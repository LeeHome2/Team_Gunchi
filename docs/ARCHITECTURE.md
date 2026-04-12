# Building Cesium - System Architecture

> 건축 도면(DXF) 기반 3D 배치 검토 및 AI 최적화 플랫폼
>
> Last Updated: 2026-04-09

---

## 1. 시스템 개요

DXF 건축 도면을 입력받아 AI 레이어 분류, 3D 모델 생성, Cesium 기반 배치, 건축 규정 검토, AI 최적 배치 추천, 이미지 생성까지의 End-to-End 파이프라인.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE OVERVIEW                                │
│                                                                         │
│  DXF 도면 입력                                                          │
│      ↓                                                                  │
│  [1] 도면 파싱 + AI 레이어 분류  ──────── ai/src/ (Python)              │
│      ↓                                                                  │
│  [2] 외벽 추출 → GLB 3D 모델 생성 ────── ai/src/exporter.py            │
│      ↓                                    backend/services/             │
│  [3] Cesium 3D 지도에 모델 로드/배치 ──── frontend/ (Next.js + Cesium)  │
│      ↓                                                                  │
│  [4] 건축 규정 검토                                                     │
│      ├─ 건축선 (이격거리)                                               │
│      ├─ 높이 제한                                                       │
│      └─ 일조권 분석                                                     │
│      ↓                                                                  │
│  [5] AI 최적 배치 (향/일조/동선 스코어링) ── 미구현                     │
│      ↓                                                                  │
│  [6] 이미지 생성 AI (조감도/배치도) ──────── 미구현                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 기술 스택

| 계층 | 기술 | 비고 |
|------|------|------|
| **Frontend** | Next.js 14.1, React 18.2, TypeScript 5.3 | App Router |
| **3D 렌더링** | CesiumJS 1.114, Resium 1.17 | 3D 지구본 뷰어 |
| **상태관리** | Zustand 4.5 | 전역 상태 |
| **공간분석** | Turf.js 7.3 | 기하학 연산 |
| **Backend** | FastAPI (Python) | REST API |
| **DXF 파싱** | ezdxf 1.1 | CAD 파일 처리 |
| **3D 모델링** | Trimesh 4.0 | 메쉬 생성/GLB 내보내기 |
| **좌표변환** | PyProj 3.6 | EPSG 좌표계 |
| **기하연산** | Shapely 2.0 | 폴리곤 연산 |
| **AI/ML** | scikit-learn 1.3 | TF-IDF + Random Forest |
| **인프라** | Docker Compose | 컨테이너화 |

---

## 3. 디렉토리 구조

