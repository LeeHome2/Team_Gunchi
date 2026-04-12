# AI 모델 인터페이스 정의서

> 프론트/백엔드 ↔ AI 서버 간 입출력 스펙
>
> Last Updated: 2026-04-10

---

## 개요

### 시스템 구성

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Frontend   │────▶│   Backend    │────▶│   AI Server      │
│  (Next.js)   │◀────│  (FastAPI)   │◀────│  (FastAPI/Flask)  │
│  port:3000   │     │  port:8000   │     │  port:8001        │
└──────────────┘     └──────────────┘     └──────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  OpenAI API  │
                     │  (GPT-4)     │
                     └──────────────┘
```

### 담당 구분

| 담당 | 범위 | 역할 |
|------|------|------|
| **호민** | Frontend + Backend | API 호출, UI, 데이터 전달, 이미지 LLM 연결 |
| **팀원** | AI Server | 모델 개발/학습, 서버 탑재, API 엔드포인트 구현 |

### 연동 흐름

```
Frontend → Backend → AI Server   (AI 모델 호출)
Frontend → Backend → OpenAI API  (이미지 생성)
```

Backend가 모든 외부 호출의 중간 다리 역할. Frontend는 AI Server를 직접 호출하지 않는다.

---

## AI 모델 1: 레이어 자동 분류

> DXF 도면의 레이어명을 건축 요소(벽, 문, 창문 등)로 자동 분류

### 엔드포인트

```
POST  http://ai-server:8001/api/classify
```

### Request

```jsonc
{
  // DXF에서 추출한 엔티티 데이터
  "entities": [
    {
      "entity_type": "LINE",           // enum: LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE, POLYLINE, SPLINE, TEXT, MTEXT, INSERT, DIMENSION
      "layer": "MURO_EXTERIOR",        // 원본 레이어명 (분류 대상)
      "start_x": 10.5,                 // LINE: 시작점 X
      "start_y": 5.2,                  // LINE: 시작점 Y
      "end_x": 20.3,                   // LINE: 끝점 X
      "end_y": 5.2,                    // LINE: 끝점 Y
      "length": 9.8,                   // LINE: 선 길이 (미터)
      "center_x": null,               // CIRCLE/ARC: 중심점 X
      "center_y": null,               // CIRCLE/ARC: 중심점 Y
      "radius": null,                 // CIRCLE/ARC: 반경
      "vertices": null,               // LWPOLYLINE: [[x,y], ...] JSON 문자열
      "vertex_count": null,           // LWPOLYLINE: 꼭지점 수
      "closed": null,                 // LWPOLYLINE: 닫힌 도형 여부
      "text": null                    // TEXT/MTEXT: 텍스트 내용
    }
    // ... 수백~수천 개
  ],

  // 선택: 파일 메타데이터
  "source_filename": "1층_평면도.dxf",

  // 선택: 사용할 모델 지정 (없으면 서버 기본 모델)
  "model_version": null
}
```

### Response

```jsonc
{
  "success": true,
  "model_version": "v2.1.0",          // 사용된 모델 버전
  "model_type": "random_forest",      // "rule_based" | "random_forest" | "bert" 등

  "predictions": [
    {
      "index": 0,                      // entities 배열의 인덱스
      "layer": "MURO_EXTERIOR",        // 원본 레이어명
      "predicted_class": "wall",       // 분류 결과
      "confidence": 0.94,             // 신뢰도 (0.0 ~ 1.0)
      "probabilities": {              // 클래스별 확률 (합계 1.0)
        "wall": 0.94,
        "door": 0.02,
        "window": 0.01,
        "stair": 0.0,
        "furniture": 0.01,
        "dimension": 0.0,
        "text": 0.0,
        "other": 0.02
      }
    }
    // ... entities 수만큼
  ],

  // 분류 통계 요약
  "summary": {
    "total_entities": 1250,
    "class_counts": {
      "wall": 400,
      "door": 30,
      "window": 25,
      "stair": 10,
      "furniture": 85,
      "dimension": 200,
      "text": 350,
      "other": 150
    },
    "average_confidence": 0.87
  }
}
```

### 분류 클래스 정의 (8개)

| class | 설명 | 대표 키워드 |
|-------|------|------------|
| `wall` | 벽체 | WALL, MURO, 벽, 벽체 |
| `door` | 문 | DOOR, PUERTAS, 문 |
| `window` | 창문 | WINDOW, VENTANA, 창 |
| `stair` | 계단 | STAIR, ESCALERA, 계단 |
| `furniture` | 가구/설비 | FURNITURE, MUEBLES, 가구 |
| `dimension` | 치수선 | DIM, COTAS, 치수 |
| `text` | 텍스트/주석 | TEXT, TEXTO, 주석 |
| `other` | 기타 | 분류 불가 |

### 에러 응답

```jsonc
{
  "success": false,
  "error": {
    "code": "MODEL_NOT_FOUND",       // 에러 코드
    "message": "지정된 모델 버전을 찾을 수 없습니다"
  }
}
```

---

## AI 모델 2: 최적 배치

> 향, 일조, 동선 등을 스코어링하여 최적의 건물 배치를 추천

### 엔드포인트

```
POST  http://ai-server:8001/api/optimize-placement
```

### Request

```jsonc
{
  // 대지 정보
  "site": {
    "footprint": [[126.978, 37.566], [126.979, 37.566], ...],  // 대지 경계 [lon, lat]
    "area_sqm": 450.5,                                          // 대지 면적 (m²)
    "zone_type": "제1종일반주거지역"                               // 용도지역
  },

  // 건축선 정보 (건축 가능 영역)
  "buildable_area": {
    "polygon": [[126.978, 37.566], ...],     // 건축선 폴리곤 [lon, lat]
    "edge_infos": [
      {
        "type": "road",                       // "road" | "adjacent_lot"
        "setback_distance": 1.0,              // 이격거리 (m)
        "start": {"lon": 126.978, "lat": 37.566},
        "end": {"lon": 126.979, "lat": 37.566},
        "length": 12.5                        // 변 길이 (m)
      }
    ]
  },

  // 건물 정보
  "building": {
    "footprint": [[0, 0], [10, 0], [10, 8], [0, 8]],  // 로컬 좌표 (m), 원점 기준
    "width": 10.0,       // m
    "depth": 8.0,        // m
    "height": 9.0,       // m
    "floors": 3
  },

  // 주변 건물 정보 (일조 분석용)
  "nearby_buildings": [
    {
      "footprint": [[126.977, 37.567], ...],   // [lon, lat]
      "height": 15.0                            // m
    }
  ],

  // 규정 제한
  "constraints": {
    "coverage_limit": 60.0,         // 건폐율 제한 (%)
    "height_limit": 16.0,           // 높이 제한 (m), null이면 제한 없음
    "setback_road": 1.0,            // 도로변 이격거리 (m)
    "setback_adjacent": 0.5         // 인접대지 이격거리 (m)
  },

  // 분석 설정
  "options": {
    "analysis_date": "2026-06-21",             // 일조 분석 기준일 (하지 기본)
    "max_candidates": 10,                      // 최대 후보 수
    "weights": {                               // 스코어링 가중치 (합계 1.0)
      "orientation": 0.25,                     // 향 (남향 선호도)
      "sunlight": 0.30,                        // 일조 시간
      "circulation": 0.20,                     // 동선 (도로 접근성)
      "coverage_efficiency": 0.15,             // 건폐율 활용도
      "setback_margin": 0.10                   // 이격거리 여유
    }
  }
}
```

### Response

```jsonc
{
  "success": true,
  "model_version": "v1.0.0",

  // 최적 배치 후보 (점수 내림차순 정렬)
  "candidates": [
    {
      "rank": 1,
      "placement": {
        "longitude": 126.9785,               // 건물 중심 경도
        "latitude": 37.5662,                 // 건물 중심 위도
        "rotation": 15.0,                    // Z축 회전 (도, 0=북향)
        "height": 0.0                        // 지상 높이 오프셋 (m)
      },

      // 종합 점수 (0.0 ~ 1.0)
      "total_score": 0.87,

      // 항목별 점수 (0.0 ~ 1.0)
      "scores": {
        "orientation": {
          "score": 0.92,
          "detail": "남남동향, 주출입구 남측 배치"
        },
        "sunlight": {
          "score": 0.85,
          "detail": "평균 일조시간 7.2시간, 최소 4시간 확보",
          "avg_sunlight_hours": 7.2,
          "min_sunlight_hours": 4.0
        },
        "circulation": {
          "score": 0.90,
          "detail": "주도로 접근 거리 2.1m, 보행 동선 양호",
          "road_access_distance": 2.1
        },
        "coverage_efficiency": {
          "score": 0.78,
          "detail": "건폐율 48.5% (제한 60%)",
          "building_coverage": 48.5,
          "coverage_limit": 60.0
        },
        "setback_margin": {
          "score": 0.82,
          "detail": "최소 이격거리 1.2m (요구 1.0m)",
          "min_setback": 1.2,
          "required_setback": 1.0
        }
      },

      // 규정 준수 여부
      "compliance": {
        "is_valid": true,
        "violations": []
      }
    }
    // ... max_candidates 개까지
  ],

  // 분석 메타데이터
  "metadata": {
    "total_evaluated": 500,                 // 탐색한 총 후보 수
    "computation_time_ms": 3200,            // 계산 소요 시간
    "analysis_date": "2026-06-21"
  }
}
```

### 에러 응답

```jsonc
{
  "success": false,
  "error": {
    "code": "INVALID_SITE",                  // 에러 코드
    "message": "대지 폴리곤이 유효하지 않습니다"
  }
}
```

---

## 이미지 생성 (GPT-4 API)

> GPT-4 이미지 생성 API로 조감도/배치도 생성 (호민 담당, Backend에서 직접 호출)

### 엔드포인트

```
POST  http://backend:8000/api/generate-image
```

### Request

```jsonc
{
  // 이미지 유형
  "image_type": "birds_eye",          // "birds_eye" (조감도) | "site_plan" (배치도) | "perspective" (투시도)

  // 배치 정보
  "placement": {
    "site": {
      "footprint": [[126.978, 37.566], ...],   // 대지 경계 [lon, lat]
      "area_sqm": 450.5,
      "zone_type": "제1종일반주거지역",
      "address": "서울시 종로구 ..."              // 선택
    },
    "building": {
      "footprint": [[0, 0], [10, 0], [10, 8], [0, 8]],  // 로컬 좌표 (m)
      "height": 9.0,
      "floors": 3,
      "position": {"longitude": 126.9785, "latitude": 37.5662},
      "rotation": 15.0
    },
    "nearby_buildings": [
      {"height": 15.0, "distance": 8.5, "direction": "north"}
    ]
  },

  // 렌더링 스타일 (선택)
  "style": {
    "season": "spring",               // "spring" | "summer" | "autumn" | "winter"
    "time_of_day": "afternoon",        // "morning" | "afternoon" | "evening"
    "render_style": "realistic",       // "realistic" | "sketch" | "watercolor"
    "include_landscaping": true,       // 조경 포함 여부
    "include_context": true            // 주변 환경 포함 여부
  },

  // GPT-4 API 설정
  "api_config": {
    "size": "1024x1024",              // "1024x1024" | "1792x1024" | "1024x1792"
    "quality": "hd"                   // "standard" | "hd"
  }
}
```

### Response

```jsonc
{
  "success": true,
  "images": [
    {
      "image_type": "birds_eye",
      "url": "/api/images/generated/abc123.png",    // 다운로드 URL
      "prompt_used": "Aerial bird's eye view of a 3-story residential building...",
      "size": "1024x1024",
      "created_at": "2026-04-10T14:30:00Z"
    }
  ]
}
```

---

## 공통 규격

### HTTP 헤더

```
Content-Type: application/json
Accept: application/json
```

### 에러 코드 목록

| 코드 | 설명 | 발생 위치 |
|------|------|----------|
| `MODEL_NOT_FOUND` | 지정된 모델 버전 없음 | AI 분류 |
| `MODEL_LOADING` | 모델 로딩 중 | AI 분류, 최적배치 |
| `INVALID_ENTITIES` | 엔티티 데이터 형식 오류 | AI 분류 |
| `INVALID_SITE` | 대지 폴리곤 오류 | 최적배치 |
| `INVALID_BUILDING` | 건물 정보 오류 | 최적배치 |
| `COMPUTATION_TIMEOUT` | 계산 시간 초과 | 최적배치 |
| `API_ERROR` | 외부 API 호출 실패 | 이미지 생성 |
| `QUOTA_EXCEEDED` | API 사용량 초과 | 이미지 생성 |
| `INTERNAL_ERROR` | 서버 내부 오류 | 전체 |

### 좌표계 규칙

| 데이터 | 좌표계 | 형식 |
|--------|--------|------|
| 대지/블록 경계 | WGS84 (EPSG:4326) | `[longitude, latitude]` |
| 건물 footprint (로컬) | 미터 좌표 | `[x, y]`, 원점 = 건물 중심 |
| 높이/길이/면적 | 미터 (SI) | `float` |
| 회전 | 도 (degree) | `float`, 0 = 북향, 시계방향 양수 |
| 신뢰도/점수 | 정규화 | `float`, 0.0 ~ 1.0 |

### 헬스 체크

```
GET  http://ai-server:8001/health

