'use client'

import { useCallback, useState, useRef, RefObject } from 'react'
import {
  analyzeSunlight,
  debugSunDirection,
  type SunlightAnalysisResult,
  type AnalysisProgress,
} from '@/lib/sunlightAnalysis'
import {
  renderSunlightHeatmap,
  clearSunlightHeatmap,
  toggleHeatmapVisibility,
  type HeatmapOptions,
} from '@/lib/sunlightHeatmap'
import type { BuildingLineResult } from '@/lib/buildingLine'

// ─── 타입 정의 ───

interface UseSunlightAnalysisOptions {
  /** 건축선 결과 가져오기 함수 */
  getBuildingLineResult: () => BuildingLineResult | null
}

interface UseSunlightAnalysisReturn {
  // 상태
  isAnalyzing: boolean
  analysisProgress: AnalysisProgress | null
  analysisResult: SunlightAnalysisResult | null
  showHeatmap: boolean
  heatmapMode: 'point' | 'cell'

  // 액션
  startAnalysis: (date: Date, gridSpacing?: number) => Promise<void>
  clearAnalysis: () => void
  toggleHeatmap: () => void
  setHeatmapMode: (mode: 'point' | 'cell') => void

  // 디버그
  debugSun: () => void
}

/**
 * 일조 분석 관리 훅
 */
export function useSunlightAnalysis(
  viewerRef: RefObject<any>,
  options: UseSunlightAnalysisOptions
): UseSunlightAnalysisReturn {
  const { getBuildingLineResult } = options

  // 상태
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analysisResult, setAnalysisResult] = useState<SunlightAnalysisResult | null>(null)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [heatmapMode, setHeatmapMode] = useState<'point' | 'cell'>('point')

  // Refs
  const heatmapEntitiesRef = useRef<any[]>([])

  /**
   * 히트맵 엔티티 정리
   */
  const clearHeatmapEntities = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (heatmapEntitiesRef.current.length > 0) {
      clearSunlightHeatmap(viewer, heatmapEntitiesRef.current)
      heatmapEntitiesRef.current = []
    }
  }, [viewerRef])

  /**
   * 일조 분석 시작
   */
  const startAnalysis = useCallback(async (
    date: Date,
    gridSpacing: number = 2
  ) => {
    const viewer = viewerRef.current
    if (!viewer) {
      console.error('Viewer가 없습니다')
      return
    }

    // 건축선 결과에서 buildableArea 가져오기
    const buildingLineResult = getBuildingLineResult()
    if (!buildingLineResult?.buildableArea?.geometry) {
      alert('먼저 건축선을 계산해주세요. 건축선 버튼을 클릭하여 건축 가능 영역을 생성하세요.')
      return
    }

    const buildableArea = buildingLineResult.buildableArea.geometry

    // 기존 히트맵 제거
    clearHeatmapEntities()

    setIsAnalyzing(true)
    setAnalysisProgress(null)

    try {
      console.log('일조 분석 시작:', {
        date: date.toISOString().split('T')[0],
        gridSpacing,
      })

      // 분석 실행
      const result = await analyzeSunlight(
        viewer,
        buildableArea,
        date,
        gridSpacing,
        (progress) => setAnalysisProgress(progress)
      )

      setAnalysisResult(result)

      // 히트맵 렌더링
      const heatmapOptions: HeatmapOptions = {
        mode: heatmapMode,
        pointSize: heatmapMode === 'point' ? 10 : undefined,
        alpha: 0.7,
      }

      const entities = renderSunlightHeatmap(viewer, result, heatmapOptions)
      heatmapEntitiesRef.current = entities

      setShowHeatmap(true)
      console.log('일조 분석 완료')

    } catch (error) {
      console.error('일조 분석 실패:', error)
      alert(`일조 분석 중 오류가 발생했습니다: ${error}`)
    } finally {
      setIsAnalyzing(false)
      setAnalysisProgress(null)
    }
  }, [viewerRef, getBuildingLineResult, clearHeatmapEntities, heatmapMode])

  /**
   * 분석 결과 및 히트맵 초기화
   */
  const clearAnalysis = useCallback(() => {
    clearHeatmapEntities()
    setAnalysisResult(null)
    setAnalysisProgress(null)
    setShowHeatmap(true)
  }, [clearHeatmapEntities])

  /**
   * 히트맵 가시성 토글
   */
  const toggleHeatmap = useCallback(() => {
    const newVisibility = !showHeatmap
    setShowHeatmap(newVisibility)
    toggleHeatmapVisibility(heatmapEntitiesRef.current, newVisibility)

    const viewer = viewerRef.current
    if (viewer) {
      viewer.scene.requestRender()
    }
  }, [showHeatmap, viewerRef])

  /**
   * 히트맵 모드 변경
   */
  const handleSetHeatmapMode = useCallback((mode: 'point' | 'cell') => {
    setHeatmapMode(mode)

    // 결과가 있으면 히트맵 다시 렌더링
    const viewer = viewerRef.current
    if (viewer && analysisResult) {
      clearHeatmapEntities()

      const heatmapOptions: HeatmapOptions = {
        mode,
        pointSize: mode === 'point' ? 10 : undefined,
        alpha: 0.7,
      }

      const entities = renderSunlightHeatmap(viewer, analysisResult, heatmapOptions)
      heatmapEntitiesRef.current = entities

      viewer.scene.requestRender()
    }
  }, [viewerRef, analysisResult, clearHeatmapEntities])

  /**
   * 태양 방향 디버그
   */
  const debugSun = useCallback(() => {
    const viewer = viewerRef.current
    if (viewer) {
      debugSunDirection(viewer)
    }
  }, [viewerRef])

  return {
    // 상태
    isAnalyzing,
    analysisProgress,
    analysisResult,
    showHeatmap,
    heatmapMode,

    // 액션
    startAnalysis,
    clearAnalysis,
    toggleHeatmap,
    setHeatmapMode: handleSetHeatmapMode,

    // 디버그
    debugSun,
  }
}
