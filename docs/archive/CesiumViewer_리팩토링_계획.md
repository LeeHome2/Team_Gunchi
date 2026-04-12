# CesiumViewer.tsx 리팩토링 계획

> **상태**: ✅ 1단계 완료 (2026-03-21)

## 현재 상태
- **리팩토링 전**: 2,452줄
- **리팩토링 후**: ~1,100줄 (훅으로 분리)
- **문제점**: 단일 파일에 너무 많은 책임이 집중됨 → **해결됨**

---

## 기능별 분석

| 기능 영역 | 라인 수 (추정) | 설명 |
|-----------|---------------|------|
| State 선언 | ~95 | useState, useRef, store 구독 |
| 모델 바운더리 체크 | ~112 | 건축선/블록 경계 검증 |
| 뷰포트 상태 저장/복원 | ~157 | localStorage 연동 |
| 지오코딩 | ~35 | 좌표 ↔ 주소 변환 |
| 지역/블록 선택 | ~185 | 선택 모드 로직 |
| 건축선 계산 | ~160 | 건축선 분석 및 표시 |
| 샘플 모델 관리 | ~218 | 3D 모델 로드/제거 |
| 휴먼 스케일 모델 | ~57 | 비교용 사람 모델 |
| 지적도 레이어 | ~159 | WFS 데이터 로드 |
| 클릭 핸들러 | ~254 | 선택 이벤트 처리 |
| Cesium 초기화 | ~164 | 뷰어 설정 |
| OSM 건물 숨기기 | ~83 | 건물 표시/숨김 |
| 대지/건물 표시 | ~115 | 폴리곤 렌더링 |
| 드래그/회전 | ~300 | 마우스 인터랙션 |
| UI/JSX | ~362 | 컨트롤 패널 |

---

## 리팩토링 전략

### Phase 1: Custom Hooks 추출 (우선순위 높음)

#### 1.1 `useCesiumViewer.ts`
Cesium 뷰어 초기화 및 기본 설정
```typescript
// hooks/useCesiumViewer.ts
export function useCesiumViewer(containerRef: RefObject<HTMLDivElement>) {
  // Cesium 초기화 로직
  // 기본 레이어 설정
  // OSM Buildings 로드
  return { viewer, isLoaded }
}
```

#### 1.2 `useModelBoundary.ts`
모델 바운더리 체크 로직
```typescript
// hooks/useModelBoundary.ts
export function useModelBoundary(
  modelTransform: ModelTransform,
  buildingLineResult: BuildingLineResult | null,
  selectedBlocks: SelectedBlock[]
) {
  // 바운더리 체크 로직
  // 색상 업데이트
  return { isInBounds, boundaryEntity }
}
```

#### 1.3 `useBuildingLine.ts`
건축선 계산 및 표시
```typescript
// hooks/useBuildingLine.ts
export function useBuildingLine(viewer: Viewer, selectedBlocks: SelectedBlock[]) {
  // 건축선 계산
  // 엔티티 관리
  return {
    buildingLineResult,
    showBuildingLine,
    toggleBuildingLine,
    clearBuildingLine
  }
}
```

#### 1.4 `useCadastral.ts`
지적도 레이어 관리
```typescript
// hooks/useCadastral.ts
export function useCadastral(viewer: Viewer) {
  // WFS 데이터 로드
  // 폴리라인 렌더링
  return {
    loadCadastral,
    removeCadastral,
    cadastralFeatures
  }
}
```

#### 1.5 `useBlockSelection.ts`
블록 선택 로직
```typescript
// hooks/useBlockSelection.ts
export function useBlockSelection(viewer: Viewer, cadastralFeatures: Feature[]) {
  // 클릭 핸들러
  // 선택 상태 관리
  return {
    selectedBlocks,
    isSelecting,
    toggleSelection,
    clearSelection
  }
}
```

#### 1.6 `useModelDrag.ts`
3D 모델 드래그/회전
```typescript
// hooks/useModelDrag.ts
export function useModelDrag(viewer: Viewer, modelEntity: Entity) {
  // 마우스 이벤트 핸들러
  // 위치/회전 업데이트
  return { isDragging, isRotating }
}
```

#### 1.7 `useOsmBuildings.ts`
OSM 건물 숨기기/표시
```typescript
// hooks/useOsmBuildings.ts
export function useOsmBuildings(viewer: Viewer) {
  // 건물 선택 모드
  // 숨김/복원 로직
  return {
    hiddenIds,
    hideBuilding,
    restoreBuilding,
    restoreAll
  }
}
```

#### 1.8 `useViewportState.ts`
뷰포트 상태 저장/복원
```typescript
// hooks/useViewportState.ts
export function useViewportState(viewer: Viewer) {
  // localStorage 연동
  return { saveState, restoreState }
}
```

