/**
 * 프로젝트 상태 관리 (Zustand)
 */

import { create } from 'zustand'

interface SiteInfo {
  fileId?: string
  footprint: number[][]
  area?: number
  centroid?: number[]
  bounds?: {
    min_x: number
    min_y: number
    max_x: number
    max_y: number
  }
}

// 작업 영역 정보
interface WorkArea {
  longitude: number
  latitude: number
  address: string
  displayName: string
}

interface BuildingInfo {
  height: number
  floors: number
  footprint: number[][]
  position?: number[]
  rotation?: number
}

interface ValidationResult {
  is_valid: boolean
  building_coverage: {
    value: number
    limit: number
    status: string
  }
  setback: {
    min_distance_m: number
    required_m: number
    status: string
  }
  height: {
    value_m: number
    limit_m: number
    status: string
  }
  violations: Array<{
    code: string
    message: string
  }>
  zone_type?: string  // 용도지역 (자동 탐지 결과)
}

/**
 * 결과 확인(/editor/result) 페이지로 전달하는 스냅샷.
 *
 * - `sitePlan`: Cesium 뷰포트를 탑다운(pitch -90°) 으로 돌린 뒤 캡처한 dataURL.
 *   나중에 학교 LLM 이미지 생성 기능이 붙으면 이 이미지를 입력으로 넘겨서
 *   건축 배치도 스타일로 변환할 수 있다.
 * - `aerialView`: STAGE 6 (이미지 생성 AI) 가 붙기 전까지 `null`. 붙으면
 *   프롬프트로 생성한 조감도 이미지 URL 을 저장한다.
 * - `capturedAt`: 스냅샷 찍은 시각 (ISO string).
 */
export interface ResultSnapshot {
  sitePlan: string | null
  aerialView: string | null
  capturedAt: string | null
  // AI 렌더링 결과 (store에 저장하여 페이지 이동 후에도 유지)
  renderedSitePlan: string | null
  renderedAerialView: string | null
}

// ── 배치안 (Placement Plan) ──

/** 배치안 내 매스 배치 정보 (매스 ID + transform만 저장, 매스 데이터는 프로젝트 레벨에서 공유) */
export interface MassPlacement {
  massId: string  // generatedMasses 내 매스의 id 참조
  transform: {
    longitude: number
    latitude: number
    height: number
    rotation: number
    scale: number
  }
}

/** 배치안별 일조 분석 결과 */
export interface PlacementSunlightResult {
  averageSunlightHours: number
  minSunlightHours: number
  maxSunlightHours: number
  totalPoints: number
  analysisDate: string
}

/** 배치안별 규정 검토 결과 */
export interface PlacementReviewData {
  zoneType?: string
  selectedZoneType?: string
  buildingCoverage: { buildingArea: number; siteArea: number; ratio: number; limit: number; status: 'OK' | 'VIOLATION' } | null
  setback: { minDistance: number; required: number; status: 'OK' | 'VIOLATION'; details: { type: string; distance: number; required: number; status: 'OK' | 'VIOLATION' }[] } | null
  heightCheck: { value: number; limit: number | null; status: 'OK' | 'VIOLATION' } | null
  isModelInBounds: boolean
}

export interface PlacementPlan {
  id: string
  name: string
  description?: string
  /** 매스별 배치 정보 (매스 데이터는 프로젝트 레벨 generatedMasses에서 공유) */
  massPlacement: MassPlacement[]
  /** 모델 변환 정보 (현재 활성 매스의 transform) */
  modelTransform: {
    longitude: number
    latitude: number
    height: number
    rotation: number
    scale: number
  }
  /** 현재 활성 매스 ID */
  activeMassId: string | null
  /** 주차구역 스냅샷 */
  parkingZone: ParkingZoneData | null
  parkingTransform: { longitude: number; latitude: number; rotation: number }
  parkingOrigin: { longitude: number; latitude: number } | null
  parkingEntrance: ParkingEntranceData | null
  entranceTransform: { longitude: number; latitude: number; rotation: number }
  isParkingVisible: boolean
  gridRotation: number
  parkingPath: ParkingPathData | null
  /** 일조 분석 결과 (배치안별 저장) */
  sunlightResult?: PlacementSunlightResult | null
  /** 규정 검토 결과 (배치안별 저장) */
  reviewData?: PlacementReviewData | null
  /** 메인 창문 방향 (나침반 각도 0-360, 180=남향) */
  mainWindowDirection?: number
  /** AI 스코어 (결과 확인 후 저장) */
  aiScore?: {
    overallScore: number
    categoryGrades: Record<string, string>
    summary: string
    /** LLM 개선 제안 */
    suggestions?: string
    /** 카테고리별 숫자 점수 (scoringEngine 결과) */
    categories?: { parking: number; sunlight: number; layout: number }
  }
  /** 생성 시각 */
  createdAt: number
  /** 수정 시각 */
  updatedAt: number
}

// ── 주차구역 (Parking Zone) ──

export interface ParkingSlotData {
  id: number
  slot_type: 'standard' | 'disabled'
  cx: number
  cy: number
  width: number
  depth: number
  heading: number
  polygon: number[][]
}

export interface ParkingAisleData {
  polygon: number[][]
  direction: string
}

