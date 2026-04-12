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
  /** Number of globe terrain/imagery tiles still loading (0 = idle). */
  tilesLoading: number
  /** True until the globe has reported tilesLoading===0 at least once after init. */
  initialTilesReady: boolean
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
  const [tilesLoading, setTilesLoading] = useState(0)
  const [initialTilesReady, setInitialTilesReady] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // 뷰포트 새로고침
  const refreshViewer = useCallback(() => {
    if (viewerRef.current) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }
    initRef.current = false
    setIsLoaded(false)
    setTilesLoading(0)
    setInitialTilesReady(false)
    setRefreshKey((prev) => prev + 1)
  }, [])

  // Cesium 초기화
  useEffect(() => {
    // React 18 strict mode에서 effect가 두 번 실행되는 걸 방어하기 위해
    // 컨테이너 엘리먼트를 effect 시작 시점에 로컬로 캡처한다.
    const container = containerRef.current
    if (!container || initRef.current) return
    initRef.current = true

    let cancelled = false
    let localViewer: any = null

    const initCesium = async () => {
      const Cesium = await import('cesium')

      // 비동기 대기 동안 cleanup이 실행됐거나 DOM에서 분리되었으면 중단
      if (cancelled || !container.isConnected) {
        initRef.current = false
        return
      }

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

      // Viewer 생성 — effect 시작 시점에 캡처한 container 사용
      // NOTE: preserveDrawingBuffer=true 는 결과 확인 페이지에서 `canvas.toDataURL()`
      // 로 스크린샷을 뽑기 위해 필수. 성능 영향은 배치 에디터 규모에서 무시할 수준.
      const viewer = new Cesium.Viewer(container, {
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
        contextOptions: {
          webgl: {
            preserveDrawingBuffer: true,
          },
        },
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

      // cleanup이 비동기 작업 도중에 실행됐다면 바로 파괴
      if (cancelled) {
        try {
          viewer.destroy()
        } catch {}
        return
      }

      localViewer = viewer
      viewerRef.current = viewer

      // Track globe tile loading so we can show a loading overlay until the
      // initial terrain + imagery tiles have settled.
      try {
        const removeListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(
          (queued: number) => {
            if (cancelled) return
            setTilesLoading(queued)
            if (queued === 0) {
              setInitialTilesReady(true)
            }
          }
        )
        // Remove listener on destroy
        const prevDestroy = viewer.destroy.bind(viewer)
        viewer.destroy = () => {
          try { removeListener() } catch {}
          prevDestroy()
        }
      } catch (e) {
        // If the event isn't available for some reason, fall back to
        // declaring the viewport ready immediately so we don't hang the UI.
        setInitialTilesReady(true)
      }

      // Safety fallback: even if the tile queue never drains (offline / failed
      // imagery), stop showing the loading overlay after 8 seconds.
      setTimeout(() => {
        if (!cancelled) setInitialTilesReady(true)
      }, 8000)

      setIsLoaded(true)
      console.log('Cesium Viewer 초기화 완료')

      // 콜백 호출
      onViewerReady?.(viewer)

      // 저장된 상태 복원 (새로고침 시)
      if (refreshKey > 0 && restoreState) {
        setTimeout(() => {
          if (!cancelled) restoreState(viewer)
        }, 500)
      }
    }

    initCesium()

    return () => {
      cancelled = true
      // 첫 실행이 localViewer를 만들었으면 그걸 정리
      const toDestroy = localViewer || viewerRef.current
      if (toDestroy) {
        try {
          toDestroy.destroy()
        } catch {}
      }
      viewerRef.current = null
      // 다음 mount에서 다시 초기화할 수 있도록 플래그 리셋
      initRef.current = false
    }
  }, [refreshKey, onViewerReady, restoreState])

  return {
    viewerRef,
    containerRef,
    isLoaded,
    tilesLoading,
    initialTilesReady,
    osmTilesetRef,
    refreshViewer,
  }
}
