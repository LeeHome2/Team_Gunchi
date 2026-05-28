# Building Cesium

> **CAD 기반 3D 건축 매스 생성 및 규정 검토 시스템**
> 2026 종합설계프로젝트 (Team 건치 / Gachon CS)

개인 건축주가 CAD 도면(DXF)을 업로드하면 **3D 건물 매스를 자동 생성**하고,
Cesium 지도 위에서 **건폐율/이격거리/일조** 등 건축 규정을 실시간 검토하는 시스템입니다.

---

## 목차

- [주요 기능](#주요-기능)
- [시스템 아키텍처](#시스템-아키텍처)
- [기술 스택](#기술-스택)
- [프로젝트 구조](#프로젝트-구조)
- [설치 및 실행](#설치-및-실행)
- [API 문서](#api-문서)
- [사용자 워크플로우](#사용자-워크플로우)
- [관리자 콘솔](#관리자-콘솔)
- [데이터 형식](#데이터-형식)
- [팀 정보](#팀-정보)

---

## 주요 기능

### 사용자 기능

| 기능 | 설명 |
|------|------|
| **DXF 파일 파싱** | CAD 도면에서 대지 경계 자동 추출 (mm/cm/m 단위 자동 감지) |
| **AI 레이어 분류** | 학과 AI 서버와 연동하여 wall/door/window 레이어 자동 분류 |
| **3D 매스 생성** | DXF 도면 기반 GLB 모델 자동 생성 (LOD3: 문/창문 포함) |
| **건물 배치** | 좌클릭 드래그로 이동, 휠클릭 드래그로 회전, 스케일 조정 |
| **배치안 비교** | 여러 배치안(A/B/C) 저장 후 스코어링 비교 |
| **주차구역 자동 배치** | 건물 용도/연면적 입력 → 법정 주차대수 계산 및 자동 레이아웃 |
| **주차 경로 탐색** | A* 알고리즘으로 입구→주차장 최적 경로 시각화 |
| **규정 검토** | 건폐율, 이격거리, 높이제한 실시간 검토 |
| **일조 분석** | 날짜/시간별 일조시간 히트맵 (포인트/셀 모드) |
| **AI 스코어링** | vLLM 기반 종합 배치 평가 (카테고리별 등급 + 100점 환산) |
| **지적도 연동** | 국토정보플랫폼 WFS로 실시간 지적 데이터 |
| **건축선 분석** | 도로/인접대지 판별 및 법정 이격거리 계산 |
| **프로젝트 저장/복원** | DB 영구 저장 + JSON 파일 백업 |

### 관리자 기능

| 기능 | 설명 |
|------|------|
| **대시보드** | KPI 요약 (사용자/프로젝트/분류/검토 통계) |
| **사용자 관리** | 사용자 목록, 상태 변경, 프로젝트 조회 |
| **프로젝트 관리** | 전체 프로젝트 + DXF/분류/모델 메타데이터 |
| **AI 모델 관리** | 분류 서버 연동, 실험 목록, 모델 배포 |
| **규정 관리** | 용도지역별 건폐율/이격거리/높이 기준값 설정 |
| **검토 결과** | 전체 검증 결과 목록 및 통과율 |
| **시스템 설정** | API URL, AI 서버 URL, 로그 레벨 등 |
| **재학습 스케줄러** | 주기별/신뢰도 기반 자동 재학습 설정 |

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js 14)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ CesiumViewer│  │   Sidebar   │  │PlacementPlans │  │  projectStore    │  │
│  │  - 3D 지도   │  │  - 업로드    │  │  - 배치안 목록 │  │  (Zustand 상태)   │  │
│  │  - 건물 매스 │  │  - 매스설정  │  │  - 비교/저장   │  │  - 전체 상태 관리 │  │
│  │  - 주차구역  │  │  - 주차/검토 │  └───────────────┘  └──────────────────┘  │
│  └─────────────┘  └─────────────┘                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Admin Console (10개 페이지)                        ││
│  │  Dashboard | Users | Projects | AI Models | Regulations | Results | ... ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ REST API
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                           Backend (FastAPI)                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   dxf_parser    │  │  gltf_exporter  │  │      ai_scoring             │  │
│  │  DXF → Polygon  │  │ Polygon → GLB   │  │  vLLM 종합 평가              │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │    validation   │  │   parking       │  │      sunlight               │  │
│  │ 건폐율/이격/높이 │  │  자동 레이아웃  │  │  일조 분석 저장/조회         │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      PostgreSQL / SQLite (선택)                          ││
│  │   projects | dxf_files | classifications | validations | users | ...   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTP Proxy
              ┌────────────────────▼─────────────────────┐
              │   학과 AI 서버 (ceprj2.gachon.ac.kr)      │
              │  ┌─────────────────────────────────────┐ │
              │  │ FastAPI (port 65006)                │ │
              │  │  - /api/classify (레이어 분류)       │ │
              │  │  - /api/mlops/* (모델 관리)          │ │
              │  │  - HistGradientBoosting + TF-IDF    │ │
              │  └─────────────────────────────────────┘ │
              └────────────────────┬─────────────────────┘
                                   │ OpenAI 호환 HTTP
              ┌────────────────────▼─────────────────────┐
              │  학과 vLLM 프록시 (cellm.gachon.ac.kr)    │
              │  Qwen3.5-35B (text/vision)               │
              └──────────────────────────────────────────┘
```

---

## 기술 스택

### Frontend

| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 14.1.0 | React 프레임워크 (App Router) |
| CesiumJS | 1.114.0 | 3D 지구 시각화 |
| Zustand | 4.5.0 | 상태 관리 |
| TypeScript | 5.3.3 | 타입 안정성 |
| Tailwind CSS | 3.4.1 | 스타일링 |
| Turf.js | 7.3.4 | 지리 연산 |

### Backend

| 기술 | 버전 | 용도 |
|------|------|------|
| FastAPI | 0.109.0 | REST API 서버 |
| SQLAlchemy | 2.0+ | ORM (PostgreSQL/SQLite) |
| ezdxf | 1.1.4 | DXF 파일 파싱 |
| Shapely | 2.0.2 | 기하학 연산 |
| trimesh | 4.0.8 | 3D 메쉬 생성 (GLB) |
| pyproj | 3.6.1 | 좌표 변환 |
| httpx | 0.26+ | AI 서버 프록시 |

### 외부 서비스

| 서비스 | 용도 |
|--------|------|
| Cesium Ion | 3D 지형 + OSM Buildings |
| V-World (국토정보플랫폼) | 지적도 WFS |
| 학과 vLLM | AI 스코어링 (텍스트) |
| 학과 AI 분류 서버 | DXF 레이어 분류 |

---

## 프로젝트 구조

```
building_cesium/
├── frontend/                     # Next.js 프론트엔드
│   ├── app/                      # 페이지 및 API 라우트
│   │   ├── page.tsx              # 랜딩 페이지
│   │   ├── editor/               # 에디터 (메인 작업 공간)
│   │   │   ├── page.tsx          # 3D 에디터
│   │   │   └── result/page.tsx   # 결과 확인 (스코어링)
│   │   ├── projects/             # 프로젝트 목록
│   │   ├── admin/                # 관리자 콘솔 (10개 페이지)
│   │   └── api/                  # Next.js API 라우트 (프록시)
│   ├── components/
│   │   ├── CesiumViewer.tsx      # 3D 뷰어 (핵심)
│   │   ├── Sidebar.tsx           # 우측 사이드바 (업로드/매스/주차/검토)
│   │   ├── PlacementPlansPanel.tsx # 좌측 사이드바 (배치안 목록)
│   │   └── admin/                # 관리자 컴포넌트
│   ├── hooks/
│   │   ├── useBlockSelection.ts  # 블록 선택
│   │   ├── useBuildingLine.ts    # 건축선 분석
│   │   ├── useCadastral.ts       # 지적도 WFS
│   │   ├── useParkingZone.ts     # 주차구역 배치
│   │   └── useProjectPersistence.ts # 프로젝트 저장/복원
│   ├── store/
│   │   └── projectStore.ts       # Zustand 전역 상태 (700+ lines)
│   ├── lib/
│   │   ├── api.ts                # 백엔드 API 클라이언트
│   │   ├── sunlightAnalysis.ts   # 일조 분석 로직
│   │   ├── parkingLayout.ts      # 주차 레이아웃 알고리즘
│   │   └── projectSerializer.ts  # 프로젝트 직렬화
│   └── types/
│       ├── cesium.ts             # Cesium 관련 타입
│       └── projectFile.ts        # 프로젝트 파일 스키마
│
├── backend/                      # FastAPI 백엔드
│   ├── main.py                   # API 엔드포인트 (1900+ lines)
│   ├── api/
│   │   └── admin_routes.py       # 관리자 API (1500+ lines)
│   ├── database/
│   │   ├── config.py             # DB 연결 (RDS/SQLite 전환)
│   │   ├── models.py             # SQLAlchemy 모델
│   │   └── crud.py               # CRUD 함수
│   ├── services/
│   │   ├── dxf_parser.py         # DXF 파싱
│   │   ├── gltf_exporter.py      # GLB 생성
│   │   ├── validation.py         # 규정 검토
│   │   ├── ai_scoring.py         # vLLM 스코어링
│   │   └── retrain_scheduler.py  # 자동 재학습
│   ├── uploads/                  # 업로드된 DXF 파일
│   └── models/                   # 생성된 GLB 모델
│
├── docs/
│   ├── QUICKSTART.md             # 빠른 시작 가이드
│   └── MODULES.md                # 모듈별 개발 가이드
│
└── README.md                     # 이 문서
```

---

## 설치 및 실행

### 사전 요구사항

- Node.js 18+
- Python 3.11+
- PostgreSQL (선택, SQLite 가능)
- Cesium Ion 계정 (무료)

### 1. 저장소 클론

```bash
git clone https://github.com/LeeHome2/Team_Gunchi.git
cd Team_Gunchi/building_cesium
```

### 2. Backend 설정

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Frontend 설정

```bash
cd frontend
npm install
```

### 4. 환경 변수 설정

**backend/.env**
```env
DATABASE_URL=sqlite:///./building.db  # 또는 PostgreSQL URL
AI_SERVER_URL=http://ceprj2.gachon.ac.kr:65006
CORS_ORIGINS=http://localhost:3000
```

**frontend/.env.local**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_CESIUM_TOKEN=your_cesium_ion_token
VWORLD_API_KEY=your_vworld_api_key
```

### 5. 실행

```bash
# Terminal 1: Backend
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

### 6. 브라우저 접속

```
http://localhost:3000
```

---

## API 문서

### 프로젝트 관리

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/projects` | 프로젝트 생성 |
| GET | `/api/projects` | 프로젝트 목록 |
| GET | `/api/projects/{id}` | 프로젝트 상세 |
| PATCH | `/api/projects/{id}` | 프로젝트 수정 |
| DELETE | `/api/projects/{id}` | 프로젝트 삭제 |
| PUT | `/api/projects/{id}/state` | 에디터 상태 저장 |
| GET | `/api/projects/{id}/state` | 에디터 상태 로드 |

### DXF 파일

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/upload-dxf` | DXF 업로드 및 파싱 |
| GET | `/api/dxf-preview/{id}` | 분류 프리뷰 이미지 |
| GET | `/api/projects/{id}/dxf-files` | DXF 파일 목록 |
| DELETE | `/api/dxf-files/{id}` | DXF 삭제 |

### 3D 매스 생성

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/generate-mass` | GLB 모델 생성 |
| POST | `/api/generate-mass-multi` | 다층 매스 생성 |
| GET | `/api/models/{id}.glb` | GLB 다운로드 |

### AI 분류

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/classify` | 레이어 분류 (AI 서버 프록시) |
| GET | `/api/ai/active-model` | 활성 모델 정보 |

### 규정 검토

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/validate-placement` | 배치 규정 검토 |
| POST | `/api/projects/{id}/review` | 검토 결과 저장 |
| GET | `/api/projects/{id}/review` | 검토 결과 조회 |
| GET | `/api/regulations` | 규정 기준값 조회 |

### 주차

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/parking/use-types` | 건물 용도 목록 |
| POST | `/api/parking/calculate-required` | 필요 주차대수 계산 |
| POST | `/api/parking/generate-layout` | 주차 레이아웃 생성 |

### 일조 분석

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/projects/{id}/sunlight-analysis` | 일조 분석 저장 |
| GET | `/api/projects/{id}/sunlight-analysis` | 일조 분석 조회 |
| DELETE | `/api/projects/{id}/sunlight-analysis/{aid}` | 일조 분석 삭제 |

### AI 스코어링

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/ai-scoring` | 종합 배치 평가 (vLLM) |

### 관리자 API (`/api/admin/*`)

| Category | Endpoints |
|----------|-----------|
| Dashboard | `GET /dashboard` |
| Users | `GET/POST /users`, `PATCH/DELETE /users/{id}` |
| Projects | `GET /projects`, `GET/DELETE /projects/{id}` |
| AI MLOps | `GET /ai/experiments`, `POST /ai/deploy`, `POST /ai/check-connection` |
| Regulations | `GET/PUT /regulations/base`, `GET/POST/PATCH/DELETE /regulations/zones` |
| Results | `GET /results` |
| Settings | `GET/PUT /service/settings`, `GET /service/endpoints` |
| Retrain | `GET /retrain/status`, `POST /retrain/trigger` |

---

## 사용자 워크플로우

### 기본 플로우

1. **로그인** → 프로젝트 생성/선택
2. **지역 선택** → 지도에서 위치 클릭 (지적도 자동 로드)
3. **영역 선택** → 대지 블록 클릭
4. **DXF 업로드** → AI 레이어 분류 → 3D 매스 자동 생성
5. **건물 배치** → 드래그로 이동/회전
6. **주차구역 생성** → 건물 용도/면적 입력 → 자동 레이아웃
7. **규정 검토** → 건폐율/이격/높이 실시간 확인
8. **일조 분석** → 날짜 선택 → 히트맵 생성
9. **결과 확인** → AI 스코어링 → 배치안 저장

### 배치안 비교 플로우

1. 햄버거 버튼(≡) 클릭 → 좌측 배치안 패널 열기
2. **배치안 추가** → 현재 배치 저장 (이름/설명)
3. 다른 배치 시도 → 추가 배치안 저장
4. 배치안 클릭 → 해당 상태 복원
5. **결과 확인** 페이지에서 스코어 비교

### 마우스 조작

| 동작 | 기능 |
|------|------|
| 좌클릭 + 드래그 (건물/주차) | 이동 |
| 휠클릭 + 드래그 (건물/주차) | 회전 |
| 좌클릭 + 드래그 (지도) | 카메라 회전 |
| 마우스 휠 | 줌 인/아웃 |

---

## 관리자 콘솔

`/admin` 경로에서 접근 (10개 페이지)

| 페이지 | 경로 | 기능 |
|--------|------|------|
| 대시보드 | `/admin` | KPI 요약 |
| 사용자 관리 | `/admin/users` | 사용자 CRUD |
| 프로젝트 관리 | `/admin/projects` | 프로젝트 상세 |
| AI 모델 관리 | `/admin/ai` | 분류 서버 연동, 배포 |
| 규정 관리 | `/admin/regulations` | 용도지역별 기준값 |
| 검토 결과 | `/admin/results` | 검증 통과율 |
| 인증 관리 | `/admin/auth` | 관리자 계정/API 키 |
| 로그 | `/admin/logs` | 시스템 로그 |
| 시스템 설정 | `/admin/settings` | 서비스 설정 |
| DB 관리 | `/admin/database` | RDS/SQLite 전환 |

---

## 데이터 형식

### 프로젝트 상태 (ProjectFile)

```typescript
interface ProjectFile {
  version: string              // "1.0.0"
  savedAt: string              // ISO timestamp
  projectName?: string

  // 카메라
  camera: { position, heading, pitch, roll }
  currentTime: { isoString: string }

  // 작업 영역
  workArea: { longitude, latitude, address, displayName } | null
  modelTransform: { longitude, latitude, height, rotation, scale }

  // 건물/대지
  building: { height, floors, footprint } | null
  site: { footprint, area, centroid, bounds } | null

  // 매스 모델
  generatedMasses: GeneratedMass[]
  activeMassGlbUrl: string | null

  // 주차
  parkingZone: ParkingZoneData | null
  parkingEntrance: ParkingEntranceData | null
  parkingPath: ParkingPathData | null
  parkingConfig: { buildingUse, grossFloorArea, ramp, requiredTotal, ... }

  // 배치안
  placementPlans: PlacementPlan[]
  activePlanId: string | null

  // 기타
  cadastralData, selectedBlocks, buildingLineResult, hiddenBuildingIds, ...
}
```

### 배치안 (PlacementPlan)

```typescript
interface PlacementPlan {
  id: string
  name: string
  description?: string

  // 스냅샷
  modelTransform: { longitude, latitude, height, rotation, scale }
  generatedMasses: GeneratedMass[]
  parkingZone: ParkingZoneData | null
  parkingTransform: { longitude, latitude, rotation }
  parkingPath: ParkingPathData | null

  // AI 스코어
  aiScore?: {
    overallScore: number
    categoryGrades: Record<string, string>
    summary: string
  }

  createdAt: number
  updatedAt: number
}
```

### AI 분류 응답

```json
{
  "model_version": "v_20260425_011526",
  "total_entities": 100,
  "class_counts": { "wall": 35, "door": 5, "window": 12, "other": 48 },
  "average_confidence": 0.98,
  "layer_decisions": {
    "WALL": "wall",
    "DOOR": "door",
    "WINDOW-001": "window"
  },
  "predictions": [
    { "entity_id": "1", "raw_layer": "WALL", "predicted_class": "wall", "confidence": 1.0 }
  ]
}
```

### AI 스코어링 응답

```json
{
  "categoryGrades": {
    "규정 준수": "A",
    "주차 효율": "B",
    "일조 환경": "A",
    "접근성": "B",
    "공간 활용": "A"
  },
  "overallScore": 85,
  "summary": "전반적으로 우수한 배치입니다. 건폐율 45.5%로 기준 이내...",
  "suggestions": "주차 입구 위치를 도로 측면으로 조정하면...",
  "source": "llm"
}
```

---

## 변경 이력 (Changelog)

### v1.1.0 (2026-05-29)

**성능 최적화 및 기능 개선**

| 항목 | 변경 내용 |
|------|----------|
| **AI 모델 페이지 최적화** | 초기 로딩 시 5개 API 병렬 호출로 변경 (`Promise.all`). 하위 컴포넌트에 preloaded 데이터 전달하여 중복 API 호출 제거 |
| **KST 타임존 적용** | 관리자 콘솔 전체 (17개 파일)의 시간 표시를 `Asia/Seoul` 타임존으로 통일 |
| **Gemini 이미지 생성** | Google Gemini API (`gemini-2.5-flash-image`) 기반 AI 렌더링 추가. GPT 대신 Nano Banana 사용 |
| **일조 분석 개선** | 샘플링 기반 일조 분석 로직 성능 최적화, AI 스코어링에 일조 데이터 연동 |

**수정된 주요 파일**:
- `frontend/app/admin/ai/page.tsx` — API 병렬 호출, preloaded 데이터 관리
- `frontend/components/admin/DatasetsPanel.tsx` — preloadedData prop 지원
- `frontend/components/admin/ProcessedDatasetsPanel.tsx` — preloadedData prop 지원
- `frontend/components/admin/JobProgressPanel.tsx` — preloadedJobs/Experiments prop 지원
- `frontend/app/api/ai-render-gemini/route.ts` — Gemini 이미지 생성 API 라우트
- `frontend/lib/sunlightAnalysis.ts` — 일조 분석 로직 개선
- `frontend/app/editor/result/page.tsx` — Gemini 렌더링 통합

---

## 팀 정보

**Team 건치 (Geonchi)** — 2026 종합설계프로젝트

- 지도교수: 이병문 교수 (가천대학교 컴퓨터공학과)
- 팀장: 신재훈
- 팀원: 김상현
- 팀원: 서민혁
- 팀원: **이호민** (프로젝트 개발 총괄)

### 관련 프로젝트

- [Team_Gunchi (메인)](https://github.com/LeeHome2/Team_Gunchi) — building_cesium
- [Team_Gunchi_classifier](https://github.com/LeeHome2/Team_Gunchi_classifier) — AI 레이어 분류 모듈

---

## 라이선스

MIT License
