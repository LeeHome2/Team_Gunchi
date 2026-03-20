'use client'

import { useCallback, useEffect, useState, RefObject } from 'react'
import type { CesiumViewer, CesiumTileset } from '@/types/cesium'

interface SelectedBuilding {
  id: string
  name: string
}

interface UseOsmBuildingsReturn {
  hiddenBuildingIds: string[]
  selectedBuilding: SelectedBuilding | null
  isBuildingSelectMode: boolean
  toggleBuildingSelectMode: () => void
  hideSelectedBuilding: () => void
  restoreBuilding: (buildingId: string) => void
  restoreAllBuildings: () => void
  // 프로젝트 저장/불러오기용
  setHiddenBuildingIdsDirect: (ids: string[]) => void
}

/**
 * OSM Buildings 숨기기/표시 관리 훅
 */
export function useOsmBuildings(
  viewerRef: RefObject<CesiumViewer | null>,
  osmTilesetRef: RefObject<CesiumTileset>,
  isLoaded: boolean
): UseOsmBuildingsReturn {
  const [hiddenBuildingIds, setHiddenBuildingIds] = useState<string[]>([])
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null)
  const [isBuildingSelectMode, setIsBuildingSelectMode] = useState(false)

  // 건물 선택 모드 토글
  const toggleBuildingSelectMode = useCallback(() => {
    setIsBuildingSelectMode(prev => !prev)
    setSelectedBuilding(null)
  }, [])

  // 숨긴 건물 목록 변경 시 OSM Buildings 스타일 업데이트
  useEffect(() => {
    if (!osmTilesetRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 숨길 건물 ID 조건 생성
    let showCondition = 'true'
    if (hiddenBuildingIds.length > 0) {
      const conditions = hiddenBuildingIds.map(id => `\${elementId} !== ${id}`).join(' && ')
      showCondition = conditions
    }

    osmTilesetRef.current.style = new Cesium.Cesium3DTileStyle({
      show: showCondition,
      color: "color('#D3D3D3')"
    })

    viewerRef.current?.scene.requestRender()
    console.log('OSM 건물 스타일 업데이트:', showCondition)
  }, [hiddenBuildingIds, isLoaded, viewerRef, osmTilesetRef])

  // 건물 선택 모드 클릭 핸들러
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !isLoaded || !isBuildingSelectMode) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((click: any) => {
      const pickedFeature = viewer.scene.pick(click.position)

      if (Cesium.defined(pickedFeature) && pickedFeature.primitive === osmTilesetRef.current) {
        // OSM Building 선택됨
        const elementId = pickedFeature.getProperty('elementId')
        const name = pickedFeature.getProperty('name') || '이름 없음'

        if (elementId) {
          setSelectedBuilding({
            id: String(elementId),
            name: String(name)
          })
          console.log('건물 선택됨:', { elementId, name })
        }
      } else {
        // 빈 공간 클릭 - 선택 해제
        setSelectedBuilding(null)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      handler.destroy()
    }
  }, [viewerRef, isLoaded, isBuildingSelectMode, osmTilesetRef])

  // 선택한 건물 숨기기
  const hideSelectedBuilding = useCallback(() => {
    if (!selectedBuilding) return

    setHiddenBuildingIds(prev => {
      if (prev.includes(selectedBuilding.id)) return prev
      return [...prev, selectedBuilding.id]
    })
    setSelectedBuilding(null)
    console.log('건물 숨김:', selectedBuilding.id)
  }, [selectedBuilding])

  // 숨긴 건물 복원
  const restoreBuilding = useCallback((buildingId: string) => {
    setHiddenBuildingIds(prev => prev.filter(id => id !== buildingId))
    console.log('건물 복원:', buildingId)
  }, [])

  // 모든 숨긴 건물 복원
  const restoreAllBuildings = useCallback(() => {
    setHiddenBuildingIds([])
    console.log('모든 건물 복원')
  }, [])

  // 숨긴 건물 ID 직접 설정 (복원용)
  const setHiddenBuildingIdsDirect = useCallback((ids: string[]) => {
    setHiddenBuildingIds(ids)
    console.log('숨긴 건물 복원:', ids.length, '개')
  }, [])

  return {
    hiddenBuildingIds,
    selectedBuilding,
    isBuildingSelectMode,
    toggleBuildingSelectMode,
    hideSelectedBuilding,
    restoreBuilding,
    restoreAllBuildings,
    setHiddenBuildingIdsDirect,
  }
}
