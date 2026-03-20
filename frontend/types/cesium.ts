/**
 * Cesium 관련 공통 타입 정의
 */

// Cesium Viewer 타입 (any로 처리 - Cesium은 window에서 로드)
export type CesiumViewer = any
export type CesiumEntity = any
export type CesiumCartesian3 = any
export type CesiumTileset = any

// 선택된 블록 정보
export interface SelectedBlock {
  pnu: string
  entity: CesiumEntity
  feature: GeoJSON.Feature<GeoJSON.Polygon>
}

// 모델 변환 정보
export interface ModelTransform {
  longitude: number
  latitude: number
  height: number
  rotation: number
  scale: number
}

// 작업 영역 정보
export interface WorkArea {
  center: [number, number]
  address: string
}

// 바운딩 박스
export interface BoundingBox {
  width: number
  depth: number
}

// 좌표 타입
export interface Coordinate {
  lon: number
  lat: number
}

// GeoJSON Feature 타입 확장
export interface CadastralFeature extends GeoJSON.Feature<GeoJSON.Polygon> {
  properties: {
    pnu?: string
    jimok?: string
    isRoad?: boolean
    [key: string]: any
  }
}

// 숨긴 건물 정보
export interface HiddenBuilding {
  id: string
  name?: string
}

// 샘플 모델 정보
export interface SampleModel {
  filename: string
  displayName: string
  sizeFormatted: string
  size: number
}