---

### Phase 2: UI 컴포넌트 분리

#### 2.1 `CesiumControls.tsx`
상단 컨트롤 바
```typescript
// components/cesium/CesiumControls.tsx
export function CesiumControls({
  onRegionSelect,
  onBlockSelect,
  onBuildingSelect,
  onRefresh,
  ...
}) {
  // 버튼 그룹 렌더링
}
```

#### 2.2 `BuildingLinePanel.tsx`
건축선 분석 결과 패널
```typescript
// components/cesium/BuildingLinePanel.tsx
export function BuildingLinePanel({ result, onClose }) {
  // 건축선 정보 표시
}
```

#### 2.3 `HiddenBuildingsList.tsx`
숨긴 건물 목록
```typescript
// components/cesium/HiddenBuildingsList.tsx
export function HiddenBuildingsList({
  hiddenIds,
  onRestore,
  onRestoreAll
}) {
  // 숨긴 건물 목록 렌더링
}
```

#### 2.4 `SunSimulation.tsx`
일조 시뮬레이션 패널
```typescript
// components/cesium/SunSimulation.tsx
export function SunSimulation({ currentTime, onTimeChange }) {
  // 날짜/시간 컨트롤
}
```

#### 2.5 `WorkAreaInfo.tsx`
작업 영역 정보 표시
```typescript
// components/cesium/WorkAreaInfo.tsx
export function WorkAreaInfo({ workArea }) {
  // 주소 표시
}
```

---

### Phase 3: 유틸리티 함수 분리

#### 3.1 `lib/cesium/coordinates.ts`
좌표 변환 유틸리티
```typescript
// 미터 ↔ 경위도 변환
// 회전 변환
// 폴리곤 중심점 계산
```

#### 3.2 `lib/cesium/entities.ts`
엔티티 생성 헬퍼
```typescript
// 폴리라인 생성
// 폴리곤 생성
// 색상 업데이트
```

#### 3.3 `lib/geocoding.ts`
지오코딩 API
```typescript
// 역지오코딩 (좌표 → 주소)
// 정지오코딩 (주소 → 좌표)
```

---

## 리팩토링 후 구조

```
frontend/
├── components/
│   ├── CesiumViewer.tsx          # ~300줄 (메인 컴포넌트)
│   └── cesium/
│       ├── CesiumControls.tsx    # 상단 컨트롤
│       ├── BuildingLinePanel.tsx # 건축선 패널
│       ├── HiddenBuildingsList.tsx
│       ├── SunSimulation.tsx
│       └── WorkAreaInfo.tsx
├── hooks/
│   ├── useCesiumViewer.ts
│   ├── useModelBoundary.ts
│   ├── useBuildingLine.ts
│   ├── useCadastral.ts
│   ├── useBlockSelection.ts
│   ├── useModelDrag.ts
│   ├── useOsmBuildings.ts
│   └── useViewportState.ts
└── lib/
    ├── cesium/
    │   ├── coordinates.ts
    │   └── entities.ts
    ├── geocoding.ts
    ├── buildingLine.ts      # 기존
    ├── setbackTable.ts      # 기존
    └── geometry.ts          # 기존
```

---

## 예상 결과

| 파일 | 예상 라인 수 |
|------|-------------|
| CesiumViewer.tsx (메인) | ~300 |
| 각 Custom Hook (8개) | ~100-150 |
| 각 UI 컴포넌트 (5개) | ~50-100 |
| 유틸리티 (3개) | ~50-100 |

**총합**: ~2,400줄 → 20개 파일로 분산

---

## 구현 우선순위

### 1단계 (즉시) ✅ 완료
- [x] `useCesiumViewer.ts` - 초기화 로직 분리
- [x] `useBuildingLine.ts` - 건축선 로직 분리
- [x] `useBlockSelection.ts` - 블록 선택 분리

### 2단계 (단기) ✅ 완료
- [x] `useOsmBuildings.ts` - 건물 숨기기 분리
- [x] `useCadastral.ts` - 지적도 분리
- [x] `useProjectPersistence.ts` - 프로젝트 저장/불러오기 (추가)

### 3단계 (중기) - 미완료
- [ ] UI 컴포넌트 분리 (CesiumControls, BuildingLinePanel 등)
- [ ] 유틸리티 함수 정리

---

## 주의사항

1. **순환 참조 방지**: hooks 간 의존성 최소화
2. **타입 정의**: `types/cesium.ts`에 공통 타입 정의
3. **테스트**: 각 hook 단위 테스트 작성
4. **점진적 적용**: 한 번에 하나씩 분리하여 안정성 확보
