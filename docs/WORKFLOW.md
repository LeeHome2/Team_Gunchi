# Building Cesium 작동 방식

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                        │
│                    localhost:3000                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Cesium   │  │ Sidebar  │  │  Hooks   │  │ Zustand     │ │
│  │ 3D Viewer│  │ 컨트롤    │  │ 분석로직  │  │ 상태관리    │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────────────┐
│                    Backend (FastAPI)                         │
│                    localhost:8000                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │DXF Parser│  │GLB Export│  │Validation│  │   Database  │ │
│  │도면 파싱  │  │3D 모델   │  │규정 검토  │  │ SQLite/PG   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP (Optional)
┌────────────────────────▼────────────────────────────────────┐
│                    AI Server (별도)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  DXF 레이어 자동 분류 (wall/door/window/furniture)     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 주요 워크플로우

### 1. DXF 업로드 → 대지 추출

```
사용자                Frontend              Backend
  │                      │                     │
  │─── DXF 파일 업로드 ──→│                     │
  │                      │── POST /api/upload-dxf ──→│
  │                      │                     │
  │                      │                     ├── ezdxf로 파싱
  │                      │                     ├── 폴리곤 추출
  │                      │                     ├── 면적/중심점 계산
  │                      │                     │
  │                      │←── footprint, area ──┤
  │←── 대지 경계 표시 ────│                     │
```

**관련 파일:**
- `backend/services/dxf_parser.py` - DXF 파싱
- `backend/main.py:390` - `/api/upload-dxf` 엔드포인트

---

### 2. 3D 건물 매스 생성

```
사용자                Frontend              Backend
  │                      │                     │
  │─── 높이/층수 설정 ───→│                     │
  │─── "매스 생성" 클릭 ──→│                     │
  │                      │── POST /api/generate-mass ──→│
  │                      │                     │
  │                      │                     ├── footprint → 3D mesh
  │                      │                     ├── trimesh로 GLB 생성
  │                      │                     ├── /models/{id}.glb 저장
  │                      │                     │
  │                      │←── model_url ───────┤
  │←── Cesium에 3D 표시 ──│                     │
```

**관련 파일:**
- `backend/services/gltf_exporter.py` - GLB 생성
- `frontend/components/CesiumViewer.tsx` - 3D 렌더링

---

### 3. 건축 규정 검토

```
사용자                Frontend              Backend
  │                      │                     │
  │─── "검토" 탭 클릭 ───→│                     │
  │                      │── POST /api/validate-placement ──→│
  │                      │                     │
  │                      │                     ├── 건폐율 계산
  │                      │                     │   (건물면적/대지면적)
  │                      │                     ├── 이격거리 계산
  │                      │                     │   (대지경계↔건물)
  │                      │                     ├── 높이 제한 확인
  │                      │                     │
  │                      │←── is_valid, violations ──┤
  │←── 적합/부적합 표시 ──│                     │
```

**검토 항목:**

| 항목 | 계산 방식 | 기준 (1종일반주거) |
|------|----------|-------------------|
| 건폐율 | 건물면적 ÷ 대지면적 × 100 | ≤ 60% |
| 이격거리 | 대지경계선 ~ 건물 최소거리 | ≥ 1.5m |
| 높이제한 | 건물 최고 높이 | ≤ 16m |

**관련 파일:**
- `backend/services/validation.py` - 규정 검토 로직

---

### 4. 주차구역 배치

```
사용자                Frontend              Backend
  │                      │                     │
  │─── 주차 대수 입력 ───→│                     │
  │                      │── POST /api/parking/generate-layout ──→│
  │                      │                     │
  │                      │                     ├── 주차장법 기준 적용
  │                      │                     ├── 슬롯 자동 배치
  │                      │                     ├── 장애인 주차 계산
  │                      │                     │
  │                      │←── slots, aisles ───┤
  │←── 주차구역 3D 표시 ──│                     │
```

**관련 파일:**
- `backend/services/parking_calculator.py` - 필요 대수 계산
- `backend/services/parking_layout.py` - 배치 알고리즘

---

