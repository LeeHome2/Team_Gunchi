# 모듈별 개발 가이드

팀 프로젝트를 위한 기능별 모듈 분류 및 담당자 가이드

---

## 모듈 구조 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Module A    │  │ Module B    │  │ Module C    │              │
│  │ 3D Viewer   │  │ UI Controls │  │ State Mgmt  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Module D    │  │ Module E    │  │ Module F    │              │
│  │ DXF Parser  │  │ Mass Gen    │  │ Validation  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend 모듈

### Module A: 3D Viewer (CesiumViewer)
**파일**: `frontend/components/CesiumViewer.tsx`
**담당 기능**:
- Cesium 뷰어 초기화
- 3D 건물 렌더링
- 마우스 드래그 이동/회전
- 일조 시뮬레이션

**의존성**: `projectStore.ts`

**주요 함수**:
| 함수명 | 설명 |
|--------|------|
| `initCesium()` | Cesium 뷰어 초기화 |
| `updateBuildingMass()` | 건물 위치/회전 업데이트 |
| `handleTimeChange()` | 일조 시간 변경 |

---

### Module B: UI Controls (Sidebar)
**파일**: `frontend/components/Sidebar.tsx`
**담당 기능**:
- DXF 업로드 UI
- 건물 설정 (높이, 층수)
- 이동/회전 컨트롤
- 검토 결과 표시

**의존성**: `projectStore.ts`, `api.ts`

**주요 함수**:
| 함수명 | 설명 |
|--------|------|
| `handleFileUpload()` | DXF 파일 업로드 |
| `handleLoadSample()` | 샘플 데이터 로드 |
| `handleGenerateMass()` | 3D 매스 생성 요청 |
| `handleValidate()` | 규정 검토 요청 |

---

### Module C: State Management (Store)
**파일**: `frontend/store/projectStore.ts`
**담당 기능**:
- 전역 상태 관리
- 컴포넌트 간 데이터 공유

**주요 상태**:
| 상태 | 타입 | 설명 |
|------|------|------|
| `viewer` | Cesium.Viewer | 뷰어 참조 |
| `site` | SiteInfo | 대지 정보 |
| `building` | BuildingInfo | 건물 정보 |
| `validation` | ValidationResult | 검토 결과 |

---

### Module D: API Client
**파일**: `frontend/lib/api.ts`
**담당 기능**:
- Backend API 호출
- 에러 처리

**주요 함수**:
| 함수명 | 설명 |
|--------|------|
| `uploadDxf()` | DXF 업로드 API |
| `generateMass()` | 매스 생성 API |
| `validatePlacement()` | 규정 검토 API |

---

### Module D-1: Custom Hooks
**파일**: `frontend/hooks/*.ts`
**담당 기능**:
- 기능별 로직 분리 및 재사용

| 훅 | 파일 | 설명 |
|----|------|------|
| `useCesiumViewer` | `useCesiumViewer.ts` | Cesium 뷰어 초기화/관리 |
| `useCadastral` | `useCadastral.ts` | 지적도 WFS 데이터 로드/표시 |
| `useBlockSelection` | `useBlockSelection.ts` | 지적 블록 선택 관리 |
| `useBuildingLine` | `useBuildingLine.ts` | 건축선 분석/시각화 |
| `useOsmBuildings` | `useOsmBuildings.ts` | OSM 건물 타일셋 숨김 관리 |
| `useProjectPersistence` | `useProjectPersistence.ts` | 프로젝트 저장/불러오기 |

---

### Module D-2: Utility Libraries
**파일**: `frontend/lib/*.ts`
**담당 기능**:
- 공통 유틸리티 함수

| 라이브러리 | 파일 | 설명 |
|-----------|------|------|
| `geometry` | `geometry.ts` | 기하학 계산 (점-폴리곤 포함, 오프셋) |
| `buildingLine` | `buildingLine.ts` | 건축선 분석 로직 |
| `setbackTable` | `setbackTable.ts` | 용도지역별 이격거리 기준표 |
| `projectSerializer` | `projectSerializer.ts` | 프로젝트 파일 직렬화/역직렬화 |
| `coordinates` | `coordinates.ts` | 좌표 변환 유틸리티 |
| `building` | `building.ts` | 건물 관련 유틸리티 |

---

### Module D-3: Types
**파일**: `frontend/types/*.ts`
**담당 기능**:
- TypeScript 타입 정의

| 타입 파일 | 설명 |
|----------|------|
| `cesium.ts` | Cesium 관련 타입 (CesiumViewer, SelectedBlock 등) |
| `projectFile.ts` | 프로젝트 파일 포맷 타입 (v1.0.0) |

---

## Backend 모듈

### Module E: DXF Parser
**파일**: `backend/services/dxf_parser.py`
**담당 기능**:
- DXF 파일 읽기
- Footprint 좌표 추출
- 면적/중심점 계산

**주요 함수**:
| 함수명 | 설명 |
|--------|------|
| `parse_dxf_file()` | DXF 파싱 메인 함수 |
| `extract_polylines()` | 폴리라인 추출 |
| `calculate_area()` | 면적 계산 |

---

