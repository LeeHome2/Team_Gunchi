/**
 * Backend API 클라이언트
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

/**
 * DXF 파일 업로드
 */
export async function uploadDxf(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_URL}/api/upload-dxf`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'DXF 업로드 실패')
  }

  return response.json()
}

/**
 * 3D 매스 생성
 */
export async function generateMass(params: {
  footprint: number[][]
  height: number
  floors: number
  position?: number[]
}) {
  const response = await fetch(`${API_URL}/api/generate-mass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '매스 생성 실패')
  }

  return response.json()
}

/**
 * 배치 규정 검토
 */
export async function validatePlacement(params: {
  site_footprint: number[][]
  building_footprint: number[][]
  building_height: number
  coverage_limit?: number
  setback_required?: number
  height_limit?: number
}) {
  const response = await fetch(`${API_URL}/api/validate-placement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '배치 검토 실패')
  }

  return response.json()
}

/**
 * 프로젝트 조회
 */
export async function getProject(id: string) {
  const response = await fetch(`${API_URL}/api/project/${id}`)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 조회 실패')
  }

  return response.json()
}

/**
 * 헬스 체크
 */
export async function healthCheck() {
  const response = await fetch(`${API_URL}/health`)
  return response.json()
}
