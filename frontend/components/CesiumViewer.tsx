'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useProjectStore, SAMPLE_MODELS } from '@/store/projectStore'

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

  // 영역 선택 모드
  const [isSelectingArea, setIsSelectingArea] = useState(false)

  // 지적도 레이어
  const [showCadastral, setShowCadastral] = useState(false)
  const cadastralLayerRef = useRef<any>(null)

  // OSM 건물 관련
  const osmTilesetRef = useRef<any>(null)
  const [hiddenBuildingIds, setHiddenBuildingIds] = useState<string[]>([])
  const [selectedBuilding, setSelectedBuilding] = useState<{ id: string; name: string } | null>(null)
  const [isBuildingSelectMode, setIsBuildingSelectMode] = useState(false)

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

  // modelTransform이 변경될 때 ref 업데이트
  useEffect(() => {
    modelTransformRef.current = modelTransform
  }, [modelTransform])

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

  // 영역 선택 모드 토글
  const toggleAreaSelection = useCallback(() => {
    setIsSelectingArea(prev => !prev)
  }, [])

  // 지적도 토글
  const toggleCadastral = useCallback(() => {
    if (showCadastral) {
      // 지적도 끄기
      if (cadastralLayerRef.current && viewerRef.current) {
        viewerRef.current.imageryLayers.remove(cadastralLayerRef.current)
        cadastralLayerRef.current = null
        viewerRef.current.scene.requestRender()
      }
      setShowCadastral(false)
    } else {
      // 지적도 켜기 - workArea가 있으면 해당 위치, 없으면 현재 카메라 위치
      if (!viewerRef.current) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      let lon: number, lat: number

      if (workArea) {
        lon = workArea.longitude
        lat = workArea.latitude
      } else {
        // 현재 카메라 중심 위치 사용
        const camera = viewerRef.current.camera
        const cartographic = Cesium.Cartographic.fromCartesian(camera.position)
        lon = Cesium.Math.toDegrees(cartographic.longitude)
        lat = Cesium.Math.toDegrees(cartographic.latitude)
      }

      // 기존 레이어 제거
      if (cadastralLayerRef.current) {
        viewerRef.current.imageryLayers.remove(cadastralLayerRef.current)
        cadastralLayerRef.current = null
      }

      // 지적도 로드
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
        console.log('지적도 로드됨:', { lon, lat, west, south, east, north })
        viewerRef.current.scene.requestRender()
      } catch (error) {
        console.error('지적도 로드 실패:', error)
      }
    }
  }, [showCadastral, workArea])

  // 지적도 레이어 제거
  const removeCadastralLayer = useCallback(() => {
    if (!viewerRef.current || !cadastralLayerRef.current) return

    viewerRef.current.imageryLayers.remove(cadastralLayerRef.current)
    cadastralLayerRef.current = null
    setShowCadastral(false)
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
      // WMS GetMap 요청으로 해당 영역만 로드
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
      console.log('지적도 로드됨:', { west, south, east, north })
      viewer.scene.requestRender()
    } catch (error) {
      console.error('지적도 로드 실패:', error)
    }
  }, [])

  // 영역 선택 클릭 핸들러
  useEffect(() => {
    if (!viewerRef.current || !isLoaded || !isSelectingArea) return

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
      setIsSelectingArea(false)

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
  }, [isLoaded, isSelectingArea, reverseGeocode, setWorkArea, loadCadastralForArea])

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

      // Google Maps Roadmap 레이어 생성 (기본 레이어)
      const googleRoadmap = new Cesium.UrlTemplateImageryProvider({
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        maximumLevel: 20,
        credit: new Cesium.Credit('Google Maps'),
      })

      // Viewer 생성
      const viewer = new Cesium.Viewer(containerRef.current!, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        baseLayer: new Cesium.ImageryLayer(googleRoadmap),
        baseLayerPicker: true,  // 지도 스타일 선택 가능
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
      if (Cesium.defined(pickedObject) && pickedObject.id?.id === 'loaded-3d-model') {
        isModelDraggingRef.current = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        viewer.scene.screenSpaceCameraController.enableTranslate = false

        // 클릭 위치와 모델 위치의 오프셋 저장 (지형 고려)
        let cartesian = viewer.scene.pickPosition(click.position)
        if (!cartesian || !Cesium.defined(cartesian)) {
          const ray = viewer.camera.getPickRay(click.position)
          if (ray) {
            cartesian = viewer.scene.globe.pick(ray, viewer.scene)
          }
        }
        if (cartesian) {
          const clickPos = Cesium.Cartographic.fromCartesian(cartesian)
          const clickLon = Cesium.Math.toDegrees(clickPos.longitude)
          const clickLat = Cesium.Math.toDegrees(clickPos.latitude)
          // 클릭 위치와 모델 중심 간의 오프셋 저장
          modelDragStartRef.current = {
            offsetLon: modelTransformRef.current.longitude - clickLon,
            offsetLat: modelTransformRef.current.latitude - clickLat,
          }
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

    // 마우스 이동
    handler.setInputAction((movement: any) => {
      // 모델 드래그 (이동) - 마우스 위치를 정확히 따라감
      if (isModelDraggingRef.current && modelDragStartRef.current) {
        let cartesian = viewer.scene.pickPosition(movement.endPosition)
        if (!cartesian || !Cesium.defined(cartesian)) {
          const ray = viewer.camera.getPickRay(movement.endPosition)
          if (ray) {
            cartesian = viewer.scene.globe.pick(ray, viewer.scene)
          }
        }
        if (cartesian) {
          const currentPos = Cesium.Cartographic.fromCartesian(cartesian)
          const mouseLon = Cesium.Math.toDegrees(currentPos.longitude)
          const mouseLat = Cesium.Math.toDegrees(currentPos.latitude)

          // 오프셋을 적용하여 모델 위치 계산 (마우스 위치 + 초기 오프셋)
          const newLon = mouseLon + modelDragStartRef.current.offsetLon
          const newLat = mouseLat + modelDragStartRef.current.offsetLat

          setModelTransform({ longitude: newLon, latitude: newLat })
          updateModelPosition(newLon, newLat, modelTransformRef.current.height, modelTransformRef.current.rotation)
        }
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
  }, [isLoaded, setModelTransform])

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
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
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
              onClick={toggleAreaSelection}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                isSelectingArea
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/90 hover:bg-white text-gray-700'
              }`}
              title="지도에서 작업 영역 선택"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm">{isSelectingArea ? '클릭하여 선택...' : '영역 선택'}</span>
            </button>
            <button
              onClick={toggleCadastral}
              className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
                showCadastral
                  ? 'bg-yellow-500 text-white'
                  : 'bg-white/90 hover:bg-white text-gray-700'
              }`}
              title="지적도 레이어 표시/숨김"
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

          {/* 선택된 작업 영역 주소 표시 */}
          {workArea && (
            <div className="bg-white/90 rounded-lg shadow-lg px-4 py-2 max-w-md">
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
        </div>
      )}

      {/* 영역 선택 모드 안내 */}
      {isSelectingArea && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">지도에서 작업할 영역을 클릭하세요</p>
        </div>
      )}

      {/* 건물 선택 모드 안내 */}
      {isBuildingSelectMode && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-20">
          <p className="text-sm">삭제할 건물을 클릭하세요</p>
        </div>
      )}

      {/* 선택된 건물 정보 */}
      {selectedBuilding && (
        <div className="absolute top-32 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg p-4 z-20 min-w-64">
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

      {/* 숨긴 건물 목록 */}
      {hiddenBuildingIds.length > 0 && (
        <div className="absolute top-20 right-4 bg-white/90 rounded-lg shadow-lg p-3 z-10 max-w-xs">
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
