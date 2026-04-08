'use client'

import { useCallback, useEffect, useRef, useState, RefObject } from 'react'
import { isPointInPolygon as checkPointInPolygon } from '@/lib/geometry'
import type { SelectedBlock, CesiumViewer, CadastralFeature } from '@/types/cesium'
import type { SerializedBlock } from '@/types/projectFile'

interface UseBlockSelectionOptions {
  cadastralFeatures: CadastralFeature[]
  onSelectionChange?: (count: number) => void
}

interface UseBlockSelectionReturn {
  isSelecting: boolean
  selectedBlocks: SelectedBlock[]
  selectedBlockCount: number
  toggleSelection: () => void
  clearSelection: () => void
  getSelectedBlocks: () => SelectedBlock[]
  // 프로젝트 저장/불러오기용
  restoreBlockSelection: (blocks: SerializedBlock[]) => Promise<void>
}

/**
 * 블록 선택 관리 훅
 */
export function useBlockSelection(
  viewerRef: RefObject<CesiumViewer | null>,
  isLoaded: boolean,
  options: UseBlockSelectionOptions
): UseBlockSelectionReturn {
  const { cadastralFeatures, onSelectionChange } = options

  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedBlockCount, setSelectedBlockCount] = useState(0)
  const selectedBlocksRef = useRef<SelectedBlock[]>([])

  // 선택 모드 토글
  const toggleSelection = useCallback(() => {
    setIsSelecting(prev => !prev)
  }, [])

  // 선택된 블록 모두 제거
  const clearSelection = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    selectedBlocksRef.current.forEach((item) => {
      viewer.entities.remove(item.entity)
    })
    selectedBlocksRef.current = []
    setSelectedBlockCount(0)
    onSelectionChange?.(0)

    viewer.scene.requestRender()
  }, [viewerRef, onSelectionChange])

  // 선택된 블록 가져오기
  const getSelectedBlocks = useCallback(() => {
    return selectedBlocksRef.current
  }, [])

  // 블록 선택 클릭 핸들러
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !isLoaded || !isSelecting) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((click: any) => {
      // 클릭 위치 가져오기 (여러 방법 시도)
      let cartesian = null

      // 1. 먼저 globe.pick 시도 (지형 위 클릭)
      const ray = viewer.camera.getPickRay(click.position)
      if (ray) {
        cartesian = viewer.scene.globe.pick(ray, viewer.scene)
      }

      // 2. globe.pick 실패 시 pickPosition 시도 (3D 타일 위 클릭)
      if (!cartesian || !Cesium.defined(cartesian)) {
        cartesian = viewer.scene.pickPosition(click.position)
      }

      // 3. 둘 다 실패 시 ellipsoid 위 좌표 사용
      if (!cartesian || !Cesium.defined(cartesian)) {
        if (ray) {
          cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid)
        }
      }

      if (!cartesian) return

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(cartographic.longitude)
      const lat = Cesium.Math.toDegrees(cartographic.latitude)

      console.log('블록 선택 클릭:', lon, lat)

      // features 데이터 확인
      if (!cadastralFeatures || cadastralFeatures.length === 0) {
        console.log('지적 데이터가 없습니다')
        return
      }

      // 클릭한 위치가 어느 폴리곤에 속하는지 확인
      let selectedFeature: CadastralFeature | null = null
      for (const feature of cadastralFeatures) {
        if (feature.geometry && feature.geometry.type === 'Polygon') {
          const rings = feature.geometry.coordinates
          if (rings.length > 0 && checkPointInPolygon([lon, lat], rings[0])) {
            selectedFeature = feature
            break
          }
        }
      }

      if (selectedFeature) {
        const featurePnu = selectedFeature.properties?.pnu || ''
        const coordCount = selectedFeature.geometry?.coordinates?.[0]?.length || 0
        console.log('선택된 블록:', selectedFeature.properties, '좌표 수:', coordCount)

        // 이미 선택된 블록인지 확인 (PNU로 구분)
        const existingIndex = selectedBlocksRef.current.findIndex(
          (item) => item.pnu === featurePnu
        )

        if (existingIndex !== -1) {
          // 이미 선택된 블록이면 제거 (토글)
          const existing = selectedBlocksRef.current[existingIndex]
          viewer.entities.remove(existing.entity)
          selectedBlocksRef.current.splice(existingIndex, 1)
          const newCount = selectedBlocksRef.current.length
          setSelectedBlockCount(newCount)
          onSelectionChange?.(newCount)
          console.log('블록 선택 해제:', featurePnu)
          viewer.scene.requestRender()
          return
        }

        // 좌표 검증
        const rings = selectedFeature.geometry.coordinates
        if (!rings || !rings[0] || rings[0].length < 4) {
          console.log('유효하지 않은 폴리곤 좌표 (최소 4개 점 필요)')
          return
        }

        const ring = rings[0]

        // 유효한 좌표만 필터링
        const validCoords = ring.filter((coord: number[]) =>
          Array.isArray(coord) &&
          coord.length >= 2 &&
          !isNaN(coord[0]) &&
          !isNaN(coord[1]) &&
          Math.abs(coord[0]) <= 180 &&
          Math.abs(coord[1]) <= 90
        )

        if (validCoords.length < 4) {
          console.log('유효한 좌표가 부족함')
          return
        }

        // 폴리곤이 닫혀있는지 확인
        const first = validCoords[0]
        const last = validCoords[validCoords.length - 1]
        const isClosed = Math.abs(first[0] - last[0]) < 0.0001 && Math.abs(first[1] - last[1]) < 0.0001

        if (!isClosed) {
          validCoords.push([...first])
        }

        // 폴리곤 범위 계산 (비정상적으로 큰 폴리곤 필터링)
        const lons = validCoords.map((c: number[]) => c[0])
        const lats = validCoords.map((c: number[]) => c[1])
        const minLon = Math.min(...lons)
        const maxLon = Math.max(...lons)
        const minLat = Math.min(...lats)
        const maxLat = Math.max(...lats)
        const lonRange = maxLon - minLon
        const latRange = maxLat - minLat

        // 약 5km (0.05도) 이상의 범위를 가진 폴리곤은 비정상으로 간주
        if (lonRange > 0.05 || latRange > 0.05) {
          console.log('비정상적으로 큰 폴리곤 (범위 초과):', { lonRange, latRange })
          return
        }

        // 좌표를 Cartesian3 배열로 변환
        const positions = validCoords.map((coord: number[]) =>
          Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
        )

        // 선택된 블록에 반투명 폴리곤 그리기
        const blockEntity = viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.CYAN.withAlpha(0.3),
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
          polyline: {
            positions: positions,
            width: 2,
            material: Cesium.Color.CYAN.withAlpha(0.7),
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: 1,
          }
        })

        // 배열에 추가
        selectedBlocksRef.current.push({
          pnu: featurePnu,
          entity: blockEntity,
          feature: selectedFeature as GeoJSON.Feature<GeoJSON.Polygon>
        })

        const newCount = selectedBlocksRef.current.length
        setSelectedBlockCount(newCount)
        onSelectionChange?.(newCount)
        viewer.scene.requestRender()
        console.log('블록 선택 완료, 총', newCount, '개 블록')
      } else {
        console.log('선택된 블록 없음')
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      handler.destroy()
    }
  }, [viewerRef, isLoaded, isSelecting, cadastralFeatures, onSelectionChange])

  // 저장된 블록 선택 상태 복원
  const restoreBlockSelection = useCallback(async (blocks: SerializedBlock[]) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 기존 선택 제거
    clearSelection()

    // 저장된 블록이 없으면 종료
    if (!blocks || blocks.length === 0) {
      console.log('복원할 블록 없음')
      return
    }

    // 각 블록의 엔티티 재생성
    for (const block of blocks) {
      if (!block.feature?.geometry?.coordinates?.[0]) continue

      const ring = block.feature.geometry.coordinates[0]

      // 유효한 좌표만 필터링
      const validCoords = ring.filter((coord: number[]) =>
        Array.isArray(coord) &&
        coord.length >= 2 &&
        !isNaN(coord[0]) &&
        !isNaN(coord[1]) &&
        Math.abs(coord[0]) <= 180 &&
        Math.abs(coord[1]) <= 90
      )

      if (validCoords.length < 4) continue

      // 폴리곤이 닫혀있는지 확인
      const first = validCoords[0]
      const last = validCoords[validCoords.length - 1]
      const isClosed = Math.abs(first[0] - last[0]) < 0.0001 && Math.abs(first[1] - last[1]) < 0.0001

      if (!isClosed) {
        validCoords.push([...first])
      }

      const positions = validCoords.map((coord: number[]) =>
        Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
      )

      // 선택된 블록에 반투명 폴리곤 그리기
      const blockEntity = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: Cesium.Color.CYAN.withAlpha(0.3),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        polyline: {
          positions: positions,
          width: 2,
          material: Cesium.Color.CYAN.withAlpha(0.7),
          clampToGround: true,
          classificationType: Cesium.ClassificationType.TERRAIN,
          zIndex: 1,
        }
      })

      // 배열에 추가
      selectedBlocksRef.current.push({
        pnu: block.pnu,
        entity: blockEntity,
        feature: block.feature as GeoJSON.Feature<GeoJSON.Polygon>
      })
    }

    const newCount = selectedBlocksRef.current.length
    setSelectedBlockCount(newCount)
    onSelectionChange?.(newCount)
    viewer.scene.requestRender()
    console.log('블록 선택 복원 완료:', newCount, '개 블록')
  }, [viewerRef, clearSelection, onSelectionChange])

  return {
    isSelecting,
    selectedBlocks: selectedBlocksRef.current,
    selectedBlockCount,
    toggleSelection,
    clearSelection,
    getSelectedBlocks,
    restoreBlockSelection,
  }
}
