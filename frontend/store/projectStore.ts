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
}

interface ProjectState {
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

  // 로드할 모델 파일명 (Sidebar에서 설정, CesiumViewer에서 처리)
  modelToLoad: string | null

  // 모델 로딩 중
  isLoadingModel: boolean

  // 휴먼 스케일 모델 로드 여부
  humanScaleModelLoaded: boolean

  // Actions
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
  setModelToLoad: (filename: string | null) => void
  setIsLoadingModel: (loading: boolean) => void
  setHumanScaleModelLoaded: (loaded: boolean) => void
  reset: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  // 초기 상태
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
  modelToLoad: null,
  isLoadingModel: false,
  humanScaleModelLoaded: false,

  // Actions
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

  setModelToLoad: (filename) => set({ modelToLoad: filename }),

  setIsLoadingModel: (loading) => set({ isLoadingModel: loading }),

  setHumanScaleModelLoaded: (loaded) => set({ humanScaleModelLoaded: loaded }),

  reset: () =>
    set({
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
      modelToLoad: null,
      isLoadingModel: false,
      humanScaleModelLoaded: false,
    }),
}))