### 5. 일조 분석

```
사용자                Frontend (Cesium)
  │                      │
  │─── 날짜/시간 설정 ───→│
  │                      ├── 태양 위치 계산 (SunlightJS)
  │                      ├── 그림자 시뮬레이션
  │                      ├── 일조시간 히트맵 생성
  │←── 히트맵 오버레이 ───│
```

**관련 파일:**
- `frontend/lib/sunlightAnalysis.ts` - 일조 계산
- `frontend/hooks/useSunlightAnalysis.ts` - 분석 훅

---

### 6. 지적도 연동 (WFS)

```
사용자                Frontend              V-World API
  │                      │                     │
  │─── 지도 클릭 ────────→│                     │
  │                      │── GET /api/cadastral/wfs ──→│
  │                      │                     │
  │                      │←── GeoJSON 지적 데이터 ──┤
  │←── 필지 경계 표시 ────│                     │
```

**관련 파일:**
- `frontend/app/api/cadastral/wfs/route.ts` - WFS 프록시
- `frontend/hooks/useCadastral.ts` - 지적도 훅

---

## 데이터 흐름

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  DXF 파일   │───→│   Backend   │───→│  GLB 모델   │
│  (CAD 도면) │    │   Parser    │    │  (3D 메쉬)  │
└─────────────┘    └─────────────┘    └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  Database   │
                   │ - Projects  │
                   │ - DXF Files │
                   │ - Models    │
                   │ - Validation│
                   └─────────────┘
```

---

## 상태 관리 (Zustand)

```typescript
// frontend/store/projectStore.ts
{
  // 프로젝트 정보
  project: { id, name, address },

  // 대지 정보
  site: { footprint, area, centroid },

  // 건물 정보
  building: { height, floors, position, rotation },

  // 검토 결과
  validation: { isValid, coverage, setback, height },

  // 주차구역
  parking: { slots, aisles, transform },

  // 일조 분석
  sunlightAnalysis: { date, results }
}
```

---

## API 엔드포인트 요약

| Method | Endpoint | 기능 |
|--------|----------|------|
| POST | `/api/upload-dxf` | DXF 업로드 및 파싱 |
| POST | `/api/generate-mass` | 3D GLB 모델 생성 |
| POST | `/api/validate-placement` | 건축 규정 검토 |
| POST | `/api/parking/generate-layout` | 주차구역 배치 |
| POST | `/api/classify` | AI 레이어 분류 |
| POST | `/api/report` | DOCX 보고서 생성 |
| CRUD | `/api/projects/*` | 프로젝트 관리 |
| CRUD | `/api/admin/*` | 관리자 기능 |

---

## 사용자 조작

| 동작 | 기능 |
|------|------|
| 좌클릭 + 드래그 (건물) | 건물 이동 |
| 휠클릭 + 드래그 (건물) | 건물 회전 |
| 좌클릭 + 드래그 (지도) | 카메라 회전 |
| 마우스 휠 | 줌 인/아웃 |

---

## 용도지역별 건축 기준

| 용도지역 | 건폐율 | 이격거리 | 높이제한 |
|----------|--------|----------|----------|
| 제1종전용주거 | 50% | 2.0m | 10m |
| 제1종일반주거 | 60% | 1.5m | 16m |
| 제2종일반주거 | 60% | 1.5m | 20m |
| 제3종일반주거 | 50% | 2.0m | 무제한 |
| 일반상업 | 80% | 0m | 무제한 |

---

## 기술 스택

### Frontend
- Next.js 14.1.0
- CesiumJS 1.114.0
- Zustand 4.5.0
- TypeScript 5.3.3
- Tailwind CSS 3.4.1

### Backend
- FastAPI 0.109.0
- ezdxf 1.1.4 (DXF 파싱)
- Shapely 2.0.2 (기하 연산)
- trimesh 4.0.8 (3D 메쉬)
- SQLAlchemy 2.0.25

### Database
- SQLite (개발)
- PostgreSQL (프로덕션)

### AI Module
- scikit-learn (레이어 분류)
- pandas (데이터 처리)