```
building_cesium/
│
├── frontend/                          # Next.js 프론트엔드
│   ├── app/
│   │   ├── page.tsx                   # 메인 페이지 (단일 SPA)
│   │   ├── layout.tsx                 # 루트 레이아웃
│   │   └── api/                       # Next.js API Routes (프록시)
│   │       ├── cadastral/             # V-World 지적도 WMS/WFS 프록시
│   │       │   ├── route.ts           #   WMS 이미지 타일
│   │       │   ├── wfs/route.ts       #   WFS 벡터 데이터 (GML→GeoJSON)
│   │       │   └── capabilities/      #   WFS 메타데이터
│   │       ├── zone/wfs/route.ts      # 용도지역 조회
│   │       └── models/                # GLB 모델 서빙
│   │           ├── route.ts           #   모델 목록 + 바운딩박스
│   │           └── [filename]/route.ts#   모델 파일 다운로드
│   │
│   ├── components/
│   │   ├── CesiumViewer.tsx           # 메인 3D 뷰어 (핵심 컴포넌트)
│   │   ├── Sidebar.tsx                # 좌측 패널 (DXF 업로드, 매스 설정, 검토)
│   │   ├── ControlPanel.tsx           # 프로젝트 정보/뷰 모드
│   │   ├── SaveLoadToolbar.tsx        # 저장/불러오기
│   │   └── ErrorBanner.tsx            # 에러 표시
│   │
│   ├── hooks/                         # React Custom Hooks
│   │   ├── useCesiumViewer.ts         # Cesium 초기화 + OSM Buildings
│   │   ├── useCadastral.ts            # 지적도 로드/표시
│   │   ├── useBlockSelection.ts       # 필지 선택 (클릭)
│   │   ├── useBuildingLine.ts         # 건축선 계산/표시
│   │   ├── useSunlightAnalysis.ts     # 일조권 분석 UI
│   │   ├── useOsmBuildings.ts         # OSM 건물 숨기기
│   │   └── useProjectPersistence.ts   # 프로젝트 저장/복원
│   │
│   ├── lib/                           # 순수 로직 함수
│   │   ├── api.ts                     # 백엔드 API 클라이언트
│   │   ├── building.ts                # 건물 엔티티 생성
│   │   ├── buildingLine.ts            # 건축선 계산 알고리즘 (핵심)
│   │   ├── setbackTable.ts            # 용도지역별 이격거리 테이블
│   │   ├── sunlightAnalysis.ts        # 일조 계산 알고리즘 (핵심)
│   │   ├── sunlightHeatmap.ts         # 히트맵 렌더링
│   │   ├── sunlightApi.ts             # 일조 API (예비)
│   │   ├── coordinates.ts             # 좌표 변환 유틸
│   │   ├── geometry.ts                # 기하학 유틸 (Point-in-Polygon 등)
│   │   └── projectSerializer.ts       # 프로젝트 직렬화
│   │
│   ├── store/
│   │   └── projectStore.ts            # Zustand 전역 상태
│   │
│   └── types/
│       ├── cesium.ts                  # Cesium 타입 정의
│       └── projectFile.ts             # 저장 파일 스키마 v1.0.0
│
├── backend/                           # FastAPI 백엔드
│   ├── main.py                        # API 엔드포인트 정의
│   ├── api/
│   │   └── models.py                  # Pydantic 요청/응답 스키마
│   └── services/
│       ├── dxf_parser.py              # DXF 파싱 (footprint 추출)
│       ├── gltf_exporter.py           # 3D 매스 생성 (GLB)
│       ├── coordinate_transform.py    # EPSG 좌표계 변환
│       └── validation.py              # 건축 규정 검토 (건폐율/이격/높이)
│
├── ai/                                # AI/ML 모듈
│   ├── src/
│   │   ├── config.py                  # 설정 (경로, 레이블, 패턴)
│   │   ├── extractor.py               # DXF → Feature CSV 추출
│   │   ├── classifier.py              # 레이어 분류 (규칙/ML)
│   │   ├── exporter.py                # 분류 결과 → GLB 3D 변환
│   │   └── pipeline.py                # 통합 파이프라인 오케스트레이션
│   ├── data/
│   │   ├── raw/                       # 원본 DXF
│   │   ├── processed/                 # 추출 CSV/JSON
│   │   ├── labeled/                   # 분류 결과 CSV
│   │   └── output/                    # 생성 GLB + predictions JSON
│   ├── models/                        # 학습된 ML 모델 (.pkl)
│   └── notebooks/                     # Jupyter 탐색 노트북
│
├── docs/                              # 문서
├── docker-compose.yml                 # 컨테이너 오케스트레이션
└── .env.example                       # 환경변수 템플릿
```

---

## 4. 파이프라인 상세

### 4.1 [STAGE 1] 도면 파싱 + AI 레이어 분류

**상태: 구현 완료**

DXF 파일에서 엔티티를 추출하고 레이어명 기반으로 건축 요소를 자동 분류한다.

