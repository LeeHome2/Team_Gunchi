'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback, useRef } from 'react'
import { useProjectStore } from '@/store/projectStore'
import Sidebar from '@/components/Sidebar'
import ErrorBanner from '@/components/ErrorBanner'

const CesiumViewer = dynamic(() => import('@/components/CesiumViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-200">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">3D 지도 로딩 중...</p>
      </div>
    </div>
  ),
})

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [projectName, setProjectName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    isLoading, viewer, setError,
    saveProjectFn, loadProjectFn, isSavingProject, isLoadingProject, projectError,
    setProjectError,
  } = useProjectStore()

  // 주소 검색 및 이동
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !viewer) return

    setIsSearching(true)
    try {
      // Nominatim API로 geocoding (OpenStreetMap 무료 API)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`,
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
  }, [searchQuery, viewer])

  // Enter 키로 검색
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  // 프로젝트 저장 다이얼로그 열기
  const handleOpenSaveDialog = useCallback(() => {
    if (!saveProjectFn) {
      setError('뷰어가 초기화되지 않았습니다')
      return
    }
    setProjectName('')
    setShowSaveDialog(true)
  }, [saveProjectFn, setError])

  // 프로젝트 저장 실행
  const handleSaveProject = useCallback(() => {
    if (saveProjectFn) {
      saveProjectFn(projectName || undefined)
      setShowSaveDialog(false)
      setProjectName('')
    }
  }, [saveProjectFn, projectName])

  // 프로젝트 불러오기 (파일 선택)
  const handleLoadClick = useCallback(() => {
    if (!loadProjectFn) {
      setError('뷰어가 초기화되지 않았습니다')
      return
    }
    fileInputRef.current?.click()
  }, [loadProjectFn, setError])

  // 파일 선택 후 불러오기
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && loadProjectFn) {
      await loadProjectFn(file)
    }
    // 같은 파일 다시 선택 가능하도록
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [loadProjectFn])

  // 새로고침
  const handleRefresh = useCallback(() => {
    window.location.reload()
  }, [])

  const sidebarClass = `bg-white border-r border-gray-200 flex-shrink-0 transition-all duration-300 ${sidebarOpen ? "w-80" : "w-0"} overflow-hidden`

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* 에러 배너 */}
      <ErrorBanner />

      <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-800">AI 건축물 배치 시스템</h1>
            <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">Cesium 3D</span>
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-md mx-8">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="주소 검색 (예: 서울시 강남구, 판교역)"
                className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSearching ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                '검색'
              )}
            </button>
          </div>
          <nav className="flex items-center gap-4">
            <button
              onClick={handleOpenSaveDialog}
              disabled={isSavingProject || !saveProjectFn}
              className="text-gray-600 hover:text-gray-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isSavingProject && (
                <div className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
              )}
              프로젝트 저장
            </button>
            <button
              onClick={handleLoadClick}
              disabled={isLoadingProject || !loadProjectFn}
              className="text-gray-600 hover:text-gray-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isLoadingProject && (
                <div className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
              )}
              불러오기
            </button>
            <button
              onClick={handleRefresh}
              className="text-gray-600 hover:text-gray-800 text-sm flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              새로고침
            </button>
          </nav>
          {/* 숨겨진 파일 입력 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title={sidebarOpen ? "사이드바 숨기기" : "사이드바 보이기"}
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="text-sm text-gray-600">3D 뷰포트</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>좌클릭: 회전</span>
              <span className="text-gray-300">|</span>
              <span>우클릭: 시점</span>
              <span className="text-gray-300">|</span>
              <span>휠: 줌</span>
            </div>
          </div>
          <div className="flex-1 relative bg-gray-900">
            <CesiumViewer />
            {isLoading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-6 text-center shadow-xl">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p className="text-gray-700">처리 중...</p>
                </div>
              </div>
            )}
          </div>
          <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between text-xs text-gray-500 flex-shrink-0">
            <div className="flex items-center gap-4">
              <span>위치: 성남시 분당구</span>
              <span>좌표: 127.1388, 37.4449</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Google Maps</span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                연결됨
              </span>
            </div>
          </div>
        </main>
        <aside className={`bg-white border-l border-gray-200 flex-shrink-0 transition-all duration-300 ${sidebarOpen ? "w-80" : "w-0"} overflow-hidden`}>
          <div className="w-80 h-full">
            <Sidebar />
          </div>
        </aside>
      </div>

      {/* 프로젝트 저장 다이얼로그 */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">프로젝트 저장</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                프로젝트 이름 (선택사항)
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="예: 판교 주택 설계"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
              >
                취소
              </button>
              <button
                onClick={handleSaveProject}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 프로젝트 에러 토스트 */}
      {projectError && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3">
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
