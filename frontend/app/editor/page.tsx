'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { useProjectStore } from '@/store/projectStore'
import Sidebar from '@/components/Sidebar'
import PlacementPlansPanel from '@/components/PlacementPlansPanel'
import ErrorBanner from '@/components/ErrorBanner'
import Brand from '@/components/Brand'
import ThemeToggle from '@/components/ThemeToggle'
import { captureTopDownDataUrl, captureCurrentViewDataUrl } from '@/lib/cesiumSnapshot'
import { getProject } from '@/lib/api'
import { loadRegulationsFromServer } from '@/lib/setbackTable'

const CesiumViewer = dynamic(() => import('@/components/CesiumViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-navy-900">
      <div className="text-center">
        <div className="spinner mx-auto mb-4"></div>
        <p className="text-white/60 text-sm">3D 지도 로딩 중...</p>
      </div>
    </div>
  ),
})

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center bg-navy-900 text-white"><div className="spinner" /></div>}>
      <EditorContent />
    </Suspense>
  )
}

function EditorContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 페이지 진입 시 서버에서 최신 규정 기준값 로드
  // (관리자가 /admin/regulations 에서 변경한 값을 즉시 반영)
  useEffect(() => {
    loadRegulationsFromServer()
  }, [])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [isCapturingResult, setIsCapturingResult] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    isLoading,
    viewer,
    workArea,
    modelTransform,
    setError,
    saveProjectFn,
    loadProjectFn,
    loadFromDbFn,
    isSavingProject,
    isLoadingProject,
    projectError,
    setProjectError,
    setResultSnapshot,
    resultSnapshot,
    projectId: storeProjectId,
    projectName: storeProjectName,
    setProjectId,
    setProjectName: setStoreProjectName,
    plansOpen,
    setPlansOpen,
    activePlanId,
    saveActivePlan,
    sunlightAnalysisState,
    setSunlightAnalysisState,
    toggleSunlightHeatmapFn,
    loadedMassGlbUrl,
  } = useProjectStore()

  // URL에서 view=result 파라미터 확인 (결과 페이지로 바로 이동)
  const viewParam = searchParams.get('view')
  const shouldRedirectToResult = viewParam === 'result'

  // URL에서 projectId 읽어서 프로젝트 정보 로드
  useEffect(() => {
    const urlProjectId = searchParams.get('projectId')
    const urlName = searchParams.get('name')

    // projectId 없이 /editor 직접 진입한 경우: 이전 프로젝트 상태(배치안·매스·
    // 검토 결과 등)가 zustand 메모리에 남아있을 수 있으므로 깨끗하게 초기화.
    // 그러지 않으면 다른 프로젝트로 갈아탄 사용자에게 옛 배치안이 보임.
    if (!urlProjectId) {
      if (storeProjectId !== null) {
        setProjectId(null)
        setStoreProjectName(null)
      }
      return
    }

    // projectId가 다르거나 projectName이 아직 없으면 로드
    const needsLoad = urlProjectId !== storeProjectId || !storeProjectName

    if (urlProjectId !== storeProjectId) {
      setProjectId(urlProjectId)
    }

    // URL에 name이 있으면 즉시 표시 (API 응답 전에도 프로젝트 이름 보이도록)
    if (urlName && !storeProjectName) {
      setStoreProjectName(urlName)
    }

    if (needsLoad) {
      getProject(urlProjectId)
        .then((proj) => {
          if (proj?.name) {
            setStoreProjectName(proj.name)
          }
          // 저장된 생성 모델 복원
          if (proj?.generated_models?.length > 0) {
            const store = useProjectStore.getState()
            // 이미 로드된 모델이 없을 때만 복원
            if (store.generatedMasses.length === 0) {
              for (const m of proj.generated_models) {
                store.addGeneratedMass({
                  id: m.id,
                  fileName: m.file_path?.split('/').pop() || 'model.glb',
                  label: m.model_type || '저장된 모델',
                  glbUrl: m.file_path ? `/models/${m.file_path.split('/').pop()}` : '',
                  footprint: [],
                  centroid: proj.longitude && proj.latitude ? [proj.longitude, proj.latitude] : [],
                  area: 0,
                  height: m.height || 4,
                  floors: m.floors || 1,
                  classification: { total_entities: 0, class_counts: {}, average_confidence: 0 },
                  createdAt: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
                })
              }
            }
          }
          // 저장된 위치 정보 복원
          if (proj?.longitude && proj?.latitude) {
            const store = useProjectStore.getState()
            if (!store.workArea) {
              store.setWorkArea({
                longitude: proj.longitude,
                latitude: proj.latitude,
                address: proj.address || '',
                displayName: proj.address || proj.name || '',
              })
            }
          }
        })
        .catch((err) => {
          console.warn('프로젝트 정보 로드 실패:', err)
          // API 실패 시 URL name을 fallback으로 사용
          if (urlName && !useProjectStore.getState().projectName) {
            setStoreProjectName(urlName)
          }
        })
    }
  }, [searchParams])

  // DB 자동 복원은 CesiumViewer 마운트 시 직접 수행 (race condition 방지)

  // view=result 파라미터가 있으면 프로젝트 데이터 로드 후 결과 페이지로 자동 이동
  const [hasRedirected, setHasRedirected] = useState(false)
  useEffect(() => {
    if (!shouldRedirectToResult || hasRedirected || !storeProjectId) return

    // 프로젝트 데이터가 로드되었는지 확인
    const hasProjectData = resultSnapshot?.sitePlan || resultSnapshot?.aerialView ||
      resultSnapshot?.renderedSitePlan || resultSnapshot?.renderedAerialView

    if (hasProjectData) {
      // 데이터가 있으면 즉시 이동
      console.log('[Editor] view=result: 프로젝트 데이터 발견, 결과 페이지로 이동')
      setHasRedirected(true)
      router.push(`/editor/result`)
    } else if (!isLoadingProject && viewer) {
      // 로딩 완료 후 약간의 지연을 두고 이동 (DB 복원 시간 확보)
      const timer = setTimeout(() => {
        if (!hasRedirected) {
          console.log('[Editor] view=result: 로딩 완료, 결과 페이지로 이동')
          setHasRedirected(true)
          router.push(`/editor/result`)
        }
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [shouldRedirectToResult, resultSnapshot, storeProjectId, hasRedirected, router, isLoadingProject, viewer])

  // 주소 검색 및 이동 — Nominatim (OSM)
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !viewer) return

    setIsSearching(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=1`,
        { headers: { 'Accept-Language': 'ko' } }
      )
      const data = await response.json()

      if (data && data.length > 0) {
        const { lon, lat } = data[0]
        const Cesium = (window as any).Cesium

        if (Cesium) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              parseFloat(lon),
              parseFloat(lat),
              500
            ),
            orientation: {
              heading: 0,
              pitch: Cesium.Math.toRadians(-45),
              roll: 0,
            },
            duration: 2,
          })
        }
      } else {
        setError('검색 결과가 없습니다.')
      }
    } catch (error) {
      console.error('검색 오류:', error)
      setError('검색 중 오류가 발생했습니다.')
    } finally {
      setIsSearching(false)
    }
  }, [searchQuery, viewer, setError])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleOpenSaveDialog = useCallback(() => {
    if (!saveProjectFn) {
      setError('뷰어가 초기화되지 않았습니다')
      return
    }
    // 활성 배치안이 있으면 현재 상태 저장
    if (activePlanId) {
      saveActivePlan()
    }
    // projectId가 있으면 다이얼로그 없이 바로 DB 저장
    if (storeProjectId) {
      saveProjectFn(storeProjectName || undefined)
      return
    }
    setProjectName('')
    setShowSaveDialog(true)
  }, [saveProjectFn, storeProjectId, storeProjectName, setError, activePlanId, saveActivePlan])

  const handleSaveProject = useCallback(() => {
    if (saveProjectFn) {
      // 활성 배치안이 있으면 현재 상태 저장
      if (activePlanId) {
        saveActivePlan()
      }
      saveProjectFn(projectName || undefined)
      setShowSaveDialog(false)
      setProjectName('')
    }
  }, [saveProjectFn, projectName, activePlanId, saveActivePlan])

  const handleLoadClick = useCallback(async () => {
    // DB에서 불러오기 우선 (projectId가 있는 경우)
    if (loadFromDbFn && storeProjectId) {
      await loadFromDbFn()
      return
    }
    // 폴백: JSON 파일에서 불러오기
    if (!loadProjectFn) {
      setError('뷰어가 초기화되지 않았습니다')
      return
    }
    fileInputRef.current?.click()
  }, [loadFromDbFn, loadProjectFn, storeProjectId, setError])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && loadProjectFn) {
        await loadProjectFn(file)
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [loadProjectFn]
  )

  const handleRefresh = useCallback(() => {
    window.location.reload()
  }, [])

  // 결과 확인 — Cesium 탑다운 스크린샷 캡처 후 /editor/result 로 이동
  // 항상 새로 캡처하여 최신 오버레이 숨김 로직이 적용되도록 함
  const handleOpenResult = useCallback(async () => {
    console.log('[Editor] ===== 결과 확인 캡처 시작 =====')

    if (!viewer) {
      setError('뷰어가 초기화되지 않았습니다')
      return
    }

    // 캡처 전 그림자 상태 확인 로깅
    console.log('[Editor] 캡처 전 viewer 그림자 상태: viewer.shadows=', viewer.shadows,
      ', shadowMap.enabled=', viewer.shadowMap?.enabled,
      ', globe.enableLighting=', viewer.scene?.globe?.enableLighting)

    // 중심 좌표 우선순위: 배치된 모델 → 대지 중심 → 작업 영역
    const lon =
      modelTransform?.longitude ??
      workArea?.longitude ??
      null
    const lat =
      modelTransform?.latitude ??
      workArea?.latitude ??
      null

    // 매스 변경 여부 시그니처 — 같으면 캡처 스킵해서 기존 렌더 결과 유지.
    // 사용자가 매스를 안 만지고 결과 페이지를 왕복할 때 매번 새 캡처가 일어나
    // 어제 푸시한 'rendered* 자동 클리어' 로직이 발동하던 문제 차단.
    const captureSignature = JSON.stringify({
      rotation: modelTransform?.rotation,
      height: modelTransform?.height,
      lon: modelTransform?.longitude,
      lat: modelTransform?.latitude,
      mass: loadedMassGlbUrl ?? null,
    })
    const prevSnap = useProjectStore.getState().resultSnapshot
    if (
      prevSnap.captureSignature === captureSignature &&
      prevSnap.sitePlan &&
      prevSnap.aerialView
    ) {
      console.log('[Editor] 매스 변경 없음 — 기존 캡처/렌더 그대로 사용')
      router.push('/editor/result')
      return
    }

    setIsCapturingResult(true)

    // 캡처 전 일조분석 히트맵 숨김 (원래 상태 저장 후 복원)
    // toggleSunlightHeatmapFn을 사용하여 실제 히트맵 엔티티를 숨김
    const wasHeatmapVisible = sunlightAnalysisState.showHeatmap
    if (wasHeatmapVisible && toggleSunlightHeatmapFn) {
      console.log('[Editor] 히트맵 숨김 (toggleSunlightHeatmapFn 호출)')
      toggleSunlightHeatmapFn()
      // Cesium 렌더링 반영을 위한 대기
      await new Promise(resolve => setTimeout(resolve, 150))
    }

    // 히트맵 숨김 후 그림자 상태 확인
    console.log('[Editor] 히트맵 숨김 후 viewer 그림자 상태: viewer.shadows=', viewer.shadows,
      ', shadowMap.enabled=', viewer.shadowMap?.enabled)

    try {
      let sitePlan: string | null = null
      let aerialView: string | null = null

      // AI 렌더링용 캡처 옵션: 시각화 오버레이(대지경계, 건축선, 주차구역 등) 숨김
      // 단, 건축영역 바운더리(model-boundary)는 유지
      const captureOpts = { hideOverlays: true }
      console.log('[Editor] 캡처 옵션:', captureOpts)

      // 1. 조감도 = 사용자가 현재 보고 있는 에디터 뷰 그대로 (카메라 이동 없음)
      try {
        console.log('[Editor] 조감도 캡처 시작...')
        aerialView = await captureCurrentViewDataUrl(viewer, captureOpts)
        console.log('[Editor] 조감도 캡처 완료')
      } catch (err) {
        console.warn('Cesium 조감도 캡처 실패:', err)
      }
      // 2. 배치도(탑다운)은 대지 중심 위로 이동해서 캡처 후 원래 카메라 복원
      if (lon != null && lat != null) {
        try {
          console.log('[Editor] 배치도 캡처 시작...')
          sitePlan = await captureTopDownDataUrl(viewer, lon, lat, 220, captureOpts)
          console.log('[Editor] 배치도 캡처 완료')
        } catch (err) {
          console.warn('Cesium 배치도 캡처 실패:', err)
        }
      }
      setResultSnapshot({
        sitePlan,
        aerialView,         // 임시 Cesium 캡처. AI 렌더 후엔 렌더링 결과로 덮어씀.
        capturedAt: new Date().toISOString(),
        captureSignature,
        // 매스 변경으로 새 캡처를 했으니 이전 AI 렌더는 stale.
        // 결과 페이지가 renderedBasedOn !== capturedAt 으로 stale 판별 후 숨김.
      })
      console.log('[Editor] ===== 결과 확인 캡처 완료, 결과 페이지로 이동 =====')
      router.push('/editor/result')
    } finally {
      setIsCapturingResult(false)
      // 히트맵 상태 복원
      if (wasHeatmapVisible && toggleSunlightHeatmapFn) {
        console.log('[Editor] 히트맵 복원 (toggleSunlightHeatmapFn 호출)')
        toggleSunlightHeatmapFn()
      }
    }
  }, [viewer, modelTransform, workArea, loadedMassGlbUrl, setError, setResultSnapshot, router, sunlightAnalysisState.showHeatmap, toggleSunlightHeatmapFn])

  return (
    <div className="h-screen flex flex-col bg-navy-900 text-white overflow-hidden">
      <ErrorBanner />

      {/* Editor header */}
      <header className="flex-shrink-0 border-b border-white/5 bg-navy-900/80 backdrop-blur-xl px-5 py-3">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Brand size="sm" />
            <span className="hidden lg:inline-flex text-xs text-white/40 border-l border-white/10 pl-4">
              CAD 건축 매스 생성 시스템
            </span>
          </div>

          <div className="flex-1 max-w-xl">
            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="주소 검색 (예: 서울시 강남구, 판교역)"
                  className="w-full px-4 py-2 pl-10 text-sm rounded-lg bg-navy-800/70 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/20 transition-colors"
                />
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <button
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="btn-primary text-sm py-2 px-4"
              >
                {isSearching ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  '검색'
                )}
              </button>
            </div>
          </div>

          <nav className="flex items-center gap-1">
            <button
              onClick={handleOpenSaveDialog}
              disabled={isSavingProject || !saveProjectFn}
              className="btn-ghost disabled:opacity-40"
            >
              {isSavingProject && (
                <div className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
              )}
              저장
            </button>
            <button
              onClick={handleLoadClick}
              disabled={isLoadingProject || (!loadFromDbFn && !loadProjectFn)}
              className="btn-ghost disabled:opacity-40"
            >
              {isLoadingProject && (
                <div className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
              )}
              불러오기
            </button>
            <button onClick={handleRefresh} className="btn-ghost" title="새로고침">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <button
              onClick={handleOpenResult}
              disabled={isCapturingResult || !viewer}
              className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40"
              title="현재 배치를 캡처해서 결과 확인 페이지로 이동"
            >
              {isCapturingResult ? (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              )}
              결과 확인
            </button>
            <ThemeToggle />
            <Link href="/projects" className="btn-ghost">
              프로젝트 목록
            </Link>
          </nav>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </header>

      {/* Main work area */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측 사이드바: 배치안 목록 */}
        <aside
          className={`flex-shrink-0 border-r border-white/5 bg-navy-850 transition-all duration-300 ${
            plansOpen ? 'w-72' : 'w-0'
          } overflow-hidden`}
        >
          <div className="w-72 h-full">
            <PlacementPlansPanel />
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 border-b border-white/5 bg-navy-900/60 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlansOpen(!plansOpen)}
                className="p-2 rounded-md hover:bg-white/5 transition-colors"
                title={plansOpen ? '배치안 목록 닫기' : '배치안 목록 열기'}
              >
                <svg className="w-5 h-5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="text-sm text-white/60">
                {storeProjectName ? (
                  <span className="text-white font-medium">{storeProjectName}</span>
                ) : (
                  '3D 뷰포트'
                )}
              </span>
            </div>
            <div className="hidden md:flex items-center gap-3 text-xs text-white/40">
              <span>좌클릭: 회전</span>
              <span>·</span>
              <span>우클릭: 시점</span>
              <span>·</span>
              <span>휠: 줌</span>
            </div>
          </div>

          <div className="flex-1 relative bg-navy-950">
            <CesiumViewer />
            {isLoading && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="card p-6 text-center">
                  <div className="spinner mx-auto mb-4"></div>
                  <p className="text-white/80">처리 중...</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-white/5 bg-navy-900/60 px-4 py-2 flex items-center justify-between text-xs text-white/40">
            <div className="flex items-center gap-4">
              <span>위치: 성남시 분당구</span>
              <span>좌표: 127.1388, 37.4449</span>
            </div>
            <div className="flex items-center gap-3">
              <span>Google Maps</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                연결됨
              </span>
            </div>
          </div>
        </main>

        <aside
          className={`flex-shrink-0 border-l border-white/5 bg-navy-850 transition-all duration-300 ${
            sidebarOpen ? 'w-80' : 'w-0'
          } overflow-hidden`}
        >
          <div className="w-80 h-full">
            <Sidebar />
          </div>
        </aside>
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">프로젝트 저장</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-white/70 mb-2">
                프로젝트 이름 (선택사항)
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="예: 판교 주택 설계"
                className="input-field"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveProject()
                  if (e.key === 'Escape') setShowSaveDialog(false)
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="btn-secondary text-sm"
              >
                취소
              </button>
              <button onClick={handleSaveProject} className="btn-primary text-sm">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project error toast */}
      {projectError && (
        <div className="fixed bottom-4 right-4 bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 backdrop-blur-sm border border-red-400/50">
          <span className="text-sm">{projectError}</span>
          <button
            onClick={() => setProjectError(null)}
            className="text-white/80 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
