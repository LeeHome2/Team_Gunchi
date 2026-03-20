'use client'

import { useCallback, useState, RefObject } from 'react'
import { useProjectStore } from '@/store/projectStore'
import {
  ProjectFile,
  SerializedBlock,
  SerializedCadastralData,
  SerializedBuildingLineResult,
  SerializedHumanModelTransform,
} from '@/types/projectFile'
import {
  createProjectFile,
  downloadProjectFile,
  readProjectFile,
} from '@/lib/projectSerializer'
import type { CesiumViewer, SelectedBlock } from '@/types/cesium'
import type { BuildingLineResult } from '@/lib/buildingLine'

interface UseProjectPersistenceOptions {
  viewerRef: RefObject<CesiumViewer | null>
  // 지적도 훅 상태
  getCadastralFeatures: () => GeoJSON.Feature<GeoJSON.Polygon>[]
  getSelectedRegion: () => { lon: number; lat: number } | null
  restoreCadastral: (data: SerializedCadastralData) => Promise<void>
  // 블록 선택 훅 상태
  getSelectedBlocks: () => SelectedBlock[]
  restoreBlockSelection: (blocks: SerializedBlock[]) => Promise<void>
  // 건축선 훅 상태
  getBuildingLineResult: () => BuildingLineResult | null
  getShowBuildingLine: () => boolean
  restoreBuildingLine: (result: SerializedBuildingLineResult | null, show: boolean) => Promise<void>
  // OSM 건물 훅 상태
  getHiddenBuildingIds: () => string[]
  restoreHiddenBuildings: (ids: string[]) => void
  // 모델 상태
  getLoadedModelFilename: () => string | null
  loadModel: (filename: string) => Promise<void>
  // 휴먼 모델 상태
  getHumanModelTransform: () => SerializedHumanModelTransform | null
  restoreHumanModelPosition: (transform: SerializedHumanModelTransform) => void
  // 시간 상태
  getCurrentTime: () => Date
  setCurrentTime: (time: Date) => void
}

interface UseProjectPersistenceReturn {
  isSaving: boolean
  isLoading: boolean
  lastError: string | null
  saveProject: (projectName?: string) => void
  loadProject: (file: File) => Promise<void>
  clearError: () => void
}

/**
 * 프로젝트 저장/불러오기 훅
 * 전체 상태 저장 및 복원 순서 조율
 */