```
DXF 파일
  │
  ├─[Backend] POST /api/upload-dxf
  │   └─ dxf_parser.py → footprint 추출 (LWPOLYLINE/POLYLINE → Shapely Polygon)
  │   └─ 면적, 중심점, 경계상자 반환
  │
  └─[AI] AIPipeline.run()
      │
      ├─ Step 1: FeatureExtractor.extract()
      │   └─ 엔티티별 특성 추출 (LINE, CIRCLE, ARC, LWPOLYLINE, TEXT, INSERT, DIMENSION)
      │   └─ 좌표, 길이, 반경, 꼭지점 등 → DataFrame → CSV
      │
      └─ Step 2: classify_dataframe()
          ├─ RuleBasedClassifier (베이스라인)
          │   └─ 레이어명 키워드 매칭 → 8개 클래스 분류
          │   └─ MURO→wall, PUERTAS→door, VENTANA→window 등
          │
          └─ MLClassifier (학습 기반)
              └─ TF-IDF(char_wb, 2-4 ngram) + RandomForest(100 trees, depth=10)
              └─ 레이어명의 문자 패턴 학습으로 분류
```

**분류 카테고리 (8개):**
wall(벽), door(문), window(창), stair(계단), furniture(가구), dimension(치수), text(텍스트), other(기타)

---

### 4.2 [STAGE 2] 외벽 추출 → GLB 3D 모델 생성

**상태: 구현 완료**

분류된 wall 레이어의 LINE/LWPOLYLINE을 3D 벽체 메쉬로 변환하여 GLB로 내보낸다.

```
분류 결과 (predicted_class == "wall")
  │
  ├─[AI] GLBExporter.export_walls()
  │   ├─ LINE → 박스 메쉬 (길이 × 0.15m 두께 × 3.0m 높이)
  │   │   └─ Z축 회전 (선의 각도) + 중심점 이동
  │   ├─ LWPOLYLINE → 연속 벽 메쉬 (꼭지점 간 벽 생성)
  │   └─ 전체 메쉬 병합 → trimesh.Scene → GLB 내보내기
  │
  └─[Backend] POST /api/generate-mass
      └─ gltf_exporter.py
          ├─ 경위도 footprint → 로컬 미터 좌표 변환
          ├─ extrude_polygon() → 3D 매스 생성
          ├─ 다층 건물: 층별 색상 차등 (밝기 120+n*20)
          └─ models/{uuid}.glb 저장
```

**두 가지 GLB 생성 경로:**
1. **AI 경로**: DXF의 wall 레이어 → 실제 벽체 형태 GLB (도면 기반)
2. **Backend 경로**: footprint + 높이 → 단순 매스 GLB (extrusion)

---

### 4.3 [STAGE 3] Cesium 3D 지도 로드 및 배치

**상태: 구현 완료**

GLB 모델을 Cesium 3D 지구본에 로드하고 위치/회전/스케일 조정으로 배치한다.