Response:
{
  "status": "healthy",
  "models_loaded": {
    "classifier": {"version": "v2.1.0", "type": "random_forest", "ready": true},
    "optimizer": {"version": "v1.0.0", "type": "genetic_algorithm", "ready": true}
  },
  "uptime_seconds": 3600
}
```

---

## 데이터 흐름 다이어그램

### 레이어 분류 흐름

```
[Frontend]                    [Backend]                     [AI Server]
    │                             │                              │
    │  POST /api/upload-dxf       │                              │
    │  (DXF 파일)                 │                              │
    │────────────────────────────▶│                              │
    │                             │  dxf_parser.py               │
    │                             │  엔티티 추출                  │
    │                             │                              │
    │                             │  POST /api/classify          │
    │                             │  (entities 배열)              │
    │                             │─────────────────────────────▶│
    │                             │                              │  모델 추론
    │                             │    predictions 반환           │
    │                             │◀─────────────────────────────│
    │                             │                              │
    │                             │  wall 엔티티만 필터           │
    │                             │  → GLB 생성                  │
    │                             │                              │
    │  {site, glb_url, classes}   │                              │
    │◀────────────────────────────│                              │
```

### 최적 배치 흐름

```
[Frontend]                    [Backend]                     [AI Server]
    │                             │                              │
    │  site + building +          │                              │
    │  buildingLine 데이터         │                              │
    │────────────────────────────▶│                              │
    │                             │  POST /api/optimize          │
    │                             │  (site, building,            │
    │                             │   constraints, options)       │
    │                             │─────────────────────────────▶│
    │                             │                              │  최적화 탐색
    │                             │                              │  스코어링
    │                             │    candidates 반환            │
    │                             │◀─────────────────────────────│
    │                             │                              │
    │  candidates (Top N)         │                              │
    │◀────────────────────────────│                              │
    │                             │                              │
    │  사용자가 배치 선택          │                              │
    │  → Cesium에 적용            │                              │