### Module F: Mass Generator
**파일**: `backend/services/gltf_exporter.py`
**담당 기능**:
- 3D 메쉬 생성
- GLB 파일 내보내기

**주요 함수**:
| 함수명 | 설명 |
|--------|------|
| `create_building_mesh()` | 3D 메쉬 생성 |
| `create_building_gltf()` | GLB 파일 생성 |

---

### Module G: Validation Service
**파일**: `backend/main.py` (validate_placement 함수)
**담당 기능**:
- 건폐율 계산
- 이격거리 계산
- 높이 검토

**주요 함수**:
| 함수명 | 설명 |
|--------|------|
| `validate_placement()` | 규정 검토 메인 |
| `calculate_coverage()` | 건폐율 계산 |
| `calculate_setback()` | 이격거리 계산 |

---

### Module H: Coordinate Transform
**파일**: `backend/services/coordinate_transform.py`
**담당 기능**:
- 좌표계 변환 (로컬 ↔ WGS84)
- 거리/면적 계산

---

## 담당자 배정 예시

| 모듈 | 담당 | 난이도 | 예상 작업 |
|------|------|:------:|----------|
| A. 3D Viewer | 담당자1 | ★★★ | 드래그 개선, 다중 건물 |
| B. UI Controls | 담당자2 | ★★ | UI 개선, 크기 조절 추가 |
| C. State Mgmt | 담당자2 | ★ | 상태 추가 |
| D. API Client | 담당자3 | ★ | API 추가 |
| E. DXF Parser | 담당자3 | ★★★ | 다양한 DXF 지원 |
| F. Mass Gen | 담당자4 | ★★ | 복잡한 모델 지원 |
| G. Validation | 담당자4 | ★★ | 용도지역별 기준 |
| H. Coord Trans | 담당자3 | ★★ | EPSG 변환 |

---

## 개발 규칙

### 1. 브랜치 전략
```
main
  └── develop
        ├── feature/module-a-drag
        ├── feature/module-b-resize
        ├── feature/module-e-dxf
        └── feature/module-g-validation
```

### 2. 커밋 메시지
```
[Module-X] 기능 설명

예시:
[Module-A] 다중 건물 선택 기능 추가
[Module-E] DXF BLOCK 엔티티 파싱 지원
[Module-G] 용도지역별 건폐율 기준 적용
```

### 3. 코드 리뷰
- PR 생성 시 관련 모듈 담당자 리뷰 필수
- 다른 모듈 수정 시 해당 담당자 승인 필요

---

## 인터페이스 정의

### Frontend ↔ Backend API

#### POST /api/upload-dxf
```typescript
// Request
FormData { file: DXF파일 }

// Response
{
  success: boolean
  file_id: string
  site: {
    footprint: [number, number][]  // [[lon, lat], ...]
    area_sqm: number
    centroid: [number, number]
    bounds: { min_x, min_y, max_x, max_y }
  }
}
```

#### POST /api/generate-mass
```typescript
// Request
{
  footprint: [number, number][]
  height: number
  floors: number
  position?: [number, number]
}

// Response
{
  success: boolean
  model_id: string
  model_url: string
  height: number
  floors: number
}
```

#### POST /api/validate-placement
```typescript
// Request
{
  site_footprint: [number, number][]
  building_footprint: [number, number][]
  building_height: number
  coverage_limit?: number   // 기본 60
  setback_required?: number // 기본 1.5
  height_limit?: number     // 기본 12
}

// Response
{
  is_valid: boolean
  building_coverage: { value, limit, status }
  setback: { min_distance_m, required_m, status }
  height: { value_m, limit_m, status }
  violations: [{ code, message }]
}
```

---

## 테스트 방법

### Frontend 단위 테스트
```bash
cd frontend
npm run test
```

### Backend 단위 테스트
```bash
cd backend
pytest tests/
```

### 통합 테스트
```bash
# Backend 실행
cd backend && python -m uvicorn main:app --reload

# Frontend 실행
cd frontend && npm run dev

# 브라우저에서 테스트
http://localhost:3002
```

---

## 다음 작업 우선순위

### Phase 1 (필수)
- [ ] Module E: 실제 DXF 파일 파싱 테스트
- [x] Module G: 용도지역별 검토 기준 (건축선 분석 구현됨)
- [ ] Module A: 다중 건물 지원

### Phase 2 (권장)
- [ ] Module B: 건물 크기 조절 UI
- [ ] Module A: 건물 선택/삭제
- [ ] Module F: 복잡한 건물 모델

### Phase 3 (추가)
- [ ] 일조권 분석 결과 시각화
- [ ] PDF 리포트 생성
- [x] 프로젝트 저장/불러오기 (구현 완료)

### 구현 완료된 기능
- [x] 지적도 WFS 연동 (useCadastral)
- [x] 블록 선택 기능 (useBlockSelection)
- [x] 건축선 분석 (useBuildingLine)
- [x] OSM 건물 숨김 (useOsmBuildings)
- [x] 프로젝트 저장/불러오기 (useProjectPersistence)
- [x] 휴먼 스케일 모델 배치
- [x] 3D 모델 로드 및 배치
