'use client'

import { useCallback, useRef, useState, RefObject } from 'react'
import type { CesiumViewer, CadastralFeature } from '@/types/cesium'
import type { SerializedCadastralData } from '@/types/projectFile'

interface UseCadastralReturn {
  showCadastral: boolean
  hasPolylinesLoaded: boolean
  cadastralFeatures: CadastralFeature[]
  loadCadastralBoundaries: (lon: number, lat: number) => Promise<void>
  toggleCadastral: () => void
  removeCadastralLayer: () => void
  // 프로젝트 저장/불러오기용
  getSelectedRegion: () => { lon: number; lat: number } | null
  restoreCadastralState: (data: SerializedCadastralData) => Promise<void>
}

/**
 * 지적도 레이어 관리 훅
 */
export function useCadastral(
  viewerRef: RefObject<CesiumViewer | null>,
  onBlockSelectionClear?: () => void
): UseCadastralReturn {
  const [showCadastral, setShowCadastral] = useState(false)
  const [hasPolylinesLoaded, setHasPolylinesLoaded] = useState(false)
  const [cadastralFeatures, setCadastralFeatures] = useState<CadastralFeature[]>([])

  // refs
  const cadastralLayerRef = useRef<any>(null)
  const cadastralBoundaryEntitiesRef = useRef<any[]>([])
  const selectedRegionRef = useRef<{ lon: number; lat: number } | null>(null)

  // WFS로 대지경계선 벡터 데이터 로드 및 폴리라인 그리기
  const loadCadastralBoundaries = useCallback(async (lon: number, lat: number) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 기존 경계선 엔티티 제거
    cadastralBoundaryEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    cadastralBoundaryEntitiesRef.current = []

    // 블록 선택 초기화
    onBlockSelectionClear?.()

    // 선택된 지역 좌표 저장
    selectedRegionRef.current = { lon, lat }

    // 범위 계산 (약 200m)
    const offset = 0.002
    const west = lon - offset
    const south = lat - offset
    const east = lon + offset
    const north = lat + offset

    try {
      const response = await fetch(`/api/cadastral/wfs?bbox=${west},${south},${east},${north}`)

      if (!response.ok) {
        console.error('WFS 요청 실패:', response.status)
        return
      }

      const data = await response.json()

      if (!data.features || data.features.length === 0) {
        console.log('지적 경계 데이터 없음')
        return
      }

      console.log(`지적 경계 ${data.features.length}개 로드됨`)

      // GeoJSON features 저장 (블록 선택용) - state로 업데이트
      setCadastralFeatures(data.features)

      // 각 폴리곤의 경계를 폴리라인으로 그리기
      let polylineCount = 0

      for (const feature of data.features) {
        if (feature.geometry && feature.geometry.type === 'Polygon') {
          const rings = feature.geometry.coordinates

          for (const ring of rings) {
            const positions = ring.map((coord: number[]) =>
              Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
            )

            const entity = viewer.entities.add({
              polyline: {
                positions: positions,
                width: 4,
                material: Cesium.Color.MAGENTA,
                clampToGround: true,
                classificationType: Cesium.ClassificationType.TERRAIN,
              }
            })

            cadastralBoundaryEntitiesRef.current.push(entity)
            polylineCount++
          }
        }
      }

      viewer.scene.requestRender()
      setHasPolylinesLoaded(true)
      console.log('대지경계선 그리기 완료:', polylineCount, '개 폴리라인')
    } catch (error) {
      console.error('WFS 데이터 로드 실패:', error)
    }
  }, [viewerRef, onBlockSelectionClear])

  // 지적도 WMS 토글
  const toggleCadastral = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    if (showCadastral) {
      // 지적도 WMS 타일 끄기
      if (cadastralLayerRef.current) {
        viewer.imageryLayers.remove(cadastralLayerRef.current)
        cadastralLayerRef.current = null
        viewer.scene.requestRender()
      }
      setShowCadastral(false)
    } else {
      // 선택된 지역이 없으면 경고
      if (!selectedRegionRef.current) {
        console.log('먼저 지역을 선택해주세요')
        return
      }

      const { lon, lat } = selectedRegionRef.current

      // 기존 레이어 제거
      if (cadastralLayerRef.current) {
        viewer.imageryLayers.remove(cadastralLayerRef.current)
        cadastralLayerRef.current = null
      }

      // 지적도 WMS 타일 로드
      const offset = 0.002
      const west = lon - offset
      const south = lat - offset
      const east = lon + offset
      const north = lat + offset

      try {
        const cadastralProvider = new Cesium.SingleTileImageryProvider({
          url: `/api/cadastral?bbox=${west},${south},${east},${north}&width=1024&height=1024`,
          rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
          tileWidth: 1024,
          tileHeight: 1024,
          credit: 'Vworld 지적도',
        })

        cadastralLayerRef.current = viewer.imageryLayers.addImageryProvider(cadastralProvider)
        cadastralLayerRef.current.alpha = 0.85
        setShowCadastral(true)
        console.log('지적도 WMS 타일 로드됨:', { lon, lat })

        viewer.scene.requestRender()
      } catch (error) {
        console.error('지적도 로드 실패:', error)
      }
    }
  }, [viewerRef, showCadastral])

  // 지적도 레이어 전체 제거
  const removeCadastralLayer = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // 이미지 레이어 제거
    if (cadastralLayerRef.current) {
      viewer.imageryLayers.remove(cadastralLayerRef.current)
      cadastralLayerRef.current = null
    }

    // 경계선 엔티티 제거
    cadastralBoundaryEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    cadastralBoundaryEntitiesRef.current = []

    // features 및 지역 좌표 초기화
    setCadastralFeatures([])
    selectedRegionRef.current = null

    setShowCadastral(false)
    setHasPolylinesLoaded(false)
    viewer.scene.requestRender()
    console.log('지적도 제거됨')
  }, [viewerRef])

  // 선택된 지역 좌표 반환 (저장용)
  const getSelectedRegion = useCallback(() => {
    return selectedRegionRef.current
  }, [])

  // 저장된 지적도 상태 복원
  const restoreCadastralState = useCallback(async (data: SerializedCadastralData) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 기존 데이터 제거
    removeCadastralLayer()

    // features 설정
    setCadastralFeatures(data.features as CadastralFeature[])

    // 선택 지역 설정
    if (data.selectedRegion) {
      selectedRegionRef.current = data.selectedRegion
    }

    // features가 없으면 종료
    if (!data.features || data.features.length === 0) {
      console.log('복원할 지적 데이터 없음')
      return
    }

    // 각 폴리곤의 경계를 폴리라인으로 다시 그리기
    let polylineCount = 0

    for (const feature of data.features) {
      if (feature.geometry && feature.geometry.type === 'Polygon') {
        const rings = feature.geometry.coordinates

        for (const ring of rings) {
          const positions = ring.map((coord: number[]) =>
            Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
          )

          const entity = viewer.entities.add({
            polyline: {
              positions: positions,
              width: 4,
              material: Cesium.Color.MAGENTA,
              clampToGround: true,
              classificationType: Cesium.ClassificationType.TERRAIN,
            }
          })

          cadastralBoundaryEntitiesRef.current.push(entity)
          polylineCount++
        }
      }
    }

    setHasPolylinesLoaded(true)
    viewer.scene.requestRender()
    console.log('지적도 복원 완료:', polylineCount, '개 폴리라인')
  }, [viewerRef, removeCadastralLayer])

  return {
    showCadastral,
    hasPolylinesLoaded,
    cadastralFeatures,
    loadCadastralBoundaries,
    toggleCadastral,
    removeCadastralLayer,
    getSelectedRegion,
    restoreCadastralState,
  }
}
