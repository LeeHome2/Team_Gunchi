/**
 * Module: Building Utilities
 * 건물 생성 및 관리 유틸리티
 */

import { transformFootprint } from './coordinates'

export interface BuildingConfig {
  id: string
  footprint: number[][]
  height: number
  floors: number
  color?: string
  opacity?: number
}

export interface BuildingTransform {
  offsetX: number  // 미터
  offsetY: number  // 미터
  rotation: number // 도
}

/**
 * Cesium에 건물 엔티티 추가
 */
export function addBuildingEntity(
  viewer: any,
  Cesium: any,
  config: BuildingConfig,
  centroid: [number, number],
  transform?: BuildingTransform
) {
  const entityId = `building-${config.id}`

  // 기존 엔티티 제거
  const existing = viewer.entities.getById(entityId)
  if (existing) {
    viewer.entities.remove(existing)
  }

  // 변환 적용
  let finalFootprint = config.footprint
  if (transform) {
    finalFootprint = transformFootprint(
      config.footprint,
      centroid,
      { x: transform.offsetX, y: transform.offsetY },
      transform.rotation
    )
  }

  // 좌표 배열 변환
  const positions = finalFootprint.flatMap(coord => [coord[0], coord[1]])

  // 색상 파싱
  const color = config.color || 'CORNFLOWERBLUE'
  const opacity = config.opacity ?? 0.8
  const material = Cesium.Color[color]?.withAlpha(opacity)
    || Cesium.Color.CORNFLOWERBLUE.withAlpha(opacity)

  // 엔티티 추가
  viewer.entities.add({
    id: entityId,
    name: `건물 ${config.id}`,
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
      height: 0,
      extrudedHeight: config.height,
      material: material,
      outline: true,
      outlineColor: Cesium.Color.WHITE,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
    },
  })

  return entityId
}

/**
 * 건물 엔티티 제거
 */
export function removeBuildingEntity(viewer: any, buildingId: string) {
  const entityId = `building-${buildingId}`
  const existing = viewer.entities.getById(entityId)
  if (existing) {
    viewer.entities.remove(existing)
    return true
  }
  return false
}

/**
 * 대지 경계 엔티티 추가
 */
export function addSiteBoundary(
  viewer: any,
  Cesium: any,
  footprint: number[][],
  id: string = 'site-boundary'
) {
  // 기존 제거
  const existing = viewer.entities.getById(id)
  if (existing) {
    viewer.entities.remove(existing)
  }

  const positions = footprint.flatMap(coord => [coord[0], coord[1]])

  viewer.entities.add({
    id: id,
    name: '대지 경계',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
      height: 0,
      material: Cesium.Color.YELLOW.withAlpha(0.3),
      outline: true,
      outlineColor: Cesium.Color.YELLOW,
      outlineWidth: 3,
    },
  })
}

/**
 * 카메라를 특정 위치로 이동
 */
export function flyToLocation(
  viewer: any,
  Cesium: any,
  longitude: number,
  latitude: number,
  height: number = 200,
  duration: number = 1.5
) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
    duration: duration,
  })
}

/**
 * 건물 색상 프리셋
 */
export const BUILDING_COLORS = {
  DEFAULT: 'CORNFLOWERBLUE',
  SELECTED: 'DODGERBLUE',
  DRAGGING: 'LIMEGREEN',
  ERROR: 'TOMATO',
  WARNING: 'ORANGE',
} as const

/**
 * 층고 계산
 */
export function calculateFloorHeight(totalHeight: number, floors: number): number {
  return totalHeight / floors
}

/**
 * 건폐율 계산 (간단 버전)
 */
export function calculateBuildingCoverage(
  buildingArea: number,
  siteArea: number
): number {
  return (buildingArea / siteArea) * 100
}
