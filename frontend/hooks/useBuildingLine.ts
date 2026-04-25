'use client'

import { useCallback, useRef, useState, RefObject } from 'react'
import * as turf from '@turf/turf'
import {
  analyzeBuildingLine,
  fetchZoneType,
  fetchNearbyParcels,
  expandBbox,
  type BuildingLineResult,
} from '@/lib/buildingLine'
import { ZoneType, DEFAULT_SETBACKS } from '@/lib/setbackTable'
import type { SelectedBlock, CesiumViewer } from '@/types/cesium'
import type { SerializedBuildingLineResult } from '@/types/projectFile'

/**
 * 여러 블록을 하나의 폴리곤으로 합필
 */
function mergeBlocks(blocks: SelectedBlock[]): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (blocks.length === 0) return null

  if (blocks.length === 1) {
    // 단일 블록
    const feature = blocks[0].feature
    return {
      type: 'Feature',
      properties: feature.properties || {},
      geometry: feature.geometry as GeoJSON.Polygon,
    }
  }

  // 여러 블록 합필
  try {
    // 첫 번째 블록으로 시작
    let merged: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = turf.polygon(
      blocks[0].feature.geometry.coordinates as number[][][]
    )

    // 나머지 블록들을 순차적으로 합필
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i]
      const polygon = turf.polygon(block.feature.geometry.coordinates as number[][][])

      const unionResult = turf.union(
        turf.featureCollection([merged, polygon])
      )

      if (unionResult) {
        merged = unionResult as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      }
    }

    // MultiPolygon인 경우 가장 큰 폴리곤 선택 또는 첫 번째 폴리곤 사용
    if (merged.geometry.type === 'MultiPolygon') {
      console.log('합필 결과가 MultiPolygon입니다. 가장 큰 폴리곤을 선택합니다.')
      const polygons = merged.geometry.coordinates
      let largestArea = 0
      let largestPolygon: number[][][] = polygons[0]

      for (const poly of polygons) {
        const area = turf.area(turf.polygon(poly))
        if (area > largestArea) {
          largestArea = area
          largestPolygon = poly
        }
      }

      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: largestPolygon,
        },
      }
    }

    // 합필된 속성 병합
    const mergedProperties: Record<string, any> = {}
    blocks.forEach((block, idx) => {
      if (block.feature.properties) {
        Object.entries(block.feature.properties).forEach(([key, value]) => {
          if (idx === 0) {
            mergedProperties[key] = value
          }
        })
      }
    })
    mergedProperties.mergedCount = blocks.length
    mergedProperties.mergedPnus = blocks.map(b => b.pnu).join(',')

    return {
      type: 'Feature',
      properties: mergedProperties,
      geometry: merged.geometry as GeoJSON.Polygon,
    }
  } catch (error) {
    console.error('블록 합필 오류:', error)
    // 실패 시 첫 번째 블록만 반환
    const feature = blocks[0].feature
    return {
      type: 'Feature',
      properties: feature.properties || {},
      geometry: feature.geometry as GeoJSON.Polygon,
    }
  }
}

interface UseBuildingLineOptions {
  getSelectedBlocks: () => SelectedBlock[]
}

interface UseBuildingLineReturn {
  showBuildingLine: boolean
  buildingLineResult: BuildingLineResult | null
  currentZoneType: ZoneType
  toggleBuildingLine: () => void
  clearBuildingLine: () => void
  calculateBuildingLine: () => Promise<void>
  // 프로젝트 저장/불러오기용
  getBuildingLineResult: () => BuildingLineResult | null
  restoreBuildingLineState: (result: SerializedBuildingLineResult | null, show: boolean) => Promise<void>
}

/**
 * 건축선 계산 및 표시 관리 훅
 */
