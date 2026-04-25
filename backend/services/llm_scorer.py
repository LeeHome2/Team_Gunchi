"""
LLM 기반 건축 배치 종합 스코어링 서비스

학과 제공 vLLM 서버 (OpenAI 호환 API)를 활용하여
배치검토·주차·일조 분석 결과를 종합 평가합니다.
"""

import json
import os
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# ── vLLM 서버 설정 ────────────────────────────────────────
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://cellm.gachon.ac.kr:8000/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "sk-vllm-63656aa1ecac49d10d5f8496")
LLM_MODEL = os.getenv("LLM_MODEL", "text")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "30"))


def _build_prompt(
    validation: Optional[Dict[str, Any]],
    parking: Optional[Dict[str, Any]],
    sunlight: Optional[Dict[str, Any]],
) -> str:
    """분석 데이터를 기반으로 LLM 평가 프롬프트를 구성합니다."""

    sections = []

    # ── 1. 배치 검토 ─────────────────────
    if validation:
        bc = validation.get("building_coverage", {})
        sb = validation.get("setback", {})
        ht = validation.get("height", {})
        violations = validation.get("violations", [])

        sections.append(f"""### 1. 건폐율 (Building Coverage)
- 현황: {bc.get('value', 'N/A')}%
- 허용 한도: {bc.get('limit', 'N/A')}%
- 대지면적: {bc.get('site_area', 'N/A')} m²
- 건축면적: {bc.get('building_area', 'N/A')} m²
- 상태: {bc.get('status', 'N/A')}""")

        sections.append(f"""### 2. 이격거리 (Setback)
- 최소 이격거리: {sb.get('min_distance_m', 'N/A')} m
- 요구 이격거리: {sb.get('required_m', 'N/A')} m
- 상태: {sb.get('status', 'N/A')}""")

        sections.append(f"""### 3. 높이 (Height)
- 건물 높이: {ht.get('value_m', 'N/A')} m
- 높이 한도: {ht.get('limit_m', '제한 없음')} m
- 상태: {ht.get('status', 'N/A')}""")

        if violations:
            v_text = "\n".join(f"  - [{v.get('code','')}] {v.get('message','')}" for v in violations)
            sections.append(f"### 위반사항\n{v_text}")
    else:
        sections.append("### 1~3. 배치 검토: 데이터 없음")

    # ── 2. 주차 ───────────────────────
    if parking:
        required = parking.get("required_total", 0)
        placed = parking.get("placed_total", 0)
        ratio = (placed / required * 100) if required > 0 else 0
        sections.append(f"""### 4. 주차 (Parking)
- 법정 필요 대수: {required}대
- 배치 대수: {placed}대
- 충족률: {ratio:.0f}%
- 장애인 전용: 필요 {parking.get('required_disabled', 0)}대 / 배치 {parking.get('placed_disabled', 0)}대
- 주차장 면적: {parking.get('total_area_m2', 'N/A')} m²""")
    else:
        sections.append("### 4. 주차: 데이터 없음 (미분석)")

    # ── 3. 일조 ───────────────────────
    if sunlight:
        sections.append(f"""### 5. 일조 (Sunlight)
- 평균 일조시간: {sunlight.get('avg_sunlight_hours', 'N/A')}시간
- 최소 일조시간: {sunlight.get('min_sunlight_hours', 'N/A')}시간
- 최대 일조시간: {sunlight.get('max_sunlight_hours', 'N/A')}시간
- 분석 포인트 수: {sunlight.get('total_points', 'N/A')}개""")
    else:
        sections.append("### 5. 일조: 데이터 없음 (미분석)")

    data_block = "\n\n".join(sections)

    prompt = f"""당신은 건축 배치 분석 전문가입니다.
아래의 건축물 배치 분석 데이터를 종합적으로 평가해주세요.

## 분석 데이터

{data_block}

## 평가 기준

각 항목을 A(우수) ~ F(심각한 미흡) 등급으로 평가하세요:
- A: 기준을 충분히 초과 충족 (여유 있음)
- B: 기준 충족 (적정)
- C: 기준에 근접 (주의 필요)
- D: 기준 미달 (개선 필요)
- E: 기준 크게 미달 (심각)
- F: 기준 매우 심각하게 미달 또는 위반

데이터가 없는 항목은 "N" (미분석)으로 표시하세요.

## 가중치
- 건폐율: 25%
- 이격거리: 20%
- 높이: 20%
- 주차: 20%
- 일조: 15%

데이터가 없는 항목은 가중치를 나머지 항목에 재분배하세요.

## 응답 형식

반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 텍스트는 포함하지 마세요.

{{
  "건폐율": "등급",
  "이격거리": "등급",
  "높이": "등급",
  "주차": "등급 또는 N",
  "일조": "등급 또는 N",
  "overall_score": 0~100 사이 정수,
  "summary": "종합 평가를 2~3문장으로 작성",
  "suggestions": "구체적인 개선 제안을 3개 이내로 작성"
}}"""

    return prompt


