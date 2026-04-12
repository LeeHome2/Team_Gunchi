"""
주차장법 시행규칙 별표1 기반 필요 주차 대수 산정

한국 주차장법 시행규칙 별표1(부설주차장 설치기준) 기준으로
건물 용도 · 연면적에 따른 최소 필요 주차 대수를 자동 산출한다.

참고:
  - 주차장법 시행규칙 [별표 1] 부설주차장의 설치대상 시설물 종류 및 설치기준
  - 장애인 주차구역: 전체 대수의 2~4% (장애인·노인·임산부 등의 편의증진 보장에 관한 법률)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional


# ── 용도별 주차 대수 산정 기준 ─────────────────────────────
# key: 건물 용도 한글명
# value: (기준면적 m², 기준대수)  → 연면적 ÷ 기준면적 × 기준대수 후 올림
#
# 예) 근린생활시설: 134m² 당 1대  →  연면적 500m²  ⇒  ceil(500/134) = 4대

PARKING_RATIO_TABLE: dict[str, tuple[float, int]] = {
    # ── 주거 ──
    "단독주택":      (150.0, 1),   # 시설면적 150m²당 1대
    "다가구주택":    (150.0, 1),
    "다세대주택":    (150.0, 1),   # 세대당 1대 (최소)
    "아파트":        (85.0,  1),   # 전용면적 85m² 이하 세대당 1대 기준 간소화
    "공동주택":      (85.0,  1),
    "주거":          (150.0, 1),   # 일반 주거 fallback

    # ── 상업/근생 ──
    "제1종근린생활시설": (134.0, 1),
    "제2종근린생활시설": (134.0, 1),
    "근린생활시설":      (134.0, 1),
    "근생":              (134.0, 1),
    "판매시설":          (134.0, 1),
    "상업":              (134.0, 1),

    # ── 업무 ──
    "업무시설":      (100.0, 1),
    "업무":          (100.0, 1),
    "오피스":        (100.0, 1),

    # ── 문화/집회 ──
    "문화및집회시설": (100.0, 1),
    "종교시설":      (150.0, 1),
    "관람장":        (100.0, 1),
    "집회장":        (100.0, 1),

    # ── 의료/교육 ──
    "의료시설":      (100.0, 1),
    "병원":          (100.0, 1),
    "교육연구시설":  (150.0, 1),
    "학교":          (150.0, 1),

    # ── 숙박/위락 ──
    "숙박시설":      (134.0, 1),
    "위락시설":      (100.0, 1),

    # ── 공장/창고 ──
    "공장":          (300.0, 1),
    "창고시설":      (300.0, 1),
    "운수시설":      (200.0, 1),

    # ── 기타 ──
    "기타":          (200.0, 1),
}


@dataclass
class ParkingRequirement:
    """필요 주차 대수 산정 결과"""

    building_use: str                       # 건물 용도
    gross_floor_area_m2: float              # 연면적 (m²)
    ratio_area_m2: float                    # 기준 면적
    ratio_count: int                        # 기준 대수
    required_total: int                     # 총 필요 대수 (올림)
    required_disabled: int                  # 장애인 전용 (2~4 %)
    required_standard: int                  # 일반
    ramp_extra_factor: float = 1.0          # 자주식 경사로 보정 계수
    note: str = ""


def calculate_required_parking(
    building_use: str,
    gross_floor_area_m2: float,
    *,
    ramp: bool = False,
    disabled_ratio: float = 0.04,
) -> ParkingRequirement:
    """
    주차장법 기반 필요 주차 대수 산정.

    Parameters
    ----------
    building_use : str
        건물 용도 (한글, PARKING_RATIO_TABLE 키)
    gross_floor_area_m2 : float
        연면적 (m²)
    ramp : bool
        자주식(경사로) 주차 여부 — True이면 면적 1.3배 보정
    disabled_ratio : float
        장애인 주차 비율 (기본 4%)

    Returns
    -------
    ParkingRequirement
    """
    # 테이블 조회 (없으면 "기타" fallback)
    ratio = PARKING_RATIO_TABLE.get(building_use)
    note = ""
    if ratio is None:
        ratio = PARKING_RATIO_TABLE["기타"]
        note = f"'{building_use}' 용도 미등록 — '기타' 기준 적용"

    area_per_unit, count_per_unit = ratio

    # 기본 대수 = ceil(연면적 ÷ 기준면적) × 기준대수
    raw = (gross_floor_area_m2 / area_per_unit) * count_per_unit
    required_total = max(1, math.ceil(raw))

    # 장애인 주차 (최소 1대)
    required_disabled = max(1, math.ceil(required_total * disabled_ratio))
    required_standard = required_total - required_disabled

    # 자주식 보정 — 경사로 + 차로 면적 때문에 대수 자체는 동일하나
    # 배치 알고리즘에서 면적 1.3배 보정 참고용
    ramp_factor = 1.3 if ramp else 1.0

    return ParkingRequirement(
        building_use=building_use,
        gross_floor_area_m2=gross_floor_area_m2,
        ratio_area_m2=area_per_unit,
        ratio_count=count_per_unit,
        required_total=required_total,
        required_disabled=required_disabled,
        required_standard=required_standard,
        ramp_extra_factor=ramp_factor,
        note=note,
    )


def get_available_use_types() -> list[str]:
    """UI 드롭다운용 용도 목록"""
    return sorted(PARKING_RATIO_TABLE.keys())
