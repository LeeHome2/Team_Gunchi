'use client'

import { useCallback, useRef, useState, RefObject } from 'react'
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
      // 첫 번째 선택된 블록을 대상으로 건축선 계산
      const selectedBlock = selectedBlocks[0]
      const feature = selectedBlock.feature

      if (!feature || !feature.geometry) {
        console.warn('선택된 블록에 geometry가 없습니다')
        return
      }

      // GeoJSON Feature 생성
      const cadastralPolygon = {
        type: 'Feature' as const,
        properties: feature.properties || {},
        geometry: feature.geometry as GeoJSON.Polygon,
      }

      // 중심점 계산
      const coords = feature.geometry.coordinates[0]
      const centerLon = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length
      const centerLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length

      console.log('건축선 계산 시작:', { centerLon, centerLat })

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

      // 건축선 폴리라인 표시 (빨간색)
      if (result.buildingLine && result.buildingLine.geometry) {
        const buildingLineCoords = result.buildingLine.geometry.coordinates[0]
        const positions = buildingLineCoords.flatMap((c: number[]) => [c[0], c[1]])

        const buildingLineEntity = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(positions),
            width: 5,
            material: Cesium.Color.RED,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: 10,
          },
        })
        buildingLineEntitiesRef.current.push(buildingLineEntity)
      }

      // 도로 접촉 변 표시 (주황색)
      result.roadEdges.forEach((edgeInfo) => {
        const edge = edgeInfo.edge
        const positions = [
          edge.start.lon, edge.start.lat,
          edge.end.lon, edge.end.lat,
        ]

        const roadEdgeEntity = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(positions),
            width: 7,
            material: Cesium.Color.ORANGE,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: 8,
          },
        })
        roadEdgeEntitiesRef.current.push(roadEdgeEntity)
      })

      // 인접 대지 변 표시 (노란색)
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
        roadEdgeEntitiesRef.current.push(adjacentEdgeEntity)
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

    // 건축선 폴리라인 표시 (빨간색)
    if (result.buildingLine?.geometry?.coordinates?.[0]) {
      const buildingLineCoords = result.buildingLine.geometry.coordinates[0]
      const positions = buildingLineCoords.flatMap((c: number[]) => [c[0], c[1]])

      const buildingLineEntity = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: 5,
          material: Cesium.Color.RED,
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
          zIndex: 10,
        },
      })
      buildingLineEntitiesRef.current.push(buildingLineEntity)
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
          width: 7,
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
      roadEdgeEntitiesRef.current.push(adjacentEdgeEntity)
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
