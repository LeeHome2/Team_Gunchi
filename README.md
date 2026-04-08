# Building Cesium

CAD 기반 3D 건축 매스 생성 및 규정 검토 시스템

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (Next.js)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│
│  │ CesiumViewer│  │   Sidebar   │  │    Hooks    │  │    projectStore     ││
│  │  - 3D 지도   │  │  - 업로드    │  │ -건축선분석 │  │   (Zustand 상태)     ││
│  │  - 건물 매스 │  │  - 매스설정  │  │ -지적도WFS  │  │  - site, building   ││
│  │  - 마우스조작│  │  - 규정검토  │  │ -프로젝트   │  │  - validation       ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ REST API
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                              Backend (FastAPI)                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   dxf_parser    │  │  gltf_exporter  │  │       validation            │  │
│  │  DXF → Polygon  │  │ Polygon → GLB   │  │  건폐율/이격/높이 검토       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                              AI Module (Python)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │    extractor    │  │   classifier    │  │        exporter             │  │
│  │  DXF → CSV      │  │ 레이어 자동분류  │  │  분류결과 → GLB             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| DXF 파일 파싱 | CAD 도면에서 대지 경계 자동 추출 |
| 3D 매스 생성 | 건물 높이/층수 설정 후 GLB 모델 생성 |
| 건물 배치 | 마우스 드래그로 이동/회전 |
| 규정 검토 | 건폐율, 이격거리, 높이제한 자동 계산 |
| 지적도 연동 | 국토정보플랫폼 WFS로 실시간 지적 데이터 |
| 건축선 분석 | 도로/인접대지 판별 및 법정 이격거리 계산 |
| 일조 시뮬레이션 | 날짜/시간별 그림자 시각화 |
| AI 레이어 분류 | CAD 도면 레이어 자동 분류 (wall/door/window) |

---

## 프로젝트 구조

```
building_cesium/
├── frontend/                 # Next.js 프론트엔드
│   ├── app/                  # 페이지 및 API 라우트
│   ├── components/           # React 컴포넌트
│   ├── hooks/                # 커스텀 훅
│   ├── store/                # Zustand 상태관리
│   ├── lib/                  # 유틸리티
│   └── types/                # TypeScript 타입
│
├── backend/                  # FastAPI 백엔드
│   ├── main.py               # API 엔드포인트
│   ├── services/             # 비즈니스 로직
│   └── api/                  # Pydantic 모델
│
├── ai/                       # AI 레이어 분류 모듈
│   ├── src/                  # 소스 코드
│   ├── data/                 # 학습/테스트 데이터
│   ├── models/               # 학습된 모델
│   └── notebooks/            # Jupyter 노트북
│
└── docs/                     # 문서
    ├── QUICKSTART.md         # 빠른 시작 가이드
    └── MODULES.md            # 모듈별 개발 가이드
```

---

## 기술 스택

### Frontend
| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 14.1.0 | React 프레임워크 |
| CesiumJS | 1.114.0 | 3D 지구 시각화 |
| Zustand | 4.5.0 | 상태 관리 |
| TypeScript | 5.3.3 | 타입 안정성 |
| Tailwind CSS | 3.4.1 | 스타일링 |
| Turf.js | 7.3.4 | 지리 연산 |

### Backend
| 기술 | 버전 | 용도 |
|------|------|------|
| FastAPI | 0.109.0 | REST API 서버 |
| ezdxf | 1.1.4 | DXF 파일 파싱 |
| Shapely | 2.0.2 | 기하학 연산 |
| trimesh | 4.0.8 | 3D 메쉬 생성 |
| pyproj | 3.6.1 | 좌표 변환 |

### AI Module
| 기술 | 용도 |
|------|------|
| ezdxf | DXF 파싱 |
| pandas | 데이터 처리 |
| scikit-learn | ML 모델 |
| trimesh | GLB 내보내기 |

---

## 설치 및 실행

### 사전 요구사항

- Node.js 18+
- Python 3.11+
- Cesium Ion 계정 (무료)

### 1. 저장소 클론

```bash
git clone https://github.com/your-repo/building_cesium.git
cd building_cesium
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

**frontend/.env.local**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_CESIUM_TOKEN=your_cesium_ion_token
VWORLD_API_KEY=your_vworld_api_key
```

> - Cesium Ion 토큰 발급: https://cesium.com/ion/tokens
> - V-World API 키 발급: https://www.vworld.kr/dev/v4api.do

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
http://localhost:3002
```

---

## API Reference

### Backend API

Base URL: `http://localhost:8000`

#### 상태 확인

```http
GET /health
```

**Response**
```json
{ "status": "healthy" }
```

---

#### DXF 파일 업로드

```http
POST /api/upload-dxf
Content-Type: multipart/form-data
```

**Request**
| Field | Type | Description |
|-------|------|-------------|
| file | File | DXF 파일 |

