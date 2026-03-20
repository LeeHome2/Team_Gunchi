/**
 * 기하학 유틸리티 함수
 */

/**
 * 점이 폴리곤 내부에 있는지 확인 (Ray Casting Algorithm)
 * @param point [x, y] 또는 [lon, lat] 좌표
 * @param polygon 폴리곤 좌표 배열 [[x, y], ...]
 * @returns 내부에 있으면 true
 */
export function isPointInPolygon(
  point: [number, number] | number[],
  polygon: number[][]
): boolean {
  const [x, y] = point
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }

  return inside
}

/**
 * 폴리곤의 면적 계산 (Shoelace Formula)
 * @param polygon 폴리곤 좌표 배열 [[x, y], ...]
 * @returns 면적 (좌표 단위의 제곱)
 */
export function calculatePolygonArea(polygon: number[][]): number {
  let area = 0
  const n = polygon.length

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += polygon[i][0] * polygon[j][1]
    area -= polygon[j][0] * polygon[i][1]
  }

  return Math.abs(area) / 2
}

/**
 * 폴리곤의 중심점(centroid) 계산
 * @param polygon 폴리곤 좌표 배열 [[x, y], ...]
 * @returns [x, y] 중심점 좌표
 */
export function calculateCentroid(polygon: number[][]): [number, number] {
  let cx = 0
  let cy = 0
  const n = polygon.length

  for (let i = 0; i < n; i++) {
    cx += polygon[i][0]
    cy += polygon[i][1]
  }

  return [cx / n, cy / n]
}

/**
 * 두 점 사이의 거리 계산
 * @param p1 [x, y] 첫 번째 점
 * @param p2 [x, y] 두 번째 점
 * @returns 거리
 */
export function distance(
  p1: [number, number] | number[],
  p2: [number, number] | number[]
): number {
  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 폴리곤의 바운딩 박스 계산
 * @param polygon 폴리곤 좌표 배열
 * @returns { minX, minY, maxX, maxY }
 */
export function getBoundingBox(polygon: number[][]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  return { minX, minY, maxX, maxY }
}
