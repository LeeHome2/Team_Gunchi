/**
 * 프로젝트 직렬화/역직렬화 유틸리티
 */

import {
  ProjectFile,
  PROJECT_FILE_VERSION,
  ProjectFileValidation,
  SerializedCameraState,
  SerializedBlock,
  SerializedCadastralData,
  SerializedBuildingLineResult,
  SerializedModelTransform,
  SerializedWorkArea,
  SerializedBuilding,
  SerializedSite,
  SerializedHumanModelTransform,
  SerializedGeneratedMass,
  SerializedParkingZoneData,
  SerializedParkingEntranceData,
  SerializedParkingPathData,
  SerializedParkingConfig,
  SerializedParkingTransform,
} from '@/types/projectFile'

/**
 * Cesium viewer에서 카메라 상태 직렬화
 */
export function serializeCameraState(viewer: any): SerializedCameraState {
  const camera = viewer.camera
  return {
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
  }
}

/**
 * 프로젝트 파일 구조 및 버전 검증
 */
export function validateProjectFile(data: unknown): ProjectFileValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!data || typeof data !== 'object') {
    return {
      isValid: false,
      errors: ['올바르지 않은 파일 형식입니다'],
      warnings: [],
      version: '',
    }
  }

  const file = data as Partial<ProjectFile>

  // 버전 확인
  if (!file.version) {
    errors.push('버전 정보가 없습니다')
  }

  // 필수 필드 확인
  if (!file.camera) {
    errors.push('카메라 상태가 없습니다')
  }

  if (!file.currentTime) {
    errors.push('시간 정보가 없습니다')
  }

  if (!file.modelTransform) {
    errors.push('모델 변환 정보가 없습니다')
  }

  // 버전 호환성 확인
  if (file.version && file.version !== PROJECT_FILE_VERSION) {
    const [fileMajor] = file.version.split('.')
    const [currentMajor] = PROJECT_FILE_VERSION.split('.')

    if (fileMajor !== currentMajor) {
      errors.push(`호환되지 않는 버전입니다: ${file.version} (현재: ${PROJECT_FILE_VERSION})`)
    } else {
      warnings.push(`파일 버전 ${file.version}은 일부 기능이 다를 수 있습니다`)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    version: file.version || '',
  }
}

/**
 * 현재 상태에서 프로젝트 파일 객체 생성
 */
export function createProjectFile(params: {
  viewer: any
  workArea: SerializedWorkArea | null
  modelTransform: SerializedModelTransform
  building: SerializedBuilding | null
  site: SerializedSite | null
  selectedBlockCount: number
  humanScaleModelLoaded: boolean
  humanModelTransform: SerializedHumanModelTransform | null
  cadastralFeatures: GeoJSON.Feature<GeoJSON.Polygon>[]
  selectedRegion: { lon: number; lat: number } | null
  selectedBlocks: SerializedBlock[]
  buildingLineResult: SerializedBuildingLineResult | null
  showBuildingLine: boolean
  hiddenBuildingIds: string[]
  loadedModelFilename: string | null
  generatedMasses: SerializedGeneratedMass[]
  activeMassGlbUrl: string | null
  currentTime: Date
  projectName?: string
  // 주차 관련 데이터
  parkingZone?: SerializedParkingZoneData | null
  parkingEntrance?: SerializedParkingEntranceData | null
  parkingPath?: SerializedParkingPathData | null
  parkingConfig?: SerializedParkingConfig
  parkingTransform?: SerializedParkingTransform
  entranceTransform?: SerializedParkingTransform
  isParkingVisible?: boolean
  gridRotation?: number
}): ProjectFile {
  const {
    viewer,
    workArea,
    modelTransform,
    building,
    site,
    selectedBlockCount,
    humanScaleModelLoaded,
    humanModelTransform,
    cadastralFeatures,
    selectedRegion,
    selectedBlocks,
    buildingLineResult,
    showBuildingLine,
    hiddenBuildingIds,
    loadedModelFilename,
    generatedMasses,
    activeMassGlbUrl,
    currentTime,
    projectName,
    // 주차 관련
    parkingZone,
    parkingEntrance,
    parkingPath,
    parkingConfig,
    parkingTransform,
    entranceTransform,
    isParkingVisible,
    gridRotation,
  } = params

  return {
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    projectName,

    camera: serializeCameraState(viewer),
    currentTime: { isoString: currentTime.toISOString() },

    workArea,
    modelTransform,
    building,
    site,
    selectedBlockCount,
    humanScaleModelLoaded,

    cadastralData: {
      features: cadastralFeatures,
      selectedRegion,
    },
    selectedBlocks,
    buildingLineResult,
    showBuildingLine,
    hiddenBuildingIds,

    loadedModel: loadedModelFilename ? { filename: loadedModelFilename } : null,
    generatedMasses,
    activeMassGlbUrl,
    humanModelTransform,

    // 주차 관련 데이터
    parkingZone,
    parkingEntrance,
    parkingPath,
    parkingConfig,
    parkingTransform,
    entranceTransform,
    isParkingVisible,
    gridRotation,
  }
}

/**
 * 프로젝트 파일을 JSON으로 다운로드
 */
export function downloadProjectFile(
  projectFile: ProjectFile,
  filename: string = 'project.json'
): void {
  const json = JSON.stringify(projectFile, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * File 객체에서 프로젝트 파일 읽기
 */
export async function readProjectFile(file: File): Promise<ProjectFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (event) => {
      try {
        const json = event.target?.result as string
        const data = JSON.parse(json)

        const validation = validateProjectFile(data)
        if (!validation.isValid) {
          reject(new Error(validation.errors.join(', ')))
          return
        }

        if (validation.warnings.length > 0) {
          console.warn('프로젝트 파일 경고:', validation.warnings)
        }

        resolve(data as ProjectFile)
      } catch (error) {
        reject(new Error('프로젝트 파일 파싱에 실패했습니다'))
      }
    }

    reader.onerror = () => reject(new Error('파일 읽기에 실패했습니다'))
    reader.readAsText(file)
  })
}

/**
 * 프로젝트 파일 데이터 정리 (손상된 데이터 제거)
 */
export function sanitizeProjectFile(file: ProjectFile): ProjectFile {
  return {
    ...file,
    selectedBlocks: file.selectedBlocks.filter(
      (b) =>
        b.pnu &&
        b.feature?.geometry?.coordinates?.length > 0
    ),
    cadastralData: {
      features: file.cadastralData.features.filter(
        (f) => f.geometry?.coordinates?.length > 0
      ),
      selectedRegion: file.cadastralData.selectedRegion,
    },
  }
}
