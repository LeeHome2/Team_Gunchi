'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useCesiumViewer, DEFAULT_POSITION } from '@/hooks/useCesiumViewer'
import { useBuildingLine } from '@/hooks/useBuildingLine'
import { useSunlightAnalysis } from '@/hooks/useSunlightAnalysis'
import { useBlockSelection } from '@/hooks/useBlockSelection'
import { useCadastral } from '@/hooks/useCadastral'
import { useOsmBuildings } from '@/hooks/useOsmBuildings'
import { useProjectPersistence } from '@/hooks/useProjectPersistence'
import { useParkingZone } from '@/hooks/useParkingZone'
import { isPointInPolygon as checkPointInPolygon } from '@/lib/geometry'
import { DEFAULT_SETBACKS } from '@/lib/setbackTable'
import type { CadastralFeature } from '@/types/cesium'

/** 점에서 선분까지의 최소 거리 (도 → m 변환 적용) */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  mPerDegLon: number, mPerDegLat: number,
): number {
  // 모두 미터 단위로 변환
  const pxm = px * mPerDegLon, pym = py * mPerDegLat
  const axm = ax * mPerDegLon, aym = ay * mPerDegLat
  const bxm = bx * mPerDegLon, bym = by * mPerDegLat
  const dx = bxm - axm, dy = bym - aym
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ddx = pxm - axm, ddy = pym - aym
    return Math.sqrt(ddx * ddx + ddy * ddy)
  }
  let t = ((pxm - axm) * dx + (pym - aym) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = axm + t * dx, cy = aym + t * dy
  const ddx = pxm - cx, ddy = pym - cy
  return Math.sqrt(ddx * ddx + ddy * ddy)
}

/**
 * CesiumJS 기반 3D 지도 뷰어 컴포넌트 (리팩토링 버전)
 */
