'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useProjectStore, SAMPLE_MODELS } from '@/store/projectStore'
import {
  analyzeBuildingLine,
  fetchZoneType,
  fetchNearbyParcels,
  expandBbox,
  type BuildingLineResult,
} from '@/lib/buildingLine'
import { ZoneType, DEFAULT_SETBACKS } from '@/lib/setbackTable'
import { isPointInPolygon as checkPointInPolygon } from '@/lib/geometry'

// Cesium 타입 정의
declare global {
  interface Window {
    CESIUM_BASE_URL: string
    Cesium: any
  }
}

// 초기 위치 상수 (컴포넌트 외부에 정의)
const DEFAULT_POSITION = {
  longitude: 127.1388, // 성남시
  latitude: 37.4449,
  height: 500,
}

/**
 * CesiumJS 기반 3D 지도 뷰어 컴포넌트
 */
export default function CesiumViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const initRef = useRef(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)  // 초기 시간을 12시(정오)로 설정
    return date
  })

  const site = useProjectStore((state) => state.site)
  const building = useProjectStore((state) => state.building)
  const modelUrl = useProjectStore((state) => state.modelUrl)
  const loadedModelEntity = useProjectStore((state) => state.loadedModelEntity)
  const modelTransform = useProjectStore((state) => state.modelTransform)
  const selectedModel = useProjectStore((state) => state.selectedModel)
  const workArea = useProjectStore((state) => state.workArea)
  const setViewer = useProjectStore((state) => state.setViewer)
  const setModelTransform = useProjectStore((state) => state.setModelTransform)
  const setSelectedModel = useProjectStore((state) => state.setSelectedModel)
  const setLoadedModelEntity = useProjectStore((state) => state.setLoadedModelEntity)
  const setWorkArea = useProjectStore((state) => state.setWorkArea)
  const setAvailableModels = useProjectStore((state) => state.setAvailableModels)
  const selectedBlockCount = useProjectStore((state) => state.selectedBlockCount)
  const setSelectedBlockCount = useProjectStore((state) => state.setSelectedBlockCount)
  const modelToLoad = useProjectStore((state) => state.modelToLoad)
  const setModelToLoad = useProjectStore((state) => state.setModelToLoad)
  const isLoadingModel = useProjectStore((state) => state.isLoadingModel)
  const setIsLoadingModel = useProjectStore((state) => state.setIsLoadingModel)
  const humanScaleModelLoaded = useProjectStore((state) => state.humanScaleModelLoaded)
  const setHumanScaleModelLoaded = useProjectStore((state) => state.setHumanScaleModelLoaded)

  // 지역 선택 모드 (지적도 데이터 로드)
  const [isSelectingRegion, setIsSelectingRegion] = useState(false)

  // 영역 선택 모드 (블록 선택) - 여러 블록 선택 지원
  const [isSelectingBlock, setIsSelectingBlock] = useState(false)
  const selectedBlockEntitiesRef = useRef<any[]>([]) // 여러 블록 선택 지원

  // 지적도 레이어
  const [showCadastral, setShowCadastral] = useState(false)
  const [hasPolylinesLoaded, setHasPolylinesLoaded] = useState(false) // 폴리라인 로드 여부
  const cadastralLayerRef = useRef<any>(null)
  const cadastralBoundaryEntitiesRef = useRef<any[]>([])
  const cadastralFeaturesRef = useRef<any[]>([]) // GeoJSON features 저장
  const selectedRegionRef = useRef<{ lon: number; lat: number } | null>(null) // 선택된 지역 좌표

  // 건축선 관련
  const [showBuildingLine, setShowBuildingLine] = useState(false)
  const [buildingLineResult, setBuildingLineResult] = useState<BuildingLineResult | null>(null)
  const [currentZoneType, setCurrentZoneType] = useState<ZoneType>('미지정')
  const buildingLineEntitiesRef = useRef<any[]>([]) // 건축선 폴리라인 엔티티
  const roadEdgeEntitiesRef = useRef<any[]>([]) // 도로 접촉 변 표시 엔티티

  // OSM 건물 관련
  const osmTilesetRef = useRef<any>(null)
  const [hiddenBuildingIds, setHiddenBuildingIds] = useState<string[]>([])
  const [selectedBuilding, setSelectedBuilding] = useState<{ id: string; name: string } | null>(null)
  const [isBuildingSelectMode, setIsBuildingSelectMode] = useState(false)

  // 샘플 모델 관련
  const availableModels = useProjectStore((state) => state.availableModels)
  const loadedSampleModelRef = useRef<any>(null)

  // 휴먼 스케일 모델 관련
  const humanModelRef = useRef<any>(null)
  const humanModelTransformRef = useRef({ longitude: 0, latitude: 0 })

  // 뷰포트 리프레시 키
  const [refreshKey, setRefreshKey] = useState(0)

  // 건물 매스 드래그 상태
  const [isDragging, setIsDragging] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const dragStartRef = useRef<any>(null)
  const buildingOffsetRef = useRef({ x: 0, y: 0, rotation: 0 })

  // 3D 모델 드래그 상태 (useRef로 즉시 반영)
  const isModelDraggingRef = useRef(false)
  const isModelRotatingRef = useRef(false)
  const modelDragStartRef = useRef<any>(null)
  const modelTransformRef = useRef(modelTransform)

  // 휴먼 모델 드래그 상태
  const isHumanDraggingRef = useRef(false)
  const humanDragStartRef = useRef<any>(null)

  // 모델이 선택 영역 내에 있는지 추적
  const [isModelInBounds, setIsModelInBounds] = useState(true)

  // 모델 바운딩 박스 크기 (미터 단위, 기본 크기)
  const modelBoundingBoxRef = useRef({ width: 10, depth: 10 })  // 가로, 세로 (미터)

  // 모델 바닥면 바운더리 폴리라인 엔티티
  const modelBoundaryEntityRef = useRef<any>(null)

  // modelTransform이 변경될 때 ref 업데이트 및 경계 체크
  useEffect(() => {
    modelTransformRef.current = modelTransform
  }, [modelTransform])

  // modelTransform 변경 시 바닥면 경계 체크 및 바운더리 폴리라인 업데이트
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return
    if (!loadedSampleModelRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    // 모델 바닥면의 네 모서리 좌표 계산
    const { longitude, latitude, rotation, scale } = modelTransform
    const halfWidth = (modelBoundingBoxRef.current.width * scale) / 2
    const halfDepth = (modelBoundingBoxRef.current.depth * scale) / 2
    const latRad = latitude * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320
    // Cesium heading은 시계방향이므로 각도를 반전
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

    // 모든 모서리가 건축선 내부에 있어야 함 (건축선이 없으면 선택 블록 기준)
    let inBounds = true

    // 건축선이 계산되어 있으면 건축선 기준으로 검사
    if (buildingLineResult?.buildingLine?.geometry?.coordinates?.[0]) {
      const buildingLineCoords = buildingLineResult.buildingLine.geometry.coordinates[0]
      for (const corner of corners) {
        if (!checkPointInPolygon(corner as [number, number], buildingLineCoords)) {
          inBounds = false
          break
        }
      }
    } else if (selectedBlockEntitiesRef.current.length > 0) {
      // 건축선이 없으면 기존 로직 (선택된 블록 기준)
      for (const corner of corners) {
        let cornerInAnyBlock = false
        for (const item of selectedBlockEntitiesRef.current) {
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

    // 바운더리 색상 결정
    const boundaryColor = inBounds ? Cesium.Color.LIME : Cesium.Color.RED

    // 바운더리 폴리라인 생성/업데이트
    const boundaryPositions = [
      ...corners.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], 0.5)),
      Cesium.Cartesian3.fromDegrees(corners[0][0], corners[0][1], 0.5) // 닫기
    ]

    if (modelBoundaryEntityRef.current) {
      // 기존 폴리라인 업데이트
      modelBoundaryEntityRef.current.polyline.positions = boundaryPositions
      modelBoundaryEntityRef.current.polyline.material = boundaryColor
    } else {
      // 새 폴리라인 생성
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
      for (const item of selectedBlockEntitiesRef.current) {
        if (item.entity?.polygon) {
          item.entity.polygon.material = areaColor.withAlpha(0.4)
        }
        if (item.entity?.polyline) {
          item.entity.polyline.material = areaColor
        }
      }
    }

    viewer.scene.requestRender()
  }, [modelTransform.longitude, modelTransform.latitude, modelTransform.rotation, modelTransform.scale, isLoaded, isModelInBounds, buildingLineResult])

  // 상태 저장 (localStorage)
  const saveViewportState = useCallback(() => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const camera = viewer.camera

    // 카메라 상태 저장
    const cameraState = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    }

    // 모델 상태 저장
    const modelState = selectedModel ? {
      modelId: selectedModel.id,
      transform: modelTransformRef.current,
    } : null

    // 시간 저장
    const timeState = {
      time: currentTime.toISOString(),
    }

    localStorage.setItem('cesium_camera_state', JSON.stringify(cameraState))
    localStorage.setItem('cesium_model_state', JSON.stringify(modelState))
    localStorage.setItem('cesium_time_state', JSON.stringify(timeState))

    console.log('뷰포트 상태 저장됨')
  }, [selectedModel, currentTime])

  // 상태 복원 함수
  const restoreViewportState = useCallback((viewer: any) => {
    const Cesium = (window as any).Cesium
    if (!Cesium || !viewer) return

    // 카메라 상태 복원
    const savedCamera = localStorage.getItem('cesium_camera_state')
    if (savedCamera) {
      try {
        const cameraState = JSON.parse(savedCamera)
        viewer.camera.setView({
          destination: new Cesium.Cartesian3(
            cameraState.position.x,
            cameraState.position.y,
            cameraState.position.z
          ),
          orientation: {
            heading: cameraState.heading,
            pitch: cameraState.pitch,
            roll: cameraState.roll,
          },
        })
        console.log('카메라 상태 복원됨')
      } catch (e) {
        console.warn('카메라 상태 복원 실패:', e)
      }
    }

    // 시간 상태 복원
    const savedTime = localStorage.getItem('cesium_time_state')
    if (savedTime) {
      try {
        const timeState = JSON.parse(savedTime)
        const restoredTime = new Date(timeState.time)
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(restoredTime)
        setCurrentTime(restoredTime)
        console.log('시간 상태 복원됨')
      } catch (e) {
        console.warn('시간 상태 복원 실패:', e)
      }
    }

    // 모델 상태 복원
    const savedModel = localStorage.getItem('cesium_model_state')
    if (savedModel) {
      try {
        const modelState = JSON.parse(savedModel)
        if (modelState && modelState.modelId) {
          const model = SAMPLE_MODELS.find(m => m.id === modelState.modelId)
          if (model) {
            const transform = modelState.transform

            // 모델 로드
            const position = Cesium.Cartesian3.fromDegrees(
              transform.longitude,
              transform.latitude,
              transform.height
            )

            const heading = Cesium.Math.toRadians(transform.rotation)
            const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
            const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)

            const entity = viewer.entities.add({
              id: 'loaded-3d-model',
              name: model.name,
              position: position,
              orientation: orientation,
              model: {
                uri: model.url,
                scale: 5.0,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              },
            })

            setSelectedModel(model)
            setLoadedModelEntity(entity)
            setModelTransform(transform)

            console.log('모델 상태 복원됨:', model.name)
          }
        }
      } catch (e) {
        console.warn('모델 상태 복원 실패:', e)
      }
    }

    viewer.scene.requestRender()
  }, [setSelectedModel, setLoadedModelEntity, setModelTransform])

  // 뷰포트 새로고침
  const handleRefreshViewport = useCallback(() => {
    saveViewportState()

    // 기존 뷰어 정리
    if (viewerRef.current) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }
    initRef.current = false
    setIsLoaded(false)

    // 리렌더링 트리거
    setRefreshKey(prev => prev + 1)
  }, [saveViewportState])

  // 페이지 새로고침/닫기 시 상태 저장
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveViewportState()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [saveViewportState])

  // 역지오코딩 (좌표 → 주소)
  const reverseGeocode = useCallback(async (lon: number, lat: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'ko' } }
      )
      const data = await response.json()

      if (data && data.address) {
        const addr = data.address
        // 한국 주소 형식으로 조합
        const parts = []
        if (addr.city || addr.town || addr.village) {
          parts.push(addr.city || addr.town || addr.village)
        }
        if (addr.suburb || addr.neighbourhood || addr.quarter) {
          parts.push(addr.suburb || addr.neighbourhood || addr.quarter)
        }
        if (addr.road) {
          parts.push(addr.road)
        }

        return {
          address: parts.join(' ') || data.display_name,
          displayName: data.display_name,
        }
      }
      return null
    } catch (error) {
      console.error('역지오코딩 실패:', error)
      return null
    }
  }, [])

  // 지역 선택 모드 토글
  const toggleRegionSelection = useCallback(() => {
    setIsSelectingRegion(prev => !prev)
    setIsSelectingBlock(false) // 다른 선택 모드 끄기
  }, [])

  // 선택된 블록들 모두 제거
  const clearSelectedBlocks = useCallback(() => {
    if (!viewerRef.current) return

    selectedBlockEntitiesRef.current.forEach((item) => {
      viewerRef.current.entities.remove(item.entity)
    })
    selectedBlockEntitiesRef.current = []
    setSelectedBlockCount(0)
    setIsModelInBounds(true)

    // 바운더리 폴리라인도 제거
    if (modelBoundaryEntityRef.current) {
      viewerRef.current.entities.remove(modelBoundaryEntityRef.current)
      modelBoundaryEntityRef.current = null
    }

    viewerRef.current.scene.requestRender()
  }, [])

  // 건축선 엔티티들 제거
  const clearBuildingLineEntities = useCallback(() => {
    if (!viewerRef.current) return

    buildingLineEntitiesRef.current.forEach((entity) => {
      viewerRef.current.entities.remove(entity)
    })
    buildingLineEntitiesRef.current = []

    roadEdgeEntitiesRef.current.forEach((entity) => {
      viewerRef.current.entities.remove(entity)
    })
    roadEdgeEntitiesRef.current = []

    viewerRef.current.scene.requestRender()
  }, [])

  // 건축선 계산 및 표시
  const calculateAndShowBuildingLine = useCallback(async () => {
    if (!viewerRef.current) return
    if (selectedBlockEntitiesRef.current.length === 0) {
      console.log('선택된 블록이 없습니다')
      return
    }

    const Cesium = (window as any).Cesium
    const viewer = viewerRef.current

    // 기존 건축선 제거
    clearBuildingLineEntities()

    try {
      // 첫 번째 선택된 블록을 대상으로 건축선 계산
      const selectedBlock = selectedBlockEntitiesRef.current[0]
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
      const bbox = expandBbox(cadastralPolygon as any, 30) // 30m 버퍼
      const nearbyParcels = await fetchNearbyParcels(bbox)
      console.log('주변 필지 수:', nearbyParcels.length)

      // 건축선 분석
      const result = await analyzeBuildingLine(
        cadastralPolygon as any,
        nearbyParcels as any,
        zoneType,
        '기타',  // 건축물 용도 (기본값)
        4        // 도로폭 (기본 4m 이상)
      )

      setBuildingLineResult(result)
      console.log('건축선 분석 결과:', {
        도로접촉변: result.roadEdges.length,
        인접대지변: result.adjacentLotEdges.length,
        용도지역: result.zoneType,
      })

      // 건축선 폴리라인 표시 (빨간색) - clampToGround로 지형 위에 표시
      if (result.buildingLine && result.buildingLine.geometry) {
        const buildingLineCoords = result.buildingLine.geometry.coordinates[0]
        const positions = buildingLineCoords.flatMap((c: number[]) => [c[0], c[1]])

        const buildingLineEntity = viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(positions),
            width: 5,
            material: Cesium.Color.RED,
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,  // 지형 위에만 표시 (건물 제외)
            zIndex: 10,  // 다른 폴리라인보다 위에 표시
          },
        })
        buildingLineEntitiesRef.current.push(buildingLineEntity)
      }

      // 도로 접촉 변 표시 (주황색) - clampToGround로 지형 위에 표시
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
            classificationType: Cesium.ClassificationType.TERRAIN,  // 지형 위에만 표시
            zIndex: 8,  // 건축선보다 약간 낮게
          },
        })
        roadEdgeEntitiesRef.current.push(roadEdgeEntity)
      })

      // 인접 대지 변 표시 (노란색) - clampToGround로 지형 위에 표시
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
            classificationType: Cesium.ClassificationType.TERRAIN,  // 지형 위에만 표시
            zIndex: 6,  // 도로변보다 낮게
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
  }, [clearBuildingLineEntities])

  // 건축선 토글
  const toggleBuildingLine = useCallback(() => {
    if (showBuildingLine) {
      clearBuildingLineEntities()
      setShowBuildingLine(false)
      setBuildingLineResult(null)
    } else {
      calculateAndShowBuildingLine()
    }
  }, [showBuildingLine, clearBuildingLineEntities, calculateAndShowBuildingLine])

  // 모델 바닥면의 네 모서리 좌표 계산
  const getModelFootprintCorners = useCallback((lon: number, lat: number, rotation: number, scale: number) => {
    // 바운딩 박스 크기 (미터) * 스케일
    const halfWidth = (modelBoundingBoxRef.current.width * scale) / 2
    const halfDepth = (modelBoundingBoxRef.current.depth * scale) / 2

    // 위도 기준 미터 → 경도/위도 변환 계수
    const latRad = lat * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320

    // 회전 각도 (라디안) - Cesium heading은 시계방향이므로 각도를 반전
    const rotRad = -rotation * Math.PI / 180
    const cos = Math.cos(rotRad)
    const sin = Math.sin(rotRad)

    // 로컬 좌표에서 네 모서리 (중심 기준)
    const localCorners = [
      { x: -halfWidth, y: -halfDepth },  // 좌하단
      { x: halfWidth, y: -halfDepth },   // 우하단
      { x: halfWidth, y: halfDepth },    // 우상단
      { x: -halfWidth, y: halfDepth },   // 좌상단
    ]

    // 회전 적용 후 경도/위도로 변환
    return localCorners.map(corner => {
      // 회전 적용
      const rotatedX = corner.x * cos - corner.y * sin
      const rotatedY = corner.x * sin + corner.y * cos

      // 미터 → 경도/위도 변환
      const cornerLon = lon + (rotatedX / metersPerDegLon)
      const cornerLat = lat + (rotatedY / metersPerDegLat)

      return [cornerLon, cornerLat]
    })
  }, [])

  // 모델 바닥면이 건축선 내에 완전히 있는지 확인 (건축선 없으면 선택 블록 기준)
  const checkModelInBounds = useCallback((lon: number, lat: number, rotation: number, scale: number) => {
    // 모델 바닥면의 네 모서리 좌표 계산
    const corners = getModelFootprintCorners(lon, lat, rotation, scale)

    // 건축선이 계산되어 있으면 건축선 기준으로 검사
    if (buildingLineResult?.buildingLine?.geometry?.coordinates?.[0]) {
      const buildingLineCoords = buildingLineResult.buildingLine.geometry.coordinates[0]
      for (const corner of corners) {
        if (!checkPointInPolygon(corner as [number, number], buildingLineCoords)) {
          return false
        }
      }
      return true
    }

    // 건축선이 없으면 기존 로직 (선택된 블록 기준)
    if (selectedBlockEntitiesRef.current.length === 0) return true

    for (const corner of corners) {
      let cornerInAnyBlock = false
      for (const item of selectedBlockEntitiesRef.current) {
        const coords = item.feature?.geometry?.coordinates?.[0]
        if (coords && checkPointInPolygon(corner as [number, number], coords)) {
          cornerInAnyBlock = true
          break
        }
      }
      // 하나라도 밖에 있으면 false
      if (!cornerInAnyBlock) {
        return false
      }
    }
    return true
  }, [getModelFootprintCorners, buildingLineResult])

  // 선택된 블록들의 색상 업데이트
  const updateBlocksColor = useCallback((inBounds: boolean) => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const color = inBounds ? Cesium.Color.CYAN : Cesium.Color.RED

    for (const item of selectedBlockEntitiesRef.current) {
      if (item.entity?.polygon) {
        item.entity.polygon.material = color.withAlpha(0.4)
      }
      if (item.entity?.polyline) {
        item.entity.polyline.material = color
      }
    }

    viewerRef.current.scene.requestRender()
  }, [])

  // 샘플 모델 목록 가져오기
  const fetchAvailableModels = useCallback(async () => {
    try {
      const response = await fetch('/api/models')
      if (response.ok) {
        const data = await response.json()
        setAvailableModels(data.models || [])
      }
    } catch (error) {
      console.error('모델 목록 가져오기 실패:', error)
    }
  }, [])

  // 샘플 모델 목록 가져오기 (컴포넌트 마운트 시)
  useEffect(() => {
    fetchAvailableModels()
  }, [fetchAvailableModels])

  // 선택된 블록 중심 좌표 계산
  const getSelectedBlocksCenter = useCallback(() => {
    if (selectedBlockEntitiesRef.current.length === 0) return null

    let totalLon = 0
    let totalLat = 0
    let count = 0

    for (const item of selectedBlockEntitiesRef.current) {
      const coords = item.feature?.geometry?.coordinates?.[0]
      if (coords) {
        for (const coord of coords) {
          if (Array.isArray(coord) && coord.length >= 2) {
            totalLon += coord[0]
            totalLat += coord[1]
            count++
          }
        }
      }
    }

    if (count === 0) return null

    return {
      lon: totalLon / count,
      lat: totalLat / count
    }
  }, [])

  // 샘플 모델 로드
  const loadSampleModel = useCallback(async (filename: string) => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    // 선택된 블록이 없으면 경고
    if (selectedBlockEntitiesRef.current.length === 0) {
      alert('먼저 영역을 선택해주세요')
      return
    }

    setIsLoadingModel(true)

    try {
      // 기존 샘플 모델 제거 (ref와 ID 둘 다 확인)
      if (loadedSampleModelRef.current) {
        viewerRef.current.entities.remove(loadedSampleModelRef.current)
        loadedSampleModelRef.current = null
      }
      const existingModel = viewerRef.current.entities.getById('loaded-3d-model')
      if (existingModel) {
        viewerRef.current.entities.remove(existingModel)
      }

      // 기존 바운더리 폴리라인 제거
      if (modelBoundaryEntityRef.current) {
        viewerRef.current.entities.remove(modelBoundaryEntityRef.current)
        modelBoundaryEntityRef.current = null
      }
      const existingBoundary = viewerRef.current.entities.getById('model-boundary')
      if (existingBoundary) {
        viewerRef.current.entities.remove(existingBoundary)
      }

      // 경계 상태 초기화
      setIsModelInBounds(true)

      // 선택된 블록 중심 좌표 계산
      const center = getSelectedBlocksCenter()
      if (!center) {
        alert('블록 좌표를 계산할 수 없습니다')
        setIsLoadingModel(false)
        return
      }

      console.log('모델 로드 위치:', center)

      // 해당 모델의 바운딩 박스 정보 가져오기
      const modelInfo = availableModels.find(m => m.filename === filename)
      if (modelInfo?.boundingBox) {
        // GLB 모델은 Y-up이므로 width=X, depth=Z (바닥면 기준)
        modelBoundingBoxRef.current = {
          width: modelInfo.boundingBox.width,
          depth: modelInfo.boundingBox.depth,
        }
        console.log('모델 바운딩 박스 설정:', modelBoundingBoxRef.current)
      }

      // 모델 변환 정보 초기화 (Sidebar 슬라이더용)
      const initialHeight = 0
      const initialRotation = 0
      const initialScale = 10.0  // 기본 스케일
      setModelTransform({
        longitude: center.lon,
        latitude: center.lat,
        height: initialHeight,
        rotation: initialRotation,
        scale: initialScale,
      })

      // 초기 위치 및 회전 설정
      const position = Cesium.Cartesian3.fromDegrees(center.lon, center.lat, initialHeight)
      const heading = Cesium.Math.toRadians(initialRotation)
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr)

      // 모델 로드 - RELATIVE_TO_GROUND로 높이 조절 가능하게
      const modelEntity = viewerRef.current.entities.add({
        id: 'loaded-3d-model',
        name: filename,
        position: position,
        orientation: orientation,
        model: {
          uri: `/api/models/${encodeURIComponent(filename)}`,
          scale: initialScale,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        }
      })

      loadedSampleModelRef.current = modelEntity
      setLoadedModelEntity(modelEntity)

      viewerRef.current.scene.requestRender()
      console.log('샘플 모델 로드 완료:', filename)
    } catch (error) {
      console.error('모델 로드 실패:', error)
      alert('모델 로드에 실패했습니다')
    } finally {
      setIsLoadingModel(false)
    }
  }, [getSelectedBlocksCenter, setLoadedModelEntity, setModelTransform, availableModels])

  // 스토어의 modelToLoad 변경 감지하여 모델 로드 (Sidebar에서 트리거)
  useEffect(() => {
    if (modelToLoad && isLoaded && !isLoadingModel) {
      loadSampleModel(modelToLoad)
      setModelToLoad(null) // 로드 후 초기화
    }
  }, [modelToLoad, isLoaded, isLoadingModel, loadSampleModel, setModelToLoad])

  // 휴먼 스케일 모델 로드/제거
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
        console.log('휴먼 모델 배치할 위치 없음')
        setHumanScaleModelLoaded(false)
        return
      }

      // 건물 모델에서 약간 떨어진 위치에 배치
      const humanLon = center.lon + 0.00005  // 약 5m 옆
      const humanLat = center.lat

      humanModelTransformRef.current = { longitude: humanLon, latitude: humanLat }

      // 휴먼 모델 로드 (원본 2m → 스케일 0.9로 180cm)
      // 모델 원점 위치에 따라 높이 오프셋 조정
      const humanHeight = 0.9  // 원점이 모델 중심에 있으면 반높이(0.9m) 올림
      const humanEntity = viewer.entities.add({
        id: 'human-scale-model',
        name: '휴먼 스케일 (180cm)',
        position: Cesium.Cartesian3.fromDegrees(humanLon, humanLat, humanHeight),
        model: {
          uri: '/api/models/Meshy_AI_man_0315144539_texture.glb',
          scale: 0.9,  // 원본 2m × 0.9 = 180cm
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        }
      })

      humanModelRef.current = humanEntity
      viewer.scene.requestRender()
      console.log('휴먼 스케일 모델 로드 완료')
    } else {
      // 휴먼 모델 제거
      if (humanModelRef.current) {
        viewer.entities.remove(humanModelRef.current)
        humanModelRef.current = null
        viewer.scene.requestRender()
        console.log('휴먼 스케일 모델 제거')
      }
    }
  }, [humanScaleModelLoaded, isLoaded, getSelectedBlocksCenter, setHumanScaleModelLoaded])

  // 영역 선택 모드 토글 (블록 선택) - ON/OFF 토글
  const toggleBlockSelection = useCallback(() => {
    setIsSelectingBlock(prev => !prev)
    setIsSelectingRegion(false) // 다른 선택 모드 끄기
  }, [])

  // WFS로 대지경계선 벡터 데이터 로드 및 폴리라인 그리기
  const loadCadastralBoundaries = useCallback(async (lon: number, lat: number) => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    // 기존 경계선 엔티티 제거
    cadastralBoundaryEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity)
    })
    cadastralBoundaryEntitiesRef.current = []

    // 기존 선택 블록들 제거
    selectedBlockEntitiesRef.current.forEach((item) => {
      viewer.entities.remove(item.entity)
    })
    selectedBlockEntitiesRef.current = []

    // 선택된 지역 좌표 저장 (WMS 로드용)
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

      // GeoJSON features 저장 (블록 선택용)
      cadastralFeaturesRef.current = data.features

      // 각 폴리곤의 경계를 폴리라인으로 그리기 (clampToGround 사용)
      let polylineCount = 0

      for (const feature of data.features) {
        if (feature.geometry && feature.geometry.type === 'Polygon') {
          const rings = feature.geometry.coordinates

          for (const ring of rings) {
            // 첫 번째 폴리라인의 좌표 디버그 출력
            if (polylineCount === 0) {
              console.log('첫 번째 폴리라인 좌표 (원본):', ring.slice(0, 3))
            }

            // 좌표를 Cartesian3 배열로 변환 (높이 없이 - clampToGround 사용)
            const positions = ring.map((coord: number[]) =>
              Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
            )

            // 폴리라인 엔티티 생성 (지형에 붙이기)
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
      setSelectedBlockCount(0)
      console.log('대지경계선 그리기 완료:', polylineCount, '개 폴리라인')
      console.log('총 엔티티 수:', viewer.entities.values.length)
    } catch (error) {
      console.error('WFS 데이터 로드 실패:', error)
    }
  }, [])

  // 지적도 토글
  const toggleCadastral = useCallback(() => {
    if (showCadastral) {
      // 지적도 WMS 타일 끄기
      if (cadastralLayerRef.current && viewerRef.current) {
        viewerRef.current.imageryLayers.remove(cadastralLayerRef.current)
        cadastralLayerRef.current = null
        viewerRef.current.scene.requestRender()
      }
      setShowCadastral(false)
    } else {
      // 지적도 WMS 타일 켜기 - 선택된 지역 좌표 사용
      if (!viewerRef.current) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      // 선택된 지역이 없으면 경고
      if (!selectedRegionRef.current) {
        console.log('먼저 지역을 선택해주세요')
        return
      }

      const { lon, lat } = selectedRegionRef.current

      // 기존 레이어 제거
      if (cadastralLayerRef.current) {
        viewerRef.current.imageryLayers.remove(cadastralLayerRef.current)
        cadastralLayerRef.current = null
      }

      // 지적도 WMS 타일 로드
      const offset = 0.002 // 약 200m
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

        cadastralLayerRef.current = viewerRef.current.imageryLayers.addImageryProvider(cadastralProvider)
        cadastralLayerRef.current.alpha = 0.85
        setShowCadastral(true)
        console.log('지적도 WMS 타일 로드됨:', { lon, lat })

        viewerRef.current.scene.requestRender()
      } catch (error) {
        console.error('지적도 로드 실패:', error)
      }
    }
  }, [showCadastral])

  // 지적도 레이어 제거
  const removeCadastralLayer = useCallback(() => {
    if (!viewerRef.current) return

    // 이미지 레이어 제거
    if (cadastralLayerRef.current) {
      viewerRef.current.imageryLayers.remove(cadastralLayerRef.current)
      cadastralLayerRef.current = null
    }

    // 경계선 엔티티 제거
    cadastralBoundaryEntitiesRef.current.forEach((entity) => {
      viewerRef.current.entities.remove(entity)
    })
    cadastralBoundaryEntitiesRef.current = []

    // 선택된 블록들 제거
    selectedBlockEntitiesRef.current.forEach((item) => {
      viewerRef.current.entities.remove(item.entity)
    })
    selectedBlockEntitiesRef.current = []

    // features 및 지역 좌표 초기화
    cadastralFeaturesRef.current = []
    selectedRegionRef.current = null

    setShowCadastral(false)
    setHasPolylinesLoaded(false)
    setSelectedBlockCount(0)
    viewerRef.current.scene.requestRender()
    console.log('지적도 제거됨')
  }, [])

  // 선택 영역 주변 지적도 로드
  const loadCadastralForArea = useCallback((lon: number, lat: number) => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    // 기존 지적도 레이어 제거
    if (cadastralLayerRef.current) {
      viewer.imageryLayers.remove(cadastralLayerRef.current)
      cadastralLayerRef.current = null
    }

    // 선택 영역 주변 약 200m 범위의 바운딩 박스 계산
    const offset = 0.002 // 약 200m
    const west = lon - offset
    const south = lat - offset
    const east = lon + offset
    const north = lat + offset

    try {
      // WMS 타일 로딩 비활성화 - 벡터 폴리라인 디버깅을 위해 주석 처리
      // const cadastralProvider = new Cesium.SingleTileImageryProvider({
      //   url: `/api/cadastral?bbox=${west},${south},${east},${north}&width=1024&height=1024`,
      //   rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
      //   tileWidth: 1024,
      //   tileHeight: 1024,
      //   credit: 'Vworld 지적도',
      // })
      // cadastralLayerRef.current = viewer.imageryLayers.addImageryProvider(cadastralProvider)
      // cadastralLayerRef.current.alpha = 0.85

      // 벡터 폴리라인만 로드 (WMS 지적도는 별도 버튼으로)
      console.log('벡터 폴리라인만 로드:', { west, south, east, north })

      // 대지경계선 벡터 데이터 로드
      loadCadastralBoundaries(lon, lat)

      viewer.scene.requestRender()
    } catch (error) {
      console.error('지적도 로드 실패:', error)
    }
  }, [loadCadastralBoundaries])

  // 영역 선택 클릭 핸들러
  useEffect(() => {
    if (!viewerRef.current || !isLoaded || !isSelectingRegion) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction(async (click: any) => {
      // 지형을 고려한 정확한 위치 선택
      let cartesian = viewer.scene.pickPosition(click.position)

      // pickPosition 실패 시 globe.pick 사용
      if (!cartesian || !Cesium.defined(cartesian)) {
        const ray = viewer.camera.getPickRay(click.position)
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene)
        }
      }

      if (!cartesian) return

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(cartographic.longitude)
      const lat = Cesium.Math.toDegrees(cartographic.latitude)

      // 역지오코딩으로 주소 가져오기
      const geoResult = await reverseGeocode(lon, lat)

      setWorkArea({
        longitude: lon,
        latitude: lat,
        address: geoResult?.address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
        displayName: geoResult?.displayName || '',
      })

      // 선택 영역 주변 지적도 로드
      loadCadastralForArea(lon, lat)

      // 선택 모드 해제
      setIsSelectingRegion(false)

      // 해당 위치로 카메라 이동 (탑뷰)
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 200),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 1.5,
      })

      viewer.scene.requestRender()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      handler.destroy()
    }
  }, [isLoaded, isSelectingRegion, reverseGeocode, setWorkArea, loadCadastralForArea])

  // 블록 선택 클릭 핸들러
  useEffect(() => {
    if (!viewerRef.current || !isLoaded || !isSelectingBlock) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((click: any) => {
      // 클릭 위치 가져오기
      let cartesian = viewer.scene.pickPosition(click.position)

      if (!cartesian || !Cesium.defined(cartesian)) {
        const ray = viewer.camera.getPickRay(click.position)
        if (ray) {
          cartesian = viewer.scene.globe.pick(ray, viewer.scene)
        }
      }

      if (!cartesian) return

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      const lon = Cesium.Math.toDegrees(cartographic.longitude)
      const lat = Cesium.Math.toDegrees(cartographic.latitude)

      console.log('블록 선택 클릭:', lon, lat)

      // features 데이터 확인
      if (!cadastralFeaturesRef.current || cadastralFeaturesRef.current.length === 0) {
        console.log('지적 데이터가 없습니다')
        return
      }

      // 클릭한 위치가 어느 폴리곤에 속하는지 확인
      let selectedFeature = null
      for (const feature of cadastralFeaturesRef.current) {
        if (feature.geometry && feature.geometry.type === 'Polygon') {
          const rings = feature.geometry.coordinates
          // 첫 번째 링(외곽)으로 확인
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
        const existingIndex = selectedBlockEntitiesRef.current.findIndex(
          (item: any) => item.pnu === featurePnu
        )

        if (existingIndex !== -1) {
          // 이미 선택된 블록이면 제거 (토글)
          const existing = selectedBlockEntitiesRef.current[existingIndex]
          viewer.entities.remove(existing.entity)
          selectedBlockEntitiesRef.current.splice(existingIndex, 1)
          setSelectedBlockCount(selectedBlockEntitiesRef.current.length)
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

        // 폴리곤이 닫혀있는지 확인 (첫 점과 마지막 점이 같거나 가까운지)
        const first = validCoords[0]
        const last = validCoords[validCoords.length - 1]
        const isClosed = Math.abs(first[0] - last[0]) < 0.0001 && Math.abs(first[1] - last[1]) < 0.0001

        if (!isClosed) {
          // 닫혀있지 않으면 첫 점을 마지막에 추가
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

        // 약 500m 이상의 범위를 가진 폴리곤은 비정상으로 간주
        if (lonRange > 0.01 || latRange > 0.01) {
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
            material: Cesium.Color.CYAN.withAlpha(0.3),  // 투명도 낮춤
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
          polyline: {
            positions: positions,
            width: 2,  // 선 두께 줄임
            material: Cesium.Color.CYAN.withAlpha(0.7),
            clampToGround: true,
            classificationType: Cesium.ClassificationType.TERRAIN,  // 지형 위에만 표시
            zIndex: 1,  // 가장 낮은 우선순위
          }
        })

        // 배열에 추가 (PNU와 entity를 함께 저장)
        selectedBlockEntitiesRef.current.push({
          pnu: featurePnu,
          entity: blockEntity,
          feature: selectedFeature
        })

        setSelectedBlockCount(selectedBlockEntitiesRef.current.length)
        viewer.scene.requestRender()
        console.log('블록 선택 완료, 총', selectedBlockEntitiesRef.current.length, '개 블록')
      } else {
        console.log('선택된 블록 없음')
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      handler.destroy()
    }
  }, [isLoaded, isSelectingBlock])

  // 작업 영역 해제 시 시각적 표시 및 지적도 제거
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    if (!workArea) {
      // 지적도 레이어 제거
      removeCadastralLayer()
    }
  }, [workArea, isLoaded, removeCadastralLayer])

  // 페이지 로드 시 저장된 상태 확인 (첫 로드 시에도 복원)
  useEffect(() => {
    if (isLoaded && viewerRef.current && refreshKey === 0) {
      const savedModel = localStorage.getItem('cesium_model_state')
      if (savedModel) {
        try {
          const modelState = JSON.parse(savedModel)
          if (modelState && modelState.modelId) {
            // 저장된 상태가 있으면 복원
            setTimeout(() => {
              restoreViewportState(viewerRef.current)
            }, 500)
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }, [isLoaded, refreshKey, restoreViewportState])

  // Cesium 초기화 (한 번만 실행)
  useEffect(() => {
    if (!containerRef.current || initRef.current) return
    initRef.current = true

    const initCesium = async () => {
      const Cesium = await import('cesium')

      // Cesium을 window에 저장 (다른 컴포넌트에서 접근 가능하도록)
      ;(window as any).Cesium = Cesium

      // Cesium Ion 토큰 설정
      const token = process.env.NEXT_PUBLIC_CESIUM_TOKEN
      if (token) {
        Cesium.Ion.defaultAccessToken = token
      }

      window.CESIUM_BASE_URL = '/cesium'

      // 이미지 레이어 프로바이더 목록 생성
      const imageryProviderViewModels = [
        new Cesium.ProviderViewModel({
          name: 'Google 로드맵',
          iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/openStreetMap.png'),
          tooltip: 'Google Maps 로드맵',
          creationFunction: () => {
            return new Cesium.UrlTemplateImageryProvider({
              url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
              maximumLevel: 20,
              credit: new Cesium.Credit('Google Maps'),
            })
          }
        }),
        new Cesium.ProviderViewModel({
          name: 'Google 위성',
          iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/bingAerialLabels.png'),
          tooltip: 'Google Maps 위성',
          creationFunction: () => {
            return new Cesium.UrlTemplateImageryProvider({
              url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
              maximumLevel: 20,
              credit: new Cesium.Credit('Google Maps'),
            })
          }
        }),
        new Cesium.ProviderViewModel({
          name: 'Google 하이브리드',
          iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/bingAerial.png'),
          tooltip: 'Google Maps 위성 + 라벨',
          creationFunction: () => {
            return new Cesium.UrlTemplateImageryProvider({
              url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
              maximumLevel: 20,
              credit: new Cesium.Credit('Google Maps'),
            })
          }
        }),
        new Cesium.ProviderViewModel({
          name: 'OpenStreetMap',
          iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/openStreetMap.png'),
          tooltip: 'OpenStreetMap',
          creationFunction: () => {
            return new Cesium.OpenStreetMapImageryProvider({
              url: 'https://a.tile.openstreetmap.org/'
            })
          }
        }),
      ]

      // Viewer 생성
      const viewer = new Cesium.Viewer(containerRef.current!, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        imageryProviderViewModels: imageryProviderViewModels,
        selectedImageryProviderViewModel: imageryProviderViewModels[0], // 기본: Google 로드맵
        baseLayerPicker: true,
        geocoder: true,
        homeButton: true,
        sceneModePicker: true,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: true,
        shadows: true,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      })

      // 시계 애니메이션 중지
      viewer.clock.shouldAnimate = false
      viewer.clock.canAnimate = false

      // 초기 시간을 정오(12시)로 설정
      const now = new Date()
      now.setHours(12, 0, 0, 0)
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(now)

      // 그림자 설정
      viewer.shadowMap.maximumDistance = 1000.0
      viewer.shadowMap.softShadows = true

      // 카메라 컨트롤 설정 변경
      const controller = viewer.scene.screenSpaceCameraController
      // 좌클릭: 회전(기본 orbit), 우클릭: 틸트(시점 조정), 휠: 줌
      controller.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG
      controller.tiltEventTypes = Cesium.CameraEventType.RIGHT_DRAG
      controller.zoomEventTypes = [
        Cesium.CameraEventType.WHEEL,
        Cesium.CameraEventType.PINCH
      ]
      controller.lookEventTypes = undefined

      // 초기 카메라 위치 (즉시 설정)
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          DEFAULT_POSITION.longitude,
          DEFAULT_POSITION.latitude,
          DEFAULT_POSITION.height
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
      })

      // OSM Buildings
      try {
        const osmBuildingsTileset = await Cesium.createOsmBuildingsAsync()
        // 밝은 회색으로 설정 (숨길 건물은 동적으로 관리)
        osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
          show: "true",
          color: "color('#D3D3D3')"
        })
        // 원본 텍스처 대신 지정 색상으로 완전 대체
        osmBuildingsTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE
        viewer.scene.primitives.add(osmBuildingsTileset)
        osmTilesetRef.current = osmBuildingsTileset
      } catch (e) {
        console.warn('OSM Buildings 로드 실패:', e)
      }

      viewerRef.current = viewer
      setViewer(viewer)
      setIsLoaded(true)
      console.log('Cesium Viewer 초기화 완료')

      // 저장된 상태 복원 (새로고침 시)
      if (refreshKey > 0) {
        setTimeout(() => {
          restoreViewportState(viewer)
        }, 500) // OSM Buildings 로드 후 복원
      }
    }

    initCesium()

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [refreshKey, restoreViewportState, setViewer])

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
  }, [hiddenBuildingIds, isLoaded])

  // 건물 선택 모드 클릭 핸들러
  useEffect(() => {
    if (!viewerRef.current || !isLoaded || !isBuildingSelectMode) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
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
  }, [isLoaded, isBuildingSelectMode])

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

  // 대지 폴리곤 표시
  useEffect(() => {
    if (!viewerRef.current || !site?.footprint || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    const existingSite = viewer.entities.getById('site-boundary')
    if (existingSite) {
      viewer.entities.remove(existingSite)
    }

    const positions = site.footprint.flatMap((coord: number[]) => [coord[0], coord[1]])

    viewer.entities.add({
      id: 'site-boundary',
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

    if (site.centroid) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          site.centroid[0],
          site.centroid[1],
          300
        ),
        duration: 1.5,
      })
    }
  }, [site, isLoaded])

  // 건물 매스 업데이트 함수
  const updateBuildingMass = (offsetX: number, offsetY: number, rotationDeg: number) => {
    if (!viewerRef.current || !building || !site?.footprint) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current

    // 기존 건물 제거
    const existing = viewer.entities.getById('building-mass')
    if (existing) viewer.entities.remove(existing)

    const footprint = building.footprint || site.footprint
    const buildingHeight = building.height || 30
    const centroid = site.centroid || [127.1388, 37.4449]

    // 좌표 변환 계수
    const latRad = centroid[1] * Math.PI / 180
    const metersPerDegLon = 111320 * Math.cos(latRad)
    const metersPerDegLat = 111320

    // 회전 함수
    const rotatePoint = (lon: number, lat: number, angle: number, cLon: number, cLat: number) => {
      const rad = angle * Math.PI / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dLon = lon - cLon
      const dLat = lat - cLat
      return [
        cos * dLon - sin * dLat + cLon,
        sin * dLon + cos * dLat + cLat
      ]
    }

    // 이동된 중심점
    const newCenterLon = centroid[0] + (offsetX / metersPerDegLon)
    const newCenterLat = centroid[1] + (offsetY / metersPerDegLat)

    // footprint 변환
    const transformedFootprint = footprint.map((coord: number[]) => {
      // 이동
      const movedLon = coord[0] + (offsetX / metersPerDegLon)
      const movedLat = coord[1] + (offsetY / metersPerDegLat)
      // 회전
      return rotatePoint(movedLon, movedLat, rotationDeg, newCenterLon, newCenterLat)
    })

    const positions = transformedFootprint.flatMap((c: number[]) => [c[0], c[1]])

    viewer.entities.add({
      id: 'building-mass',
      name: '건물 매스',
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
        height: 0,
        extrudedHeight: buildingHeight,
        material: Cesium.Color.CORNFLOWERBLUE.withAlpha(0.8),
        outline: true,
        outlineColor: Cesium.Color.WHITE,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      },
    })
  }

  // 건물 매스 표시
  useEffect(() => {
    if (!viewerRef.current || !building || !isLoaded) return
    updateBuildingMass(0, 0, 0)
    buildingOffsetRef.current = { x: 0, y: 0, rotation: 0 }
    console.log('건물 매스 추가')
  }, [building, site, isLoaded])

  // 마우스 드래그로 건물 이동/회전
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    // 마우스 왼쪽 버튼 누름 - 이동 시작
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (Cesium.defined(pickedObject) && pickedObject.id?.id === 'building-mass') {
        setIsDragging(true)
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false

        const cartesian = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid)
        if (cartesian) {
          dragStartRef.current = Cesium.Cartographic.fromCartesian(cartesian)
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    // 마우스 오른쪽 버튼 누름 - 회전 시작
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (Cesium.defined(pickedObject) && pickedObject.id?.id === 'building-mass') {
        setIsRotating(true)
        viewer.scene.screenSpaceCameraController.enableRotate = false

        dragStartRef.current = click.position.x
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_DOWN)

    // 마우스 이동
    handler.setInputAction((movement: any) => {
      if (isDragging && site?.centroid) {
        const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid)
        if (cartesian && dragStartRef.current) {
          const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
          const startPos = dragStartRef.current

          const latRad = site.centroid[1] * Math.PI / 180
          const metersPerDegLon = 111320 * Math.cos(latRad)
          const metersPerDegLat = 111320

          const deltaLon = Cesium.Math.toDegrees(currentPos.longitude - startPos.longitude)
          const deltaLat = Cesium.Math.toDegrees(currentPos.latitude - startPos.latitude)

          const deltaX = deltaLon * metersPerDegLon
          const deltaY = deltaLat * metersPerDegLat

          const newOffsetX = buildingOffsetRef.current.x + deltaX
          const newOffsetY = buildingOffsetRef.current.y + deltaY

          updateBuildingMass(newOffsetX, newOffsetY, buildingOffsetRef.current.rotation)

          dragStartRef.current = currentPos
          buildingOffsetRef.current.x = newOffsetX
          buildingOffsetRef.current.y = newOffsetY
        }
      }

      if (isRotating) {
        const deltaX = movement.endPosition.x - dragStartRef.current
        const newRotation = buildingOffsetRef.current.rotation + deltaX * 0.5

        updateBuildingMass(buildingOffsetRef.current.x, buildingOffsetRef.current.y, newRotation)

        dragStartRef.current = movement.endPosition.x
        buildingOffsetRef.current.rotation = newRotation
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 마우스 버튼 뗌
    handler.setInputAction(() => {
      setIsDragging(false)
      viewer.scene.screenSpaceCameraController.enableRotate = true
      viewer.scene.screenSpaceCameraController.enableTranslate = true
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    handler.setInputAction(() => {
      setIsRotating(false)
      viewer.scene.screenSpaceCameraController.enableRotate = true
    }, Cesium.ScreenSpaceEventType.RIGHT_UP)

    return () => {
      handler.destroy()
    }
  }, [isLoaded, isDragging, isRotating, site])

  // 3D 모델 드래그/회전 핸들러
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    const Cesium = (window as any).Cesium
    if (!Cesium) return

    const viewer = viewerRef.current
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    // 모델 위치 업데이트 함수
    const updateModelPosition = (lon: number, lat: number, height: number, rotation: number) => {
      const entity = viewer.entities.getById('loaded-3d-model')
      if (!entity) return

      // 위치 업데이트
      entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, height)

      // 회전 업데이트 (Z축 기준)
      const heading = Cesium.Math.toRadians(rotation)
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0)
      entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(lon, lat, height),
        hpr
      )

      viewer.scene.requestRender()
    }

    // 마우스 왼쪽 버튼 누름 - 모델 이동 시작
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

    // 마우스 휠(미들) 버튼 누름 - 모델 회전 시작
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (Cesium.defined(pickedObject) && pickedObject.id?.id === 'loaded-3d-model') {
        isModelRotatingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTilt = false
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_DOWN)

    // 휴먼 모델 위치 업데이트 함수
    const updateHumanModelPosition = (lon: number, lat: number) => {
      const entity = viewer.entities.getById('human-scale-model')
      if (!entity) return
      // 높이 0.9m 유지 (원본 2m 모델 × 0.9 스케일 = 180cm, 모델 원점이 중심이므로 반높이 올림)
      entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 0.9)
      humanModelTransformRef.current = { longitude: lon, latitude: lat }
      viewer.scene.requestRender()
    }

    // 마우스 이동
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

        setModelTransform({ longitude: newLon, latitude: newLat })
        updateModelPosition(newLon, newLat, modelTransformRef.current.height, modelTransformRef.current.rotation)

        // 모델 바닥면이 선택 영역 내에 있는지 체크하고 색상 업데이트
        const inBounds = checkModelInBounds(newLon, newLat, modelTransformRef.current.rotation, modelTransformRef.current.scale)
        if (inBounds !== isModelInBounds) {
          setIsModelInBounds(inBounds)
          updateBlocksColor(inBounds)
        }
      }

      // 휴먼 모델 드래그 (이동)
      if (isHumanDraggingRef.current && humanDragStartRef.current && cartesian) {
        const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
        const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
        const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

        const newLon = mouseLon + humanDragStartRef.current.offsetLon
        const newLat = mouseLat + humanDragStartRef.current.offsetLat

        updateHumanModelPosition(newLon, newLat)
      }

      // 모델 회전 - 마우스 위치를 향해 모델이 바라보도록
      if (isModelRotatingRef.current) {
        let cartesian = viewer.scene.pickPosition(movement.endPosition)
        if (!cartesian || !Cesium.defined(cartesian)) {
          const ray = viewer.camera.getPickRay(movement.endPosition)
          if (ray) {
            cartesian = viewer.scene.globe.pick(ray, viewer.scene)
          }
        }
        if (cartesian) {
          const mousePos = Cesium.Cartographic.fromCartesian(cartesian)
          const mouseLon = Cesium.Math.toDegrees(mousePos.longitude)
          const mouseLat = Cesium.Math.toDegrees(mousePos.latitude)

          // 모델 위치에서 마우스 위치로의 방향 계산
          const currentTransform = modelTransformRef.current
          const deltaLon = mouseLon - currentTransform.longitude
          const deltaLat = mouseLat - currentTransform.latitude

          // atan2로 각도 계산 (북쪽이 0도, 시계방향으로 증가)
          // Cesium heading: 북쪽=0, 동쪽=90, 남쪽=180, 서쪽=270
          const angleRad = Math.atan2(deltaLon, deltaLat)
          const angleDeg = Cesium.Math.toDegrees(angleRad)

          // 0-360 범위로 정규화
          const newRotation = (angleDeg + 360) % 360

          setModelTransform({ rotation: newRotation })
          updateModelPosition(
            currentTransform.longitude,
            currentTransform.latitude,
            currentTransform.height,
            newRotation
          )

          // 회전 시에도 바닥면 경계 체크
          const inBounds = checkModelInBounds(currentTransform.longitude, currentTransform.latitude, newRotation, currentTransform.scale)
          if (inBounds !== isModelInBounds) {
            setIsModelInBounds(inBounds)
            updateBlocksColor(inBounds)
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 마우스 버튼 뗌
    handler.setInputAction(() => {
      if (isModelDraggingRef.current) {
        isModelDraggingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
      }
      if (isHumanDraggingRef.current) {
        isHumanDraggingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTranslate = true
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    handler.setInputAction(() => {
      if (isModelRotatingRef.current) {
        isModelRotatingRef.current = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        viewer.scene.screenSpaceCameraController.enableTilt = true
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_UP)

    return () => {
      handler.destroy()
    }
  }, [isLoaded, setModelTransform, checkModelInBounds, updateBlocksColor, isModelInBounds])

  // 시간 변경 (일조 시뮬레이션)
  const handleTimeChange = (date: Date) => {
    if (!viewerRef.current) return

    const Cesium = (window as any).Cesium
    viewerRef.current.clock.currentTime = Cesium.JulianDate.fromDate(date)
    viewerRef.current.scene.requestRender()
    setCurrentTime(date)
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="cesium-viewer absolute inset-0" />

      {/* 상단 컨트롤 바 */}
      {isLoaded && (
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="bg-white/90 rounded-lg shadow-lg px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span className="text-sm text-gray-700">3D 지도 준비 완료</span>
              </div>
            </div>
            <button
              onClick={handleRefreshViewport}
              className="bg-white/90 hover:bg-white rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors"
              title="뷰포트 새로고침 (모델, 시점 유지)"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="text-sm text-gray-700">새로고침</span>
            </button>
            <button
              onClick={toggleRegionSelection}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                isSelectingRegion
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/90 hover:bg-white text-gray-700'
              }`}
              title="지도에서 지역 선택 (지적도 로드)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm">{isSelectingRegion ? '클릭하여 선택...' : '지역 선택'}</span>
            </button>
            <button
              onClick={toggleBlockSelection}
              disabled={!hasPolylinesLoaded}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                isSelectingBlock
                  ? 'bg-green-500 text-white'
                  : selectedBlockCount > 0
                    ? 'bg-green-100 hover:bg-green-200 text-green-700'
                    : hasPolylinesLoaded
                      ? 'bg-white/90 hover:bg-white text-gray-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              title="지적 블록 선택 (모델 배치 영역)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span className="text-sm">
                {isSelectingBlock ? '블록 선택 중...' : selectedBlockCount > 0 ? `영역 선택 (${selectedBlockCount})` : '영역 선택'}
              </span>
            </button>
            {selectedBlockCount > 0 && (
              <button
                onClick={clearSelectedBlocks}
                className="rounded-lg shadow-lg px-2 py-2 bg-red-100 hover:bg-red-200 text-red-600 transition-colors"
                title="선택 초기화"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <button
              onClick={toggleCadastral}
              disabled={!hasPolylinesLoaded}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                showCadastral
                  ? 'bg-yellow-500 text-white'
                  : hasPolylinesLoaded
                    ? 'bg-white/90 hover:bg-white text-gray-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              title="지적도 WMS 타일 표시/숨김"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="text-sm">{showCadastral ? '지적도 ON' : '지적도'}</span>
            </button>
            <button
              onClick={() => setIsBuildingSelectMode(!isBuildingSelectMode)}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                isBuildingSelectMode
                  ? 'bg-red-500 text-white'
                  : 'bg-white/90 hover:bg-white text-gray-700'
              }`}
              title="기존 건물 선택하여 숨기기"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="text-sm">{isBuildingSelectMode ? '건물 선택 중...' : '건물 삭제'}</span>
            </button>
            {/* 건축선 버튼 */}
            <button
              onClick={toggleBuildingLine}
              disabled={selectedBlockCount === 0}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                showBuildingLine
                  ? 'bg-red-500 text-white'
                  : selectedBlockCount > 0
                    ? 'bg-white/90 hover:bg-white text-gray-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              title={selectedBlockCount > 0 ? '건축선 계산 및 표시' : '먼저 영역을 선택하세요'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="text-sm">{showBuildingLine ? '건축선 숨기기' : '건축선'}</span>
            </button>
            {hiddenBuildingIds.length > 0 && (
              <button
                onClick={restoreAllBuildings}
                className="bg-white/90 hover:bg-white rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors text-gray-700"
                title="숨긴 건물 모두 복원"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-sm">건물 복원 ({hiddenBuildingIds.length})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 선택된 작업 영역 주소 표시 - Cesium 위젯 아래에 배치 */}
      {isLoaded && workArea && (
        <div className="absolute top-48 right-4 bg-white/90 rounded-lg shadow-lg px-4 py-2 max-w-md z-10">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{workArea.address}</p>
              <p className="text-xs text-gray-500">
                {workArea.latitude.toFixed(6)}, {workArea.longitude.toFixed(6)}
              </p>
            </div>
            <button
              onClick={() => setWorkArea(null)}
              className="ml-2 text-gray-400 hover:text-gray-600"
              title="영역 선택 해제"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 건축선 분석 결과 패널 */}
      {isLoaded && showBuildingLine && buildingLineResult && (
        <div className="absolute top-64 right-4 bg-white/95 rounded-lg shadow-lg p-4 max-w-sm z-10">
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            건축선 분석 결과
          </h3>

          <div className="space-y-2 text-xs">
            {/* 용도지역 */}
            <div className="flex justify-between items-center py-1 border-b border-gray-100">
              <span className="text-gray-600">용도지역</span>
              <span className="font-medium text-blue-600">{currentZoneType}</span>
            </div>

            {/* 도로 접촉 변 */}
            <div className="flex justify-between items-center py-1 border-b border-gray-100">
              <span className="text-gray-600">도로 접촉 변</span>
              <span className="font-medium text-orange-500">{buildingLineResult.roadEdges.length}개</span>
            </div>

            {/* 인접 대지 변 */}
            <div className="flex justify-between items-center py-1 border-b border-gray-100">
              <span className="text-gray-600">인접 대지 변</span>
              <span className="font-medium text-yellow-600">{buildingLineResult.adjacentLotEdges.length}개</span>
            </div>

            {/* 이격거리 정보 */}
            <div className="mt-3 pt-2 border-t border-gray-200">
              <p className="text-gray-500 mb-2">적용 이격거리</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-orange-50 rounded p-2">
                  <p className="text-orange-600 font-medium">건축선</p>
                  <p className="text-gray-700">
                    {buildingLineResult.roadEdges[0]?.setbackDistance ?? DEFAULT_SETBACKS.fromBuildingLine}m
                  </p>
                </div>
                <div className="bg-yellow-50 rounded p-2">
                  <p className="text-yellow-600 font-medium">인접대지</p>
                  <p className="text-gray-700">
                    {buildingLineResult.adjacentLotEdges[0]?.setbackDistance ?? DEFAULT_SETBACKS.fromAdjacentLot}m
                  </p>
                </div>
              </div>
            </div>

            {/* 범례 */}
            <div className="mt-3 pt-2 border-t border-gray-200">
              <p className="text-gray-500 mb-2">범례</p>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-1 bg-red-500 rounded"></span>
                  <span className="text-gray-600">건축선 (건축 가능 영역)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-1 bg-orange-500 rounded"></span>
                  <span className="text-gray-600">도로 접촉 변</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-1 bg-yellow-400 rounded"></span>
                  <span className="text-gray-600">인접 대지 변</span>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={toggleBuildingLine}
            className="mt-3 w-full text-xs text-gray-500 hover:text-gray-700 py-1"
          >
            닫기
          </button>
        </div>
      )}

      {/* 지역 선택 모드 안내 */}
      {isSelectingRegion && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">지도에서 작업할 지역을 클릭하세요</p>
        </div>
      )}

      {/* 블록 선택 모드 안내 */}
      {isSelectingBlock && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">블록을 클릭하여 선택/해제 (여러 개 선택 가능) - 완료 후 버튼 다시 클릭</p>
        </div>
      )}

      {/* 건물 선택 모드 안내 */}
      {isBuildingSelectMode && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">삭제할 건물을 클릭하세요</p>
        </div>
      )}

      {/* 선택된 건물 정보 */}
      {selectedBuilding && (
        <div className="absolute top-36 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg p-4 z-20 min-w-64">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-gray-800">선택된 건물</h4>
            <button
              onClick={() => setSelectedBuilding(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="text-sm text-gray-600 mb-3">
            <p>이름: {selectedBuilding.name}</p>
            <p className="text-xs text-gray-400">ID: {selectedBuilding.id}</p>
          </div>
          <button
            onClick={hideSelectedBuilding}
            className="w-full bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            이 건물 숨기기
          </button>
        </div>
      )}

      {/* 숨긴 건물 목록 - 우측 하단에 배치 */}
      {hiddenBuildingIds.length > 0 && (
        <div className="absolute bottom-8 right-4 bg-white/90 rounded-lg shadow-lg p-3 z-10 max-w-xs">
          <h4 className="font-medium text-sm text-gray-800 mb-2">숨긴 건물 ({hiddenBuildingIds.length})</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {hiddenBuildingIds.map((id) => (
              <div key={id} className="flex items-center justify-between text-xs bg-gray-100 rounded px-2 py-1">
                <span className="text-gray-600 truncate">ID: {id}</span>
                <button
                  onClick={() => restoreBuilding(id)}
                  className="text-blue-500 hover:text-blue-700 ml-2"
                  title="복원"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
