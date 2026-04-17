/**
 * 일조 분석 API 연동 모듈
 *
 * 분석 결과를 백엔드에 저장하고 조회하는 API 함수들입니다.
 * 현재 백엔드 미구현 상태이므로 에러 핸들링을 포함합니다.
 */

import type { SunlightAnalysisResult, SunlightPoint } from './sunlightAnalysis'

// Next.js rewrites가 /api/* → FastAPI로 프록시하므로 상대경로 사용
const API_URL = ''

// ─── 타입 정의 ───

export interface SaveSunlightRequest {
  projectId: string
  analysisDate: string
  gridSpacing: number
  points: Array<{
    longitude: number
    latitude: number
    sunlightHours: number
    hourlyDetail: boolean[]
  }>
}

export interface SaveSunlightResponse {
  success: boolean
  analysisId?: string
  message?: string
}

export interface LoadSunlightResponse {
  success: boolean
  data?: SunlightAnalysisResult
  message?: string
}

// ─── API 함수 ───

/**
 * 일조 분석 결과를 서버에 저장
 *
 * @param projectId - 프로젝트 ID
 * @param result - 일조 분석 결과
 * @returns 저장 결과
 */
export async function saveSunlightAnalysis(
  projectId: string,
  result: SunlightAnalysisResult
): Promise<SaveSunlightResponse> {
  try {
    const requestBody: SaveSunlightRequest = {
      projectId,
      analysisDate: result.analysisDate,
      gridSpacing: result.gridSpacing,
      points: result.points.map((point) => ({
        longitude: point.longitude,
        latitude: point.latitude,
        sunlightHours: point.sunlightHours,
        hourlyDetail: point.hourlyDetail,
      })),
    }

    const response = await fetch(`${API_URL}/api/projects/${projectId}/sunlight-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      // 백엔드 미구현 시 404 반환 예상
      if (response.status === 404) {
        console.warn('일조 분석 저장 API가 아직 구현되지 않았습니다')
        return {
          success: false,
          message: 'API 미구현 (백엔드 개발 필요)',
        }
      }

      throw new Error(`저장 실패: ${response.status}`)
    }

    const data = await response.json()
    return {
      success: true,
      analysisId: data.analysisId,
      message: '저장 완료',
    }
  } catch (error) {
    console.error('일조 분석 저장 오류:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '저장 중 오류 발생',
    }
  }
}

/**
 * 저장된 일조 분석 결과 조회
 *
 * @param projectId - 프로젝트 ID
 * @param date - 분석 날짜 (YYYY-MM-DD)
 * @returns 일조 분석 결과
 */
export async function loadSunlightAnalysis(
  projectId: string,
  date?: string
): Promise<LoadSunlightResponse> {
  try {
    const url = date
      ? `/api/projects/${projectId}/sunlight-analysis?date=${date}`
      : `${API_URL}/api/projects/${projectId}/sunlight-analysis`

    const response = await fetch(url)

    if (!response.ok) {
      // 백엔드 미구현 시 404 반환 예상
      if (response.status === 404) {
        console.warn('일조 분석 조회 API가 아직 구현되지 않았습니다')
        return {
          success: false,
          message: 'API 미구현 (백엔드 개발 필요)',
        }
      }

      throw new Error(`조회 실패: ${response.status}`)
    }

    const data = await response.json()
    return {
      success: true,
      data: data as SunlightAnalysisResult,
    }
  } catch (error) {
    console.error('일조 분석 조회 오류:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '조회 중 오류 발생',
    }
  }
}

/**
 * 저장된 일조 분석 삭제
 *
 * @param projectId - 프로젝트 ID
 * @param analysisId - 분석 ID
 * @returns 삭제 결과
 */
export async function deleteSunlightAnalysis(
  projectId: string,
  analysisId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch(
      `/api/projects/${projectId}/sunlight-analysis/${analysisId}`,
      { method: 'DELETE' }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          message: 'API 미구현 (백엔드 개발 필요)',
        }
      }

      throw new Error(`삭제 실패: ${response.status}`)
    }

    return {
      success: true,
      message: '삭제 완료',
    }
  } catch (error) {
    console.error('일조 분석 삭제 오류:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '삭제 중 오류 발생',
    }
  }
}

// ─── 로컬 저장 (백엔드 미구현 시 대안) ───

const STORAGE_KEY_PREFIX = 'sunlight_analysis_'

/**
 * 일조 분석 결과를 로컬 스토리지에 저장
 *
 * @param projectId - 프로젝트 ID
 * @param result - 일조 분석 결과
 */
export function saveSunlightAnalysisLocal(
  projectId: string,
  result: SunlightAnalysisResult
): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}${projectId}_${result.analysisDate}`
    localStorage.setItem(key, JSON.stringify(result))
    console.log('일조 분석 결과 로컬 저장 완료:', key)
  } catch (error) {
    console.error('로컬 저장 실패:', error)
  }
}

/**
 * 로컬 스토리지에서 일조 분석 결과 조회
 *
 * @param projectId - 프로젝트 ID
 * @param date - 분석 날짜 (YYYY-MM-DD)
 * @returns 일조 분석 결과 또는 null
 */
export function loadSunlightAnalysisLocal(
  projectId: string,
  date: string
): SunlightAnalysisResult | null {
  try {
    const key = `${STORAGE_KEY_PREFIX}${projectId}_${date}`
    const data = localStorage.getItem(key)

    if (!data) return null

    return JSON.parse(data) as SunlightAnalysisResult
  } catch (error) {
    console.error('로컬 조회 실패:', error)
    return null
  }
}

/**
 * 특정 프로젝트의 모든 일조 분석 결과 목록 조회
 *
 * @param projectId - 프로젝트 ID
 * @returns 분석 날짜 목록
 */
export function listSunlightAnalysisLocal(projectId: string): string[] {
  const dates: string[] = []
  const prefix = `${STORAGE_KEY_PREFIX}${projectId}_`

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) {
      const date = key.replace(prefix, '')
      dates.push(date)
    }
  }

  return dates.sort().reverse()
}