export default function CesiumViewer() {
  // === Store 연결 ===
  const {
    site, building, workArea, modelUrl, projectName,
    loadedModelEntity, modelTransform, selectedModel,
    parkingZone, isParkingVisible, parkingTransform, entranceTransform,
    setViewer, setModelTransform, setSelectedModel, setLoadedModelEntity,
    setWorkArea, setAvailableModels, setSelectedBlockCount, setSelectedBlockInfo,
    modelToLoad, setModelToLoad, massGlbToLoad, setMassGlbToLoad, isLoadingModel, setIsLoadingModel,
    humanScaleModelLoaded, setHumanScaleModelLoaded,
    setParkingTransform, setEntranceTransform,
    setReviewData, setSunlightAnalysisState,
    setRunReviewCheckFn, setStartSunlightFn, setToggleSunlightHeatmapFn, setClearSunlightFn, setSetSunlightHeatmapModeFn,
    setSaveProjectFn, setLoadProjectFn, setLoadFromDbFn, setIsSavingProject, setIsLoadingProject, setProjectError,
    selectedBlockInfo,
  } = useProjectStore()

  // === 로컬 상태 ===
  const [currentTime, setCurrentTime] = useState(() => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    return date
  })
  const [isSelectingRegion, setIsSelectingRegion] = useState(false)
  const [isModelInBounds, setIsModelInBounds] = useState(true)

  // === Refs ===
  const loadedSampleModelRef = useRef<any>(null)
  const humanModelRef = useRef<any>(null)
  const humanModelTransformRef = useRef({ longitude: 0, latitude: 0 })
  const isModelDraggingRef = useRef(false)
  const isModelRotatingRef = useRef(false)
  const isHumanDraggingRef = useRef(false)
  const modelDragStartRef = useRef<{ offsetLon: number; offsetLat: number } | null>(null)
  const humanDragStartRef = useRef<{ offsetLon: number; offsetLat: number } | null>(null)
  const modelTransformRef = useRef(modelTransform)
  const modelBoundingBoxRef = useRef({ width: 10, depth: 10 })
  /** 모델 바닥면 Convex Hull (로컬 m, X-Z). null이면 boundingBox 사각형 fallback */
  const modelFloorPolygonRef = useRef<number[][] | null>(null)
  const modelBoundaryEntityRef = useRef<any>(null)
  const isModelInBoundsRef = useRef(true)
  const [boundaryCheckTrigger, setBoundaryCheckTrigger] = useState(0) // 바운더리 체크 강제 트리거
  const checkModelInBoundsRef = useRef<((lon: number, lat: number, rotation: number, scale: number) => boolean) | null>(null)
  const updateBlocksColorRef = useRef<((inBounds: boolean) => void) | null>(null)

  // 주차구역 드래그/회전 Refs
  const isParkingDraggingRef = useRef(false)
  const isParkingRotatingRef = useRef(false)
  const parkingDragStartRef = useRef<{ offsetLon: number; offsetLat: number } | null>(null)
  // NOTE: parkingTransformRef/entranceTransformRef는 useParkingZone hook에서 공유받아 사용
  // (parkingHookTransformRef / entranceHookTransformRef)
  // 입구 드래그/회전 Refs
  const isEntranceDraggingRef = useRef(false)
  const isEntranceRotatingRef = useRef(false)
  const entranceDragStartRef = useRef<{ offsetLon: number; offsetLat: number } | null>(null)

  // === 뷰포트 상태 복원 함수 ===
  const restoreViewportState = useCallback((viewer: any) => {
    const Cesium = (window as any).Cesium
    if (!Cesium || !viewer) return

    const savedCamera = localStorage.getItem('cesium_camera_state')
    if (savedCamera) {
      try {
        const cameraState = JSON.parse(savedCamera)
        viewer.camera.setView({
          destination: new Cesium.Cartesian3(
            cameraState.position.x, cameraState.position.y, cameraState.position.z
          ),
          orientation: {
            heading: cameraState.heading,
            pitch: cameraState.pitch,
            roll: cameraState.roll,
          },
        })
      } catch (e) {
        console.warn('카메라 상태 복원 실패:', e)
      }
    }

    const savedTime = localStorage.getItem('cesium_time_state')
    if (savedTime) {
      try {
        const timeState = JSON.parse(savedTime)
        const restoredTime = new Date(timeState.time)
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(restoredTime)
        setCurrentTime(restoredTime)
      } catch (e) {
        console.warn('시간 상태 복원 실패:', e)
      }
    }

    viewer.scene.requestRender()
  }, [])

  // === Cesium Viewer 초기화 (Hook) ===
  const {
    viewerRef,
    containerRef,
    isLoaded,
    tilesLoading,
    initialTilesReady,
    osmTilesetRef,
    refreshViewer,
  } = useCesiumViewer({
    // setViewer는 Zustand 액션이라 레퍼런스가 안정적이라 inline 함수를 피한다
    // (매 렌더마다 새 함수면 useEffect가 계속 재실행되어 viewer 재초기화 문제 발생)
    onViewerReady: setViewer,
    restoreState: restoreViewportState,
  })

  // === 지적도 (Hook) - 블록 선택보다 먼저 선언 ===
  const cadastral = useCadastral(viewerRef, () => {
    // 블록 선택 초기화는 아래에서 처리
  })

  // === 블록 선택 (Hook) ===
  const blockSelection = useBlockSelection(
    viewerRef,
    isLoaded,
    {
      cadastralFeatures: cadastral.cadastralFeatures as CadastralFeature[],
      onSelectionChange: (count) => {
        setSelectedBlockCount(count)
        // 블록 상세 정보 업데이트 (지연 호출: ref가 업데이트된 후 읽기)
        setTimeout(() => {
          const blocks = blockSelectionRef.current?.getSelectedBlocks() ?? []
          if (blocks.length === 0) {
            setSelectedBlockInfo(null)
            return
          }
          const coordinates: number[][][] = []
          let totalArea = 0
          let sumLon = 0, sumLat = 0, ptCount = 0

          for (const b of blocks) {
            const coords = b.feature?.geometry?.coordinates?.[0]
            if (!coords || coords.length < 3) continue
            coordinates.push(coords as number[][])

            // Shoelace formula for polygon area (approximate m² using lat/lon)
            let area = 0
            for (let i = 0; i < coords.length - 1; i++) {
              const [x1, y1] = coords[i]
              const [x2, y2] = coords[i + 1]
              area += x1 * y2 - x2 * y1
            }
            // Convert degree² to m² (approximate at mid-latitude)
            const midLat = coords.reduce((s: number, c: number[]) => s + c[1], 0) / coords.length
            const latToM = 111320
            const lonToM = 111320 * Math.cos(midLat * Math.PI / 180)
            const areaDeg2 = Math.abs(area) / 2
            totalArea += areaDeg2 * latToM * lonToM

            for (const c of coords) {
              sumLon += c[0]; sumLat += c[1]; ptCount++
            }
          }

          setSelectedBlockInfo({
            coordinates,
            totalArea,
            centroid: ptCount > 0 ? [sumLon / ptCount, sumLat / ptCount] : null,
          })
        }, 0)
      },
    }
  )

  // blockSelection ref for deferred access in onSelectionChange
  const blockSelectionRef = useRef(blockSelection)
  blockSelectionRef.current = blockSelection

  // === 건축선 (Hook) ===
  const buildingLine = useBuildingLine(viewerRef, {
    getSelectedBlocks: blockSelection.getSelectedBlocks,
  })

  // === 일조 분석 (Hook) ===
  const sunlightAnalysis = useSunlightAnalysis(viewerRef, {
    getBuildingLineResult: buildingLine.getBuildingLineResult,
    getSelectedBlocks: blockSelection.getSelectedBlocks,
  })

  // === OSM 건물 숨기기 (Hook) ===
  const osmBuildings = useOsmBuildings(viewerRef, osmTilesetRef, isLoaded)

  // === 주차구역 (Hook) ===
  const {
    render: renderParking,
    renderEntranceOnly,
    updatePositionsInPlace: updateParkingInPlace,
    updateEntranceInPlace,
    parkingTransformRef: parkingHookTransformRef,
    entranceTransformRef: entranceHookTransformRef,
  } = useParkingZone()

  // === 샘플 모델 관련 ===
  const availableModels = useProjectStore((state) => state.availableModels)

  // 로드된 모델 파일명 반환 함수
  const getLoadedModelFilename = useCallback(() => {
    return loadedSampleModelRef.current?.name || null
  }, [])

  // 휴먼 모델 위치 반환 함수 (저장용)
  const getHumanModelTransform = useCallback(() => {
    if (!humanScaleModelLoaded) return null
    return {
      longitude: humanModelTransformRef.current.longitude,
      latitude: humanModelTransformRef.current.latitude,
    }
  }, [humanScaleModelLoaded])

  // 휴먼 모델 위치 복원 함수
  const restoreHumanModelPosition = useCallback((transform: { longitude: number; latitude: number }) => {
    if (!viewerRef.current) return
    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const entity = viewerRef.current.entities.getById('human-scale-model')
    if (!entity) return

    entity.position = Cesium.Cartesian3.fromDegrees(transform.longitude, transform.latitude, 0.9)
    humanModelTransformRef.current = { longitude: transform.longitude, latitude: transform.latitude }
    viewerRef.current.scene.requestRender()
    console.log('휴먼 모델 위치 복원:', transform)
  }, [])

  // modelTransform 변경 시 ref 업데이트
  useEffect(() => {
    modelTransformRef.current = modelTransform
  }, [modelTransform])

  // parkingTransformRef/entranceTransformRef는 useParkingZone hook에서 store와 자동 동기화됨

  // === 모델 위치/회전/스케일 업데이트 ===
  useEffect(() => {
    if (!viewerRef.current || !isLoaded || !loadedModelEntity) return
    if (!loadedSampleModelRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const { longitude, latitude, height, rotation, scale } = modelTransform
    const entity = loadedSampleModelRef.current

    // 위치 업데이트 (ConstantPositionProperty 사용)
    const newPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, height)
    entity.position = new Cesium.ConstantPositionProperty(newPosition)

    // 회전 업데이트 (ConstantProperty 사용)
    const heading = Cesium.Math.toRadians(rotation)
    const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
    const orientation = Cesium.Transforms.headingPitchRollQuaternion(newPosition, hpr)
    entity.orientation = new Cesium.ConstantProperty(orientation)

    // 스케일 업데이트
    if (entity.model) {
      entity.model.scale = new Cesium.ConstantProperty(scale)
    }

    viewerRef.current.scene.requestRender()
  }, [modelTransform.longitude, modelTransform.latitude, modelTransform.height, modelTransform.rotation, modelTransform.scale, isLoaded, loadedModelEntity])

  // === 바운더리 체크 및 폴리라인 업데이트 ===
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    // 모델이 없으면 바운더리 제거 및 영역 색상 복원
    if (!loadedModelEntity) {
      if (modelBoundaryEntityRef.current) {
        viewer.entities.remove(modelBoundaryEntityRef.current)
        modelBoundaryEntityRef.current = null
      }
      // 영역 색상을 원래대로 복원
      for (const item of blockSelection.getSelectedBlocks()) {
        if (item.entity?.polygon) {
          item.entity.polygon.material = Cesium.Color.CYAN.withAlpha(0.3)
        }
        if (item.entity?.polyline) {
          item.entity.polyline.material = Cesium.Color.CYAN.withAlpha(0.7)
        }
      }
      setIsModelInBounds(true)
      viewer.scene.requestRender()
      return
    }

    if (!loadedSampleModelRef.current) return

    // 드래그/회전 중에는 핸들러가 직접 바운더리 체크하므로 useEffect 건너뜀
    if (isModelDraggingRef.current || isModelRotatingRef.current) return

    const { longitude, latitude, rotation, scale } = modelTransform

    // 모델 좌표가 아직 유효하지 않으면 (store 초기값) 체크하지 않음 — 기본 파란색 유지
    if (longitude === 0 && latitude === 0) return
    const latRad = latitude * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320
    const rotRad = -rotation * Math.PI / 180
    const cos = Math.cos(rotRad)
    const sin = Math.sin(rotRad)

    // 바닥면 폴리곤이 있으면 사용, 없으면 바운딩박스 사각형 fallback
    let localCorners: { x: number; y: number }[]

    if (modelFloorPolygonRef.current && modelFloorPolygonRef.current.length >= 3) {
      // floorPolygon은 [x, z] (모델 로컬 m) — scale 적용
      // Cesium은 glTF 모델의 +X를 forward(North)로 처리
      // 따라서: model X → North(local y), model Z → East(local x)
      localCorners = modelFloorPolygonRef.current.map(([fx, fz]) => ({
        x: fz * scale,
        y: fx * scale,
      }))
    } else {
      const halfWidth = (modelBoundingBoxRef.current.width * scale) / 2
      const halfDepth = (modelBoundingBoxRef.current.depth * scale) / 2
      localCorners = [
        { x: -halfWidth, y: -halfDepth },
        { x: halfWidth, y: -halfDepth },
        { x: halfWidth, y: halfDepth },
        { x: -halfWidth, y: halfDepth },
      ]
    }


    const corners = localCorners.map(corner => {
      const rotatedX = corner.x * cos - corner.y * sin
      const rotatedY = corner.x * sin + corner.y * cos
      return [longitude + (rotatedX / metersPerDegLon), latitude + (rotatedY / metersPerDegLat)]
    })

    // 건축선 기준 바운더리 체크
    let inBounds = true
    if (buildingLine.buildingLineResult?.buildingLine?.geometry?.coordinates?.[0]) {
      const buildingLineCoords = buildingLine.buildingLineResult.buildingLine.geometry.coordinates[0]
      for (const corner of corners) {
        if (!checkPointInPolygon(corner as [number, number], buildingLineCoords)) {
          inBounds = false
          break
        }
      }
    } else {
      const selectedBlocks = blockSelection.getSelectedBlocks()
      if (selectedBlocks.length > 0) {
        for (const corner of corners) {
          let cornerInAnyBlock = false
          for (const item of selectedBlocks) {
            const coords = item.feature?.geometry?.coordinates?.[0]
            if (coords && checkPointInPolygon(corner as [number, number], coords)) {
              cornerInAnyBlock = true
              break
            }
          }
          if (!cornerInAnyBlock) {
            inBounds = false
            break
          }
        }
      }
    }

    // 바운더리 색상 결정
    const boundaryColor = inBounds ? Cesium.Color.LIME : Cesium.Color.RED
    const boundaryPositions = [
      ...corners.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], 0.5)),
      Cesium.Cartesian3.fromDegrees(corners[0][0], corners[0][1], 0.5)
    ]

    if (modelBoundaryEntityRef.current) {
      modelBoundaryEntityRef.current.polyline.positions = boundaryPositions
      modelBoundaryEntityRef.current.polyline.material = boundaryColor
    } else {
      modelBoundaryEntityRef.current = viewer.entities.add({
        id: 'model-boundary',
        polyline: {
          positions: boundaryPositions,
          width: 4,
          material: boundaryColor,
          clampToGround: true,
        }
      })
    }

    // 선택 영역 색상 업데이트 + ref 동기화
    isModelInBoundsRef.current = inBounds
    if (inBounds !== isModelInBounds) {
      setIsModelInBounds(inBounds)
      const areaColor = inBounds ? Cesium.Color.CYAN : Cesium.Color.RED
      for (const item of blockSelection.getSelectedBlocks()) {
        if (item.entity?.polygon) {
          item.entity.polygon.material = areaColor.withAlpha(0.4)
        }
        if (item.entity?.polyline) {
          item.entity.polyline.material = areaColor
        }
      }
    }

    viewer.scene.requestRender()
  }, [modelTransform.longitude, modelTransform.latitude, modelTransform.height, modelTransform.rotation, modelTransform.scale, isLoaded, isModelInBounds, buildingLine.buildingLineResult, blockSelection, loadedModelEntity, boundaryCheckTrigger])

  // === 뷰포트 상태 저장 ===
  const saveViewportState = useCallback(() => {
    if (!viewerRef.current) return
    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const camera = viewer.camera

    const cameraState = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    }

    const modelState = selectedModel ? {
      modelId: selectedModel.id,
      transform: modelTransformRef.current,
    } : null

    const timeState = { time: currentTime.toISOString() }

    localStorage.setItem('cesium_camera_state', JSON.stringify(cameraState))
    localStorage.setItem('cesium_model_state', JSON.stringify(modelState))
    localStorage.setItem('cesium_time_state', JSON.stringify(timeState))
  }, [selectedModel, currentTime])

  // 페이지 새로고침/닫기 시 상태 저장
  useEffect(() => {
    const handleBeforeUnload = () => saveViewportState()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [saveViewportState])

  // === 역지오코딩 ===
  const reverseGeocode = useCallback(async (lon: number, lat: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`,
        { headers: { 'Accept-Language': 'ko' } }
      )
      const data = await response.json()
      return {
        address: data.address ?
          `${data.address.city || data.address.town || data.address.county || ''} ${data.address.road || data.address.neighbourhood || ''}`.trim() :
          data.display_name?.split(',').slice(0, 2).join(', '),
        displayName: data.display_name,
      }
    } catch (error) {
      console.error('역지오코딩 실패:', error)
      return null
    }
  }, [])

  // === 지역 선택 모드 토글 ===
  const toggleRegionSelection = useCallback(() => {
    setIsSelectingRegion(prev => !prev)
  }, [])

  // === 선택된 블록 모두 제거 ===
  const clearSelectedBlocks = useCallback(() => {
    blockSelection.clearSelection()
    setIsModelInBounds(true)

    if (modelBoundaryEntityRef.current && viewerRef.current) {
      viewerRef.current.entities.remove(modelBoundaryEntityRef.current)
      modelBoundaryEntityRef.current = null
    }
  }, [blockSelection])

  // === 샘플 모델 목록 가져오기 ===
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/models')
        if (response.ok) {
          const data = await response.json()
          setAvailableModels(data.models || [])
        }
      } catch (error) {
        console.error('모델 목록 로드 실패:', error)
      }
    }
    fetchModels()
  }, [setAvailableModels])

  // === 선택된 블록 중심 좌표 계산 ===
  const getSelectedBlocksCenter = useCallback(() => {
    const selectedBlocks = blockSelection.getSelectedBlocks()
    if (selectedBlocks.length === 0) return null

    let totalLon = 0
    let totalLat = 0
    let count = 0

    for (const item of selectedBlocks) {
      const coords = item.feature?.geometry?.coordinates?.[0]
      if (coords) {
        for (const coord of coords) {
          totalLon += coord[0]
          totalLat += coord[1]
          count++
        }
      }
    }

    if (count === 0) return null
    return { longitude: totalLon / count, latitude: totalLat / count }
  }, [blockSelection.getSelectedBlocks])

  // === 샘플 모델 로드 ===
  const loadSampleModel = useCallback(async (filename: string) => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 선택된 블록이 없으면 경고
    const selectedBlocks = blockSelection.getSelectedBlocks()
    if (selectedBlocks.length === 0) {
      alert('먼저 영역을 선택해주세요')
      return
    }

    const center = getSelectedBlocksCenter()
    if (!center) {
      alert('블록 좌표를 계산할 수 없습니다')
      return
    }

    const viewer = viewerRef.current
    setIsLoadingModel(true)

    try {
      // 기존 샘플 모델 제거 (ref와 ID 둘 다 확인)
      if (loadedSampleModelRef.current) {
        viewer.entities.remove(loadedSampleModelRef.current)
        loadedSampleModelRef.current = null
      }
      const existingModel = viewer.entities.getById('loaded-3d-model')
      if (existingModel) {
        viewer.entities.remove(existingModel)
      }

      // 기존 바운더리 폴리라인 제거
      if (modelBoundaryEntityRef.current) {
        viewer.entities.remove(modelBoundaryEntityRef.current)
        modelBoundaryEntityRef.current = null
      }
      const existingBoundary = viewer.entities.getById('model-boundary')
      if (existingBoundary) {
        viewer.entities.remove(existingBoundary)
      }

      // 경계 상태 초기화 (파란색으로 시작)
      isModelInBoundsRef.current = true
      setIsModelInBounds(true)

      // 해당 모델의 바운딩 박스 + 바닥면 폴리곤 정보 가져오기
      const modelInfo = availableModels.find(m => m.filename === filename)
      if (modelInfo?.boundingBox) {
        // Cesium heading=0에서 glTF 축 매핑:
        //   model X(=백엔드 width) → North-South(lat) = 바운더리 depth
        //   model Z(=백엔드 depth) → East-West(lon)  = 바운더리 width
        modelBoundingBoxRef.current = {
          width: modelInfo.boundingBox.depth,   // Z축 → East-West(lon)
          depth: modelInfo.boundingBox.width,    // X축 → North-South(lat)
        }
      } else {
        modelBoundingBoxRef.current = { width: 10, depth: 10 }
      }
      modelFloorPolygonRef.current = modelInfo?.floorPolygon ?? null

      const modelUrl = `/api/models/${encodeURIComponent(filename)}`
      const initialRotation = 0
      const initialScale = 10.0

      // 바닥면 높이 자동 보정: 모델 Y 최솟값 × scale 만큼 올려야 바닥이 지면과 일치
      const originYMin = modelInfo?.originYMin ?? 0
      const initialHeight = -originYMin * initialScale

      const position = Cesium.Cartesian3.fromDegrees(center.longitude, center.latitude, initialHeight)
      const heading = Cesium.Math.toRadians(initialRotation)
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)

      const entity = viewer.entities.add({
        id: 'loaded-3d-model',
        name: filename,
        position: position,
        orientation: orientation,
        model: {
          uri: modelUrl,
          scale: initialScale,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      })

      loadedSampleModelRef.current = entity
      setLoadedModelEntity(entity)
      setModelTransform({
        longitude: center.longitude,
        latitude: center.latitude,
        height: initialHeight,
        rotation: initialRotation,
        scale: initialScale,
      })

      viewer.scene.requestRender()
    } catch (error) {
      console.error('모델 로드 실패:', error)
      alert('모델 로드에 실패했습니다')
    } finally {
      setIsLoadingModel(false)
      setModelToLoad(null)
    }
  }, [isLoaded, getSelectedBlocksCenter, setIsLoadingModel, setLoadedModelEntity, setModelTransform, setModelToLoad, blockSelection, availableModels])

  // 모델 로드 트리거 감지
  useEffect(() => {
    if (modelToLoad && isLoaded && !isLoadingModel) {
      loadSampleModel(modelToLoad)
    }
  }, [modelToLoad, isLoaded, isLoadingModel, loadSampleModel])

  // === DXF 파싱 → 매스 GLB 로드 (loadSampleModel과 동일 방식) ===
  const loadMassGlb = useCallback(async (glbUrl: string) => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // DB 복원 시 전달된 transform이 있으면 사용, 아니면 블록 센터에 새 배치
    const currentState = useProjectStore.getState()
    const restoreTransform = currentState.massGlbRestoreTransform

    let lon: number | undefined
    let lat: number | undefined
    let restoredRotation: number | undefined
    let restoredScale: number | undefined

    if (restoreTransform) {
      // DB에서 복원 — 저장된 위치, 각도, 스케일 사용
      lon = restoreTransform.longitude
      lat = restoreTransform.latitude
      restoredRotation = restoreTransform.rotation
      restoredScale = restoreTransform.scale
      // 매스 GLB 스케일 보정: 기본값 10.0(샘플 모델용)이면 1.0으로
      if (restoredScale > 5.0) restoredScale = 1.0
      console.log('[매스 GLB] DB 복원:', lon, lat, 'rot:', restoredRotation, 'scale:', restoredScale)
    } else {
      // 첫 배치: 블록 센터 또는 building position
      const center = getSelectedBlocksCenter()
      const fallbackPos = currentState.building?.position || currentState.site?.centroid
      lon = center?.longitude ?? fallbackPos?.[0]
      lat = center?.latitude ?? fallbackPos?.[1]
    }

    if (lon == null || lat == null) {
      console.warn('[매스 GLB] 배치 위치를 결정할 수 없습니다')
      return
    }

    const viewer = viewerRef.current
    setIsLoadingModel(true)

    try {
      // 기존 모델 제거 (샘플 모델과 동일한 정리 로직)
      if (loadedSampleModelRef.current) {
        viewer.entities.remove(loadedSampleModelRef.current)
        loadedSampleModelRef.current = null
      }
      const existingModel = viewer.entities.getById('loaded-3d-model')
      if (existingModel) viewer.entities.remove(existingModel)

      // 기존 바운더리 제거
      if (modelBoundaryEntityRef.current) {
        viewer.entities.remove(modelBoundaryEntityRef.current)
        modelBoundaryEntityRef.current = null
      }
      const existingBoundary = viewer.entities.getById('model-boundary')
      if (existingBoundary) viewer.entities.remove(existingBoundary)

      // 초기 상태: 영역 안에 있다고 가정 (파란색으로 시작)
      isModelInBoundsRef.current = true
      setIsModelInBounds(true)
      // 블록 영역 색상을 파란색으로 초기화
      const Cesium_ = (window as any).Cesium
      if (Cesium_) {
        for (const item of blockSelection.getSelectedBlocks()) {
          if (item.entity?.polygon) {
            item.entity.polygon.material = Cesium_.Color.CYAN.withAlpha(0.3)
          }
          if (item.entity?.polyline) {
            item.entity.polyline.material = Cesium_.Color.CYAN.withAlpha(0.7)
          }
        }
      }

      // 매스 모델 바운딩 박스: 백엔드에서 계산된 실제 GLB 크기 우선 사용
      const latestState = useProjectStore.getState()
      const placedMass = latestState.generatedMasses.find(m => m.glbUrl === glbUrl)

      if (placedMass?.boundingBox) {
        // 백엔드가 반환한 실제 GLB 바운딩 박스 (미터 단위)
        // Cesium heading=0에서 glTF 축 매핑 (floorPolygon 코드와 동일):
        //   model X → North-South(lat) = 바운더리 depth
        //   model Z → East-West(lon)   = 바운더리 width
        modelBoundingBoxRef.current = {
          width: placedMass.boundingBox.depth,   // Z축 → East-West(lon)
          depth: placedMass.boundingBox.width,    // X축 → North-South(lat)
        }
        console.log('[매스 GLB] 백엔드 bounding box 사용 (swap):', modelBoundingBoxRef.current.width.toFixed(2), 'x', modelBoundingBoxRef.current.depth.toFixed(2), 'm')
      } else {
        // 폴백: footprint에서 추정
        const fp = latestState.building?.footprint || latestState.site?.footprint || []
        if (fp.length >= 3) {
          const xs = fp.map((c: number[]) => c[0])
          const ys = fp.map((c: number[]) => c[1])
          const minX = Math.min(...xs), maxX = Math.max(...xs)
          const minY = Math.min(...ys), maxY = Math.max(...ys)

          // footprint이 위경도인지 DXF 로컬(미터)인지 판별
          const isLonLat = minX >= 124 && maxX <= 133 && minY >= 33 && maxY <= 39
            && (maxX - minX) < 0.05 && (maxY - minY) < 0.05

          if (isLonLat) {
            const latRad = lat * Math.PI / 180
            const mPerDegLon = 111320 * Math.cos(latRad)
            const mPerDegLat = 111320
            modelBoundingBoxRef.current = {
              width: (maxX - minX) * mPerDegLon,
              depth: (maxY - minY) * mPerDegLat,
            }
          } else {
            modelBoundingBoxRef.current = { width: maxX - minX, depth: maxY - minY }
          }
          console.log('[매스 GLB] footprint 추정 bounding box:', modelBoundingBoxRef.current)
        } else {
          modelBoundingBoxRef.current = { width: 10, depth: 10 }
          console.log('[매스 GLB] footprint 없음, 기본 바운딩 박스 사용')
        }
      }
      modelFloorPolygonRef.current = null // 매스 GLB는 별도 floor polygon 없음

      const initialRotation = restoredRotation ?? 0
      const initialScale = restoredScale ?? 1.0
      const initialHeight = restoreTransform?.height ?? 0

      const position = Cesium.Cartesian3.fromDegrees(lon, lat, initialHeight)
      const heading = Cesium.Math.toRadians(initialRotation)
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)

      const entity = viewer.entities.add({
        id: 'loaded-3d-model',
        name: 'mass-model',
        position: position,
        orientation: orientation,
        model: {
          uri: glbUrl,
          scale: initialScale,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          maximumScale: 20000,
          minimumPixelSize: 0,
          backFaceCulling: false,
        },
      })

      loadedSampleModelRef.current = entity
      setLoadedModelEntity(entity)
      setModelTransform({
        longitude: lon,
        latitude: lat,
        height: initialHeight,
        rotation: initialRotation,
        scale: initialScale,
      })

      // 즉시 바운더리 폴리라인 생성 (useEffect 의존 대신 직접 그리기)
      const bbWidth = modelBoundingBoxRef.current.width
      const bbDepth = modelBoundingBoxRef.current.depth
      if (bbWidth > 0 && bbDepth > 0) {
        const latRadB = lat * Math.PI / 180
        const mPerDegLonB = 111320 * Math.cos(latRadB)
        const mPerDegLatB = 111320
        const halfW = (bbWidth * initialScale) / 2
        const halfD = (bbDepth * initialScale) / 2
        const rotRadB = -initialRotation * Math.PI / 180
        const cosB = Math.cos(rotRadB)
        const sinB = Math.sin(rotRadB)
        const localCornersBound = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]]
        const boundaryCorners = localCornersBound.map(([lx, ly]) => {
          const rx = lx * cosB - ly * sinB
          const ry = lx * sinB + ly * cosB
          return [lon + rx / mPerDegLonB, lat + ry / mPerDegLatB]
        })
        const bPositions = [
          ...boundaryCorners.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], 0.5)),
          Cesium.Cartesian3.fromDegrees(boundaryCorners[0][0], boundaryCorners[0][1], 0.5)
        ]
        modelBoundaryEntityRef.current = viewer.entities.add({
          id: 'model-boundary',
          polyline: {
            positions: bPositions,
            width: 4,
            material: Cesium.Color.LIME,
            clampToGround: true,
          }
        })
        console.log('[매스 GLB] 바운더리 생성:', bbWidth.toFixed(1), 'x', bbDepth.toFixed(1), 'm')
      }

      viewer.scene.requestRender()

      // 현재 로드된 매스 URL 저장 (프로젝트 저장용)
      useProjectStore.getState().setLoadedMassGlbUrl(glbUrl)

      console.log('[매스 GLB] 모델 배치 완료:', glbUrl, 'at', [lon, lat])

      // 모델 로드 완료 후 지연된 바운더리 재체크 트리거
      // (블록 렌더링이 완료된 후 바운더리 체크가 정확히 실행되도록)
      setTimeout(() => {
        setBoundaryCheckTrigger(prev => prev + 1)
      }, 300)
    } catch (error) {
      console.error('[매스 GLB] 로드 실패:', error)
    } finally {
      setIsLoadingModel(false)
      setMassGlbToLoad(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, getSelectedBlocksCenter, setIsLoadingModel, setLoadedModelEntity, setModelTransform, setMassGlbToLoad, setBoundaryCheckTrigger])

  // 매스 GLB 로드 트리거 감지
  useEffect(() => {
    if (massGlbToLoad && isLoaded && !isLoadingModel) {
      loadMassGlb(massGlbToLoad)
    }
  }, [massGlbToLoad, isLoaded, isLoadingModel, loadMassGlb])

  // === 휴먼 스케일 모델 ===
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    if (humanScaleModelLoaded) {
      // 기존 휴먼 모델이 있으면 제거
      if (humanModelRef.current) {
        viewer.entities.remove(humanModelRef.current)
        humanModelRef.current = null
      }

      // 선택된 블록 중심 또는 건물 모델 근처에 배치
      const center = getSelectedBlocksCenter()
      if (!center) {
        setHumanScaleModelLoaded(false)
        return
      }

      // 건물 모델에서 약간 떨어진 위치에 배치
      const humanLon = center.longitude + 0.00005  // 약 5m 옆
      const humanLat = center.latitude

      humanModelTransformRef.current = { longitude: humanLon, latitude: humanLat }

      // 휴먼 모델 로드 (원본 2m → 스케일 0.9로 180cm)
      const humanHeight = 0.9  // 원점이 모델 중심에 있으면 반높이(0.9m) 올림
      const entity = viewer.entities.add({
        id: 'human-scale-model',
        name: '휴먼 스케일 (180cm)',
        position: Cesium.Cartesian3.fromDegrees(humanLon, humanLat, humanHeight),
        model: {
          uri: '/api/models/Meshy_AI_man_0315144539_texture.glb',
          scale: 0.9,  // 원본 2m × 0.9 = 180cm
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      })

      humanModelRef.current = entity
      viewer.scene.requestRender()
    } else {
      if (humanModelRef.current) {
        viewer.entities.remove(humanModelRef.current)
        humanModelRef.current = null
        viewer.scene.requestRender()
      }
    }
  }, [humanScaleModelLoaded, isLoaded, getSelectedBlocksCenter, setHumanScaleModelLoaded])

  // === 지역 선택 클릭 핸들러 ===
  useEffect(() => {
    if (!viewerRef.current || !isLoaded || !isSelectingRegion) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction(async (click: any) => {
      // 클릭 위치 가져오기 (여러 방법 시도)
      let cartesian = null
      const ray = viewer.camera.getPickRay(click.position)

      // 1. 먼저 globe.pick 시도
      if (ray) {
        cartesian = viewer.scene.globe.pick(ray, viewer.scene)
      }

      // 2. globe.pick 실패 시 pickPosition 시도
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

      const geoResult = await reverseGeocode(lon, lat)
      setWorkArea({
        longitude: lon,
        latitude: lat,
        address: geoResult?.address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
        displayName: geoResult?.displayName || '',
      })

      // 프로젝트에 위치 자동저장
      const pid = useProjectStore.getState().projectId
      if (pid) {
        import('@/lib/api').then(({ updateProject }) => {
          updateProject(pid, {
            longitude: lon,
            latitude: lat,
            address: geoResult?.address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
          }).catch((err) => console.warn('위치 자동저장 실패:', err))
        })
      }

      // 지적도 로드
      cadastral.loadCadastralBoundaries(lon, lat)
      setIsSelectingRegion(false)

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 200),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.5,
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [isLoaded, isSelectingRegion, reverseGeocode, setWorkArea, cadastral.loadCadastralBoundaries])

  // === 작업 영역 해제 시 지적도 제거 ===
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return
    if (!workArea) {
      cadastral.removeCadastralLayer()
    }
  }, [workArea, isLoaded, cadastral.removeCadastralLayer])

  // === 모델 바운더리 체크 함수 ===
  const checkModelInBounds = useCallback((lon: number, lat: number, rotation: number, scale: number) => {
    const selectedBlocks = blockSelection.getSelectedBlocks()
    if (selectedBlocks.length === 0) return true

    // 모델 바닥면 꼭짓점 좌표 계산 (floorPolygon 우선, 없으면 boundingBox fallback)
    const latRad = lat * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320
    const rotRad = -rotation * Math.PI / 180
    const cos = Math.cos(rotRad)
    const sin = Math.sin(rotRad)

    let localCorners: { x: number; y: number }[]
    if (modelFloorPolygonRef.current && modelFloorPolygonRef.current.length >= 3) {
      localCorners = modelFloorPolygonRef.current.map(([fx, fz]) => ({
        x: fz * scale,
        y: fx * scale,
      }))
    } else {
      const halfWidth = (modelBoundingBoxRef.current.width * scale) / 2
      const halfDepth = (modelBoundingBoxRef.current.depth * scale) / 2
      localCorners = [
        { x: -halfWidth, y: -halfDepth },
        { x: halfWidth, y: -halfDepth },
        { x: halfWidth, y: halfDepth },
        { x: -halfWidth, y: halfDepth },
      ]
    }

    const corners = localCorners.map(corner => {
      const rotatedX = corner.x * cos - corner.y * sin
      const rotatedY = corner.x * sin + corner.y * cos
      return [lon + (rotatedX / metersPerDegLon), lat + (rotatedY / metersPerDegLat)]
    })

    // 건축선이 있으면 건축선 기준으로 체크
    if (buildingLine.buildingLineResult?.buildingLine?.geometry?.coordinates?.[0]) {
      const buildingLineCoords = buildingLine.buildingLineResult.buildingLine.geometry.coordinates[0]
      for (const corner of corners) {
        if (!checkPointInPolygon(corner as [number, number], buildingLineCoords)) {
          return false
        }
      }
      return true
    }

    // 건축선이 없으면 선택된 블록들 기준으로 체크
    for (const corner of corners) {
      let cornerInAnyBlock = false
      for (const item of selectedBlocks) {
        const coords = item.feature?.geometry?.coordinates?.[0]
        if (coords && checkPointInPolygon(corner as [number, number], coords)) {
          cornerInAnyBlock = true
          break
        }
      }
      if (!cornerInAnyBlock) return false
    }
    return true
  }, [blockSelection, buildingLine.buildingLineResult])

  // === 선택된 블록들의 색상 업데이트 ===
  const updateBlocksColor = useCallback((inBounds: boolean) => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const color = inBounds ? Cesium.Color.CYAN : Cesium.Color.RED

    for (const item of blockSelection.getSelectedBlocks()) {
      if (item.entity?.polygon) {
        item.entity.polygon.material = color.withAlpha(0.4)
      }
      if (item.entity?.polyline) {
        item.entity.polyline.material = color
      }
    }

    viewerRef.current.scene.requestRender()
  }, [blockSelection])

  // 함수들을 ref에 저장 (드래그 핸들러가 재생성되지 않도록)
  useEffect(() => {
    checkModelInBoundsRef.current = checkModelInBounds
    updateBlocksColorRef.current = updateBlocksColor
  }, [checkModelInBounds, updateBlocksColor])

  // === 휴먼 모델 위치 업데이트 함수 ===
  const updateHumanModelPosition = useCallback((lon: number, lat: number) => {
    if (!viewerRef.current) return
    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const entity = viewerRef.current.entities.getById('human-scale-model')
    if (!entity) return

    entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 0.9)
    humanModelTransformRef.current = { longitude: lon, latitude: lat }
    viewerRef.current.scene.requestRender()
  }, [])

  // === 3D 모델 드래그/회전 핸들러 ===
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    // 좌클릭 시작 - 드래그 시작
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (!Cesium.defined(pickedObject)) return

      const entityId = pickedObject.id?.id

      // 클릭 위치 계산
      let cartesian = viewer.scene.pickPosition(click.position)
      if (!cartesian || !Cesium.defined(cartesian)) {
        const ray = viewer.camera.getPickRay(click.position)
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene)
        }
      }
      if (!cartesian) return

      const clickPos = Cesium.Cartographic.fromCartesian(cartesian)
      const clickLon = Cesium.Math.toDegrees(clickPos.longitude)
      const clickLat = Cesium.Math.toDegrees(clickPos.latitude)

      // 건물 모델 드래그
      if (entityId === 'loaded-3d-model') {
        isModelDraggingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false
        modelDragStartRef.current = {
          offsetLon: modelTransformRef.current.longitude - clickLon,
          offsetLat: modelTransformRef.current.latitude - clickLat,
        }
      }
      // 휴먼 모델 드래그
      else if (entityId === 'human-scale-model') {
        isHumanDraggingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false
        humanDragStartRef.current = {
          offsetLon: humanModelTransformRef.current.longitude - clickLon,
          offsetLat: humanModelTransformRef.current.latitude - clickLat,
        }
      }
      // 입구 드래그 (entrance 엔티티 — parking보다 먼저 검사)
      else if (entityId && typeof entityId === 'string' && entityId.startsWith('_parking_entrance')) {
        isEntranceDraggingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false
        entranceDragStartRef.current = {
          offsetLon: entranceHookTransformRef.current.longitude - clickLon,
          offsetLat: entranceHookTransformRef.current.latitude - clickLat,
        }
      }
      // 주차구역 드래그
      else if (entityId && typeof entityId === 'string' && entityId.startsWith('_parking_')) {
        isParkingDraggingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false
        parkingDragStartRef.current = {
          offsetLon: parkingHookTransformRef.current.longitude - clickLon,
          offsetLat: parkingHookTransformRef.current.latitude - clickLat,
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    // 휠클릭 시작 - 회전 시작
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (!Cesium.defined(pickedObject)) return
      const entityId = pickedObject.id?.id
      if (entityId === 'loaded-3d-model') {
        isModelRotatingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTilt = false
      } else if (entityId && typeof entityId === 'string' && entityId.startsWith('_parking_entrance')) {
        isEntranceRotatingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTilt = false
      } else if (entityId && typeof entityId === 'string' && entityId.startsWith('_parking_')) {
        isParkingRotatingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTilt = false
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_DOWN)

    // 마우스 이동 - 드래그 및 회전 통합 핸들러
    handler.setInputAction((movement: any) => {
      // 드래그/회전 중이 아니면 즉시 반환 — pickPosition은 GPU 읽기라 비용이 큼
      const anyActive = isModelDraggingRef.current || isHumanDraggingRef.current ||
        isParkingDraggingRef.current || isEntranceDraggingRef.current ||
        isModelRotatingRef.current || isParkingRotatingRef.current ||
        isEntranceRotatingRef.current
      if (!anyActive) return

      // 마우스 위치 계산 (공통)
      let cartesian = viewer.scene.pickPosition(movement.endPosition)
      if (!cartesian || !Cesium.defined(cartesian)) {
        const ray = viewer.camera.getPickRay(movement.endPosition)
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene)
        }
      }

      // 건물 모델 드래그 (이동) — React 상태 업데이트 없이 직접 entity 조작
      if (isModelDraggingRef.current && modelDragStartRef.current && cartesian) {
        const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
        const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

        const newLon = mouseLon + modelDragStartRef.current.offsetLon
        const newLat = mouseLat + modelDragStartRef.current.offsetLat

        // ref만 업데이트 (React 리렌더 없음)
        modelTransformRef.current = {
          ...modelTransformRef.current,
          longitude: newLon,
          latitude: newLat,
        }

        // entity 위치 직접 업데이트 (useEffect 경유 안 함)
        const entity = loadedSampleModelRef.current
        if (entity) {
          const t = modelTransformRef.current
          const newPos = Cesium.Cartesian3.fromDegrees(newLon, newLat, t.height)
          entity.position = new Cesium.ConstantPositionProperty(newPos)
          const heading = Cesium.Math.toRadians(t.rotation)
          const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
          entity.orientation = new Cesium.ConstantProperty(
            Cesium.Transforms.headingPitchRollQuaternion(newPos, hpr)
          )
        }

        // 바운더리 폴리라인 따라가기
        if (modelBoundaryEntityRef.current) {
          const t = modelTransformRef.current
          const lr = t.latitude * Math.PI / 180
          const ml = 111320 * Math.cos(lr)
          const ma = 111320
          const rr = -t.rotation * Math.PI / 180
          const rc = Math.cos(rr), rs = Math.sin(rr)
          const hw = (modelBoundingBoxRef.current.width * t.scale) / 2
          const hd = (modelBoundingBoxRef.current.depth * t.scale) / 2
          const lc = [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]]
          const bp = lc.map(([cx,cy]) => {
            return Cesium.Cartesian3.fromDegrees(newLon+(cx*rc-cy*rs)/ml, newLat+(cx*rs+cy*rc)/ma, 0.5)
          })
          bp.push(bp[0])
          modelBoundaryEntityRef.current.polyline.positions = bp
        }

        // 실시간 바운더리 체크
        if (checkModelInBoundsRef.current && updateBlocksColorRef.current) {
          const inBounds = checkModelInBoundsRef.current(newLon, newLat, modelTransformRef.current.rotation, modelTransformRef.current.scale)
          if (inBounds !== isModelInBoundsRef.current) {
            isModelInBoundsRef.current = inBounds
            setIsModelInBounds(inBounds)
            updateBlocksColorRef.current(inBounds)
          }
        }

        viewer.scene.requestRender()
        return
      }

      // 휴먼 모델 드래그 (이동)
      if (isHumanDraggingRef.current && humanDragStartRef.current && cartesian) {
        const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
        const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

        const newLon = mouseLon + humanDragStartRef.current.offsetLon
        const newLat = mouseLat + humanDragStartRef.current.offsetLat

        updateHumanModelPosition(newLon, newLat)
        return
      }

      // 입구 드래그 (이동) — entranceTransform 업데이트 후 re-render
      if (isEntranceDraggingRef.current && entranceDragStartRef.current && cartesian) {
        const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
        const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

        entranceHookTransformRef.current = {
          ...entranceHookTransformRef.current,
          longitude: mouseLon + entranceDragStartRef.current.offsetLon,
          latitude: mouseLat + entranceDragStartRef.current.offsetLat,
        }

        updateEntranceInPlace()
        viewer.scene.requestRender()
        return
      }

      // 입구 회전 (entrance center 기준)
      if (isEntranceRotatingRef.current && cartesian) {
        const mousePos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(mousePos.longitude)
        const mouseLat = Cesium.Math.toDegrees(mousePos.latitude)

        // 입구 중심 = modelTransform 원점 + entranceCenter(m→deg) + entranceTransform offset
        const mt = modelTransformRef.current
        const et = entranceHookTransformRef.current
        const latRad = (mt.latitude * Math.PI) / 180
        const mPerDegLon = 111_320 * Math.cos(latRad)
        const mPerDegLat = 111_320
        const entrance = useProjectStore.getState().parkingEntrance
        const ecx = entrance?.cx ?? 0
        const ecy = entrance?.cy ?? 0
        const originLon = mt.longitude + ecx / mPerDegLon + et.longitude
        const originLat = mt.latitude + ecy / mPerDegLat + et.latitude

        const deltaLon = mouseLon - originLon
        const deltaLat = mouseLat - originLat
        const angleRad = Math.atan2(deltaLon, deltaLat)
        const angleDeg = Cesium.Math.toDegrees(angleRad)

        entranceHookTransformRef.current = {
          ...entranceHookTransformRef.current,
          rotation: (-angleDeg + 360) % 360,
        }

        updateEntranceInPlace()
        viewer.scene.requestRender()
        return
      }

      // 주차구역 드래그 (이동) — parkingTransform offset 업데이트 후 re-render
      if (isParkingDraggingRef.current && parkingDragStartRef.current && cartesian) {
        const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
        const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

        const newLon = mouseLon + parkingDragStartRef.current.offsetLon
        const newLat = mouseLat + parkingDragStartRef.current.offsetLat

        // ref 업데이트
        parkingHookTransformRef.current = {
          ...parkingHookTransformRef.current,
          longitude: newLon,
          latitude: newLat,
        }

        // 주차구역 인플레이스 업데이트 (엔티티 삭제/재생성 없이 빠른 위치 업데이트)
        const currentParkingZoneDrag = useProjectStore.getState().parkingZone
        if (currentParkingZoneDrag) {
          updateParkingInPlace(currentParkingZoneDrag)
        }

        viewer.scene.requestRender()
        return
      }

      // 주차구역 회전 — parkingTransform rotation 업데이트 (zoneCenter 기준)
      if (isParkingRotatingRef.current && cartesian) {
        const mousePos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(mousePos.longitude)
        const mouseLat = Cesium.Math.toDegrees(mousePos.latitude)

        // 주차구역 중심 = modelTransform 원점 + zoneCenter(m→deg) + parkingTransform offset
        const mt = modelTransformRef.current
        const pt = parkingHookTransformRef.current
        const latRad = (mt.latitude * Math.PI) / 180
        const mPerDegLon = 111_320 * Math.cos(latRad)
        const mPerDegLat = 111_320
        const zone = useProjectStore.getState().parkingZone
        const zcx = zone?.zoneCenter?.[0] ?? 0
        const zcy = zone?.zoneCenter?.[1] ?? 0
        const originLon = mt.longitude + zcx / mPerDegLon + pt.longitude
        const originLat = mt.latitude + zcy / mPerDegLat + pt.latitude

        const deltaLon = mouseLon - originLon
        const deltaLat = mouseLat - originLat

        const angleRad = Math.atan2(deltaLon, deltaLat)
        const angleDeg = Cesium.Math.toDegrees(angleRad)
        const newRotation = (-angleDeg + 360) % 360

        parkingHookTransformRef.current = {
          ...parkingHookTransformRef.current,
          rotation: newRotation,
        }

        const currentParkingZoneRot = useProjectStore.getState().parkingZone
        if (currentParkingZoneRot) {
          updateParkingInPlace(currentParkingZoneRot)
        }

        viewer.scene.requestRender()
        return
      }

      // 모델 회전 — React 상태 업데이트 없이 직접 entity 조작
      if (isModelRotatingRef.current && cartesian) {
        const mousePos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(mousePos.longitude)
        const mouseLat = Cesium.Math.toDegrees(mousePos.latitude)

        const currentTransform = modelTransformRef.current
        const deltaLon = mouseLon - currentTransform.longitude
        const deltaLat = mouseLat - currentTransform.latitude

        const angleRad = Math.atan2(deltaLon, deltaLat)
        const angleDeg = Cesium.Math.toDegrees(angleRad)
        const newRotation = (angleDeg + 360) % 360

        // ref만 업데이트 (React 리렌더 없음)
        modelTransformRef.current = {
          ...modelTransformRef.current,
          rotation: newRotation,
        }

        // entity 회전 직접 업데이트
        const entity = loadedSampleModelRef.current
        if (entity) {
          const pos = Cesium.Cartesian3.fromDegrees(currentTransform.longitude, currentTransform.latitude, currentTransform.height)
          const heading = Cesium.Math.toRadians(newRotation)
          const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
          entity.orientation = new Cesium.ConstantProperty(
            Cesium.Transforms.headingPitchRollQuaternion(pos, hpr)
          )
        }

        // 바운더리 폴리라인 회전 따라가기
        if (modelBoundaryEntityRef.current) {
          const scl = currentTransform.scale
          const cLon = currentTransform.longitude, cLat = currentTransform.latitude
          const lr = cLat * Math.PI / 180
          const ml = 111320 * Math.cos(lr), ma = 111320
          const rr = -newRotation * Math.PI / 180
          const rc = Math.cos(rr), rs = Math.sin(rr)
          const hw = (modelBoundingBoxRef.current.width * scl) / 2
          const hd = (modelBoundingBoxRef.current.depth * scl) / 2
          const lc = [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]]
          const bp = lc.map(([cx,cy]) => {
            return Cesium.Cartesian3.fromDegrees(cLon+(cx*rc-cy*rs)/ml, cLat+(cx*rs+cy*rc)/ma, 0.5)
          })
          bp.push(bp[0])
          modelBoundaryEntityRef.current.polyline.positions = bp
        }

        // 회전 시에도 바운더리 체크
        if (checkModelInBoundsRef.current && updateBlocksColorRef.current) {
          const inBounds = checkModelInBoundsRef.current(currentTransform.longitude, currentTransform.latitude, newRotation, currentTransform.scale)
          if (inBounds !== isModelInBoundsRef.current) {
            isModelInBoundsRef.current = inBounds
            setIsModelInBounds(inBounds)
            updateBlocksColorRef.current(inBounds)
          }
        }

        viewer.scene.requestRender()
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 좌클릭 종료 - 드래그 종료
    handler.setInputAction(() => {
      if (isModelDraggingRef.current) {
        isModelDraggingRef.current = false
        modelDragStartRef.current = null
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
        // 드래그 종료 시 React 상태 동기화 (ref → store)
        const t = modelTransformRef.current
        setModelTransform({ longitude: t.longitude, latitude: t.latitude })
      }
      if (isHumanDraggingRef.current) {
        isHumanDraggingRef.current = false
        humanDragStartRef.current = null
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
      }
      if (isEntranceDraggingRef.current) {
        isEntranceDraggingRef.current = false
        entranceDragStartRef.current = null
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
        const et = entranceHookTransformRef.current
        setEntranceTransform({ longitude: et.longitude, latitude: et.latitude })
      }
      if (isParkingDraggingRef.current) {
        isParkingDraggingRef.current = false
        parkingDragStartRef.current = null
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
        const pt = parkingHookTransformRef.current
        setParkingTransform({ longitude: pt.longitude, latitude: pt.latitude })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    // 휠클릭 종료 - 회전 종료
    handler.setInputAction(() => {
      if (isModelRotatingRef.current) {
        isModelRotatingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTilt = true
        // 회전 종료 시 React 상태 동기화 (ref → store)
        const t = modelTransformRef.current
        setModelTransform({ rotation: t.rotation })
      }
      if (isEntranceRotatingRef.current) {
        isEntranceRotatingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTilt = true
        const et = entranceHookTransformRef.current
        setEntranceTransform({ rotation: et.rotation })
      }
      if (isParkingRotatingRef.current) {
        isParkingRotatingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTilt = true
        const pt = parkingHookTransformRef.current
        setParkingTransform({ rotation: pt.rotation })
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_UP)

    return () => handler.destroy()
  }, [isLoaded, setModelTransform, setParkingTransform, setEntranceTransform, updateHumanModelPosition, renderParking, renderEntranceOnly, updateParkingInPlace, updateEntranceInPlace])

  // === 시간 변경 (일조 시뮬레이션) ===
  const handleTimeChange = useCallback((date: Date) => {
    if (!viewerRef.current) return
    const Cesium = (window as any).Cesium
    if (!Cesium) return

    viewerRef.current.clock.currentTime = Cesium.JulianDate.fromDate(date)
    setCurrentTime(date)
    viewerRef.current.scene.requestRender()
  }, [])

  // === 일조 시간 슬라이더 동기화 ===
  const sunlightDate = useProjectStore((state) => state.sunlightDate)
  useEffect(() => {
    if (!viewerRef.current) return
    const Cesium = (window as any).Cesium
    if (!Cesium) return
    viewerRef.current.clock.currentTime = Cesium.JulianDate.fromDate(sunlightDate)
    viewerRef.current.scene.globe.enableLighting = true
    viewerRef.current.scene.requestRender()
    setCurrentTime(sunlightDate)
  }, [sunlightDate])

  // === 프로젝트 저장/불러오기 (Hook) ===
  const projectPersistence = useProjectPersistence({
    viewerRef,
    // 지적도 상태
    getCadastralFeatures: () => cadastral.cadastralFeatures as GeoJSON.Feature<GeoJSON.Polygon>[],
    getSelectedRegion: cadastral.getSelectedRegion,
    restoreCadastral: cadastral.restoreCadastralState,
    // 블록 선택 상태
    getSelectedBlocks: blockSelection.getSelectedBlocks,
    restoreBlockSelection: blockSelection.restoreBlockSelection,
    // 건축선 상태
    getBuildingLineResult: buildingLine.getBuildingLineResult,
    getShowBuildingLine: () => buildingLine.showBuildingLine,
    restoreBuildingLine: buildingLine.restoreBuildingLineState,
    // OSM 건물 상태
    getHiddenBuildingIds: () => osmBuildings.hiddenBuildingIds,
    restoreHiddenBuildings: osmBuildings.setHiddenBuildingIdsDirect,
    // 모델 상태
    getLoadedModelFilename,
    loadModel: loadSampleModel,
    // 휴먼 모델 상태
    getHumanModelTransform,
    restoreHumanModelPosition,
    // 시간 상태
    getCurrentTime: () => currentTime,
    setCurrentTime: handleTimeChange,
  })

  // === 스토어에 저장/불러오기 함수 등록 (ref 사용하여 안정적 참조) ===
  const projectPersistenceRef = useRef(projectPersistence)
  projectPersistenceRef.current = projectPersistence

  useEffect(() => {
    // 래퍼 함수를 통해 항상 최신 함수 참조
    const saveWrapper = (projectName?: string) => {
      projectPersistenceRef.current.saveProject(projectName)
    }
    const loadWrapper = async (file: File) => {
      await projectPersistenceRef.current.loadProject(file)
    }
    const loadFromDbWrapper = async () => {
      await projectPersistenceRef.current.loadFromDb()
    }
    setSaveProjectFn(saveWrapper)
    setLoadProjectFn(loadWrapper)
    setLoadFromDbFn(loadFromDbWrapper)

    // 검토 체크 함수 등록
    const reviewCheck = () => {
      const state = useProjectStore.getState()
      const siteArea = state.selectedBlockInfo?.totalArea || 0
      if (siteArea <= 0) return

      // 건폐율: 모델 바운더리 면적 / 선택 블록 면적
      const bbox = modelBoundingBoxRef.current
      const scale = modelTransformRef.current.scale
      const buildingArea = (bbox.width * scale) * (bbox.depth * scale)
      const ratio = siteArea > 0 ? (buildingArea / siteArea) * 100 : 0
      // 용도지역별 건폐율 한도 (기본 60%)
      const limit = 60

      // 이격거리: 모델 코너와 블록 경계 간 최소거리 계산
      const t = modelTransformRef.current
      const lat = t.latitude
      const lon = t.longitude
      const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180)
      const mPerDegLat = 111320
      const rr = -t.rotation * Math.PI / 180
      const cos = Math.cos(rr), sin = Math.sin(rr)
      const hw = (bbox.width * scale) / 2
      const hd = (bbox.depth * scale) / 2
      const corners = [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]]
      const modelCorners = corners.map(([cx,cy]) => [
        lon + (cx*cos - cy*sin) / mPerDegLon,
        lat + (cx*sin + cy*cos) / mPerDegLat,
      ])

      // 블록 경계와의 최소거리
      const blockCoords = state.selectedBlockInfo?.coordinates || []
      let minDist = Infinity
      const setbackDetails: { type: string; distance: number; required: number; status: 'OK' | 'VIOLATION' }[] = []

      for (const blockRing of blockCoords) {
        for (let i = 0; i < blockRing.length - 1; i++) {
          const [ex1, ey1] = blockRing[i]
          const [ex2, ey2] = blockRing[i + 1]
          for (const [mx, my] of modelCorners) {
            const dist = pointToSegmentDist(mx, my, ex1, ey1, ex2, ey2, mPerDegLon, mPerDegLat)
            if (dist < minDist) minDist = dist
          }
        }
      }

      const requiredSetback = 0.5 // 기본 인접대지 이격거리
      if (minDist < Infinity) {
        setbackDetails.push({
          type: '대지경계',
          distance: Math.round(minDist * 100) / 100,
          required: requiredSetback,
          status: minDist >= requiredSetback ? 'OK' : 'VIOLATION',
        })
      }

      state.setReviewData({
        buildingCoverage: {
          buildingArea: Math.round(buildingArea * 100) / 100,
          siteArea: Math.round(siteArea * 100) / 100,
          ratio: Math.round(ratio * 10) / 10,
          limit,
          status: ratio <= limit ? 'OK' : 'VIOLATION',
        },
        setback: minDist < Infinity ? {
          minDistance: Math.round(minDist * 100) / 100,
          required: requiredSetback,
          status: minDist >= requiredSetback ? 'OK' : 'VIOLATION',
          details: setbackDetails,
        } : null,
        isModelInBounds: isModelInBoundsRef.current,
      })
    }
    setRunReviewCheckFn(reviewCheck)

    // 일조분석 함수 등록
    setStartSunlightFn((date: Date, gridSpacing?: number) => {
      sunlightAnalysis.startAnalysis(date, gridSpacing)
    })
    setToggleSunlightHeatmapFn(() => sunlightAnalysis.toggleHeatmap())
    setClearSunlightFn(() => sunlightAnalysis.clearAnalysis())
    setSetSunlightHeatmapModeFn((mode: 'point' | 'cell') => sunlightAnalysis.setHeatmapMode(mode))

    return () => {
      setSaveProjectFn(null)
      setLoadProjectFn(null)
      setLoadFromDbFn(null)
      setRunReviewCheckFn(null)
      setStartSunlightFn(null)
      setToggleSunlightHeatmapFn(null)
      setClearSunlightFn(null)
      setSetSunlightHeatmapModeFn(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 마운트 시 한 번만 실행

  // === 뷰어 로드 후 DB 자동 복원 ===
  const hasAutoLoadedRef = useRef(false)
  useEffect(() => {
    if (hasAutoLoadedRef.current) return
    if (!isLoaded) return // 뷰어가 준비될 때까지 대기
    const { projectId } = useProjectStore.getState()
    if (!projectId) return

    hasAutoLoadedRef.current = true
    console.log('[CesiumViewer] 뷰어 준비 완료, 프로젝트 자동 복원:', projectId)
    projectPersistenceRef.current.loadFromDb().catch((err) => {
      console.warn('[CesiumViewer] 자동 상태 복원 실패:', err)
    })
  }, [isLoaded])

  // === 저장/불러오기 상태 동기화 ===
  useEffect(() => {
    setIsSavingProject(projectPersistence.isSaving)
  }, [projectPersistence.isSaving, setIsSavingProject])

  useEffect(() => {
    setIsLoadingProject(projectPersistence.isLoading)
  }, [projectPersistence.isLoading, setIsLoadingProject])

  useEffect(() => {
    setProjectError(projectPersistence.lastError)
  }, [projectPersistence.lastError, setProjectError])

  // === 일조분석 상태 → store 동기화 ===
  useEffect(() => {
    setSunlightAnalysisState({
      isAnalyzing: sunlightAnalysis.isAnalyzing,
      progress: sunlightAnalysis.analysisProgress,
      result: sunlightAnalysis.analysisResult ? {
        averageSunlightHours: sunlightAnalysis.analysisResult.statistics.averageSunlightHours,
        minSunlightHours: sunlightAnalysis.analysisResult.statistics.minSunlightHours,
        maxSunlightHours: sunlightAnalysis.analysisResult.statistics.maxSunlightHours,
        totalPoints: sunlightAnalysis.analysisResult.totalPoints,
        analysisDate: sunlightAnalysis.analysisResult.analysisDate,
      } : null,
      showHeatmap: sunlightAnalysis.showHeatmap,
      heatmapMode: sunlightAnalysis.heatmapMode,
    })
  }, [sunlightAnalysis.isAnalyzing, sunlightAnalysis.analysisProgress, sunlightAnalysis.analysisResult, sunlightAnalysis.showHeatmap, sunlightAnalysis.heatmapMode, setSunlightAnalysisState])

  // === 뷰포트 새로고침 ===
  const handleRefreshViewport = useCallback(() => {
    saveViewportState()
    refreshViewer()
  }, [saveViewportState, refreshViewer])

  // === UI 렌더링 ===
  const viewportLoading = !isLoaded || !initialTilesReady
  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* 뷰포트 로딩 오버레이 — Cesium 초기화 및 지도 타일 로딩 중 표시 */}
      {viewportLoading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-navy-900/85 backdrop-blur-sm pointer-events-auto">
          <div className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl bg-navy-800/70 border border-white/10 shadow-2xl">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-white/10 rounded-full" />
              <div className="absolute inset-0 w-12 h-12 border-4 border-brand-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white/90">
                {!isLoaded ? '3D 뷰포트 초기화 중…' : '지도 타일 불러오는 중…'}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {!isLoaded
                  ? 'Cesium 엔진을 준비하고 있습니다.'
                  : tilesLoading > 0
                  ? `남은 타일: ${tilesLoading}`
                  : '거의 다 됐습니다…'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 상단 컨트롤 바 */}
      {isLoaded && (
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="bg-[#ffffffe6] rounded-lg shadow-lg px-4 py-2 flex items-center gap-3">
              <span className="text-sm font-bold text-gray-800">{projectName || 'Building Cesium'}</span>
              {workArea && (
                <>
                  <span className="text-gray-300">|</span>
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    <span className="text-sm text-gray-600 max-w-xs truncate">{workArea.address}</span>
                  </div>
                </>
              )}
            </div>

            {/* 지역 선택 버튼 */}
            <button
              onClick={toggleRegionSelection}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                isSelectingRegion ? 'bg-blue-500 text-[#fff]' : 'bg-[#ffffffe6] hover:bg-gray-100 text-gray-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              <span className="text-sm">{isSelectingRegion ? '선택 중...' : '지역 선택'}</span>
            </button>

            {/* 영역 선택 버튼 */}
            <button
              onClick={blockSelection.toggleSelection}
              disabled={!cadastral.hasPolylinesLoaded}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                blockSelection.isSelecting
                  ? 'bg-green-500 text-[#fff]'
                  : blockSelection.selectedBlockCount > 0
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-[#ffffffe6] hover:bg-gray-100 text-gray-700'
              } ${!cadastral.hasPolylinesLoaded ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span className="text-sm">
                {blockSelection.isSelecting ? '블록 선택 중...' : blockSelection.selectedBlockCount > 0 ? `영역 선택 (${blockSelection.selectedBlockCount})` : '영역 선택'}
              </span>
            </button>

            {blockSelection.selectedBlockCount > 0 && (
              <button onClick={clearSelectedBlocks} className="rounded-lg shadow-lg px-2 py-2 bg-red-100 hover:bg-red-200 text-red-600 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            {/* 건물 삭제 모드 버튼 */}
            <button
              onClick={osmBuildings.toggleBuildingSelectMode}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                osmBuildings.isBuildingSelectMode ? 'bg-red-500 text-[#fff]' : 'bg-[#ffffffe6] hover:bg-gray-100 text-gray-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="text-sm">{osmBuildings.isBuildingSelectMode ? '선택 중...' : '건물 삭제'}</span>
            </button>

            {/* 건축선 버튼 */}
            <button
              onClick={buildingLine.toggleBuildingLine}
              disabled={blockSelection.selectedBlockCount === 0}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                buildingLine.showBuildingLine
                  ? 'bg-red-500 text-[#fff]'
                  : blockSelection.selectedBlockCount > 0
                    ? 'bg-[#ffffffe6] hover:bg-gray-100 text-gray-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="text-sm">{buildingLine.showBuildingLine ? '건축선 숨기기' : '건축선'}</span>
            </button>

            {/* 건물 복원 버튼 */}
            {osmBuildings.hiddenBuildingIds.length > 0 && (
              <button onClick={osmBuildings.restoreAllBuildings} className="rounded-lg shadow-lg px-3 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 flex items-center gap-2 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-sm">건물 복원 ({osmBuildings.hiddenBuildingIds.length})</span>
              </button>
            )}
          </div>

          {/* 우측 컨트롤 */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* 새로고침 */}
            <button onClick={handleRefreshViewport} className="rounded-lg shadow-lg px-3 py-2 bg-[#ffffffe6] hover:bg-gray-100 text-gray-700 flex items-center gap-2 transition-colors" title="뷰포트 새로고침">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 작업 영역 주소 — 상단 바에 통합됨 */}

      {/* 건축선 분석 결과 패널 */}
      {isLoaded && buildingLine.showBuildingLine && buildingLine.buildingLineResult && (
        <div className="absolute top-64 right-4 bg-[#fffffff2] rounded-lg shadow-lg p-4 max-w-sm z-10">
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            건축선 분석 결과
          </h3>
          <div className="text-xs space-y-2">
            <div className="flex justify-between items-center py-1 border-b border-gray-100">
              <span className="text-gray-600">도로 접촉 변</span>
              <span className="font-medium text-orange-500">{buildingLine.buildingLineResult.roadEdges.length}개</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100">
              <span className="text-gray-600">인접 대지 변</span>
              <span className="font-medium text-yellow-600">{buildingLine.buildingLineResult.adjacentLotEdges.length}개</span>
            </div>
            <div className="mt-3 p-2 bg-gray-50 rounded">
              <p className="text-gray-500 mb-1">적용 이격거리</p>
              <div className="flex gap-2">
                <div className="bg-orange-50 rounded p-2 flex-1">
                  <p className="text-orange-600 font-medium">도로측</p>
                  <p className="text-gray-700">{buildingLine.buildingLineResult.roadEdges[0]?.setbackDistance ?? DEFAULT_SETBACKS.fromBuildingLine}m</p>
                </div>
                <div className="bg-yellow-50 rounded p-2 flex-1">
                  <p className="text-yellow-600 font-medium">인접대지</p>
                  <p className="text-gray-700">{buildingLine.buildingLineResult.adjacentLotEdges[0]?.setbackDistance ?? DEFAULT_SETBACKS.fromAdjacentLot}m</p>
                </div>
              </div>
            </div>
            <div className="mt-3 p-2 bg-blue-50 rounded">
              <p className="text-blue-600 font-medium">범례</p>
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-2"><span className="w-4 h-1 bg-red-500 rounded"></span><span className="text-gray-600">건축선</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-1 bg-orange-500 rounded"></span><span className="text-gray-600">도로 접촉 변</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-1 bg-yellow-400 rounded"></span><span className="text-gray-600">인접 대지 변</span></div>
              </div>
            </div>
          </div>
          <button onClick={buildingLine.toggleBuildingLine} className="mt-3 w-full text-xs text-gray-500 hover:text-gray-700 py-1">닫기</button>
        </div>
      )}

      {/* 모드 안내 */}
      {isSelectingRegion && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-blue-500 text-[#fff] px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">지도에서 작업할 지역을 클릭하세요</p>
        </div>
      )}
      {blockSelection.isSelecting && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-green-500 text-[#fff] px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">블록을 클릭하여 선택/해제 - 완료 후 버튼 다시 클릭</p>
        </div>
      )}
      {osmBuildings.isBuildingSelectMode && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-red-500 text-[#fff] px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">삭제할 건물을 클릭하세요</p>
        </div>
      )}

      {/* 선택된 건물 정보 */}
      {osmBuildings.selectedBuilding && (
        <div className="absolute top-36 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg p-4 z-20 min-w-64">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-gray-800">선택된 건물</h4>
            <button onClick={osmBuildings.toggleBuildingSelectMode} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="text-sm text-gray-600 mb-3">
            <p>이름: {osmBuildings.selectedBuilding.name}</p>
            <p className="text-xs text-gray-400">ID: {osmBuildings.selectedBuilding.id}</p>
          </div>
          <button onClick={osmBuildings.hideSelectedBuilding} className="w-full bg-red-500 hover:bg-red-600 text-[#fff] px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            이 건물 숨기기
          </button>
        </div>
      )}

      {/* 숨긴 건물 목록 */}
      {osmBuildings.hiddenBuildingIds.length > 0 && (
        <div className="absolute bottom-8 right-4 bg-[#ffffffe6] rounded-lg shadow-lg p-3 z-10 max-w-xs">
          <h4 className="font-medium text-sm text-gray-800 mb-2">숨긴 건물 ({osmBuildings.hiddenBuildingIds.length})</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {osmBuildings.hiddenBuildingIds.map((id) => (
              <div key={id} className="flex items-center justify-between text-xs bg-gray-100 rounded px-2 py-1">
                <span className="text-gray-600 truncate">ID: {id}</span>
                <button onClick={() => osmBuildings.restoreBuilding(id)} className="text-blue-500 hover:text-blue-700 ml-2">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 일조 시뮬레이션 — 사이드바 검토 탭으로 이동됨 */}
    </div>
  )
}
