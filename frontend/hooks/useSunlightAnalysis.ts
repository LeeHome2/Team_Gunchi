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
import { mergeBlocks } from '@/hooks/useBuildingLine'
import type { SelectedBlock } from '@/types/cesium'

// ─── 타입 정의 ───

interface UseSunlightAnalysisOptions {
  /** 건축선 결과 가져오기 함수 */
  getBuildingLineResult: () => BuildingLineResult | null
  /** 선택된 필지 가져오기 함수 (건축선 미계산 시 fallback용) */
  getSelectedBlocks?: () => SelectedBlock[]
  /** 사용자 매스 엔티티 가져오기 함수 (일조 분석에서 제외) */
  getLoadedModelEntity?: () => any
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
  const { getBuildingLineResult, getSelectedBlocks, getLoadedModelEntity } = options

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

    // 분석 영역 결정
    // 1순위: buildableArea (건축선 + 도로/인접대지 offset 적용)
    // 2순위: buildingLine (건축선만 계산됨)
    // 3순위: cadastralPolygon (대지 경계선만 있음)
    // 4순위: 선택된 필지 직접 합필 (건축선 미계산 시 fallback)
    const buildingLineResult = getBuildingLineResult()
    let areaFeature: GeoJSON.Feature<GeoJSON.Polygon> | null =
      buildingLineResult?.buildableArea ??
      buildingLineResult?.buildingLine ??
      buildingLineResult?.cadastralPolygon ??
      null

    if (!areaFeature?.geometry && getSelectedBlocks) {
      const selectedBlocks = getSelectedBlocks()
      if (selectedBlocks.length > 0) {
        areaFeature = mergeBlocks(selectedBlocks)
        console.log('건축선 미계산 - 선택된 필지로 일조 분석 진행')
      }
    }

    if (!areaFeature?.geometry) {
      alert('먼저 필지를 선택해주세요. 지도에서 분석할 대지를 선택한 후 일조 분석을 진행하세요.')
      return
    }

    const buildableArea = areaFeature.geometry

    // 기존 히트맵 제거
    clearHeatmapEntities()

    setIsAnalyzing(true)
    setAnalysisProgress(null)

    try {
      // 사용자 매스 엔티티 가져오기 (일조 분석에서 제외)
      const loadedModelEntity = getLoadedModelEntity?.()
      const excludeObjects: any[] = []
      if (loadedModelEntity) {
        // Entity 자체 추가
        excludeObjects.push(loadedModelEntity)

        // Entity의 Model primitive 추출 (여러 방법 시도)
        // 방법 1: model._model (직접 접근)
        if (loadedModelEntity.model?._model) {
          excludeObjects.push(loadedModelEntity.model._model)
        }
        // 방법 2: _modelPrimitive (Entity가 렌더링된 후 생성됨)
        if ((loadedModelEntity as any)._modelPrimitive) {
          excludeObjects.push((loadedModelEntity as any)._modelPrimitive)
        }
        // 방법 3: DataSourceDisplay의 visualizers에서 찾기
        try {
          const dataSourceDisplay = (viewer as any)._dataSourceDisplay
          if (dataSourceDisplay) {
            const visualizers = dataSourceDisplay._defaultDataSource?._visualizers || []
            for (const visualizer of visualizers) {
              if (visualizer._modelHash) {
                const modelData = visualizer._modelHash.get?.(loadedModelEntity.id)
                if (modelData?.model) {
                  excludeObjects.push(modelData.model)
                  console.log('일조 분석: visualizer에서 모델 찾음')
                }
              }
            }
          }
        } catch (e) {
          // visualizer 접근 실패 무시
        }

        console.log('일조 분석: 사용자 매스 제외 설정됨, 제외 객체:', excludeObjects.length, '개')
      }

      console.log('일조 분석 시작:', {
        date: date.toISOString().split('T')[0],
        gridSpacing,
        excludeCount: excludeObjects.length,
      })

      // 분석 실행 (사용자 매스 제외)
      const result = await analyzeSunlight(
        viewer,
        buildableArea,
        date,
        gridSpacing,
        (progress) => setAnalysisProgress(progress),
        excludeObjects
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
  }, [viewerRef, getBuildingLineResult, getSelectedBlocks, getLoadedModelEntity, clearHeatmapEntities, heatmapMode])

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