```
┌─────────── CesiumViewer.tsx (메인 오케스트레이터) ────────────┐
│                                                                │
│  useCesiumViewer()      Cesium 초기화, OSM Buildings 로드      │
│       ↓                                                        │
│  useCadastral()         V-World WMS/WFS → 지적도 로드          │
│       ↓                 GML → GeoJSON 변환, 폴리라인 표시       │
│  useBlockSelection()    클릭 → Point-in-Polygon → 필지 선택    │
│       ↓                 CYAN 반투명 폴리곤 표시                 │
│  [GLB 모델 로드]        /api/models/[filename] → Cesium Entity │
│       ↓                 위치(lon,lat,height), 회전, 스케일 조정 │
│  [바운더리 체크]        모델 코너 vs 건축선/블록 경계 → GREEN/RED│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**상태 관리 (Zustand projectStore):**

```
workArea          → 작업 위치 (주소, 좌표)
site              → 대지 정보 (footprint, area, centroid)
building          → 건물 정보 (height, floors, footprint)
modelTransform    → 모델 변환값 (lon, lat, height, rotation, scale)
loadedModelEntity → Cesium 모델 엔티티 참조
validation        → 규정 검토 결과
```

---

### 4.4 [STAGE 4] 건축 규정 검토

**상태: 구현 완료**

#### 4.4.1 건축선 (이격거리) 검토

```
선택된 블록들 (useBuildingLine)
  │
  ├─ mergeBlocks()                     여러 블록 합필 (Turf.union)
  ├─ fetchZoneType()                   V-World WFS → 용도지역 조회
  ├─ fetchNearbyParcels()              주변 필지 조회
  │
  └─ analyzeBuildingLine()
      │
      ├─ findRoadAdjacentEdges()       각 변의 도로/인접대지 판별
      │   ├─ Step 1: 명시적 도로 필지 맞닿음 → "도로"
      │   ├─ Step 2: 비도로 필지 맞닿음 → "인접대지"
      │   └─ Step 3: 빈 공간 → "도로" (휴리스틱)
      │   └─ edgesShareBoundary(): 변 위 25/50/75% 포인트 샘플링, 거리 < 1.5m
      │
      ├─ getSetbackFromBuildingLine()   용도지역별 이격거리 테이블 조회
      │   ├─ 주거: 도로변 1m / 인접대지 0.5m
      │   ├─ 상업: 0m
      │   └─ 녹지: 2m
      │
      └─ calculateBuildingLine()        이격거리 적용 → 건축선 폴리곤 계산
          ├─ 각 변을 이격거리만큼 내부로 평행이동
          ├─ 인접 오프셋 라인 교점 계산
          └─ 원본과 intersection → 건축 가능 영역
```

**시각 표현:**
- 건축선: RED DASHED 폴리라인
- 건축 가능 영역: RED 반투명 폴리곤
- 도로 접촉 변: ORANGE 실선
- 인접대지 변: YELLOW 실선

#### 4.4.2 높이 제한 검토

```
[Backend] validate_placement()
  └─ 용도지역별 높이 제한
      ├─ 제1종전용주거: 10m
      ├─ 제2종전용주거: 12m
      ├─ 제1종일반주거: 16m
      ├─ 제2종일반주거: 20m
      └─ 상업/준주거/준공업: 제한 없음
```

#### 4.4.3 일조권 분석

```
useSunlightAnalysis()
  │
  ├─ 그리드 포인트 생성
  │   └─ buildableArea 내부에 2m 간격 포인트 (최대 10,000개)
  │   └─ Turf.pointGrid() + 폴리곤 마스크
  │
  ├─ 시간별 일조 판정 (6시~18시, 1시간 단위, 13 스텝)
  │   ├─ 태양 위치 계산 (Simon1994PlanetaryPositions)
  │   ├─ 각 포인트에서 Ray → 태양 방향 발사
  │   ├─ pickFromRay()로 3D 타일셋(주변 건물) 충돌 검사
  │   └─ 충돌 없음 = 일조 / 충돌 있음 = 그림자
  │
  └─ 히트맵 렌더링
      ├─ 0~2시간: 진빨강 (음지)
      ├─ 2~7시간: 주황→노랑 (부분일조)
      └─ 7~13시간: 초록→청색 (양지)
```

#### 4.4.4 건폐율 검토

```
[Backend] calculate_building_coverage()
  └─ 건폐율 = (건축면적 / 대지면적) × 100
      ├─ 제1종전용주거: 50%
      ├─ 일반주거: 60%
      ├─ 준주거/준공업: 70%
      └─ 일반상업: 80%
```

---

### 4.5 [STAGE 5] AI 최적 배치 (향후 구현)

**상태: 미구현**

향, 일조, 동선 등을 스코어링하여 최적의 건물 배치를 찾아주는 두 번째 AI 파트.

```
[구현 계획]

입력:
  ├─ 대지 경계 (건축선 폴리곤)
  ├─ 건물 footprint + 높이
  ├─ 주변 건물 정보 (OSM 3D Tiles)
  └─ 용도지역 규정