export function useProjectPersistence(
  options: UseProjectPersistenceOptions
): UseProjectPersistenceReturn {
  const {
    viewerRef,
    getCadastralFeatures,
    getSelectedRegion,
    restoreCadastral,
    getSelectedBlocks,
    restoreBlockSelection,
    getBuildingLineResult,
    getShowBuildingLine,
    restoreBuildingLine,
    getHiddenBuildingIds,
    restoreHiddenBuildings,
    getLoadedModelFilename,
    loadModel,
    getHumanModelTransform,
    restoreHumanModelPosition,
    getCurrentTime,
    setCurrentTime,
  } = options

  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  // === 프로젝트 저장 ===
  const saveProject = useCallback((projectName?: string) => {
    const viewer = viewerRef.current
    if (!viewer) {
      setLastError('뷰어가 초기화되지 않았습니다')
      return
    }

    setIsSaving(true)
    setLastError(null)

    try {
      const store = useProjectStore.getState()

      // 선택된 블록 직렬화 (entity 제외)
      const selectedBlocks = getSelectedBlocks().map((b) => ({
        pnu: b.pnu,
        feature: b.feature,
      }))

      const projectFile = createProjectFile({
        viewer,
        workArea: store.workArea,
        modelTransform: store.modelTransform,
        building: store.building,
        site: store.site,
        selectedBlockCount: store.selectedBlockCount,
        humanScaleModelLoaded: store.humanScaleModelLoaded,
        humanModelTransform: getHumanModelTransform(),
        cadastralFeatures: getCadastralFeatures(),
        selectedRegion: getSelectedRegion(),
        selectedBlocks,
        buildingLineResult: getBuildingLineResult() as SerializedBuildingLineResult | null,
        showBuildingLine: getShowBuildingLine(),
        hiddenBuildingIds: getHiddenBuildingIds(),
        loadedModelFilename: getLoadedModelFilename(),
        currentTime: getCurrentTime(),
        projectName,
      })

      // 파일명 생성
      const filename = projectName
        ? `${projectName.replace(/[^a-z0-9가-힣]/gi, '_')}.json`
        : `project_${new Date().toISOString().slice(0, 10)}.json`

      downloadProjectFile(projectFile, filename)
      console.log('프로젝트 저장 완료:', filename)
    } catch (error) {
      console.error('프로젝트 저장 오류:', error)
      setLastError(error instanceof Error ? error.message : '프로젝트 저장에 실패했습니다')
    } finally {
      setIsSaving(false)
    }
  }, [
    viewerRef,
    getCadastralFeatures,
    getSelectedRegion,
    getSelectedBlocks,
    getBuildingLineResult,
    getShowBuildingLine,
    getHiddenBuildingIds,
    getLoadedModelFilename,
    getHumanModelTransform,
    getCurrentTime,
  ])

  // === 프로젝트 불러오기 ===
  const loadProject = useCallback(async (file: File) => {
    const viewer = viewerRef.current
    if (!viewer) {
      setLastError('뷰어가 초기화되지 않았습니다')
      return
    }

    setIsLoading(true)
    setLastError(null)

    try {
      const projectFile = await readProjectFile(file)
      const Cesium = (window as any).Cesium

      // === 복원 순서 ===
      // 순서가 중요함 - 시각적 아티팩트 방지

      // 1. 카메라 위치 복원 (즉시)
      console.log('카메라 복원 중...')
      viewer.camera.setView({
        destination: new Cesium.Cartesian3(
          projectFile.camera.position.x,
          projectFile.camera.position.y,
          projectFile.camera.position.z
        ),
        orientation: {
          heading: projectFile.camera.heading,
          pitch: projectFile.camera.pitch,
          roll: projectFile.camera.roll,
        },
      })

      // 2. 시간 복원 (그림자용)
      console.log('시간 복원 중...')
      const restoredTime = new Date(projectFile.currentTime.isoString)
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(restoredTime)
      setCurrentTime(restoredTime)

      // 3. 프로젝트 스토어 상태 복원
      console.log('스토어 상태 복원 중...')
      const {
        setWorkArea,
        setModelTransform,
        setBuilding,
        setSite,
        setHumanScaleModelLoaded,
        setSelectedBlockCount,
      } = useProjectStore.getState()

      if (projectFile.workArea) {
        setWorkArea(projectFile.workArea)
      }
      setModelTransform(projectFile.modelTransform)
      if (projectFile.building) {
        setBuilding(projectFile.building)
      }
      if (projectFile.site) {
        setSite(projectFile.site)
      }

      // 4. 지적도 데이터 복원 (폴리라인 생성 필요)
      console.log('지적도 복원 중...')
      await restoreCadastral(projectFile.cadastralData)

      // 지적도 렌더링 완료 대기
      await new Promise(resolve => setTimeout(resolve, 300))

      // 5. 블록 선택 복원 (폴리곤 엔티티 생성)
      console.log('블록 선택 복원 중...')
      await restoreBlockSelection(projectFile.selectedBlocks)

      // 6. 건축선 복원 (선택된 블록 필요)
      console.log('건축선 복원 중...')
      await restoreBuildingLine(
        projectFile.buildingLineResult,
        projectFile.showBuildingLine
      )

      // 7. 로드된 모델 복원 (있는 경우)
      if (projectFile.loadedModel?.filename) {
        console.log('모델 복원 중...')
        await loadModel(projectFile.loadedModel.filename)
      }

      // 8. 휴먼 스케일 모델 복원
      setHumanScaleModelLoaded(projectFile.humanScaleModelLoaded)

      // 8-1. 휴먼 모델 위치 복원
      if (projectFile.humanScaleModelLoaded && projectFile.humanModelTransform) {
        console.log('휴먼 모델 위치 복원 중...')
        // 휴먼 모델이 로드된 후 위치 설정을 위해 약간 대기
        setTimeout(() => {
          if (projectFile.humanModelTransform) {
            restoreHumanModelPosition(projectFile.humanModelTransform)
          }
        }, 500)
      }

      // 9. 숨긴 OSM 건물 복원 (마지막에 스타일 적용)
      console.log('숨긴 건물 복원 중...')
      restoreHiddenBuildings(projectFile.hiddenBuildingIds)

      // 최종 렌더
      viewer.scene.requestRender()
      console.log('프로젝트 복원 완료')
    } catch (error) {
      console.error('프로젝트 불러오기 오류:', error)
      setLastError(error instanceof Error ? error.message : '프로젝트 불러오기에 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }, [
    viewerRef,
    setCurrentTime,
    restoreCadastral,
    restoreBlockSelection,
    restoreBuildingLine,
    loadModel,
    restoreHumanModelPosition,
    restoreHiddenBuildings,
  ])

  const clearError = useCallback(() => {
    setLastError(null)
  }, [])

  return {
    isSaving,
    isLoading,
    lastError,
    saveProject,
    loadProject,
    clearError,
  }
}
