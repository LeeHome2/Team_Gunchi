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
import { saveProjectState, loadProjectState } from '@/lib/api'
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
  loadFromDb: () => Promise<void>
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

  // === 프로젝트 저장 (DB 우선, 폴백: JSON 파일) ===
  const saveProject = useCallback(async (projectName?: string) => {
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
        generatedMasses: store.generatedMasses,
        activeMassGlbUrl: store.loadedMassGlbUrl || null,
        currentTime: getCurrentTime(),
        projectName,
      })

      // DB에 저장 시도 (projectId가 있는 경우)
      const projectId = store.projectId
      if (projectId) {
        try {
          await saveProjectState(projectId, projectFile as any)
          console.log('프로젝트 DB 저장 완료:', projectId)
          return // DB 저장 성공 → 완료
        } catch (dbError) {
          console.warn('DB 저장 실패, JSON 파일로 폴백:', dbError)
        }
      }

      // 폴백: JSON 파일 다운로드 (projectId 없거나 DB 저장 실패)
      const filename = projectName
        ? `${projectName.replace(/[^a-z0-9가-힣]/gi, '_')}.json`
        : `project_${new Date().toISOString().slice(0, 10)}.json`

      downloadProjectFile(projectFile, filename)
      console.log('프로젝트 파일 저장 완료:', filename)
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

  // === 프로젝트 상태 복원 (공통 로직) ===
  const restoreProjectState = useCallback(async (projectFile: ProjectFile) => {
    const viewer = viewerRef.current
    if (!viewer) throw new Error('뷰어가 초기화되지 않았습니다')

    const Cesium = (window as any).Cesium

    // 1. 카메라 위치 복원
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

    // 2. 시간 복원
    console.log('시간 복원 중...')
    const restoredTime = new Date(projectFile.currentTime.isoString)
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(restoredTime)
    setCurrentTime(restoredTime)

    // 3. 스토어 상태 복원
    console.log('스토어 상태 복원 중...')
    const {
      setWorkArea,
      setModelTransform,
      setBuilding,
      setSite,
      setHumanScaleModelLoaded,
    } = useProjectStore.getState()

    if (projectFile.workArea) setWorkArea(projectFile.workArea)
    setModelTransform(projectFile.modelTransform)
    if (projectFile.building) setBuilding(projectFile.building)
    if (projectFile.site) setSite(projectFile.site)

    // 4. 지적도 복원
    console.log('지적도 복원 중...')
    await restoreCadastral(projectFile.cadastralData)
    await new Promise(resolve => setTimeout(resolve, 300))

    // 5. 블록 선택 복원
    console.log('블록 선택 복원 중...')
    await restoreBlockSelection(projectFile.selectedBlocks)

    // 6. 건축선 복원
    console.log('건축선 복원 중...')
    await restoreBuildingLine(
      projectFile.buildingLineResult,
      projectFile.showBuildingLine
    )

    // 7-a. 생성된 매스 모델 복원
    if (projectFile.generatedMasses && projectFile.generatedMasses.length > 0) {
      console.log('매스 모델 목록 복원 중...', projectFile.generatedMasses.length, '개')
      const store = useProjectStore.getState()
      // 기존 매스 목록 비우고 저장된 목록으로 교체
      for (const mass of projectFile.generatedMasses) {
        // 이미 같은 ID가 있으면 스킵
        if (!store.generatedMasses.find(m => m.id === mass.id)) {
          store.addGeneratedMass(mass)
        }
      }
    }

    // 7-b. 배치된 매스 GLB 복원 (building/site 정보가 있고 매스가 있으면)
    if (projectFile.activeMassGlbUrl || (projectFile.building && projectFile.generatedMasses?.length)) {
      const massUrl = projectFile.activeMassGlbUrl
        || projectFile.generatedMasses?.find(m => m.glbUrl)?.glbUrl
      if (massUrl) {
        console.log('매스 GLB 복원 중:', massUrl)
        // 저장된 transform 정보를 함께 전달 (위치, 각도, 스케일 복원용)
        const savedTransform = projectFile.modelTransform
        setTimeout(() => {
          useProjectStore.getState().setMassGlbToLoad(massUrl, {
            longitude: savedTransform.longitude,
            latitude: savedTransform.latitude,
            height: savedTransform.height,
            rotation: savedTransform.rotation,
            scale: savedTransform.scale,
          })
        }, 500)
      }
    }

    // 7-c. 샘플 모델 복원 (있는 경우)
    if (projectFile.loadedModel?.filename) {
      console.log('샘플 모델 복원 중...')
      await loadModel(projectFile.loadedModel.filename)
    }

    // 8. 휴먼 스케일 모델 복원
    setHumanScaleModelLoaded(projectFile.humanScaleModelLoaded)
    if (projectFile.humanScaleModelLoaded && projectFile.humanModelTransform) {
      setTimeout(() => {
        if (projectFile.humanModelTransform) {
          restoreHumanModelPosition(projectFile.humanModelTransform)
        }
      }, 500)
    }

    // 9. 숨긴 OSM 건물 복원
    console.log('숨긴 건물 복원 중...')
    restoreHiddenBuildings(projectFile.hiddenBuildingIds)

    viewer.scene.requestRender()
    console.log('프로젝트 복원 완료')
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

  // === 프로젝트 불러오기 (JSON 파일) ===
  const loadProject = useCallback(async (file: File) => {
    if (!viewerRef.current) {
      setLastError('뷰어가 초기화되지 않았습니다')
      return
    }

    setIsLoading(true)
    setLastError(null)

    try {
      const projectFile = await readProjectFile(file)
      await restoreProjectState(projectFile)
    } catch (error) {
      console.error('프로젝트 불러오기 오류:', error)
      setLastError(error instanceof Error ? error.message : '프로젝트 불러오기에 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }, [viewerRef, restoreProjectState])

  // === DB에서 프로젝트 불러오기 ===
  const loadFromDb = useCallback(async () => {
    if (!viewerRef.current) {
      setLastError('뷰어가 초기화되지 않았습니다')
      return
    }

    const projectId = useProjectStore.getState().projectId
    if (!projectId) {
      setLastError('프로젝트가 선택되지 않았습니다')
      return
    }

    setIsLoading(true)
    setLastError(null)

    try {
      const stateData = await loadProjectState(projectId)
      if (!stateData) {
        console.log('DB에 저장된 상태 없음')
        return
      }
      await restoreProjectState(stateData as ProjectFile)
      console.log('DB에서 프로젝트 복원 완료:', projectId)
    } catch (error) {
      console.error('DB 프로젝트 불러오기 오류:', error)
      setLastError(error instanceof Error ? error.message : '프로젝트 불러오기에 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }, [viewerRef, restoreProjectState])

  const clearError = useCallback(() => {
    setLastError(null)
  }, [])

  return {
    isSaving,
    isLoading,
    lastError,
    saveProject,
    loadProject,
    loadFromDb,
    clearError,
  }
}
