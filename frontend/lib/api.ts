/**
 * Backend API 클라이언트
 */

// Next.js rewrites가 /api/* → FastAPI로 프록시하므로 상대경로 사용
const API_URL = ''

/* ============================================================================
 * Auth API
 * ==========================================================================*/

export interface AuthUser {
  user_id: string
  name: string
  email: string
}

/**
 * 회원가입
 */
export async function signup(name: string, email: string, password: string): Promise<{
  success: boolean
  user_id?: string
  name?: string
  email?: string
  message?: string
}> {
  const response = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })

  return response.json()
}

/**
 * 로그인
 */
export async function login(email: string, password: string): Promise<{
  success: boolean
  user_id?: string
  name?: string
  email?: string
  message?: string
}> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  return response.json()
}

/* ============================================================================
 * DXF & Mass API
 * ==========================================================================*/

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
 * 클라이언트에서 계산한 규정 검토 결과를 DB에 저장한다.
 * 관리자 결과 관리 탭에서 조회 가능하게 하기 위함.
 */
export async function saveReviewResult(
  projectId: string,
  payload: {
    is_valid: boolean
    building_coverage?: Record<string, unknown>
    setback?: Record<string, unknown>
    height_check?: Record<string, unknown>
    violations?: Array<Record<string, unknown>>
    zone_type?: string | null
    model_id?: string | null
  },
) {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || '검토 결과 저장 실패')
  }
  return response.json()
}

/**
 * 프로젝트 생성
 * DXF 업로드 전에 호출하여 project_id를 발급받습니다.
 */
export async function createProject(name: string, address?: string, user_id?: string) {
  const response = await fetch(`${API_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, address, user_id }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 생성 실패')
  }

  return response.json()
}

/**
 * 프로젝트 목록 조회
 */
export async function listProjects(skip = 0, limit = 50, user_id?: string) {
  const params = new URLSearchParams({ skip: String(skip), limit: String(limit) })
  if (user_id) params.set('user_id', user_id)

  const response = await fetch(`${API_URL}/api/projects?${params}`)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 목록 조회 실패')
  }

  return response.json()
}

/**
 * 프로젝트 상세 조회
 */
export async function getProject(id: string) {
  const response = await fetch(`${API_URL}/api/projects/${id}`)

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 조회 실패')
  }

  return response.json()
}

/**
 * 프로젝트 정보 업데이트
 */
export async function updateProject(id: string, data: {
  name?: string
  address?: string
  longitude?: number
  latitude?: number
  zone_type?: string
}) {
  const response = await fetch(`${API_URL}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 업데이트 실패')
  }

  return response.json()
}

/**
 * 프로젝트 에디터 상태 저장 (DB)
 */
export async function saveProjectState(projectId: string, stateData: Record<string, any>) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stateData),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 상태 저장 실패')
  }

  return response.json()
}

/**
 * 프로젝트 에디터 상태 불러오기 (DB)
 */
export async function loadProjectState(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/state`)

  if (!response.ok) {
    if (response.status === 404) return null // 저장된 상태 없음
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 상태 불러오기 실패')
  }

  return response.json()
}

/**
 * 프로젝트 삭제
 */
export async function deleteProject(id: string) {
  const response = await fetch(`${API_URL}/api/projects/${id}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '프로젝트 삭제 실패')
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


/* ============================================================================
 * Parking Zone API
 * ==========================================================================*/

/**
 * 건물 용도 목록 조회
 */
export async function getParkingUseTypes(): Promise<{ use_types: string[] }> {
  const response = await fetch(`${API_URL}/api/parking/use-types`)
  if (!response.ok) throw new Error('용도 목록 조회 실패')
  return response.json()
}

/**
 * 필요 주차 대수 산정
 */
export async function calculateParkingRequired(params: {
  building_use: string
  gross_floor_area_m2: number
  ramp?: boolean
}) {
  const response = await fetch(`${API_URL}/api/parking/calculate-required`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '주차 대수 산정 실패')
  }
  return response.json()
}

/**
 * 주차구역 자동 배치
 */
