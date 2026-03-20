'use client'

import { useEffect, useRef, useState, useCallback, RefObject } from 'react'

// Cesium 타입 정의
declare global {
  interface Window {
    CESIUM_BASE_URL: string
    Cesium: any
  }
}

// 초기 위치 상수
export const DEFAULT_POSITION = {
  longitude: 127.1388, // 성남시
  latitude: 37.4449,
  height: 500,
}

interface UseCesiumViewerOptions {
  onViewerReady?: (viewer: any) => void
  restoreState?: (viewer: any) => void
}

interface UseCesiumViewerReturn {
  viewerRef: RefObject<any>
  containerRef: RefObject<HTMLDivElement>
  isLoaded: boolean
  osmTilesetRef: RefObject<any>
  refreshViewer: () => void
}

/**
 * Cesium Viewer 초기화 및 관리 훅
 */
export function useCesiumViewer(options: UseCesiumViewerOptions = {}): UseCesiumViewerReturn {
  const { onViewerReady, restoreState } = options

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const initRef = useRef(false)
  const osmTilesetRef = useRef<any>(null)

  const [isLoaded, setIsLoaded] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // 뷰포트 새로고침
  const refreshViewer = useCallback(() => {
    if (viewerRef.current) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }
    initRef.current = false
    setIsLoaded(false)
    setRefreshKey((prev) => prev + 1)
  }, [])

  // Cesium 초기화
  useEffect(() => {
    if (!containerRef.current || initRef.current) return
    initRef.current = true

    const initCesium = async () => {
      const Cesium = await import('cesium')

      // Cesium을 window에 저장
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
        selectedImageryProviderViewModel: imageryProviderViewModels[0],
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

      // 지형에 대한 깊이 테스트 활성화 (globe.pick 작동에 필요)
      viewer.scene.globe.depthTestAgainstTerrain = true

      // 카메라 컨트롤 설정 변경
      const controller = viewer.scene.screenSpaceCameraController
      controller.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG
      controller.tiltEventTypes = Cesium.CameraEventType.RIGHT_DRAG
      controller.zoomEventTypes = [
        Cesium.CameraEventType.WHEEL,
        Cesium.CameraEventType.PINCH
      ]
      controller.lookEventTypes = undefined

      // 초기 카메라 위치
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
        osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
          show: "true",
          color: "color('#D3D3D3')"
        })
        osmBuildingsTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE
        viewer.scene.primitives.add(osmBuildingsTileset)
        osmTilesetRef.current = osmBuildingsTileset
      } catch (e) {
        console.warn('OSM Buildings 로드 실패:', e)
      }

      viewerRef.current = viewer
      setIsLoaded(true)
      console.log('Cesium Viewer 초기화 완료')

      // 콜백 호출
      onViewerReady?.(viewer)

      // 저장된 상태 복원 (새로고침 시)
      if (refreshKey > 0 && restoreState) {
        setTimeout(() => {
          restoreState(viewer)
        }, 500)
      }
    }

    initCesium()

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [refreshKey, onViewerReady, restoreState])

  return {
    viewerRef,
    containerRef,
    isLoaded,
    osmTilesetRef,
    refreshViewer,
  }
}
