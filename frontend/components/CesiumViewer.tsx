'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useCesiumViewer, DEFAULT_POSITION } from '@/hooks/useCesiumViewer'
import { useBuildingLine } from '@/hooks/useBuildingLine'
import { useBlockSelection } from '@/hooks/useBlockSelection'
import { useCadastral } from '@/hooks/useCadastral'
import { useOsmBuildings } from '@/hooks/useOsmBuildings'
import { useProjectPersistence } from '@/hooks/useProjectPersistence'
import { isPointInPolygon as checkPointInPolygon } from '@/lib/geometry'
import { DEFAULT_SETBACKS } from '@/lib/setbackTable'
import type { CadastralFeature } from '@/types/cesium'

/**
 * CesiumJS 기반 3D 지도 뷰어 컴포넌트 (리팩토링 버전)
 */
export default function CesiumViewer() {
  // === Store 연결 ===
  const {
    site, building, workArea,
    loadedModelEntity, modelTransform, selectedModel,
    setViewer, setModelTransform, setSelectedModel, setLoadedModelEntity,
    setWorkArea, setAvailableModels, setSelectedBlockCount,
    modelToLoad, setModelToLoad, isLoadingModel, setIsLoadingModel,
    humanScaleModelLoaded, setHumanScaleModelLoaded,
    setSaveProjectFn, setLoadProjectFn, setIsSavingProject, setIsLoadingProject, setProjectError,
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
  const modelBoundaryEntityRef = useRef<any>(null)
  const isModelInBoundsRef = useRef(true)
  const checkModelInBoundsRef = useRef<((lon: number, lat: number, rotation: number, scale: number) => boolean) | null>(null)
  const updateBlocksColorRef = useRef<((inBounds: boolean) => void) | null>(null)

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
    osmTilesetRef,
    refreshViewer,
  } = useCesiumViewer({
    onViewerReady: (viewer) => {
      setViewer(viewer)
    },
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
      },
    }
  )

  // === 건축선 (Hook) ===
  const buildingLine = useBuildingLine(viewerRef, {
    getSelectedBlocks: blockSelection.getSelectedBlocks,
  })

  // === OSM 건물 숨기기 (Hook) ===
  const osmBuildings = useOsmBuildings(viewerRef, osmTilesetRef, isLoaded)

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

    const { longitude, latitude, rotation, scale } = modelTransform
    const halfWidth = (modelBoundingBoxRef.current.width * scale) / 2
    const halfDepth = (modelBoundingBoxRef.current.depth * scale) / 2
    const latRad = latitude * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320
    const rotRad = -rotation * Math.PI / 180
    const cos = Math.cos(rotRad)
    const sin = Math.sin(rotRad)

    const localCorners = [
      { x: -halfWidth, y: -halfDepth },
      { x: halfWidth, y: -halfDepth },
      { x: halfWidth, y: halfDepth },
      { x: -halfWidth, y: halfDepth },
    ]

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

    // 선택 영역 색상 업데이트
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
  }, [modelTransform.longitude, modelTransform.latitude, modelTransform.height, modelTransform.rotation, modelTransform.scale, isLoaded, isModelInBounds, buildingLine.buildingLineResult, blockSelection, loadedModelEntity])

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

      // 경계 상태 초기화
      setIsModelInBounds(true)

      // 해당 모델의 바운딩 박스 정보 가져오기
      const modelInfo = availableModels.find(m => m.filename === filename)
      if (modelInfo?.boundingBox) {
        modelBoundingBoxRef.current = {
          width: modelInfo.boundingBox.width,
          depth: modelInfo.boundingBox.depth,
        }
      } else {
        modelBoundingBoxRef.current = { width: 10, depth: 10 }
      }

      const modelUrl = `/api/models/${encodeURIComponent(filename)}`
      const initialRotation = 0
      const initialScale = 10.0

      const position = Cesium.Cartesian3.fromDegrees(center.longitude, center.latitude, 0)
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
        height: 0,
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

    // 모델 바닥면의 네 모서리 좌표 계산
    const halfWidth = (modelBoundingBoxRef.current.width * scale) / 2
    const halfDepth = (modelBoundingBoxRef.current.depth * scale) / 2
    const latRad = lat * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320
    const rotRad = -rotation * Math.PI / 180
    const cos = Math.cos(rotRad)
    const sin = Math.sin(rotRad)

    const localCorners = [
      { x: -halfWidth, y: -halfDepth },
      { x: halfWidth, y: -halfDepth },
      { x: halfWidth, y: halfDepth },
      { x: -halfWidth, y: halfDepth },
    ]

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
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    // 휠클릭 시작 - 회전 시작
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (Cesium.defined(pickedObject) && pickedObject.id?.id === 'loaded-3d-model') {
        isModelRotatingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTilt = false
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_DOWN)

    // 마우스 이동 - 드래그 및 회전 통합 핸들러
    handler.setInputAction((movement: any) => {
      // 마우스 위치 계산 (공통)
      let cartesian = viewer.scene.pickPosition(movement.endPosition)
      if (!cartesian || !Cesium.defined(cartesian)) {
        const ray = viewer.camera.getPickRay(movement.endPosition)
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene)
        }
      }

      // 건물 모델 드래그 (이동)
      if (isModelDraggingRef.current && modelDragStartRef.current && cartesian) {
        const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
        const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

        const newLon = mouseLon + modelDragStartRef.current.offsetLon
        const newLat = mouseLat + modelDragStartRef.current.offsetLat

        modelTransformRef.current = {
          ...modelTransformRef.current,
          longitude: newLon,
          latitude: newLat,
        }
        setModelTransform({ longitude: newLon, latitude: newLat })

        // 실시간 바운더리 체크
        if (checkModelInBoundsRef.current && updateBlocksColorRef.current) {
          const inBounds = checkModelInBoundsRef.current(newLon, newLat, modelTransformRef.current.rotation, modelTransformRef.current.scale)
          if (inBounds !== isModelInBoundsRef.current) {
            isModelInBoundsRef.current = inBounds
            setIsModelInBounds(inBounds)
            updateBlocksColorRef.current(inBounds)
          }
        }
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

      // 모델 회전 - 마우스 위치를 향해 모델이 바라보도록
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

        modelTransformRef.current = {
          ...modelTransformRef.current,
          rotation: newRotation,
        }
        setModelTransform({ rotation: newRotation })

        // 회전 시에도 바운더리 체크
        if (checkModelInBoundsRef.current && updateBlocksColorRef.current) {
          const inBounds = checkModelInBoundsRef.current(currentTransform.longitude, currentTransform.latitude, newRotation, currentTransform.scale)
          if (inBounds !== isModelInBoundsRef.current) {
            isModelInBoundsRef.current = inBounds
            setIsModelInBounds(inBounds)
            updateBlocksColorRef.current(inBounds)
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 좌클릭 종료 - 드래그 종료
    handler.setInputAction(() => {
      if (isModelDraggingRef.current) {
        isModelDraggingRef.current = false
        modelDragStartRef.current = null
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
      }
      if (isHumanDraggingRef.current) {
        isHumanDraggingRef.current = false
        humanDragStartRef.current = null
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    // 휠클릭 종료 - 회전 종료
    handler.setInputAction(() => {
      if (isModelRotatingRef.current) {
        isModelRotatingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTilt = true
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_UP)

    return () => handler.destroy()
  }, [isLoaded, setModelTransform, updateHumanModelPosition])

  // === 시간 변경 (일조 시뮬레이션) ===
  const handleTimeChange = useCallback((date: Date) => {
    if (!viewerRef.current) return
    const Cesium = (window as any).Cesium
    if (!Cesium) return

    viewerRef.current.clock.currentTime = Cesium.JulianDate.fromDate(date)
    setCurrentTime(date)
    viewerRef.current.scene.requestRender()
  }, [])

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
    setSaveProjectFn(saveWrapper)
    setLoadProjectFn(loadWrapper)
    return () => {
      setSaveProjectFn(null)
      setLoadProjectFn(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 마운트 시 한 번만 실행

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

  // === 뷰포트 새로고침 ===
  const handleRefreshViewport = useCallback(() => {
    saveViewportState()
    refreshViewer()
  }, [saveViewportState, refreshViewer])

  // === UI 렌더링 ===
  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* 상단 컨트롤 바 */}
      {isLoaded && (
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="bg-white/90 rounded-lg shadow-lg px-4 py-2">
              <span className="text-sm font-medium text-gray-700">Cesium 3D</span>
            </div>

            {/* 지역 선택 버튼 */}
            <button
              onClick={toggleRegionSelection}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                isSelectingRegion ? 'bg-blue-500 text-white' : 'bg-white/90 hover:bg-gray-100 text-gray-700'
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
                  ? 'bg-green-500 text-white'
                  : blockSelection.selectedBlockCount > 0
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-white/90 hover:bg-gray-100 text-gray-700'
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
                osmBuildings.isBuildingSelectMode ? 'bg-red-500 text-white' : 'bg-white/90 hover:bg-gray-100 text-gray-700'
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
                  ? 'bg-red-500 text-white'
                  : blockSelection.selectedBlockCount > 0
                    ? 'bg-white/90 hover:bg-gray-100 text-gray-700'
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
            <button onClick={handleRefreshViewport} className="rounded-lg shadow-lg px-3 py-2 bg-white/90 hover:bg-gray-100 text-gray-700 flex items-center gap-2 transition-colors" title="뷰포트 새로고침">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 작업 영역 주소 표시 */}
      {isLoaded && workArea && (
        <div className="absolute top-48 right-4 bg-white/90 rounded-lg shadow-lg px-4 py-2 max-w-md z-10">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            </svg>
            <span className="text-sm text-gray-700 truncate">{workArea.address}</span>
            <button onClick={() => setWorkArea(null)} className="ml-2 text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 건축선 분석 결과 패널 */}
      {isLoaded && buildingLine.showBuildingLine && buildingLine.buildingLineResult && (
        <div className="absolute top-64 right-4 bg-white/95 rounded-lg shadow-lg p-4 max-w-sm z-10">
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
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">지도에서 작업할 지역을 클릭하세요</p>
        </div>
      )}
      {blockSelection.isSelecting && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">블록을 클릭하여 선택/해제 - 완료 후 버튼 다시 클릭</p>
        </div>
      )}
      {osmBuildings.isBuildingSelectMode && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
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
          <button onClick={osmBuildings.hideSelectedBuilding} className="w-full bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            이 건물 숨기기
          </button>
        </div>
      )}

      {/* 숨긴 건물 목록 */}
      {osmBuildings.hiddenBuildingIds.length > 0 && (
        <div className="absolute bottom-8 right-4 bg-white/90 rounded-lg shadow-lg p-3 z-10 max-w-xs">
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

      {/* 일조 시뮬레이션 */}
      {isLoaded && (
        <div className="absolute bottom-8 left-4 bg-white/90 rounded-lg shadow-lg p-4 z-10">
          <h4 className="font-medium text-sm mb-2">일조 시뮬레이션</h4>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-600">날짜</label>
              <input
                type="date"
                value={currentTime.toISOString().split('T')[0]}
                onChange={(e) => {
                  const newDate = new Date(e.target.value)
                  newDate.setHours(currentTime.getHours())
                  handleTimeChange(newDate)
                }}
                className="input-field text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">시간: {currentTime.getHours()}시</label>
              <input
                type="range"
                min="0"
                max="23"
                value={currentTime.getHours()}
                onChange={(e) => {
                  const newDate = new Date(currentTime)
                  newDate.setHours(parseInt(e.target.value))
                  handleTimeChange(newDate)
                }}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
