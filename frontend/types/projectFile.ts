/**
 * 프로젝트 파일 포맷 v1.0.0
 * 저장/불러오기 기능을 위한 직렬화 타입 정의
 */

// 파일 포맷 버전 (호환성 관리용)
export const PROJECT_FILE_VERSION = '1.0.0'

// 카메라 상태
export interface SerializedCameraState {
  position: { x: number; y: number; z: number }
  heading: number
  pitch: number
  roll: number
}

// 작업 영역
export interface SerializedWorkArea {
  longitude: number
  latitude: number
  address: string
  displayName: string
}

// 모델 변환 정보
export interface SerializedModelTransform {
  longitude: number
  latitude: number
  height: number
  rotation: number
  scale: number
}

// 건물 정보
export interface SerializedBuilding {
  height: number
  floors: number
  footprint: number[][]
  position?: number[]
  rotation?: number
}

// 대지 정보
export interface SerializedSite {
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

// 선택된 블록 (entity 제외)
export interface SerializedBlock {
  pnu: string
  feature: GeoJSON.Feature<GeoJSON.Polygon>
}

// 지적도 데이터
export interface SerializedCadastralData {
  features: GeoJSON.Feature<GeoJSON.Polygon>[]
  selectedRegion: { lon: number; lat: number } | null
}

// 건축선 엣지 정보
export interface SerializedEdgeInfo {
  edge: {
    index: number
    start: { lon: number; lat: number }
    end: { lon: number; lat: number }
    length: number
    lineString: GeoJSON.Feature<GeoJSON.LineString>
  }
  type: 'road' | 'adjacent_lot' | 'unknown'
  roadParcel?: GeoJSON.Feature
  setbackDistance: number
}

// 건축선 분석 결과
export interface SerializedBuildingLineResult {
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>
  edgeInfos: SerializedEdgeInfo[]
  roadEdges: SerializedEdgeInfo[]
  adjacentLotEdges: SerializedEdgeInfo[]
  zoneType: string
  buildingLine: GeoJSON.Feature<GeoJSON.Polygon> | null
  buildableArea: GeoJSON.Feature<GeoJSON.Polygon> | null
}

// 로드된 모델 정보
export interface SerializedLoadedModel {
  filename: string
  displayName?: string
}

// 생성된 매스 모델
export interface SerializedGeneratedMass {
  id: string
  fileName: string
  label: string
  glbUrl: string
  footprint: number[][]
  centroid: number[]
  area: number
  height: number
  floors: number
  classification: {
    total_entities: number
    class_counts: Record<string, number>
    average_confidence: number
  }
  boundingBox?: { width: number; depth: number; height: number }
  createdAt: number
}

// 시간 상태
export interface SerializedTimeState {
  isoString: string
}

// 휴먼 모델 배치 정보
export interface SerializedHumanModelTransform {
  longitude: number
  latitude: number
}

// 주차 슬롯 데이터
export interface SerializedParkingSlotData {
  id: number
  slot_type: 'standard' | 'disabled'
  cx: number
  cy: number
  width: number
  depth: number
  heading: number
  polygon: number[][]
}

// 주차 차로 데이터
export interface SerializedParkingAisleData {
  polygon: number[][]
  direction: string
}

// 주차 출입 포인트
export interface SerializedAccessPointData {
  x: number
  y: number
  road_x: number | null
  road_y: number | null
  width: number
}

// 주차 영역 데이터
export interface SerializedParkingZoneData {
  slots: SerializedParkingSlotData[]
  aisles: SerializedParkingAisleData[]
  accessPoint: SerializedAccessPointData | null
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

// 주차 입구 데이터
export interface SerializedParkingEntranceData {
  cx: number
  cy: number
  width: number
  depth: number
  heading: number
  polygon: number[][]
}

// 주차 그리드 셀
export interface SerializedParkingGridCell {
  x: number
  y: number
  blocked: boolean
}

// 주차 그리드 데이터
export interface SerializedParkingGridData {
  cells: SerializedParkingGridCell[]
  gridSize: number
  cols: number
  rows: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

// 주차 경로 데이터
export interface SerializedParkingPathData {
  points: number[][]
  length: number
  isValid: boolean
  grid?: SerializedParkingGridData
}

// 주차 설정
export interface SerializedParkingConfig {
  buildingUse: string
  grossFloorArea: number
  ramp: boolean
  requiredTotal: number | null
  requiredDisabled: number | null
  layoutPattern: 'perpendicular' | 'parallel'
}

// 주차/입구 변환 정보
export interface SerializedParkingTransform {
  longitude: number
  latitude: number
  rotation: number
}

// 전체 프로젝트 파일 구조
export interface ProjectFile {
  // 메타데이터
  version: string
  savedAt: string
  projectName?: string

  // 카메라 & 뷰포트
  camera: SerializedCameraState
  currentTime: SerializedTimeState

  // 프로젝트 스토어 상태
  workArea: SerializedWorkArea | null
  modelTransform: SerializedModelTransform
  building: SerializedBuilding | null
  site: SerializedSite | null
  selectedBlockCount: number
  humanScaleModelLoaded: boolean

  // 훅 상태
  cadastralData: SerializedCadastralData
  selectedBlocks: SerializedBlock[]
  buildingLineResult: SerializedBuildingLineResult | null
  showBuildingLine: boolean
  hiddenBuildingIds: string[]

  // 모델 상태
  loadedModel: SerializedLoadedModel | null

  // 생성된 매스 모델 목록
  generatedMasses?: SerializedGeneratedMass[]

  // 현재 뷰포트에 배치된 매스 GLB URL
  activeMassGlbUrl?: string | null

  // 휴먼 모델 상태
  humanModelTransform: SerializedHumanModelTransform | null

  // 주차 관련 데이터
  parkingZone?: SerializedParkingZoneData | null
  parkingEntrance?: SerializedParkingEntranceData | null
  parkingPath?: SerializedParkingPathData | null
  parkingConfig?: SerializedParkingConfig
  parkingTransform?: SerializedParkingTransform
  entranceTransform?: SerializedParkingTransform
  isParkingVisible?: boolean
  gridRotation?: number
}

// 파일 검증 결과
export interface ProjectFileValidation {
  isValid: boolean
  errors: string[]
  warnings: string[]
  version: string
}
