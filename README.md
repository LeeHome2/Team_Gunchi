# Building Cesium - CAD 기반 건축 매스 생성 시스템

CesiumJS를 활용한 3D 건물 배치 및 규정 검토 시스템

## 프로젝트 개요

CAD 도면(DXF)을 기반으로 3D 건물 매스를 생성하고, 건축 규정(건폐율, 이격거리, 높이제한)을 검토하는 웹 애플리케이션입니다.

### 주요 기능
- DXF 파일 업로드 및 대지 경계 추출
- 3D 건물 매스 생성 및 시각화
- 마우스 드래그로 건물 이동/회전
- 건축 규정 자동 검토
- 일조 시뮬레이션 (날짜/시간별 그림자)
- OSM Buildings 배경 건물 표시

---

## 기술 스택

### Frontend
| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 14.1.0 | React 프레임워크 |
| CesiumJS | 1.114.0 | 3D 지구 시각화 |
| Zustand | 4.5.0 | 상태 관리 |
| TypeScript | 5.x | 타입 안정성 |
| Tailwind CSS | 3.4.1 | 스타일링 |

### Backend
| 기술 | 용도 |
|------|------|
| FastAPI | REST API 서버 |
| ezdxf | DXF 파일 파싱 |
| Shapely | 기하학 연산 |
| trimesh | 3D 메쉬 생성 |
| pyproj | 좌표 변환 |

---

## 프로젝트 구조

```
building_cesium/
├── frontend/                    # Next.js 프론트엔드
│   ├── app/
│   │   ├── layout.tsx          # 루트 레이아웃
│   │   ├── page.tsx            # 메인 페이지
│   │   └── globals.css         # 전역 스타일
│   ├── components/
│   │   ├── CesiumViewer.tsx    # 3D 뷰어 컴포넌트 (핵심)
│   │   └── Sidebar.tsx         # 사이드바 컨트롤
│   ├── store/
│   │   └── projectStore.ts     # Zustand 상태 관리
│   ├── lib/
│   │   └── api.ts              # 백엔드 API 클라이언트
│   └── .env.local              # 환경변수 (Cesium 토큰)
│
├── backend/                     # FastAPI 백엔드
│   ├── main.py                 # API 엔드포인트
│   ├── api/
│   │   └── models.py           # Pydantic 모델
│   ├── services/
│   │   ├── dxf_parser.py       # DXF 파싱 서비스
│   │   ├── gltf_exporter.py    # glTF 생성 서비스
│   │   └── coordinate_transform.py  # 좌표 변환
│   ├── models/                 # 생성된 GLB 파일 저장
│   ├── uploads/                # 업로드된 DXF 파일
│   └── requirements.txt        # Python 의존성
│
└── README.md                   # 이 문서
```

---

## 핵심 컴포넌트 설명

### 1. CesiumViewer.tsx (3D 뷰어)

**역할**: CesiumJS 뷰어 초기화 및 3D 시각화

**주요 기능**:
```typescript
// Cesium 초기화
const viewer = new Cesium.Viewer(container, {
  terrain: Cesium.Terrain.fromWorldTerrain(),  // 지형 데이터
  shadows: true,                                // 그림자 활성화
})

// OSM Buildings 로드
const osmBuildingsTileset = await Cesium.createOsmBuildingsAsync()
viewer.scene.primitives.add(osmBuildingsTileset)
```

**건물 매스 표시**:
```typescript
// Polygon Extrude 방식으로 3D 건물 생성
viewer.entities.add({
  id: 'building-mass',
  polygon: {
    hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
    height: 0,
    extrudedHeight: buildingHeight,  // 돌출 높이
    material: Cesium.Color.CORNFLOWERBLUE.withAlpha(0.8),
    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
  },
})
```

**마우스 드래그 처리**:
```typescript
// 좌클릭: 건물 이동
handler.setInputAction((click) => {
  const picked = viewer.scene.pick(click.position)
  if (picked?.id?.id === 'building-mass') {
    setIsDragging(true)
    // 카메라 컨트롤 비활성화
    viewer.scene.screenSpaceCameraController.enableRotate = false
  }
}, Cesium.ScreenSpaceEventType.LEFT_DOWN)

// 우클릭: 건물 회전
handler.setInputAction((click) => {
  // ... 회전 로직
}, Cesium.ScreenSpaceEventType.RIGHT_DOWN)
```

---

### 2. Sidebar.tsx (사이드바 컨트롤)

**역할**: 사용자 입력 및 워크플로우 관리

**탭 구성**:
1. **업로드 탭**: DXF 파일 업로드 / 샘플 데이터 로드
2. **매스 탭**: 건물 높이, 층수 설정 / 이동/회전 컨트롤
3. **검토 탭**: 건축 규정 검토 실행 및 결과 표시

**샘플 데이터 로드**:
```typescript
const handleLoadSample = () => {
  const sampleSite = {
    fileId: 'sample',
    footprint: [
      [127.1385, 37.4447],  // 성남시 좌표
      [127.1390, 37.4447],
      [127.1390, 37.4451],
      [127.1385, 37.4451],
    ],
    area: 300,
    centroid: [127.13875, 37.4449],
  }
  setSite(sampleSite)
}
```

---

### 3. projectStore.ts (상태 관리)