def _parse_llm_response(text: str) -> Dict[str, Any]:
    """LLM 응답에서 JSON을 추출하고 파싱합니다."""
    # JSON 블록 추출 시도
    cleaned = text.strip()

    # ```json ... ``` 블록 추출
    if "```json" in cleaned:
        start = cleaned.index("```json") + 7
        end = cleaned.index("```", start)
        cleaned = cleaned[start:end].strip()
    elif "```" in cleaned:
        start = cleaned.index("```") + 3
        end = cleaned.index("```", start)
        cleaned = cleaned[start:end].strip()

    # { ... } 추출
    brace_start = cleaned.find("{")
    brace_end = cleaned.rfind("}")
    if brace_start != -1 and brace_end != -1:
        cleaned = cleaned[brace_start:brace_end + 1]

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"LLM 응답 JSON 파싱 실패: {e}\n원문: {text[:500]}")
        # 파싱 실패 시 기본값 반환
        return _fallback_score()

    # 등급 매핑 정규화
    grade_map = {"건폐율", "이격거리", "높이", "주차", "일조"}
    valid_grades = {"A", "B", "C", "D", "E", "F", "N"}
    category_grades = {}
    for key in grade_map:
        grade = str(data.get(key, "N")).upper().strip()
        if grade not in valid_grades:
            grade = "N"
        category_grades[key] = grade

    # 종합 점수
    overall = data.get("overall_score", 0)
    try:
        overall = int(overall)
        overall = max(0, min(100, overall))
    except (ValueError, TypeError):
        overall = 50

    return {
        "category_grades": category_grades,
        "overall_score": overall,
        "summary": str(data.get("summary", "")),
        "suggestions": str(data.get("suggestions", "")),
    }


def _fallback_score(
    validation: Optional[Dict[str, Any]] = None,
    parking: Optional[Dict[str, Any]] = None,
    sunlight: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """LLM 실패 시 규칙 기반 폴백 스코어를 생성합니다."""
    grades = {}
    scores = []

    # 건폐율
    if validation and validation.get("building_coverage"):
        bc = validation["building_coverage"]
        val = bc.get("value", 0)
        lim = bc.get("limit", 60)
        ratio = val / lim if lim > 0 else 1
        if ratio < 0.8:
            grades["건폐율"] = "A"
            scores.append(95)
        elif ratio < 0.9:
            grades["건폐율"] = "B"
            scores.append(85)
        elif ratio < 1.0:
            grades["건폐율"] = "C"
            scores.append(70)
        else:
            grades["건폐율"] = "E"
            scores.append(40)
    else:
        grades["건폐율"] = "N"

    # 이격거리
    if validation and validation.get("setback"):
        sb = validation["setback"]
        if sb.get("status", "").upper() in ("OK", "PASS"):
            grades["이격거리"] = "A"
            scores.append(90)
        else:
            grades["이격거리"] = "D"
            scores.append(50)
    else:
        grades["이격거리"] = "N"

    # 높이
    if validation and validation.get("height"):
        ht = validation["height"]
        if ht.get("status", "").upper() in ("OK", "PASS"):
            grades["높이"] = "A"
            scores.append(90)
        else:
            grades["높이"] = "D"
            scores.append(50)
    else:
        grades["높이"] = "N"

    # 주차
    if parking:
        req = parking.get("required_total", 0)
        placed = parking.get("placed_total", 0)
        if req > 0:
            ratio = placed / req
            if ratio >= 1.1:
                grades["주차"] = "A"
                scores.append(95)
            elif ratio >= 1.0:
                grades["주차"] = "B"
                scores.append(85)
            elif ratio >= 0.8:
                grades["주차"] = "C"
                scores.append(65)
            else:
                grades["주차"] = "E"
                scores.append(40)
        else:
            grades["주차"] = "N"
    else:
        grades["주차"] = "N"

    # 일조
    if sunlight:
        avg = sunlight.get("avg_sunlight_hours", 0)
        if avg >= 4:
            grades["일조"] = "A"
            scores.append(90)
        elif avg >= 3:
            grades["일조"] = "B"
            scores.append(80)
        elif avg >= 2:
            grades["일조"] = "C"
            scores.append(65)
        else:
            grades["일조"] = "D"
            scores.append(50)
    else:
        grades["일조"] = "N"

    overall = int(sum(scores) / len(scores)) if scores else 50

    return {
        "category_grades": grades,
        "overall_score": overall,
        "summary": "규칙 기반 자동 평가 결과입니다. LLM 서버 연결 실패로 간이 평가를 수행했습니다.",
        "suggestions": "LLM 서버 연결 후 상세 분석을 다시 요청해주세요.",
    }


async def score_placement(
    validation: Optional[Dict[str, Any]] = None,
    parking: Optional[Dict[str, Any]] = None,
    sunlight: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    배치 분석 데이터를 LLM으로 종합 평가합니다.

    Returns:
        {
            "category_grades": {"건폐율": "A", "이격거리": "B", ...},
            "overall_score": 88,
            "summary": "종합 평가...",
            "suggestions": "개선 제안...",
            "source": "llm" | "fallback"
        }
    """
    prompt = _build_prompt(validation, parking, sunlight)
    logger.info(f"LLM scoring request - prompt length: {len(prompt)} chars")

    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
            timeout=LLM_TIMEOUT,
        )

        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "당신은 건축법규와 배치 분석에 정통한 전문 평가사입니다. 반드시 JSON 형식으로만 응답하세요.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1024,
        )

        llm_text = response.choices[0].message.content
        logger.info(f"LLM response received: {len(llm_text)} chars")

        result = _parse_llm_response(llm_text)
        result["source"] = "llm"
        return result

    except ImportError:
        logger.error("openai 패키지가 설치되지 않았습니다. pip install openai")
        result = _fallback_score(validation, parking, sunlight)
        result["source"] = "fallback"
        result["error"] = "openai 패키지 미설치"
        return result

    except Exception as e:
        logger.error(f"LLM 스코어링 실패: {e}")
        result = _fallback_score(validation, parking, sunlight)
        result["source"] = "fallback"
        result["error"] = str(e)
        return result
