import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const MODELS_DIR = process.env.MODELS_DIR || path.join(process.cwd(), 'public', 'models')

/**
 * GLB 파일에서 glTF JSON + binary chunk 를 파싱한다.
 */
function parseGlb(filePath: string): { gltf: any; binBuffer: Buffer } | null {
  try {
    const buffer = fs.readFileSync(filePath)
    const magic = buffer.toString('ascii', 0, 4)
    if (magic !== 'glTF') {
      console.warn(`parseGlb: ${filePath} is not a valid glTF file`)
      return null
    }

    const version = buffer.readUInt32LE(4)
    const totalLength = buffer.readUInt32LE(8)
    const jsonChunkLength = buffer.readUInt32LE(12)
    const jsonChunkType = buffer.readUInt32LE(16)

    const jsonData = buffer.toString('utf8', 20, 20 + jsonChunkLength)
    const gltf = JSON.parse(jsonData)

    // Binary chunk
    const binChunkStart = 20 + jsonChunkLength
    if (binChunkStart + 8 > buffer.length) {
      return { gltf, binBuffer: Buffer.alloc(0) }
    }

    const binChunkLength = buffer.readUInt32LE(binChunkStart)
    const binChunkType = buffer.readUInt32LE(binChunkStart + 4)

    const binOffset = binChunkStart + 8
    const binBuffer = buffer.subarray(binOffset, binOffset + binChunkLength)

    return { gltf, binBuffer }
  } catch (err) {
    console.error(`parseGlb error: ${filePath}`, err)
    return null
  }
}

/**
 * GLB 파일에서 바운딩 박스 크기 추출 (accessor min/max)
 */
function extractBoundingBox(
  gltf: any,
): { width: number; height: number; depth: number } | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  // POSITION accessor 인덱스만 수집 (NORMAL 등 다른 VEC3 포함하면 -1~1로 잘못 계산됨)
  const posAccessorIndices = new Set<number>()
  if (gltf.meshes) {
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives || []) {
        const posIdx = prim.attributes?.POSITION
        if (posIdx !== undefined) posAccessorIndices.add(posIdx)
      }
    }
  }

  if (gltf.accessors) {
    for (let i = 0; i < gltf.accessors.length; i++) {
      const accessor = gltf.accessors[i]
      if (!posAccessorIndices.has(i)) continue // POSITION만 사용
      if (accessor.min && accessor.max && accessor.type === 'VEC3') {
        minX = Math.min(minX, accessor.min[0])
        minY = Math.min(minY, accessor.min[1])
        minZ = Math.min(minZ, accessor.min[2])
        maxX = Math.max(maxX, accessor.max[0])
        maxY = Math.max(maxY, accessor.max[1])
        maxZ = Math.max(maxZ, accessor.max[2])
      }
    }
  }

  if (minX === Infinity) return null
  return {
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  }
}

/**
 * GLB 파일에서 바닥면 꼭짓점을 읽어 Convex Hull(바닥 폴리곤)을 추출한다.
 *
 * 1) 모든 메시의 POSITION accessor에서 실제 vertex 좌표를 읽는다.
 * 2) Y축(높이) 최솟값 근처(전체 높이의 2%) 정점만 수집한다.
 * 3) X-Z 평면에서 Convex Hull을 구한다.
 * 4) CCW 순서의 [x, z] 배열로 반환한다.
 *
 * 반환 좌표는 모델 로컬 좌표(m) 기준이므로,
 * CesiumViewer에서 scale·rotation 적용 후 경위도 변환해야 한다.
 */
function extractFloorPolygon(
  gltf: any,
  binBuffer: Buffer,
  filename: string = '',
): { polygon: number[][]; minY: number } | null {
  try {
    const bufferViews = gltf.bufferViews || []
    const accessors = gltf.accessors || []
    const meshes = gltf.meshes || []

    // 모든 메시에서 POSITION accessor 인덱스 수집
    const posAccessorIndices = new Set<number>()
    for (const mesh of meshes) {
      for (const prim of mesh.primitives || []) {
        const posIdx = prim.attributes?.POSITION
        if (posIdx !== undefined) posAccessorIndices.add(posIdx)
      }
    }

    if (posAccessorIndices.size === 0) {
      return null
    }

    // 모든 position 버텍스 읽기
    const allVertices: { x: number; y: number; z: number }[] = []

    for (const accIdx of Array.from(posAccessorIndices)) {
      const acc = accessors[accIdx]
      if (!acc || acc.type !== 'VEC3') continue

      const bvIdx = acc.bufferView
      const bv = bufferViews[bvIdx]
      if (!bv) continue

      const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
      const count = acc.count
      const stride = bv.byteStride || 12 // VEC3 float32 = 12 bytes

      // componentType 5126 = FLOAT
      if (acc.componentType !== 5126) {
        continue
      }

      for (let i = 0; i < count; i++) {
        const off = byteOffset + i * stride
        if (off + 12 > binBuffer.length) break
        const x = binBuffer.readFloatLE(off)
        const y = binBuffer.readFloatLE(off + 4)
        const z = binBuffer.readFloatLE(off + 8)
        allVertices.push({ x, y, z })
      }
    }

    if (allVertices.length === 0) return null

    // 바닥 정점 필터링: Y 최솟값 + 전체 높이의 2%
    // NOTE: Math.min(...arr) 는 배열이 10만 이상이면 콜 스택 오버플로우 발생
    // 루프로 min/max 계산
    let minY = Infinity
    let maxY = -Infinity
    for (const v of allVertices) {
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
    }
    const modelHeight = maxY - minY
    const heightThreshold = Math.max(modelHeight * 0.02, 0.005)
    const bottomVerts = allVertices.filter((v) => v.y <= minY + heightThreshold)


    if (bottomVerts.length < 3) return null

    // X-Z 평면 Convex Hull (Graham Scan)
    const points: [number, number][] = bottomVerts.map((v) => [v.x, v.z])
    const hull = convexHull(points)

    if (hull.length < 3) return null
    return { polygon: hull, minY }
  } catch (err) {
    console.error(`extractFloorPolygon error: ${filename}`, err)
    return null
  }
}

