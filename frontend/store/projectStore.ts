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

// 샘플 모델 정보
interface SampleModel {
  id: string
  name: string
  url: string
  thumbnail?: string
}

// 사용 가능한 샘플 모델 목록
export const SAMPLE_MODELS: SampleModel[] = [
  {
    id: 'sample_house',
    name: '샘플 주택',
    url: '/models/sample_house.glb',
  },
]

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
  }

  // 검토 결과
  validation: ValidationResult | null

  // 로딩 상태
  isLoading: boolean

  // 에러 메시지
  error: string | null

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
  },
  validation: null,
  isLoading: false,
  error: null,

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
      },
      validation: null,
      isLoading: false,
      error: null,
    }),
}))