export async function generateParkingLayout(params: {
  site_footprint: number[][]
  building_footprint: number[][]
  required_total: number
  required_disabled?: number
  road_lines?: number[][][] | null
  preferred_heading?: number
}) {
  const response = await fetch(`${API_URL}/api/parking/generate-layout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '주차구역 배치 실패')
  }
  return response.json()
}

/* ============================================================================
 * Admin Console API
 * ==========================================================================*/

async function adminFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || detail
    } catch {}
    throw new Error(`${res.status} ${detail}`)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

export interface AdminUser {
  id: string
  name: string
  email: string
  status: string
  joined_at: string | null
  last_login_at: string | null
  project_count: number
}

export interface AdminProject {
  id: string
  name: string
  address: string | null
  zone_type: string | null
  created_at: string | null
  updated_at: string | null
  has_dxf: boolean
  area_sqm: number | null
}

export interface AdminResult {
  id: string
  project_id: string
  project_name: string
  is_valid: boolean
  coverage: number | null
  floor_area_ratio: number | null
  height: number | null
  zone_type: string | null
  created_at: string | null
}

export interface AdminBaseRule {
  key: string
  label: string
  unit: string
  value: number
  description: string | null
  updated_at: string | null
}

export interface AdminZoneRule {
  id: string
  zone: string
  region: string
  coverage: number
  far: number
  height_max: number
  setback: number
  updated_at: string | null
}

export interface AdminAIModel {
  id: string
  model_name: string
  version: string
  model_type: string
  is_active: boolean
  accuracy: number | null
  description: string | null
  file_path?: string | null
  trained_at: string | null
  created_at: string | null
}

// classifier MLOps experiment (Team_Gunchi_classifier 프록시 응답)
export interface AIExperiment {
  run_id: string
  model_version?: string
  algorithm?: string
  status?: string
  is_active?: boolean
  trained_at?: string | null
  deployed_at?: string | null
  metrics?: {
    accuracy?: number
    f1?: number
    precision?: number
    recall?: number
    confusion_matrix?: number[][] | Record<string, number[]>
    [k: string]: unknown
  }
  hyperparameters?: Record<string, unknown>
  notes?: string | null
  [k: string]: unknown
}

export interface AdminLog {
  id: number
  ts: string
  level: string
  source: string
  message: string
}

export interface AdminAccount {
  id: string
  email: string
  name: string
  role: string
  is_active: boolean
  last_login_at: string | null
  created_at: string | null
}

export interface AdminApiKey {
  id: string
  name: string
  prefix: string
  environment: string
  is_active: boolean
  created_at: string | null
  last_used_at: string | null
  raw_key?: string
}

export interface AdminEndpointStatus {
  name: string
  url: string
  status: 'ok' | 'degraded' | 'down' | string
  latency_ms: number | null
}

export const adminApi = {
  // Dashboard
  dashboard: () => adminFetch<any>('/dashboard'),

  // Users
  listUsers: (params?: { status?: string; query?: string }) => {
    const qs = new URLSearchParams()
    if (params?.status && params.status !== 'all') qs.set('status', params.status)
    if (params?.query) qs.set('query', params.query)
    const suffix = qs.toString() ? `?${qs}` : ''
    return adminFetch<{ users: AdminUser[]; counts: Record<string, number> }>(
      `/users${suffix}`
    )
  },
  createUser: (payload: { name: string; email: string; status?: string }) =>
    adminFetch<AdminUser>('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUserStatus: (userId: string, status: string) =>
    adminFetch<AdminUser>(`/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteUser: (userId: string) =>
    adminFetch<{ ok: true }>(`/users/${userId}`, { method: 'DELETE' }),
  listUserProjects: (userId: string) =>
    adminFetch<{ user: AdminUser; projects: AdminProject[]; total: number }>(
      `/users/${userId}/projects`
    ),

  // Projects (admin)
  listProjects: () =>
    adminFetch<{ projects: AdminProject[]; total: number }>('/projects'),
  deleteProject: (projectId: string) =>
    adminFetch<{ ok: true }>(`/projects/${projectId}`, { method: 'DELETE' }),

  // Results
  listResults: () =>
    adminFetch<{
      results: AdminResult[]
      total: number
      valid: number
      invalid: number
      pass_rate: number
    }>('/results'),

  // Regulations
  listBaseRules: () =>
    adminFetch<{ rules: AdminBaseRule[] }>('/regulations/base'),
  upsertBaseRule: (payload: {
    key: string
    label: string
    unit: string
    value: number
    description?: string | null
  }) =>
    adminFetch<AdminBaseRule>('/regulations/base', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  listZoneRules: () =>
    adminFetch<{ rules: AdminZoneRule[] }>('/regulations/zones'),
  createZoneRule: (payload: Omit<AdminZoneRule, 'id' | 'updated_at'>) =>
    adminFetch<AdminZoneRule>('/regulations/zones', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateZoneRule: (id: string, payload: Partial<AdminZoneRule>) =>
    adminFetch<AdminZoneRule>(`/regulations/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteZoneRule: (id: string) =>
    adminFetch<{ ok: true }>(`/regulations/zones/${id}`, { method: 'DELETE' }),

  // AI models
  listAIModels: () => adminFetch<{ models: AdminAIModel[] }>('/ai/models'),
  createAIModel: (payload: {
    model_name: string
    version: string
    model_type: string
    accuracy?: number
    description?: string
  }) =>
    adminFetch<AdminAIModel>('/ai/models', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  activateAIModel: (id: string) =>
    adminFetch<AdminAIModel>(`/ai/models/${id}/activate`, { method: 'POST' }),
  deactivateAIModel: (id: string) =>
    adminFetch<AdminAIModel>(`/ai/models/${id}/deactivate`, { method: 'POST' }),

  // AI MLOps (Team_Gunchi_classifier 프록시)
  listExperiments: (limit = 50) =>
    adminFetch<{ experiments: AIExperiment[] }>(`/ai/experiments?limit=${limit}`),
  getExperiment: (runId: string) =>
    adminFetch<AIExperiment>(`/ai/experiments/${runId}`),
  getActiveAIModel: () =>
    adminFetch<{ active: AIExperiment | null } | AIExperiment>(`/ai/active-model`),
  deployAIModel: (payload: { run_id: string; environment?: string; notes?: string }) =>
    adminFetch<{ active_run_id: string; environment: string }>(`/ai/deploy`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Logs
  listLogs: (params?: { level?: string; q?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.level && params.level !== 'all') qs.set('level', params.level)
    if (params?.q) qs.set('q', params.q)
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return adminFetch<{ logs: AdminLog[]; counts: Record<string, number> }>(
      `/logs${suffix}`
    )
  },

  // Admin accounts
  listAdminAccounts: () =>
    adminFetch<{ accounts: AdminAccount[] }>('/auth/accounts'),
  createAdminAccount: (payload: {
    email: string
    name: string
    role?: string
  }) =>
    adminFetch<AdminAccount>('/auth/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAdminAccount: (
    id: string,
    payload: { name?: string; role?: string; is_active?: boolean }
  ) =>
    adminFetch<AdminAccount>(`/auth/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAdminAccount: (id: string) =>
    adminFetch<{ ok: true }>(`/auth/accounts/${id}`, { method: 'DELETE' }),

  // API keys
  listApiKeys: () => adminFetch<{ keys: AdminApiKey[] }>('/auth/api-keys'),
  createApiKey: (payload: { name: string; environment?: string }) =>
    adminFetch<AdminApiKey>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeApiKey: (id: string) =>
    adminFetch<AdminApiKey>(`/auth/api-keys/${id}/revoke`, { method: 'POST' }),
  deleteApiKey: (id: string) =>
    adminFetch<{ ok: true }>(`/auth/api-keys/${id}`, { method: 'DELETE' }),

  // Service
  getServiceSettings: () =>
    adminFetch<{ settings: Record<string, string> }>('/service/settings'),
  putServiceSetting: (key: string, value: string) =>
    adminFetch<{ key: string; value: string }>('/service/settings', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  listServiceEndpoints: () =>
    adminFetch<{ endpoints: AdminEndpointStatus[] }>('/service/endpoints'),

  // Database
  getDatabaseStatus: () =>
    adminFetch<{ type: string; url: string; rds_available: boolean }>('/database/status'),
  switchDatabase: (target: 'rds' | 'sqlite') =>
    adminFetch<{ ok: boolean; type: string; url: string; rds_available: boolean }>('/database/switch', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
}