스코어링 요소:
  ├─ 향 (Orientation)     → 남향 선호도 점수
  ├─ 일조 (Sunlight)      → 일조 시간 기반 점수
  ├─ 동선 (Circulation)   → 도로 접근성, 주출입구 배치
  ├─ 이격거리 충족         → 규정 준수 여부
  └─ 건폐율/용적률 최적화  → 활용도 극대화

출력:
  ├─ 최적 배치 위치 (lon, lat)
  ├─ 최적 회전 각도
  ├─ 종합 점수 + 항목별 점수
  └─ 상위 N개 배치 후보
```

**가능한 접근:**
- 유전 알고리즘 (GA) 기반 탐색
- 강화학습 (RL) 기반 배치 최적화
- 그리드 서치 + 스코어링 함수

---

### 4.6 [STAGE 6] 이미지 생성 AI (향후 구현)

**상태: 미구현**

외부 이미지 생성 AI API를 연결하여 조감도, 배치도를 생성한다.

```
[구현 계획]

입력:
  ├─ 3D 배치 결과 (Cesium 뷰 캡처 또는 메타데이터)
  ├─ 건물 형태/높이/재질 정보
  └─ 주변 환경 컨텍스트

출력:
  ├─ 조감도 (Bird's Eye View)      → 위에서 내려다본 전체 배치
  ├─ 배치도 (Site Plan Rendering)  → 평면적 배치 이미지
  └─ 투시도 (Perspective View)     → 사람 시점 렌더링

API 후보:
  ├─ OpenAI DALL-E 3 / GPT-4V
  ├─ Stability AI (SDXL)
  ├─ Midjourney API
  └─ 자체 ControlNet 파이프라인
```

---

## 5. API 설계

### 5.1 Backend API (FastAPI, port 8000)

| Method | Endpoint | 설명 | 상태 |
|--------|----------|------|------|
| POST | `/api/upload-dxf` | DXF 파일 업로드 및 파싱 | 완료 |
| POST | `/api/generate-mass` | footprint → GLB 3D 매스 생성 | 완료 |
| POST | `/api/validate-placement` | 건폐율/이격/높이 규정 검토 | 완료 |
| GET | `/api/models/{id}.glb` | GLB 모델 파일 다운로드 | 완료 |
| GET | `/health` | 헬스 체크 | 완료 |
| POST | `/api/ai/classify` | AI 레이어 분류 요청 | 미구현 |
| POST | `/api/ai/optimize-placement` | AI 최적 배치 요청 | 미구현 |
| POST | `/api/ai/generate-image` | 이미지 생성 요청 | 미구현 |

### 5.2 Frontend API Routes (Next.js, 프록시)

| Endpoint | 프록시 대상 | 설명 |
|----------|------------|------|
| `/api/cadastral` | V-World WMS | 지적도 이미지 타일 |
| `/api/cadastral/wfs` | V-World WFS | 지적 벡터 데이터 (GML→GeoJSON) |
| `/api/cadastral/capabilities` | V-World WFS | WFS 메타데이터 |
| `/api/zone/wfs` | V-World WFS | 용도지역 조회 |
| `/api/models` | 로컬 파일 | GLB 모델 목록 + 바운딩박스 |
| `/api/models/[filename]` | 로컬 파일 | GLB 파일 서빙 |

---

## 6. 데이터 흐름

### 6.1 전체 흐름

```
사용자
  │
  ├─ DXF 업로드 ──→ [Backend] 파싱 ──→ footprint/area/centroid
  │                  [AI] 레이어 분류 ──→ wall GLB
  │
  ├─ 위치 선택 ───→ [Frontend] V-World WFS ──→ 지적도 표시
  │                  클릭 → 필지 선택 (Cyan 폴리곤)
  │
  ├─ 건축선 계산 ─→ [Frontend] Turf.js 기하연산
  │                  도로/인접대지 판별 → 이격거리 적용
  │                  건축선 폴리곤 생성 (Red dashed)
  │
  ├─ 모델 배치 ──→ [Frontend] GLB 로드 → Cesium Entity
  │                  위치/회전/스케일 조정
  │                  바운더리 체크 (Green/Red)
  │
  ├─ 규정 검토 ──→ [Backend] 건폐율/이격/높이 검증
  │                 [Frontend] 일조권 분석 (Ray casting)
  │
  ├─ AI 최적화 ──→ [AI] 향/일조/동선 스코어링 ──→ 최적 배치 (TODO)
  │
  └─ 이미지 생성 ─→ [AI API] 조감도/배치도 렌더링 (TODO)
```

### 6.2 상태 저장/복원

프로젝트 전체 상태를 JSON으로 직렬화하여 저장/복원 가능 (ProjectFile v1.0.0).

```
저장 항목:
  ├─ 카메라 위치/방향
  ├─ 시간 상태 (그림자 표현용)
  ├─ workArea, site, building
  ├─ modelTransform
  ├─ 지적도 데이터 (features, selectedRegion)
  ├─ 선택된 블록 (pnu, feature)
  ├─ 건축선 결과 (polygon, edgeInfos, zoneType)
  ├─ 숨겨진 OSM 건물 ID
  └─ 로드된 모델 정보

복원 순서: 카메라 → 시간 → 스토어 → 지적도 → 블록 → 건축선 → 모델 → 휴먼모델 → 숨긴건물
```

---

## 7. Frontend 컴포넌트 아키텍처

```
page.tsx
  └─ <main>
       ├─ <Sidebar />                    좌측 패널
       │   ├─ DXF 업로드 폼
       │   ├─ 매스 설정 (높이, 층수)
       │   ├─ 모델 선택/로드
       │   └─ 검토 결과 표시
       │
       ├─ <CesiumViewer />               메인 3D 뷰어 ← 모든 훅 조합
       │   ├─ useCesiumViewer()          Cesium 초기화
       │   ├─ useCadastral()             지적도
       │   ├─ useBlockSelection()        필지 선택
       │   ├─ useBuildingLine()          건축선
       │   ├─ useSunlightAnalysis()      일조 분석
       │   ├─ useOsmBuildings()          OSM 건물 관리
       │   └─ useProjectPersistence()    저장/복원
       │
       ├─ <ControlPanel />               상단 컨트롤
       ├─ <SaveLoadToolbar />            저장/불러오기
       └─ <ErrorBanner />                에러 표시
```

---

## 8. AI 모듈 상세

### 8.1 현재 구현 (레이어 분류)

```
ai/src/
  ├─ config.py         설정 중앙 관리
  │   ├─ LAYER_CLASSES = [wall, door, window, stair, furniture, dimension, text, other]
  │   ├─ LAYER_PATTERNS = {wall: [WALL, MURO, 벽, ...], ...}
  │   ├─ TARGET_ENTITIES = [LINE, CIRCLE, ARC, LWPOLYLINE, TEXT, INSERT, DIMENSION]
  │   └─ DEFAULT_WALL_HEIGHT=3.0m, DEFAULT_WALL_THICKNESS=0.15m
  │
  ├─ extractor.py      DXF → DataFrame
  │   └─ FeatureExtractor: 엔티티별 좌표/길이/반경 추출 → CSV
  │
  ├─ classifier.py     분류 엔진
  │   ├─ RuleBasedClassifier: 키워드 매칭 (baseline)
  │   └─ MLClassifier: TF-IDF(char 2-4gram) + RandomForest(100 trees)
  │
  ├─ exporter.py       3D 변환
  │   └─ GLBExporter: LINE→벽박스, POLYLINE→연속벽 → GLB
  │
  └─ pipeline.py       오케스트레이션
      └─ AIPipeline.run(): extract → classify → export → result JSON
```

### 8.2 향후 AI 파트 (최적 배치)

- 입력: 대지 + 건물 + 주변환경 + 규정
- 스코어링: 향(남향도), 일조(시간), 동선(접근성)
- 탐색: 위치(x,y) × 회전(θ) 파라미터 공간 최적화
- 출력: Top-N 배치 후보 + 점수

### 8.3 향후 AI 파트 (이미지 생성)

- 외부 API 연결 (DALL-E, Stable Diffusion 등)
- 입력: 3D 배치 메타데이터 또는 뷰 캡처
- 출력: 조감도, 배치도, 투시도

---

## 9. 외부 서비스 연동

| 서비스 | 용도 | 프로토콜 |
|--------|------|----------|
| V-World WMS | 지적도 이미지 타일 | HTTP (Next.js 프록시) |
| V-World WFS | 지적 벡터 데이터, 용도지역 | HTTP (GML→GeoJSON) |
| Cesium Ion | 3D 타일셋, 지형 데이터 | Cesium Token |
| OSM Buildings | 주변 건물 3D 데이터 | Cesium 3D Tiles |

---

## 10. 환경 설정

```bash
# .env.example
CESIUM_ION_TOKEN=your_cesium_token      # Cesium Ion 접근
VWORLD_API_KEY=your_vworld_key          # V-World 지적도 API
NEXT_PUBLIC_CESIUM_TOKEN=same_token     # 프론트엔드용
NEXT_PUBLIC_API_URL=http://localhost:8000 # 백엔드 URL
```

---

## 11. 구현 현황 요약

| 단계 | 기능 | 상태 | 위치 |
|------|------|------|------|
| 1 | DXF 파싱 | 완료 | backend/services/dxf_parser.py |
| 1 | AI 레이어 분류 (규칙) | 완료 | ai/src/classifier.py |
| 1 | AI 레이어 분류 (ML) | 구현됨, 학습 데이터 부족 | ai/src/classifier.py |
| 2 | 외벽 추출 → GLB | 완료 | ai/src/exporter.py |
| 2 | footprint → GLB 매스 | 완료 | backend/services/gltf_exporter.py |
| 3 | Cesium 3D 뷰어 | 완료 | frontend/components/CesiumViewer.tsx |
| 3 | 지적도 (WMS/WFS) | 완료 | frontend/hooks/useCadastral.ts |
| 3 | 필지 선택 | 완료 | frontend/hooks/useBlockSelection.ts |
| 3 | GLB 모델 로드/배치 | 완료 | frontend/components/CesiumViewer.tsx |
| 3 | 프로젝트 저장/복원 | 완료 | frontend/hooks/useProjectPersistence.ts |
| 4 | 건축선 계산 | 완료 | frontend/lib/buildingLine.ts |
| 4 | 높이 제한 검토 | 완료 | backend/services/validation.py |
| 4 | 건폐율 검토 | 완료 | backend/services/validation.py |
| 4 | 일조권 분석 | 완료 | frontend/lib/sunlightAnalysis.ts |
| 5 | AI 최적 배치 | 미구현 | - |
| 6 | 이미지 생성 AI | 미구현 | - |

---

## 12. 기술적 참고사항

**좌표계**: WGS84(EPSG:4326) 기본, 한국 TM(5185/5186/5187) 지원. 경도별 자동 존 감지.

**3D 변환**: Trimesh extrude_polygon()으로 2D→3D. LINE은 박스 메쉬(길이×0.15m×3.0m)로 변환.

**건축선 알고리즘**: 변별 이격거리가 다를 때 각 변을 법선 방향으로 평행이동 후 교점 계산으로 건축선 폴리곤 생성. Turf.js intersection으로 건축 가능 영역 추출.

**일조 분석**: Cesium pickFromRay()로 3D 타일셋 충돌 검사. Simon1994 천문학 모델로 태양 위치 계산. 그리드 포인트 최대 10,000개 제한.

**DB**: requirements.txt에 SQLAlchemy/psycopg2 포함되어 있으나 현재 미사용. 용적률(FAR) 검증 필드 정의되어 있으나 로직 미구현.
