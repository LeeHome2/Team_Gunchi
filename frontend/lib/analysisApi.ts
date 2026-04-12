/**
 * AI Analysis API functions
 * Handles DXF parsing, layer classification, and 3D model generation
 *
 * All AI calls go through the backend proxy (/api/classify)
 * so the frontend never directly contacts the AI server.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ============= Type Definitions =============

export interface ParseResult {
  success: boolean
  file_id: string
  site: {
    footprint: number[][]
    area_sqm: number
    centroid: number[]
    bounds: any
  }
  entities: any[]
  total_entities: number
}

export interface ClassificationResult {
  file_id: string
  total_entities: number
  class_counts: Record<string, number>
  layers: string[]
  average_confidence: number
  is_mock?: boolean
}

export interface ModelResult {
  file_id: string
  glb_url: string
  mesh_stats: {
    wall_meshes: number
    vertices: number
    faces: number
  }
  bounding_box?: {
    width: number
    depth: number
    height: number
  }
}

// ============= API Functions =============

/**
 * Create a project in the backend DB
 * Returns the project ID for subsequent API calls
 */
export async function createProject(fileName: string): Promise<string | null> {
  try {
    const projectName = fileName.replace(/\.dxf$/i, '')
    const response = await fetch(`${API_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: projectName }),
    })

    if (response.ok) {
      const data = await response.json()
      return data.id
    }
  } catch (error) {
    console.warn('Failed to create project (DB may be unavailable):', error)
  }
  return null
}

/**
 * Upload and parse DXF file
 * Returns parsing result with entity information
 */
export async function uploadAndParseDxf(file: File, projectId?: string | null): Promise<ParseResult> {
  const formData = new FormData()
  formData.append('file', file)

  const url = projectId
    ? `${API_URL}/api/upload-dxf?project_id=${projectId}`
    : `${API_URL}/api/upload-dxf`

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'DXF 파싱 실패')
  }

  const data = await response.json()
  return {
    success: true,
    file_id: data.file_id,
    site: data.site,
    entities: data.entities || [],
    total_entities: data.total_entities || 0,
  }
}

/**
 * Classify layers using backend proxy (/api/classify)
 * Backend tries AI server first, falls back to mock if unavailable
 */
export async function classifyLayers(
  fileId: string,
  entities: any[],
  parseResult: ParseResult,
  projectId?: string | null,
  fileName?: string
): Promise<ClassificationResult> {
  // 1순위: 하드코딩 레이어 분류 (AI 모델 없이 샘플 도면용)
  if (fileName) {
    const hardcoded = generateHardcodedClassification(fileId, fileName, parseResult)
    if (hardcoded) {
      console.log(`[하드코딩 분류] ${fileName} → 매핑 사용`)
      return hardcoded
    }
  }

  // 2순위: 백엔드 AI 분류 서버
  try {
    const url = projectId
      ? `${API_URL}/api/classify?project_id=${projectId}`
      : `${API_URL}/api/classify`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_id: fileId,
        entities,
      }),
      signal: AbortSignal.timeout(20000), // 20 second timeout (backend needs time to proxy)
    })

    if (response.ok) {
      const data = await response.json()
      return {
        file_id: fileId,
        total_entities: data.total_entities || parseResult.total_entities,
        class_counts: data.class_counts,
        layers: data.layers || [],
        average_confidence: data.average_confidence || 0.85,
        is_mock: data.is_mock || false,
      }
    }

    // If backend classify endpoint fails, use client-side mock
    console.warn('Backend classify failed, using client-side mock')
  } catch (error) {
    console.warn('Backend classify unavailable, using client-side mock:', error)
  }

  // Final fallback: client-side mock
  return generateMockClassification(fileId, parseResult)
}

/**
 * DXF 로컬 좌표(미터)를 기준 위경도 중심으로 변환
 * 건축 DXF는 보통 미터 단위 로컬 좌표이므로, 맵에 올리려면 위경도로 변환 필요
 */
function localToLonLat(
  localCoords: number[][],
  anchorLonLat: [number, number]
): number[][] {
  const [anchorLon, anchorLat] = anchorLonLat
  const latRad = anchorLat * Math.PI / 180
  const metersPerDegLat = 111320
  const metersPerDegLon = 111320 * Math.cos(latRad)

  // 로컬 좌표의 중심을 구해서, anchor에 맞춤
  const cx = localCoords.reduce((s, c) => s + c[0], 0) / localCoords.length
  const cy = localCoords.reduce((s, c) => s + c[1], 0) / localCoords.length

  return localCoords.map(([x, y]) => [
    anchorLon + (x - cx) / metersPerDegLon,
    anchorLat + (y - cy) / metersPerDegLat,
  ])
}

/**
 * footprint 좌표가 위경도인지 로컬(미터)인지 판별
 *
 * 판별 기준: 대한민국 위경도 범위 (경도 124~132, 위도 33~39) 내에 있고
 * 스팬이 0.01도(~1km) 이하면 위경도로 판단.
 * 그 외에는 모두 DXF 로컬 미터 좌표로 간주.
 */
function isLonLatCoords(coords: number[][]): boolean {
  if (coords.length === 0) return false
  const xs = coords.map(c => c[0])
  const ys = coords.map(c => c[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)

  // 대한민국 위경도 범위 내에서 스팬이 매우 작아야 위경도
  const inKoreaLonRange = minX >= 124 && maxX <= 133
  const inKoreaLatRange = minY >= 33 && maxY <= 39
  const smallSpan = (maxX - minX) < 0.05 && (maxY - minY) < 0.05

  return inKoreaLonRange && inKoreaLatRange && smallSpan
}

/**
 * Generate 3D model from classified layers
 * Uses the site footprint from parse result with default building params
 *
 * anchorLonLat: 모델을 배치할 기준 위경도 [lon, lat]
 *   - 선택된 블록의 centroid 또는 workArea 좌표를 사용
 *   - 전달되지 않으면 기본값(성남시) 사용
 */
/**
 * 하드코딩 매핑에서 특정 클래스의 원본 레이어 이름 목록 추출
 */
function getLayersByClass(fileName: string, targetClass: string): string[] {
  const normalizedName = fileName.toLowerCase().replace(/\s+/g, '_')
  const entry = Object.entries(HARDCODED_LAYER_MAP).find(
    ([key]) => normalizedName.includes(key.replace('.dxf', ''))
  )
  if (!entry) return []
  const [, layerMap] = entry
  return Object.entries(layerMap)
    .filter(([, cls]) => cls === targetClass)
    .map(([layer]) => layer)
}

export async function generateModelFromClassification(
  fileId: string,
  classification: ClassificationResult,
  parseResult?: ParseResult,
  anchorLonLat?: [number, number],
  fileName?: string,
  projectId?: string | null
): Promise<ModelResult> {
  let rawFootprint = parseResult?.site?.footprint || [[0, 0], [10, 0], [10, 10], [0, 10]]
  const anchor: [number, number] = anchorLonLat || [127.1388, 37.4449]

  // footprint이 너무 작으면 bounds 기반 사각형으로 대체
  const bounds = parseResult?.site?.bounds
  if (rawFootprint.length >= 3 && bounds?.min_x != null) {
    const xs = rawFootprint.map((c: number[]) => c[0])
    const ys = rawFootprint.map((c: number[]) => c[1])
    const fpArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
    const bArea = (bounds.max_x - bounds.min_x) * (bounds.max_y - bounds.min_y)
    if (fpArea < bArea * 0.1 && bArea > 10) {
      console.log('[generateModel] footprint 너무 작음, bounds 사용', { fpArea, bArea })
      rawFootprint = [
        [bounds.min_x, bounds.min_y],
        [bounds.max_x, bounds.min_y],
        [bounds.max_x, bounds.max_y],
        [bounds.min_x, bounds.max_y],
      ]
    }
  }

  // 좌표가 위경도가 아니면(= DXF 로컬 미터) → 위경도로 변환
  const footprint = isLonLatCoords(rawFootprint)
    ? rawFootprint
    : localToLonLat(rawFootprint, anchor)

  const position = [
    footprint.reduce((s, c) => s + c[0], 0) / footprint.length,
    footprint.reduce((s, c) => s + c[1], 0) / footprint.length,
  ]

  // 벽 레이어 추출 (하드코딩 매핑에서 wall 클래스 레이어)
  const wallLayers = fileName ? getLayersByClass(fileName, 'wall') : []

  console.log('[generateModel]', {
    isLonLat: isLonLatCoords(rawFootprint),
    rawCentroid: parseResult?.site?.centroid,
    anchor,
    convertedPosition: position,
    wallLayers,
    useWallMode: wallLayers.length > 0,
  })

  const body: Record<string, any> = {
    footprint,
    height: 9.0,
    floors: 3,
    position,
  }

  // 벽 레이어가 있으면 벽체 기반 생성
  if (wallLayers.length > 0) {
    body.file_id = fileId
    body.wall_layers = wallLayers
    body.wall_thickness = 0.15
  }

  const massUrl = projectId
    ? `${API_URL}/api/generate-mass?project_id=${projectId}`
    : `${API_URL}/api/generate-mass`

  const response = await fetch(massUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '3D 모델 생성 실패')
  }

  const data = await response.json()
  return {
    file_id: fileId,
    glb_url: data.model_url || data.glb_url || null,
    mesh_stats: {
      wall_meshes: data.mesh_stats?.wall_meshes || 4,
      vertices: data.mesh_stats?.vertices || 24,
      faces: data.mesh_stats?.faces || 12,
    },
    bounding_box: data.bounding_box || undefined,
  }
}

// ============= Hardcoded Layer Classification =============

/**
 * 크롤링 샘플 도면별 레이어 → 건축 클래스 매핑 테이블
 * AI 분류 모델이 준비되기 전까지 사용하는 하드코딩 분류
 */
const HARDCODED_LAYER_MAP: Record<string, Record<string, string>> = {
  // 1.00.- ARQUITECTURA.dxf — 건축 도면 (스페인어 레이어)
  'arquitectura.dxf': {
    'MURO':       'wall',
    'MURO BAJO':  'wall',
    'VIGAS':      'wall',
    'CUADRO':     'wall',
    'PUERTAS':    'door',
    'VENTANA':    'window',
    'ESCALERA':   'stair',
    'MOBILIARIO': 'furniture',
    'SANITARIOS': 'furniture',
    'BARANDA DE MADERA': 'furniture',
    'COTAS':      'dimension',
    'NIVELES':    'dimension',
    'TEXTO':      'text',
    'TEJA ANDINA':'other',
    'MADERA':     'other',
    'SOMBREADO':  'other',
    'OTROS':      'other',
  },
  // Trabajo_final_.dxf — 종합 설계
  'trabajo_final.dxf': {
    'Muros':      'wall',
    'Medianeras': 'wall',
    'Puertas':    'door',
    'Ventanas':   'window',
    'Muebles objetos y demas': 'furniture',
    'Cotas':      'dimension',
    'Defpoints':  'dimension',
    '0':          'other',
  },
  // elect CASA VELACION-1.dxf — 전기 설비 1
  'casa_velacion_1.dxf': {
    'PLANTA-ARQUITECTONICA': 'wall',
    'COMANDO-SUICHE':        'door',
    'ELEMENTOS-ELEC':        'furniture',
    'APARATOS-SANITARIOS':   'furniture',
    'CABLES':                'other',
    'TUBERIA':               'other',
    'TUBERIA-PISO':          'other',
    'TUBERIA-TELEF':         'other',
    'TUBERIA-TV':            'other',
    'CARGAS-DIAGRAMA-CONVENC':'other',
    'TEXTO':                 'text',
    'TITULOS':               'text',
    'ACOMETIDAS':            'other',
    'PARABOLAS':             'other',
  },
  // elect CASA VELACION-2.dxf — 전기 설비 2
  'casa_velacion_2.dxf': {
    'CAJONEO':               'wall',
    'ELEMENTOS-ELEC':        'furniture',
    'CABLES':                'other',
    'TUBERIA-PISO':          'other',
    'TUBERIA-TV':            'other',
    'TUBERIA-TELEF':         'other',
    'TUBERIA':               'other',
    'CARGAS-DIAGRAMA-CONVENC':'other',
    'TEXTO':                 'text',
    'NOTAS':                 'text',
    'TITULOS':               'text',
    'ACOMETIDAS':            'other',
    'MANCHETA':              'other',
    'PARABOLAS':             'other',
  },
}

/**
 * 파일명으로부터 하드코딩 분류를 생성합니다.
 * 매핑이 존재하면 entity의 layer를 기반으로 실제 카운트를 계산합니다.
 */
export function generateHardcodedClassification(
  fileId: string,
  fileName: string,
  parseResult: ParseResult
): ClassificationResult | null {
  // 파일명에서 매핑 찾기
  const normalizedName = fileName.toLowerCase().replace(/\s+/g, '_')
  const layerMap = Object.entries(HARDCODED_LAYER_MAP).find(
    ([key]) => normalizedName.includes(key.replace('.dxf', ''))
  )?.[1]

  if (!layerMap) return null

  // entity의 layer 기반으로 실제 클래스별 카운트
  const classCounts: Record<string, number> = {
    wall: 0, door: 0, window: 0, stair: 0,
    furniture: 0, dimension: 0, text: 0, other: 0,
  }

  const entities = parseResult.entities || []
  for (const entity of entities) {
    const layer = entity.layer || ''
    const cls = layerMap[layer] || 'other'
    classCounts[cls] = (classCounts[cls] || 0) + 1
  }

  // 엔티티가 없으면 총 개수 기반으로 비율 추정
  if (entities.length === 0) {
    const total = parseResult.total_entities || 100
    for (const [layer, cls] of Object.entries(layerMap)) {
      classCounts[cls] = (classCounts[cls] || 0) + Math.round(total / Object.keys(layerMap).length)
    }
  }

  const layers = Object.keys(layerMap)

  return {
    file_id: fileId,
    total_entities: parseResult.total_entities || entities.length,
    class_counts: classCounts,
    layers,
    average_confidence: 0.95, // 하드코딩이므로 높은 신뢰도
    is_mock: false, // mock이 아닌 하드코딩 분류
  }
}

// ============= Mock Data Generator =============

/**
 * Generate realistic mock classification based on entity count
 * (AI 서버 & 하드코딩 모두 불가할 때 최종 폴백)
 */
function generateMockClassification(
  fileId: string,
  parseResult: ParseResult
): ClassificationResult {
  const totalEntities = parseResult.total_entities || 1250

  const classDistribution = {
    wall: 0.35,
    door: 0.05,
    window: 0.03,
    stair: 0.02,
    furniture: 0.1,
    dimension: 0.2,
    text: 0.2,
    other: 0.05,
  }

  const classCounts: Record<string, number> = {}
  for (const [className, ratio] of Object.entries(classDistribution)) {
    classCounts[className] = Math.round(totalEntities * ratio)
  }

  const layers = parseResult.site?.bounds?.layers || [
    'WALLS', 'DOORS', 'WINDOWS', 'FURNITURE', 'DIMENSIONS', 'TEXT', 'OTHERS',
  ]

  return {
    file_id: fileId,
    total_entities: totalEntities,
    class_counts: classCounts,
    layers,
    average_confidence: 0.87 + Math.random() * 0.08,
    is_mock: true,
  }
}