export interface AccessPointData {
  x: number
  y: number
  road_x: number | null
  road_y: number | null
  width: number
}

export interface ParkingZoneData {
  slots: ParkingSlotData[]
  aisles: ParkingAisleData[]
  accessPoint: AccessPointData | null
  zonePolygon: number[][]
  zoneCenter: number[]
  zoneRotation: number
  zoneWidth: number
  zoneDepth: number
  totalSlots: number
  standardSlots: number
  disabledSlots: number
  totalAreaM2: number
  parkingAreaRatio: number
  warnings: string[]
}

/** 주차 입구 오브젝트 (독립 이동/회전) */
export interface ParkingEntranceData {
  /** 로컬 좌표 중심 (m) */
  cx: number
  cy: number
  /** 입구 너비 (m, 기본 6m) */
  width: number
  /** 입구 깊이 (m, 기본 3m) */
  depth: number
  /** 입구 방향 (도) */
  heading: number
  /** 입구 폴리곤 (로컬 m) */
  polygon: number[][]
}

/** A* 경로 탐색 결과 */
export interface ParkingGridCell {
  x: number // 로컬 m
  y: number // 로컬 m
  blocked: boolean // true=장애물(건물) 또는 사이트 외부
  isBuilding?: boolean // true=건물 영역 (별도 표시용)
}

export interface ParkingGridData {
  cells: ParkingGridCell[]
  gridSize: number
  cols: number
  rows: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** 회전된 좌표계에서의 그리드 원점 및 회전 중심 (그리드 선과 셀 정렬용) */
  rotatedOrigin?: { x: number; y: number; rotation: number; centerX: number; centerY: number }
}

export interface ParkingPathData {
  /** 경로 노드들 (로컬 m 좌표) */
  points: number[][]
  /** 경로 전체 길이 (m) */
  length: number
  /** 경로 유효 여부 (영역 내) */
  isValid: boolean
  /** 그리드 시각화 데이터 */
  grid?: ParkingGridData
  /** 차량 너비 (m) - 경로 시각화용 */
  vehicleWidth?: number
}

export type ParkingLayoutPattern = 'perpendicular' | 'parallel'

export interface ParkingConfig {
  buildingUse: string
  grossFloorArea: number
  ramp: boolean
  requiredTotal: number | null
  requiredDisabled: number | null
  layoutPattern: ParkingLayoutPattern
}

// 샘플 모델 정보 (기존 - deprecated)
interface SampleModel {
  id: string
  name: string
  url: string
  thumbnail?: string
}

// 사용 가능한 샘플 모델 목록 (기존 - deprecated)
export const SAMPLE_MODELS: SampleModel[] = [
  {
    id: 'sample_house',
    name: '샘플 주택',
    url: '/models/sample_house.glb',
  },
]

// API 기반 모델 정보
interface AvailableModel {
  filename: string
  displayName: string
  size: number
  sizeFormatted: string
  boundingBox: {
    width: number
    height: number
    depth: number
  }
  /** 바닥면 Convex Hull (모델 로컬 m, X-Z 평면) — null이면 boundingBox 사각형 fallback */
  floorPolygon: number[][] | null
  /** 모델 Y 최솟값 — height = -originYMin * scale 로 바닥 보정 */
  originYMin: number
}

// DXF 파싱 후 생성된 매스 모델
/** 개구부 (문/창문) 위치 정보 */
export interface OpeningPosition {
  x: number       // 로컬 X 좌표 (모델 중심 기준, 미터)
  y: number       // 로컬 Y 좌표 (모델 중심 기준, 미터)
  width: number   // 개구부 폭 (미터)
  height: number  // 개구부 높이 (미터)
  rotation: number // 회전 각도 (도)
  type: 'door' | 'window'  // 개구부 유형
  isMainEntrance?: boolean  // 주 출입문 여부
}

/** 메인 출입구 마커 (드래그 가능, 매스에 종속) */
export interface MainEntranceData {
  /** 로컬 좌표 (매스 중심 기준, 미터) */
  localX: number
  localY: number
  /** 마커 방향 (도, 화살표가 가리키는 방향) */
  heading: number
  /** 마커 크기 (미터) */
  size: number
}

export interface GeneratedMass {
  id: string
  fileName: string       // 원본 DXF 파일명
  label: string          // 표시명
  glbUrl: string         // 백엔드 GLB URL (천장 포함)
  glbUrlNoRoof?: string  // 천장 없는 GLB URL (토글용)
  footprint: number[][]  // 위경도 변환된 footprint
  centroid: number[]     // 위경도 centroid
  area: number           // 면적 (m²)
  height: number         // 건물 높이
  floors: number         // 층수
  classification: {
    total_entities: number
    class_counts: Record<string, number>
    average_confidence: number
  }
  /** GLB 실제 바운딩 박스 (미터 단위, 백엔드 계산) */
  boundingBox?: { width: number; depth: number; height: number }
  /** 문/창문 위치 목록 (Cesium 마커용) */
  openings?: OpeningPosition[]
  createdAt: number      // timestamp
}

// UI 테마 타입
export type ThemeMode = 'light' | 'dark'

interface ProjectState {
  // UI 테마 (라이트/다크 모드)
  theme: ThemeMode