**역할**: Zustand를 이용한 전역 상태 관리

**상태 구조**:
```typescript
interface ProjectState {
  viewer: any | null           // Cesium Viewer 참조
  site: SiteInfo | null        // 대지 정보
  building: BuildingInfo | null // 건물 정보
  modelUrl: string | null      // 생성된 모델 URL
  validation: ValidationResult | null  // 검토 결과
  isLoading: boolean           // 로딩 상태
}
```

---

### 4. Backend API (main.py)

**엔드포인트**:

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/health` | 서버 상태 확인 |
| POST | `/api/upload-dxf` | DXF 파일 업로드 |
| POST | `/api/generate-mass` | 3D 매스 생성 |
| POST | `/api/validate-placement` | 규정 검토 |

**규정 검토 로직**:
```python
# 건폐율 = (건축면적 / 대지면적) x 100
building_coverage = (building_area / site_area) * 100
coverage_ok = building_coverage <= 60.0  # 기본 60%

# 이격거리 = 대지경계선 ~ 건물 최소 거리
min_distance = site_boundary.distance(building_boundary)
setback_ok = min_distance >= 1.5  # 기본 1.5m

# 높이제한
height_ok = building_height <= 12.0  # 기본 12m
```

---

## 데이터 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                        사용자 조작                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Sidebar.tsx                               │
│  - DXF 업로드 / 샘플 로드                                    │
│  - 높이, 층수 설정                                           │
│  - 이동/회전 슬라이더                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  projectStore.ts (Zustand)                   │
│  - site: 대지 정보                                           │
│  - building: 건물 정보                                       │
│  - validation: 검토 결과                                     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│    CesiumViewer.tsx     │     │      Backend API            │
│  - 3D 시각화             │     │  - /api/generate-mass       │
│  - 마우스 이벤트 처리     │     │  - /api/validate-placement  │
│  - 건물 이동/회전         │     │  - 좌표 변환, 검증           │
└─────────────────────────┘     └─────────────────────────────┘
```

---

## 좌표계 설명

### 경위도 (WGS84)
- **형식**: [longitude, latitude] = [경도, 위도]
- **예시**: [127.1385, 37.4447] (성남시)
- **사용처**: Cesium 위치, API 통신

### 미터 단위 (로컬)
- **형식**: [x, y] in meters
- **변환**: 경위도 → 미터 (건물 크기 계산용)
```typescript
const metersPerDegLon = 111320 * Math.cos(latRad)  // 경도 1도당 미터
const metersPerDegLat = 111320                      // 위도 1도당 미터
```

---

## 실행 방법

### 1. Backend 실행
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### 2. Frontend 실행
```bash
cd frontend
npm install
npm run dev
```

### 3. 브라우저 접속
```
http://localhost:3002
```

---

## 환경 변수

### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_CESIUM_TOKEN=your_cesium_ion_token
```
> Cesium 토큰 발급: https://cesium.com/ion/ (무료 계정 생성 후 Access Token 발급)

### Backend (.env) - 선택사항
```env
CORS_ORIGINS=http://localhost:3000,http://localhost:3002
```

---

## 조작 방법

### 기본 워크플로우
1. **"샘플 데이터로 테스트"** 버튼 클릭
2. **"3D 매스 생성"** 버튼 클릭
3. **"건물 위치로 이동"** 버튼 클릭
4. 마우스로 건물 이동/회전
5. **"배치 검토 실행"** 버튼 클릭

### 마우스 조작
| 동작 | 기능 |
|------|------|
| 좌클릭 + 드래그 (건물) | 건물 이동 |
| 우클릭 + 드래그 (건물) | 건물 회전 |
| 좌클릭 + 드래그 (지도) | 카메라 회전 |
| 우클릭 + 드래그 (지도) | 카메라 줌 |
| 마우스 휠 | 줌 인/아웃 |

### 일조 시뮬레이션
- 좌하단 패널에서 **날짜** 선택
- **시간 슬라이더**로 0~23시 조절
- 실시간 그림자 변화 확인

---

## Three.js 버전과 비교

| 기능 | Three.js | Cesium |
|------|:--------:|:------:|
| 건물 이동 | O | O |
| 건물 회전 | O | O |
| 건물 크기 조정 | O | X |
| 다중 건물 | O | X |
| 일조 시뮬레이션 | X | O |
| OSM 배경 건물 | X | O |
| 지형 데이터 | X | O |
| 백엔드 API | X | O |

---

## 검토 조건 (기본값)

| 항목 | 기본값 | 설명 |
|------|--------|------|
| 건폐율 | 60% | (건축면적 / 대지면적) x 100 |
| 이격거리 | 1.5m | 대지경계선 ~ 건물 최소 거리 |
| 높이제한 | 12m | 건물 최고 높이 |

---

## 향후 개선 사항

- [ ] 건물 크기(가로/세로) 조정 기능
- [ ] 다중 건물 배치 지원
- [ ] 다양한 건물 모델 (집, 아파트 등)
- [ ] 실제 DXF 파일 업로드 테스트
- [ ] 용도지역별 규정 적용
- [ ] 일조권 분석 결과 시각화

---

## 라이선스

MIT License

---

## 팀 정보

팀 건치 (Team Geonchi) - 2024 종합설계프로젝트