```

### 이미지 생성 흐름

```
[Frontend]                    [Backend]                     [OpenAI API]
    │                             │                              │
    │  POST /api/generate-image   │                              │
    │  (placement, style)         │                              │
    │────────────────────────────▶│                              │
    │                             │  프롬프트 생성                │
    │                             │  (배치 데이터 → 텍스트)       │
    │                             │                              │
    │                             │  POST /v1/images/generations │
    │                             │  (GPT-4 API)                 │
    │                             │─────────────────────────────▶│
    │                             │                              │  이미지 생성
    │                             │    image URL 반환             │
    │                             │◀─────────────────────────────│
    │                             │                              │
    │                             │  이미지 다운로드 + 저장       │
    │                             │                              │
    │  {image_url}                │                              │
    │◀────────────────────────────│                              │
```

---

## 기존 코드 매핑

현재 프로젝트 코드와 이 인터페이스가 어떻게 연결되는지 참고.

### AI Server (팀원 구현)

| 인터페이스 | 현재 코드 참고 | 비고 |
|-----------|--------------|------|
| `POST /api/classify` | `ai/src/classifier.py` → `classify_dataframe()` | HTTP 래핑 필요 |
| `POST /api/optimize-placement` | 없음 (신규 개발) | 스코어링 모델 설계 필요 |
| `GET /health` | 없음 | 모델 로딩 상태 포함 |

### Backend (호민 구현)

| 인터페이스 | 현재 코드 참고 | 비고 |
|-----------|--------------|------|
| DXF 파싱 → AI 호출 | `backend/main.py` → `upload_dxf()` | AI Server HTTP 호출 추가 |
| 최적 배치 프록시 | 없음 | 엔드포인트 신규 추가 |
| 이미지 생성 | 없음 | GPT-4 API 연결 신규 추가 |
| GLB 생성 | `backend/services/gltf_exporter.py` | 기존 유지 |
| 규정 검토 | `backend/services/validation.py` | 기존 유지 |

### Frontend (호민 구현)

| 인터페이스 | 현재 코드 참고 | 비고 |
|-----------|--------------|------|
| DXF 업로드 | `frontend/lib/api.ts` → `uploadDxf()` | 분류 결과 UI 추가 |
| 최적 배치 결과 표시 | `frontend/components/CesiumViewer.tsx` | 후보 배치 시각화 추가 |
| 이미지 표시 | 없음 | 이미지 뷰어 UI 추가 |
| 건축선/일조 | `frontend/lib/buildingLine.ts`, `sunlightAnalysis.ts` | 기존 유지 |