export function useBuildingLine(
  viewerRef: RefObject<CesiumViewer | null>,
  options: UseBuildingLineOptions
): UseBuildingLineReturn {
  const { getSelectedBlocks } = options

  const [showBuildingLine, setShowBuildingLine] = useState(false)
  const [buildingLineResult, setBuildingLineResult] = useState<BuildingLineResult | null>(null)
  const [currentZoneType, setCurrentZoneType] = useState<ZoneType>('미지정')

  // 엔티티 참조
  const buildingLineEntitiesRef = useRef<any[]>([])
  const roadEdgeEntitiesRef = useRef<any[]>([])
  const adjacentEdgeEntitiesRef = useRef<any[]>([])

  // 건축선 엔티티들 제거
  const clearBuildingLine = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    buildingLineEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    buildingLineEntitiesRef.current = []

    roadEdgeEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    roadEdgeEntitiesRef.current = []

    adjacentEdgeEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    adjacentEdgeEntitiesRef.current = []

    setShowBuildingLine(false)
    setBuildingLineResult(null)

    viewer.scene.requestRender()
  }, [viewerRef])

  // 건축선 계산 및 표시
  const calculateBuildingLine = useCallback(async () => {
    const viewer = viewerRef.current
    if (!viewer) return

    const selectedBlocks = getSelectedBlocks()
    if (selectedBlocks.length === 0) {
      console.log('선택된 블록이 없습니다')
      return
    }

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 기존 건축선 제거
    clearBuildingLine()

    try {
      // 여러 블록 선택 시 합필 처리
      const mergedPolygon = mergeBlocks(selectedBlocks)

      if (!mergedPolygon || !mergedPolygon.geometry) {
        console.warn('블록 합필 실패 또는 geometry가 없습니다')
        return
      }

      console.log(`${selectedBlocks.length}개 블록 ${selectedBlocks.length > 1 ? '합필' : '선택'} 완료`)

      // GeoJSON Feature 사용
      const cadastralPolygon = mergedPolygon

      // 중심점 계산 (turf 사용)
      const centroid = turf.centroid(cadastralPolygon)
      const centerLon = centroid.geometry.coordinates[0]
      const centerLat = centroid.geometry.coordinates[1]

      console.log('건축선 계산 시작:', { centerLon, centerLat, blockCount: selectedBlocks.length })

      // 용도지역 조회
      const zoneType = await fetchZoneType(centerLon, centerLat)
      setCurrentZoneType(zoneType)
      console.log('용도지역:', zoneType)

      // 주변 필지 조회 (bbox 확장)
      const bbox = expandBbox(cadastralPolygon as any, 30)
      const nearbyParcels = await fetchNearbyParcels(bbox)
      console.log('주변 필지 수:', nearbyParcels.length)

      // 건축선 분석
      const result = await analyzeBuildingLine(
        cadastralPolygon as any,
        nearbyParcels as any,
        zoneType,
        '기타',
        4
      )

      setBuildingLineResult(result)
      console.log('건축선 분석 결과:', {
        도로접촉변: result.roadEdges.length,
        인접대지변: result.adjacentLotEdges.length,
        용도지역: result.zoneType,
      })

      // 건축선 폴리곤 표시 (빨간 테두리 + 반투명 면)
      if (result.buildingLine && result.buildingLine.geometry) {
        const buildingLineCoords = result.buildingLine.geometry.coordinates[0]
        const positions = buildingLineCoords.flatMap((c: number[]) => [c[0], c[1]])
        const cartesianPositions = Cesium.Cartesian3.fromDegreesArray(positions)

        // 건축선 테두리
        const buildingLineEntity = viewer.entities.add({
          polyline: {
            positions: cartesianPositions,
            width: 4,
            material: Cesium.Color.RED,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: 10,
          },
        })
        buildingLineEntitiesRef.current.push(buildingLineEntity)

        // 건축 가능 영역 면
        const areaEntity = viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(cartesianPositions),
            material: Cesium.Color.RED.withAlpha(0.08),
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        })
        buildingLineEntitiesRef.current.push(areaEntity)
      }

      // 도로 접촉 변 표시 (주황색, 두꺼운 실선)
      result.roadEdges.forEach((edgeInfo) => {
        const edge = edgeInfo.edge
        const positions = [
          edge.start.lon, edge.start.lat,
          edge.end.lon, edge.end.lat,
        ]

        const roadEdgeEntity = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(positions),
            width: 8,
            material: Cesium.Color.ORANGE,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: 8,
          },
        })
        roadEdgeEntitiesRef.current.push(roadEdgeEntity)

      })

      // 인접 대지 변 표시 (노란색, 얇은 실선)
      result.adjacentLotEdges.forEach((edgeInfo) => {
        const edge = edgeInfo.edge
        const positions = [
          edge.start.lon, edge.start.lat,
          edge.end.lon, edge.end.lat,
        ]

        const adjacentEdgeEntity = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(positions),
            width: 4,
            material: Cesium.Color.YELLOW.withAlpha(0.8),
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: 6,
          },
        })
        adjacentEdgeEntitiesRef.current.push(adjacentEdgeEntity)
      })

      setShowBuildingLine(true)
      viewer.scene.requestRender()

      console.log('건축선 표시 완료')
    } catch (error) {
      console.error('건축선 계산 오류:', error)
    }
  }, [viewerRef, getSelectedBlocks, clearBuildingLine])

  // 건축선 토글
  const toggleBuildingLine = useCallback(() => {
    if (showBuildingLine) {
      clearBuildingLine()
    } else {
      calculateBuildingLine()
    }
  }, [showBuildingLine, clearBuildingLine, calculateBuildingLine])

  // 건축선 결과 반환 (저장용)
  const getBuildingLineResult = useCallback(() => {
    return buildingLineResult
  }, [buildingLineResult])

  // 저장된 건축선 상태 복원
  const restoreBuildingLineState = useCallback(async (
    result: SerializedBuildingLineResult | null,
    show: boolean
  ) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 기존 건축선 제거
    clearBuildingLine()

    // 결과가 없거나 표시하지 않으면 종료
    if (!result || !show) {
      console.log('복원할 건축선 없음')
      return
    }

    // 결과 상태 설정
    setBuildingLineResult(result as BuildingLineResult)
    setCurrentZoneType(result.zoneType as ZoneType)

    // 건축선 폴리곤 표시 (빨간 대시선 + 반투명 면)
    if (result.buildingLine?.geometry?.coordinates?.[0]) {
      const buildingLineCoords = result.buildingLine.geometry.coordinates[0]
      const positions = buildingLineCoords.flatMap((c: number[]) => [c[0], c[1]])
      const cartesianPositions = Cesium.Cartesian3.fromDegreesArray(positions)

      const buildingLineEntity = viewer.entities.add({
        polyline: {
          positions: cartesianPositions,
          width: 4,
          material: Cesium.Color.RED,
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
          zIndex: 10,
        },
      })
      buildingLineEntitiesRef.current.push(buildingLineEntity)

      const areaEntity = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(cartesianPositions),
          material: Cesium.Color.RED.withAlpha(0.08),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      })
      buildingLineEntitiesRef.current.push(areaEntity)
    }

    // 도로 접촉 변 표시 (주황색)
    result.roadEdges?.forEach((edgeInfo) => {
      const edge = edgeInfo.edge
      const positions = [
        edge.start.lon, edge.start.lat,
        edge.end.lon, edge.end.lat,
      ]

      const roadEdgeEntity = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: 8,
          material: Cesium.Color.ORANGE,
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
          zIndex: 8,
        },
      })
      roadEdgeEntitiesRef.current.push(roadEdgeEntity)
    })

    // 인접 대지 변 표시 (노란색)
    result.adjacentLotEdges?.forEach((edgeInfo) => {
      const edge = edgeInfo.edge
      const positions = [
        edge.start.lon, edge.start.lat,
        edge.end.lon, edge.end.lat,
      ]

      const adjacentEdgeEntity = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: 4,
          material: Cesium.Color.YELLOW.withAlpha(0.8),
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
          zIndex: 6,
        },
      })
      adjacentEdgeEntitiesRef.current.push(adjacentEdgeEntity)
    })

    setShowBuildingLine(true)
    viewer.scene.requestRender()
    console.log('건축선 복원 완료')
  }, [viewerRef, clearBuildingLine])

  return {
    showBuildingLine,
    buildingLineResult,
    currentZoneType,
    toggleBuildingLine,
    clearBuildingLine,
    calculateBuildingLine,
    getBuildingLineResult,
    restoreBuildingLineState,
  }
}