/**
 * 로컬 저장된 일조 분석 결과 삭제
 *
 * @param projectId - 프로젝트 ID
 * @param date - 분석 날짜 (YYYY-MM-DD)
 */
export function deleteSunlightAnalysisLocal(
  projectId: string,
  date: string
): void {
  const key = `${STORAGE_KEY_PREFIX}${projectId}_${date}`
  localStorage.removeItem(key)
  console.log('일조 분석 결과 로컬 삭제 완료:', key)
}

// ─── JSON 파일 다운로드 ───

/**
 * 일조 분석 결과를 JSON 파일로 다운로드
 *
 * @param result - 일조 분석 결과
 * @param filename - 파일명 (확장자 제외)
 */
export function downloadSunlightAnalysisJson(
  result: SunlightAnalysisResult,
  filename?: string
): void {
  const data = JSON.stringify(result, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename || `sunlight_analysis_${result.analysisDate}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  console.log('일조 분석 결과 다운로드 완료')
}

/**
 * JSON 파일에서 일조 분석 결과 로드
 *
 * @param file - JSON 파일
 * @returns 일조 분석 결과
 */
export async function loadSunlightAnalysisFromFile(
  file: File
): Promise<SunlightAnalysisResult | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string)

        // 기본 유효성 검사
        if (
          !data.analysisDate ||
          !data.points ||
          !Array.isArray(data.points)
        ) {
          console.error('유효하지 않은 일조 분석 파일')
          resolve(null)
          return
        }

        resolve(data as SunlightAnalysisResult)
      } catch (error) {
        console.error('파일 파싱 오류:', error)
        resolve(null)
      }
    }

    reader.onerror = () => {
      console.error('파일 읽기 오류')
      resolve(null)
    }

    reader.readAsText(file)
  })
}