/**
 * 2D Convex Hull — Graham Scan.
 * 입력: [x, z][], 출력: CCW 정렬된 hull [x, z][].
 */
function convexHull(points: [number, number][]): number[][] {
  // 중복 제거 (소수점 4자리 반올림)
  const unique = new Map<string, [number, number]>()
  for (const p of points) {
    const key = `${p[0].toFixed(4)}_${p[1].toFixed(4)}`
    unique.set(key, p)
  }
  const pts = Array.from(unique.values())

  if (pts.length < 3) return pts.map((p) => [p[0], p[1]])

  // 최하단-좌측 점 찾기
  pts.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const origin = pts[0]

  // 극각 기준 정렬
  const rest = pts.slice(1)
  rest.sort((a, b) => {
    const angA = Math.atan2(a[1] - origin[1], a[0] - origin[0])
    const angB = Math.atan2(b[1] - origin[1], b[0] - origin[0])
    if (Math.abs(angA - angB) < 1e-10) {
      const dA = (a[0] - origin[0]) ** 2 + (a[1] - origin[1]) ** 2
      const dB = (b[0] - origin[0]) ** 2 + (b[1] - origin[1]) ** 2
      return dA - dB
    }
    return angA - angB
  })

  const stack: [number, number][] = [origin]

  for (const p of rest) {
    while (stack.length >= 2) {
      const a = stack[stack.length - 2]
      const b = stack[stack.length - 1]
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
      if (cross <= 0) {
        stack.pop()
      } else {
        break
      }
    }
    stack.push(p)
  }

  return stack.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)])
}

export async function GET() {
  try {
    const files = fs.readdirSync(MODELS_DIR)
    // 휴먼 스케일 모델(man)은 건물 모델 목록에서 제외
    const EXCLUDED_KEYWORDS = ['man', 'human', 'person', 'people']
    const glbFiles = files.filter((file) => {
      if (!file.endsWith('.glb')) return false
      const lower = file.toLowerCase()
      return !EXCLUDED_KEYWORDS.some((kw) => lower.includes(kw))
    })

    const models = glbFiles.map((filename) => {
      const filePath = path.join(MODELS_DIR, filename)
      const stats = fs.statSync(filePath)

      let displayName = filename
        .replace('Meshy_AI_', '')
        .replace('_texture.glb', '')
        .replace(/_\d+$/, '')
        .replace(/_/g, ' ')

      const parsed = parseGlb(filePath)
      const boundingBox = parsed
        ? extractBoundingBox(parsed.gltf)
        : null

      // 바닥면 폴리곤 추출 (모델 로컬 좌표, X-Z 평면) + 실제 바닥 Y 좌표
      const floorResult = parsed
        ? extractFloorPolygon(parsed.gltf, parsed.binBuffer, filename)
        : null

      const floorPolygon = floorResult?.polygon ?? null
      // originYMin: 실제 POSITION 버텍스에서 추출한 Y 최솟값 (NORMAL accessor가 아님)
      const originYMin = floorResult?.minY ?? 0

      return {
        filename,
        displayName,
        size: stats.size,
        sizeFormatted: (stats.size / 1024 / 1024).toFixed(1) + ' MB',
        boundingBox: boundingBox || { width: 10, height: 10, depth: 10 },
        floorPolygon, // [[x, z], ...] 모델 로컬 좌표 (m) — null이면 bounding box fallback
        originYMin,   // POSITION 버텍스의 Y 최솟값 — height = -originYMin * scale 로 바닥 보정
      }
    })

    return NextResponse.json({ models })
  } catch (error) {
    console.error('모델 목록 조회 실패:', error)
    return NextResponse.json(
      { error: 'Failed to list models', details: String(error) },
      { status: 500 },
    )
  }
}
