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
  blocked: boolean // true=장애물(건물)
}

export interface ParkingGridData {
  cells: ParkingGridCell[]
  gridSize: number
  cols: number
  rows: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
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
export interface GeneratedMass {
  id: string
  fileName: string       // 원본 DXF 파일명
  label: string          // 표시명
  glbUrl: string         // 백엔드 GLB URL
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
  createdAt: number      // timestamp
}

interface ProjectState {
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

  // 생성된 매스 모델 목록
  generatedMasses: GeneratedMass[]

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
  // 주차 입구 (독립 오브젝트)
  parkingEntrance: ParkingEntranceData | null
  entranceTransform: { longitude: number; latitude: number; rotation: number }
  // 경로 탐색 결과
  parkingPath: ParkingPathData | null

  // 검토 탭 데이터 (CesiumViewer에서 계산)
  reviewData: {
    buildingCoverage: { buildingArea: number; siteArea: number; ratio: number; limit: number; status: 'OK' | 'VIOLATION' } | null
    setback: { minDistance: number; required: number; status: 'OK' | 'VIOLATION'; details: { type: string; distance: number; required: number; status: 'OK' | 'VIOLATION' }[] } | null
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
    } | null
    error: string | null
  }
  setAIScore: (state: Partial<ProjectState['aiScore']>) => void

  // 일조 분석 날짜/시간 (Sidebar ↔ CesiumViewer 공유)
  sunlightDate: Date
  setSunlightDate: (date: Date) => void

  // 결과 확인 페이지용 스냅샷
  resultSnapshot: ResultSnapshot

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
  setIsLoadingModel: (loading: boolean) => void
  setHumanScaleModelLoaded: (loaded: boolean) => void
  setParkingConfig: (config: Partial<ParkingConfig>) => void
  setParkingZone: (zone: ParkingZoneData | null) => void
  setIsParkingVisible: (visible: boolean) => void
  setIsParkingEditing: (editing: boolean) => void
  setParkingTransform: (transform: Partial<{ longitude: number; latitude: number; rotation: number }>) => void
  setParkingEntrance: (entrance: ParkingEntranceData | null) => void
  setEntranceTransform: (transform: Partial<{ longitude: number; latitude: number; rotation: number }>) => void
  setParkingPath: (path: ParkingPathData | null) => void
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
  reset: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  // 초기 상태
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
  parkingEntrance: null,
  entranceTransform: { longitude: 0, latitude: 0, rotation: 0 },
  parkingPath: null,
  reviewData: {
    buildingCoverage: null,
    setback: null,
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
  resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null },
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
  setProjectId: (id) => set({ projectId: id }),
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
    set((state) => ({ generatedMasses: [...state.generatedMasses, mass] })),
  removeGeneratedMass: (id) =>
    set((state) => ({ generatedMasses: state.generatedMasses.filter((m) => m.id !== id) })),

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
  setParkingEntrance: (entrance) => set({ parkingEntrance: entrance }),
  setEntranceTransform: (transform) =>
    set((state) => ({
      entranceTransform: { ...state.entranceTransform, ...transform },
    })),
  setParkingPath: (path) => set({ parkingPath: path }),
  clearParking: () =>
    set({
      parkingZone: null,
      isParkingVisible: false,
      isParkingEditing: false,
      parkingTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingEntrance: null,
      entranceTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingPath: null,
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
    set({ resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null } }),

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
      parkingEntrance: null,
      entranceTransform: { longitude: 0, latitude: 0, rotation: 0 },
      parkingPath: null,
      reviewData: { buildingCoverage: null, setback: null, isModelInBounds: true },
      aiScore: { isLoading: false, result: null, error: null },
      sunlightAnalysisState: { isAnalyzing: false, progress: null, result: null, showHeatmap: false, heatmapMode: 'point' as const },
      resultSnapshot: { sitePlan: null, aerialView: null, capturedAt: null },
      saveProjectFn: null,
      loadProjectFn: null,
      loadFromDbFn: null,
      isSavingProject: false,
      isLoadingProject: false,
      projectError: null,
    }),
}))