  // DB 프로젝트 ID (백엔드 연동용)
  projectId: string | null
  projectName: string | null

  // Cesium Viewer 참조
  viewer: any | null

  // 작업 영역 (지적도 선택)
  workArea: WorkArea | null

  // 대지 정보
  site: SiteInfo | null

  // 건물 정보
  building: BuildingInfo | null

  // 생성된 모델 URL
  modelUrl: string | null

  // 선택된 샘플 모델
  selectedModel: SampleModel | null

  // 로드된 3D 모델 Entity
  loadedModelEntity: any | null

  // 모델 변환 정보
  modelTransform: {
    longitude: number
    latitude: number
    height: number
    rotation: number // Z축 회전 (도)
    scale: number // 스케일
  }

  // 검토 결과
  validation: ValidationResult | null

  // 로딩 상태
  isLoading: boolean

  // 에러 메시지
  error: string | null

  // API 기반 샘플 모델 목록
  availableModels: AvailableModel[]

  // 선택된 블록 수
  selectedBlockCount: number

  // 선택된 블록 상세 정보 (좌표, 면적)
  selectedBlockInfo: {
    coordinates: number[][][] // 각 블록의 좌표 배열
    totalArea: number // 총 면적 (m²)
    centroid: [number, number] | null // 중심점 [lon, lat]
  } | null

  // 로드할 모델 파일명 (Sidebar에서 설정, CesiumViewer에서 처리)
  modelToLoad: string | null

  // DXF 파싱 후 생성된 매스 GLB URL (Sidebar에서 설정, CesiumViewer에서 로드)
  massGlbToLoad: string | null
  // DB 복원 시 매스 GLB에 적용할 저장된 transform (null이면 새 배치)
  massGlbRestoreTransform: { longitude: number; latitude: number; height: number; rotation: number; scale: number } | null
  // 현재 뷰포트에 로드된 매스 GLB URL (저장용)
  loadedMassGlbUrl: string | null

  // 생성된 매스 모델 목록 (프로젝트 레벨에서 공유)
  generatedMasses: GeneratedMass[]

  // 현재 활성 매스 ID (배치안별로 다른 매스를 표시할 수 있음)
  activeMassId: string | null

  // 매스 생성 기본 설정
  massSettings: {
    defaultHeight: number  // 기본 건물 높이 (m)
    defaultFloors: number  // 기본 층수
  }

  // 천장 슬래브 표시 여부 (토글용)
  showRoof: boolean

  // 문/창문 마커 표시 여부
  showOpeningMarkers: boolean

  // 메인 출입구 마커 (드래그 가능)
  mainEntrance: MainEntranceData | null

  // 모델 로딩 중
  isLoadingModel: boolean

  // 휴먼 스케일 모델 로드 여부
  humanScaleModelLoaded: boolean

  // 주차구역
  parkingConfig: ParkingConfig
  parkingZone: ParkingZoneData | null
  isParkingVisible: boolean
  isParkingEditing: boolean
  parkingTransform: { longitude: number; latitude: number; rotation: number }
  // 주차구역 원점 (건물과 독립적으로 고정)
  parkingOrigin: { longitude: number; latitude: number } | null
  // 주차 입구 (독립 오브젝트)
  parkingEntrance: ParkingEntranceData | null
  entranceTransform: { longitude: number; latitude: number; rotation: number }
  // 경로 탐색 결과
  parkingPath: ParkingPathData | null
  // 그리드 회전 각도 (도)
  gridRotation: number

  // 검토 탭 데이터 (CesiumViewer에서 계산)
  reviewData: {
    zoneType?: string  // 자동 탐지된 용도지역
    selectedZoneType?: string  // 사용자가 선택한 용도지역 (드롭다운)
    buildingCoverage: { buildingArea: number; siteArea: number; ratio: number; limit: number; status: 'OK' | 'VIOLATION' } | null
    setback: { minDistance: number; required: number; status: 'OK' | 'VIOLATION'; details: { type: string; distance: number; required: number; status: 'OK' | 'VIOLATION' }[] } | null
    heightCheck: { value: number; limit: number | null; status: 'OK' | 'VIOLATION' } | null
    isModelInBounds: boolean
  }
  sunlightAnalysisState: {
    isAnalyzing: boolean
    progress: { currentHour: number; percentComplete: number } | null
    result: {
      averageSunlightHours: number
      minSunlightHours: number
      maxSunlightHours: number
      totalPoints: number
      analysisDate: string
    } | null
    showHeatmap: boolean
    heatmapMode: 'point' | 'cell'
  }
  // AI 스코어링
  aiScore: {
    isLoading: boolean
    result: {
      categoryGrades: Record<string, string>
      overallScore: number
      summary: string
      suggestions: string
      source: 'llm' | 'fallback'
      /** 카테고리별 숫자 점수 (scoringEngine 결과) */
      categories?: { parking: number; sunlight: number; layout: number }
    } | null
    error: string | null
  }
  setAIScore: (state: Partial<ProjectState['aiScore']>) => void

  // 일조 분석 날짜/시간 (Sidebar ↔ CesiumViewer 공유)
  sunlightDate: Date
  setSunlightDate: (date: Date) => void

  // 결과 확인 페이지용 스냅샷
  resultSnapshot: ResultSnapshot