**Response**
```json
{
  "success": true,
  "file_id": "uuid-string",
  "site": {
    "footprint": [[127.1385, 37.4447], ...],
    "area_sqm": 350.5,
    "centroid": [127.1387, 37.4449],
    "bounds": {
      "min_x": 127.1385,
      "min_y": 37.4447,
      "max_x": 127.1390,
      "max_y": 37.4451
    }
  }
}
```

---

#### 3D 매스 생성

```http
POST /api/generate-mass
Content-Type: application/json
```

**Request**
```json
{
  "footprint": [[127.1385, 37.4447], [127.1390, 37.4447], ...],
  "height": 9.0,
  "floors": 3
}
```

**Response**
```json
{
  "success": true,
  "model_id": "uuid-string",
  "model_url": "/models/uuid-string.glb",
  "height": 9.0,
  "floors": 3
}
```

---

#### 배치 규정 검토

```http
POST /api/validate-placement
Content-Type: application/json
```

**Request**
```json
{
  "site_footprint": [[127.1385, 37.4447], ...],
  "building_footprint": [[127.1386, 37.4448], ...],
  "building_height": 9.0,
  "zone_type": "제1종일반주거지역",
  "coverage_limit": 60.0,
  "setback_required": 1.5,
  "height_limit": 12.0
}
```

**Response**
```json
{
  "is_valid": true,
  "building_coverage": {
    "value": 45.5,
    "limit": 60.0,
    "status": "OK"
  },
  "setback": {
    "min_distance_m": 2.3,
    "required_m": 1.5,
    "status": "OK"
  },
  "height": {
    "value_m": 9.0,
    "limit_m": 12.0,
    "status": "OK"
  },
  "violations": []
}
```

---

### 외부 API

#### Cesium Ion

- **용도**: 3D 지형 데이터, OSM Buildings
- **발급**: https://cesium.com/ion/tokens
- **환경변수**: `NEXT_PUBLIC_CESIUM_TOKEN`

#### 국토정보플랫폼 (V-World)

- **용도**: 지적도 WFS 데이터
- **발급**: https://www.vworld.kr/dev/v4api.do
- **환경변수**: `VWORLD_API_KEY`

**지적도 WFS 요청 예시**
```
GET /api/cadastral/wfs?bbox=127.1,37.4,127.2,37.5
```

---

## AI 모듈 사용법

### 파이프라인 실행

```bash
cd ai

# 전체 파이프라인 (DXF → 분류 → GLB)
python -m src.pipeline -i data/raw/sample.dxf

# 개별 단계
python -m src.extractor -i data/raw/sample.dxf    # Feature 추출
python -m src.classifier -i data/processed/sample.csv  # 분류
python -m src.exporter -i data/labeled/sample.csv      # GLB 생성
```

### Input/Output

| 단계 | Input | Output |
|------|-------|--------|
| 추출 | `data/raw/*.dxf` | `data/processed/*.csv` |
| 분류 | `data/processed/*.csv` | `data/labeled/*.csv` |
| 내보내기 | `data/labeled/*.csv` | `data/output/*.glb` |

### 분류 레이블

| 레이블 | 설명 |
|--------|------|
| wall | 벽체 |
| door | 문 |
| window | 창문 |
| stair | 계단 |
| furniture | 가구 |
| dimension | 치수 |
| text | 텍스트 |
| other | 기타 |

---

## 사용자 조작 가이드

### 기본 워크플로우

1. **샘플 데이터 로드** 또는 DXF 업로드
2. **3D 매스 생성** 버튼 클릭
3. **건물 위치로 이동** 클릭
4. 마우스로 건물 이동/회전
5. **배치 검토 실행** 클릭

### 마우스 조작

| 동작 | 기능 |
|------|------|
| 좌클릭 + 드래그 (건물) | 건물 이동 |
| 우클릭 + 드래그 (건물) | 건물 회전 |
| 좌클릭 + 드래그 (지도) | 카메라 회전 |
| 마우스 휠 | 줌 인/아웃 |

### 건축선 분석

1. **지역 선택** 버튼 클릭
2. 지도에서 위치 클릭 (지적도 로드)
3. **영역 선택** 후 대지 블록 클릭
4. **건축선 분석** 버튼으로 결과 확인

---

## 건축 규정 기준

### 용도지역별 기준

| 용도지역 | 건폐율 | 이격거리 | 높이제한 |
|----------|--------|----------|----------|
| 제1종전용주거 | 50% | 2.0m | 10m |
| 제1종일반주거 | 60% | 1.5m | 16m |
| 제2종일반주거 | 60% | 1.5m | 20m |
| 일반상업 | 80% | 0m | 무제한 |

### 검토 항목

- **건폐율**: (건축면적 / 대지면적) × 100
- **이격거리**: 대지경계선 ~ 건물 최소 거리
- **높이제한**: 건물 최고 높이

---

## 개발 가이드

자세한 개발 가이드는 아래 문서 참고:

- [QUICKSTART.md](docs/QUICKSTART.md) - 5분 빠른 시작
- [MODULES.md](docs/MODULES.md) - 모듈별 개발 가이드

---

## 라이선스

MIT License

---

## 팀 정보

**팀 건치 (Team Geonchi)** - 2024 종합설계프로젝트