  // 배치안 목록
  placementPlans: PlacementPlan[]
  // 현재 활성 배치안 ID
  activePlanId: string | null
  // 좌측 사이드바 (배치안 목록) 열림 여부
  plansOpen: boolean

  // 프로젝트 저장/불러오기 함수 참조 (CesiumViewer에서 설정)
  saveProjectFn: ((projectName?: string) => void) | null
  loadProjectFn: ((file: File) => Promise<void>) | null
  loadFromDbFn: (() => Promise<void>) | null
  isSavingProject: boolean
  isLoadingProject: boolean
  projectError: string | null

  // Actions
  setProjectId: (id: string | null) => void
  setProjectName: (name: string | null) => void
  setViewer: (viewer: any) => void
  setWorkArea: (workArea: WorkArea | null) => void
  setSite: (site: SiteInfo) => void
  setBuilding: (building: BuildingInfo) => void
  setModelUrl: (url: string) => void
  setSelectedModel: (model: SampleModel | null) => void
  setLoadedModelEntity: (entity: any) => void
  setModelTransform: (transform: Partial<ProjectState['modelTransform']>) => void
  setValidation: (result: ValidationResult) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setAvailableModels: (models: AvailableModel[]) => void
  setSelectedBlockCount: (count: number) => void
  setSelectedBlockInfo: (info: ProjectState['selectedBlockInfo']) => void
  setModelToLoad: (filename: string | null) => void
  setMassGlbToLoad: (url: string | null, restoreTransform?: { longitude: number; latitude: number; height: number; rotation: number; scale: number } | null) => void
  setLoadedMassGlbUrl: (url: string | null) => void
  addGeneratedMass: (mass: GeneratedMass) => void
  removeGeneratedMass: (id: string) => void
  setActiveMassId: (id: string | null) => void
  setMassSettings: (settings: Partial<ProjectState['massSettings']>) => void
  setShowRoof: (show: boolean) => void
  setShowOpeningMarkers: (show: boolean) => void
  setMainEntrance: (entrance: MainEntranceData | null) => void
  setIsLoadingModel: (loading: boolean) => void
  setHumanScaleModelLoaded: (loaded: boolean) => void
  setParkingConfig: (config: Partial<ParkingConfig>) => void
  setParkingZone: (zone: ParkingZoneData | null) => void
  setIsParkingVisible: (visible: boolean) => void
  setIsParkingEditing: (editing: boolean) => void
  setParkingTransform: (transform: Partial<{ longitude: number; latitude: number; rotation: number }>) => void
  setParkingOrigin: (origin: { longitude: number; latitude: number } | null) => void
  setParkingEntrance: (entrance: ParkingEntranceData | null) => void
  setEntranceTransform: (transform: Partial<{ longitude: number; latitude: number; rotation: number }>) => void
  setParkingPath: (path: ParkingPathData | null) => void
  setGridRotation: (rotation: number) => void
  clearParking: () => void
  setResultSnapshot: (snapshot: Partial<ResultSnapshot>) => void
  clearResultSnapshot: () => void
  setSaveProjectFn: (fn: ((projectName?: string) => void) | null) => void
  setLoadProjectFn: (fn: ((file: File) => Promise<void>) | null) => void
  setLoadFromDbFn: (fn: (() => Promise<void>) | null) => void
  setIsSavingProject: (saving: boolean) => void
  setIsLoadingProject: (loading: boolean) => void
  setProjectError: (error: string | null) => void
  setReviewData: (data: Partial<ProjectState['reviewData']>) => void
  setSunlightAnalysisState: (state: Partial<ProjectState['sunlightAnalysisState']>) => void
  // CesiumViewer에서 설정하는 함수 참조
  runReviewCheckFn: (() => void) | null
  setRunReviewCheckFn: (fn: (() => void) | null) => void
  startSunlightFn: ((date: Date, gridSpacing?: number) => void) | null
  setStartSunlightFn: (fn: ((date: Date, gridSpacing?: number) => void) | null) => void
  toggleSunlightHeatmapFn: (() => void) | null
  setToggleSunlightHeatmapFn: (fn: (() => void) | null) => void
  clearSunlightFn: (() => void) | null
  setClearSunlightFn: (fn: (() => void) | null) => void
  setSunlightHeatmapModeFn: ((mode: 'point' | 'cell') => void) | null
  setSetSunlightHeatmapModeFn: (fn: ((mode: 'point' | 'cell') => void) | null) => void
  // 배치안 관련 액션
  setPlansOpen: (open: boolean) => void
  addPlacementPlan: (plan: PlacementPlan) => void
  updatePlacementPlan: (id: string, updates: Partial<PlacementPlan>) => void
  removePlacementPlan: (id: string) => void
  setActivePlanId: (id: string | null) => void
  /** 현재 상태를 새 배치안으로 저장 */
  saveCurrentAsPlan: (name: string, description?: string) => PlacementPlan
  /** 현재 활성 배치안의 상태를 저장 (배치안 전환 전 호출) */
  saveActivePlan: () => void
  /** 배치안 로드 (현재 상태를 해당 배치안으로 복원) */
  loadPlan: (id: string) => void
  // 테마 설정
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  reset: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  // 초기 상태
  theme: 'dark' as ThemeMode,  // 기본 다크 모드
  projectId: null,
  projectName: null,
  viewer: null,
  workArea: null,
  site: null,
  building: null,
  modelUrl: null,
  selectedModel: null,
  loadedModelEntity: null,
  modelTransform: {
    longitude: 127.1388,
    latitude: 37.4449,
    height: 0,
    rotation: 180,
    scale: 10.0,
  },
  validation: null,
  isLoading: false,
  error: null,
  availableModels: [],
  selectedBlockCount: 0,
  selectedBlockInfo: null,
  modelToLoad: null,
  massGlbToLoad: null,
  massGlbRestoreTransform: null,
  loadedMassGlbUrl: null,
  generatedMasses: [],
  activeMassId: null,
  massSettings: {
    defaultHeight: 3.0,  // 기본 건물 높이 3m (1층 기준)
    defaultFloors: 1,    // 기본 층수 1층
  },
  showRoof: true,  // 천장 슬래브 기본 표시
  showOpeningMarkers: true,  // 문/창문 마커 기본 표시
  mainEntrance: null,  // 메인 출입구 마커 (사용자가 드래그로 위치 설정)
  isLoadingModel: false,
  humanScaleModelLoaded: false,
  parkingConfig: {
    buildingUse: '근린생활시설',
    grossFloorArea: 0,
    ramp: false,
    requiredTotal: null,
    requiredDisabled: null,
    layoutPattern: 'perpendicular' as ParkingLayoutPattern,
  },
  parkingZone: null,
  isParkingVisible: false,
  isParkingEditing: false,
  parkingTransform: { longitude: 0, latitude: 0, rotation: 0 },
  parkingOrigin: null,
  parkingEntrance: null,
  entranceTransform: { longitude: 0, latitude: 0, rotation: 0 },
  parkingPath: null,
  gridRotation: 0,
  reviewData: {
    zoneType: undefined,
    selectedZoneType: undefined,
    buildingCoverage: null,
    setback: null,
    heightCheck: null,
    isModelInBounds: true,
  },
  aiScore: {
    isLoading: false,
    result: null,
    error: null,
  },
  setAIScore: (state) => set((prev) => ({
    aiScore: { ...prev.aiScore, ...state },
  })),
  sunlightAnalysisState: {
    isAnalyzing: false,
    progress: null,
    result: null,
    showHeatmap: false,
    heatmapMode: 'point' as const,
  },
  sunlightDate: (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d })(),
  setSunlightDate: (date: Date) => set({ sunlightDate: date }),
  resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null, renderedSitePlan: null, renderedAerialView: null },
  placementPlans: [],
  activePlanId: null,
  plansOpen: false,
  runReviewCheckFn: null,
  startSunlightFn: null,
  toggleSunlightHeatmapFn: null,
  clearSunlightFn: null,
  setSunlightHeatmapModeFn: null,
  saveProjectFn: null,
  loadProjectFn: null,
  loadFromDbFn: null,
  isSavingProject: false,
  isLoadingProject: false,
  projectError: null,

  // Actions
  setProjectId: (id) => set((state) => {
    // 프로젝트 ID가 변경되면 프로젝트 종속 데이터 초기화
    if (state.projectId !== id) {
      console.log('[ProjectStore] 프로젝트 전환:', state.projectId, '->', id)
      return {
        projectId: id,
        // 배치안은 프로젝트에 종속되므로 초기화
        placementPlans: [],
        activePlanId: null,
        // 기타 프로젝트 종속 데이터도 초기화
        generatedMasses: [],
        activeMassId: null,
        loadedMassGlbUrl: null,
        massGlbToLoad: null,
        massGlbRestoreTransform: null,
        mainEntrance: null,
        parkingZone: null,
        parkingEntrance: null,
        parkingPath: null,
        parkingOrigin: null,
        isParkingVisible: false,
        aiScore: { isLoading: false, result: null, error: null },
        sunlightAnalysisState: { isAnalyzing: false, progress: null, result: null, showHeatmap: false, heatmapMode: 'point' as const },
        resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null, renderedSitePlan: null, renderedAerialView: null },
        // 규정 검토 결과도 초기화 (이전 프로젝트의 부적합 판정/이격거리 음수값이
        // 다른 프로젝트로 넘어가지 않도록 함)
        reviewData: {
          zoneType: undefined,
          selectedZoneType: undefined,
          buildingCoverage: null,
          setback: null,
          heightCheck: null,
          isModelInBounds: true,
        },
        validation: null,
      }
    }
    return { projectId: id }
  }),
  setProjectName: (name) => set({ projectName: name }),

  setViewer: (viewer) => set({ viewer }),

  setWorkArea: (workArea) => set({ workArea }),

  setSite: (site) => set({ site }),

  setBuilding: (building) => set({ building }),

  setModelUrl: (url) => set({ modelUrl: url }),

  setSelectedModel: (model) => set({ selectedModel: model }),

  setLoadedModelEntity: (entity) => set({ loadedModelEntity: entity }),

  setModelTransform: (transform) =>
    set((state) => ({
      modelTransform: { ...state.modelTransform, ...transform },
    })),

  setValidation: (result) => set({ validation: result }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  setAvailableModels: (models) => set({ availableModels: models }),

  setSelectedBlockCount: (count) => set({ selectedBlockCount: count }),

  setSelectedBlockInfo: (info) => set({ selectedBlockInfo: info }),

  setModelToLoad: (filename) => set({ modelToLoad: filename }),

  setMassGlbToLoad: (url, restoreTransform) => set({ massGlbToLoad: url, massGlbRestoreTransform: restoreTransform ?? null }),
  setLoadedMassGlbUrl: (url: string | null) => set({ loadedMassGlbUrl: url }),

  addGeneratedMass: (mass) =>
    set((state) => {
      // 같은 fileName이 이미 있으면 교체, 없으면 추가
      const existingIndex = state.generatedMasses.findIndex(
        (m) => m.fileName === mass.fileName
      )
      if (existingIndex >= 0) {
        // 기존 항목 교체
        const updated = [...state.generatedMasses]
        updated[existingIndex] = mass
        return { generatedMasses: updated }
      }
      return { generatedMasses: [...state.generatedMasses, mass] }
    }),
  removeGeneratedMass: (id) =>
    set((state) => ({ generatedMasses: state.generatedMasses.filter((m) => m.id !== id) })),

  setActiveMassId: (id) => set({ activeMassId: id }),

  setMassSettings: (settings) =>
    set((state) => ({ massSettings: { ...state.massSettings, ...settings } })),

  setShowRoof: (show) => set({ showRoof: show }),

  setShowOpeningMarkers: (show) => set({ showOpeningMarkers: show }),
  setMainEntrance: (entrance) => set({ mainEntrance: entrance }),

  setIsLoadingModel: (loading) => set({ isLoadingModel: loading }),

  setHumanScaleModelLoaded: (loaded) => set({ humanScaleModelLoaded: loaded }),

  setParkingConfig: (config) =>
    set((state) => ({
      parkingConfig: { ...state.parkingConfig, ...config },
    })),
  setParkingZone: (zone) => set({ parkingZone: zone }),
  setIsParkingVisible: (visible) => set({ isParkingVisible: visible }),
  setIsParkingEditing: (editing) => set({ isParkingEditing: editing }),
  setParkingTransform: (transform) =>
    set((state) => ({
      parkingTransform: { ...state.parkingTransform, ...transform },
    })),
  setParkingOrigin: (origin) => set({ parkingOrigin: origin }),
  setParkingEntrance: (entrance) => set({ parkingEntrance: entrance }),
  setEntranceTransform: (transform) =>
    set((state) => ({
      entranceTransform: { ...state.entranceTransform, ...transform },
    })),
  setParkingPath: (path) => set({ parkingPath: path }),
  setGridRotation: (rotation) => set({ gridRotation: rotation }),
  clearParking: () =>
    set({
      parkingZone: null,
      isParkingVisible: false,
      isParkingEditing: false,
      parkingTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingOrigin: null,
      parkingEntrance: null,
      entranceTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingPath: null,
      gridRotation: 0,
      parkingConfig: {
        buildingUse: '근린생활시설',
        grossFloorArea: 0,
        ramp: false,
        requiredTotal: null,
        requiredDisabled: null,
        layoutPattern: 'perpendicular' as ParkingLayoutPattern,
      },
    }),

  setResultSnapshot: (snapshot) =>
    set((state) => ({
      resultSnapshot: { ...state.resultSnapshot, ...snapshot },
    })),
  clearResultSnapshot: () =>
    set({ resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null, renderedSitePlan: null, renderedAerialView: null } }),

  setSaveProjectFn: (fn) => set({ saveProjectFn: fn }),
  setLoadProjectFn: (fn) => set({ loadProjectFn: fn }),
  setLoadFromDbFn: (fn) => set({ loadFromDbFn: fn }),
  setIsSavingProject: (saving) => set({ isSavingProject: saving }),
  setIsLoadingProject: (loading) => set({ isLoadingProject: loading }),
  setProjectError: (error) => set({ projectError: error }),

  setReviewData: (data) =>
    set((state) => ({
      reviewData: { ...state.reviewData, ...data },
    })),
  setSunlightAnalysisState: (state) =>
    set((prev) => ({
      sunlightAnalysisState: { ...prev.sunlightAnalysisState, ...state },
    })),
  setRunReviewCheckFn: (fn) => set({ runReviewCheckFn: fn }),
  setStartSunlightFn: (fn) => set({ startSunlightFn: fn }),
  setToggleSunlightHeatmapFn: (fn) => set({ toggleSunlightHeatmapFn: fn }),
  setClearSunlightFn: (fn) => set({ clearSunlightFn: fn }),
  setSetSunlightHeatmapModeFn: (fn) => set({ setSunlightHeatmapModeFn: fn }),

  // 배치안 관련 액션
  setPlansOpen: (open) => set({ plansOpen: open }),

  addPlacementPlan: (plan) =>
    set((state) => ({
      placementPlans: [...state.placementPlans, plan],
    })),

  updatePlacementPlan: (id, updates) =>
    set((state) => ({
      placementPlans: state.placementPlans.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      ),
    })),

  removePlacementPlan: (id) =>
    set((state) => ({
      placementPlans: state.placementPlans.filter((p) => p.id !== id),
      activePlanId: state.activePlanId === id ? null : state.activePlanId,
    })),

  setActivePlanId: (id) => set({ activePlanId: id }),

  saveCurrentAsPlan: (name, description) => {
    const state = useProjectStore.getState()
    const now = Date.now()

    // 매스별 배치 정보만 저장 (매스 데이터는 프로젝트 레벨에서 공유)
    const massPlacement: MassPlacement[] = state.generatedMasses.map(mass => ({
      massId: mass.id,
      transform: { ...state.modelTransform },  // 현재는 단일 transform, 추후 매스별 transform으로 확장 가능
    }))

    const plan: PlacementPlan = {
      id: `plan_${now}`,
      name,
      description,
      massPlacement,
      modelTransform: { ...state.modelTransform },
      activeMassId: state.activeMassId,
      parkingZone: state.parkingZone ? JSON.parse(JSON.stringify(state.parkingZone)) : null,
      parkingTransform: { ...state.parkingTransform },
      parkingOrigin: state.parkingOrigin ? { ...state.parkingOrigin } : null,
      parkingEntrance: state.parkingEntrance ? JSON.parse(JSON.stringify(state.parkingEntrance)) : null,
      entranceTransform: { ...state.entranceTransform },
      isParkingVisible: state.isParkingVisible,
      gridRotation: state.gridRotation,
      parkingPath: state.parkingPath ? JSON.parse(JSON.stringify(state.parkingPath)) : null,
      sunlightResult: state.sunlightAnalysisState.result
        ? { ...state.sunlightAnalysisState.result }
        : null,
      reviewData: {
        zoneType: state.reviewData.zoneType,
        selectedZoneType: state.reviewData.selectedZoneType,
        buildingCoverage: state.reviewData.buildingCoverage ? { ...state.reviewData.buildingCoverage } : null,
        setback: state.reviewData.setback ? { ...state.reviewData.setback } : null,
        heightCheck: state.reviewData.heightCheck ? { ...state.reviewData.heightCheck } : null,
        isModelInBounds: state.reviewData.isModelInBounds,
      },
      // 새 배치안은 빈 점수로 시작. 직전 활성 plan 의 store.aiScore.result 가
      // 그대로 복사되면 두 배치안이 동일 점수로 보이는 버그 (해당 plan 의
      // 실제 배치/일조/주차로 계산된 게 아니라 직전 plan 의 잔여 점수).
      // 결과 페이지에서 매번 재계산되므로 빈 상태로 두는 게 안전.
      aiScore: undefined,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({
      placementPlans: [...s.placementPlans, plan],
      activePlanId: plan.id,
    }))
    return plan
  },

  /** 현재 활성 배치안의 상태를 저장 (배치안 전환 전 호출) */
  saveActivePlan: () => {
    const state = useProjectStore.getState()
    if (!state.activePlanId) return

    const massPlacement: MassPlacement[] = state.generatedMasses.map(mass => ({
      massId: mass.id,
      transform: { ...state.modelTransform },
    }))

    set((s) => ({
      placementPlans: s.placementPlans.map(p =>
        p.id === s.activePlanId
          ? {
              ...p,
              massPlacement,
              modelTransform: { ...s.modelTransform },
              activeMassId: s.activeMassId,
              parkingZone: s.parkingZone ? JSON.parse(JSON.stringify(s.parkingZone)) : null,
              parkingTransform: { ...s.parkingTransform },
              parkingOrigin: s.parkingOrigin ? { ...s.parkingOrigin } : null,
              parkingEntrance: s.parkingEntrance ? JSON.parse(JSON.stringify(s.parkingEntrance)) : null,
              entranceTransform: { ...s.entranceTransform },
              isParkingVisible: s.isParkingVisible,
              gridRotation: s.gridRotation,
              parkingPath: s.parkingPath ? JSON.parse(JSON.stringify(s.parkingPath)) : null,
              sunlightResult: s.sunlightAnalysisState.result
                ? { ...s.sunlightAnalysisState.result }
                : p.sunlightResult,  // 기존 값 유지
              reviewData: s.reviewData.buildingCoverage || s.reviewData.setback || s.reviewData.heightCheck
                ? {
                    zoneType: s.reviewData.zoneType,
                    selectedZoneType: s.reviewData.selectedZoneType,
                    buildingCoverage: s.reviewData.buildingCoverage ? { ...s.reviewData.buildingCoverage } : null,
                    setback: s.reviewData.setback ? { ...s.reviewData.setback } : null,
                    heightCheck: s.reviewData.heightCheck ? { ...s.reviewData.heightCheck } : null,
                    isModelInBounds: s.reviewData.isModelInBounds,
                  }
                : p.reviewData,  // 기존 값 유지
              aiScore: s.aiScore.result
                ? {
                    overallScore: s.aiScore.result.overallScore,
                    categoryGrades: s.aiScore.result.categoryGrades,
                    summary: s.aiScore.result.summary,
                    suggestions: s.aiScore.result.suggestions,
                    categories: s.aiScore.result.categories,
                  }
                : p.aiScore,  // 기존 값 유지
              updatedAt: Date.now(),
            }
          : p
      ),
    }))
    console.log('[ProjectStore] 현재 배치안 저장:', state.activePlanId)
  },

  loadPlan: (id) => {
    const state = useProjectStore.getState()
    const plan = state.placementPlans.find((p) => p.id === id)
    if (!plan) return

    // 이전 배치안 상태 저장 (전환 전)
    if (state.activePlanId && state.activePlanId !== id) {
      useProjectStore.getState().saveActivePlan()
    }

    // 배치안 로드 (매스 데이터는 건드리지 않음, transform만 적용)
    // 저장된 일조/규정/AI스코어 결과도 함께 복원
    set({
      activePlanId: id,
      modelTransform: { ...plan.modelTransform },
      activeMassId: plan.activeMassId,
      parkingZone: plan.parkingZone ? JSON.parse(JSON.stringify(plan.parkingZone)) : null,
      parkingTransform: { ...plan.parkingTransform },
      parkingOrigin: plan.parkingOrigin ? { ...plan.parkingOrigin } : null,
      parkingEntrance: plan.parkingEntrance ? JSON.parse(JSON.stringify(plan.parkingEntrance)) : null,
      entranceTransform: { ...plan.entranceTransform },
      isParkingVisible: plan.isParkingVisible,
      gridRotation: plan.gridRotation,
      parkingPath: plan.parkingPath ? JSON.parse(JSON.stringify(plan.parkingPath)) : null,
      // 저장된 일조 분석 결과 복원
      sunlightAnalysisState: plan.sunlightResult
        ? {
            isAnalyzing: false,
            progress: null,
            result: { ...plan.sunlightResult },
            showHeatmap: false,
            heatmapMode: 'point' as const,
          }
        : { isAnalyzing: false, progress: null, result: null, showHeatmap: false, heatmapMode: 'point' as const },
      // 저장된 규정 검토 결과 복원
      reviewData: plan.reviewData
        ? {
            zoneType: plan.reviewData.zoneType,
            selectedZoneType: plan.reviewData.selectedZoneType,
            buildingCoverage: plan.reviewData.buildingCoverage ? { ...plan.reviewData.buildingCoverage } : null,
            setback: plan.reviewData.setback ? { ...plan.reviewData.setback } : null,
            heightCheck: plan.reviewData.heightCheck ? { ...plan.reviewData.heightCheck } : null,
            isModelInBounds: plan.reviewData.isModelInBounds,
          }
        : {
            zoneType: state.reviewData.zoneType,
            selectedZoneType: state.reviewData.selectedZoneType,
            buildingCoverage: null,
            setback: null,
            heightCheck: null,
            isModelInBounds: true,
          },
      // 저장된 AI 스코어 복원
      aiScore: plan.aiScore
        ? {
            isLoading: false,
            result: {
              overallScore: plan.aiScore.overallScore,
              categoryGrades: plan.aiScore.categoryGrades,
              summary: plan.aiScore.summary,
              suggestions: plan.aiScore.suggestions || '',
              source: 'llm' as const,
              categories: plan.aiScore.categories,
            },
            error: null,
          }
        : { isLoading: false, result: null, error: null },
      validation: null,
    })
    console.log('[ProjectStore] 배치안 로드:', id, '일조/규정/AI스코어 복원됨')
  },

  // 테마 설정
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  reset: () =>
    set({
      projectId: null,
      projectName: null,
      workArea: null,
      site: null,
      building: null,
      modelUrl: null,
      selectedModel: null,
      loadedModelEntity: null,
      modelTransform: {
        longitude: 127.1388,
        latitude: 37.4449,
        height: 0,
        rotation: 180,
        scale: 10.0,
      },
      validation: null,
      isLoading: false,
      error: null,
      availableModels: [],
      selectedBlockCount: 0,
      selectedBlockInfo: null,
      modelToLoad: null,
      massGlbToLoad: null,
      massGlbRestoreTransform: null,
      loadedMassGlbUrl: null,
      generatedMasses: [],
      activeMassId: null,
      massSettings: { defaultHeight: 3.0, defaultFloors: 1 },
      isLoadingModel: false,
      humanScaleModelLoaded: false,
      mainEntrance: null,
      parkingConfig: {
        buildingUse: '근린생활시설',
        grossFloorArea: 0,
        ramp: false,
        requiredTotal: null,
        requiredDisabled: null,
        layoutPattern: 'perpendicular' as ParkingLayoutPattern,
      },
      parkingZone: null,
      isParkingVisible: false,
      isParkingEditing: false,
      parkingTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingOrigin: null,
      parkingEntrance: null,
      entranceTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingPath: null,
      gridRotation: 0,
      reviewData: { zoneType: undefined, selectedZoneType: undefined, buildingCoverage: null, setback: null, heightCheck: null, isModelInBounds: true },
      aiScore: { isLoading: false, result: null, error: null },
      sunlightAnalysisState: { isAnalyzing: false, progress: null, result: null, showHeatmap: false, heatmapMode: 'point' as const },
      resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null, renderedSitePlan: null, renderedAerialView: null },
      placementPlans: [],
      activePlanId: null,
      plansOpen: false,
      saveProjectFn: null,
      loadProjectFn: null,
      loadFromDbFn: null,
      isSavingProject: false,
      isLoadingProject: false,
      projectError: null,
    }),
}))
