/**
 * A* 경로 탐색 — 입구에서 주차영역까지의 최적 경로
 *
 * 블록(사이트) 내에서 건물 등 장애물을 회피하면서
 * 입구 중심 → 주차영역 중심으로 가는 경로를 찾습니다.
 */

import type { ParkingPathData } from '@/store/projectStore'

// ─── 유틸리티 ───

/** 점이 폴리곤 내부인지 (ray-casting) */
function isInsidePolygon(px: number, py: number, polygon: number[][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 선분-AABB 교차 검사 (간략) */
function lineIntersectsAABB(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number,
): boolean {
  // 선분의 AABB
  const lMinX = Math.min(x1, x2)
  const lMaxX = Math.max(x1, x2)
  const lMinY = Math.min(y1, y2)
  const lMaxY = Math.max(y1, y2)

  // 겹침 확인
  if (lMaxX < minX || lMinX > maxX || lMaxY < minY || lMinY > maxY) return false

  // 선분 방향
  const dx = x2 - x1, dy = y2 - y1

  // SAT — 4개 변 검사
  const corners = [
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
  ]
  let allSameSide = true
  let prevSide = 0
  for (const [cx, cy] of corners) {
    const cross = dx * (cy - y1) - dy * (cx - x1)
    const side = cross > 0 ? 1 : cross < 0 ? -1 : 0
    if (prevSide !== 0 && side !== 0 && side !== prevSide) {
      allSameSide = false
      break
    }
    if (side !== 0) prevSide = side
  }

  return !allSameSide
}

// ─── A* 구현 ───

interface AStarNode {
  x: number
  y: number
  g: number // cost from start
  h: number // heuristic to goal
  f: number // g + h
  parent: AStarNode | null
}

/** 유클리디안 거리 */
function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

/** 그리드 키 */
function nodeKey(gx: number, gy: number): string {
  return `${gx},${gy}`
}

export interface PathfinderInput {
  /** 출발점 (입구 중심, 로컬 m) */
  start: [number, number]
  /** 목표점 (주차영역 중심, 로컬 m) */
  goal: [number, number]
  /** 사이트 경계 (로컬 m) */
  siteFootprint: number[][]
  /** 장애물 (건물 등) AABB 목록 [{minX,minY,maxX,maxY}] */
  obstacles: { minX: number; minY: number; maxX: number; maxY: number }[]
  /** 그리드 해상도 (m, 기본 2m) */
  gridSize?: number
}

/**
 * A* 경로 탐색 실행
 *
 * 사이트 AABB를 그리드로 분할하고, 장애물 셀을 차단,
 * 8방향 이동으로 최적 경로를 탐색합니다.
 */
export function findParkingPath(input: PathfinderInput): ParkingPathData {
  const { start, goal, siteFootprint, obstacles, gridSize = 2 } = input

  // 사이트 AABB
  const xs = siteFootprint.map((p) => p[0])
  const ys = siteFootprint.map((p) => p[1])
  const sMinX = Math.min(...xs) - 5
  const sMinY = Math.min(...ys) - 5
  const sMaxX = Math.max(...xs) + 5
  const sMaxY = Math.max(...ys) + 5

  // 그리드 크기
  const cols = Math.ceil((sMaxX - sMinX) / gridSize)
  const rows = Math.ceil((sMaxY - sMinY) / gridSize)

  // 세계 좌표 → 그리드 인덱스
  const toGrid = (wx: number, wy: number): [number, number] => [
    Math.round((wx - sMinX) / gridSize),
    Math.round((wy - sMinY) / gridSize),
  ]
  // 그리드 → 세계
  const toWorld = (gx: number, gy: number): [number, number] => [
    sMinX + gx * gridSize,
    sMinY + gy * gridSize,
  ]

  // 장애물 그리드 마크
  const blocked = new Set<string>()
  const margin = 1 // 1 그리드 셀 마진

  for (const obs of obstacles) {
    const [g1x, g1y] = toGrid(obs.minX, obs.minY)
    const [g2x, g2y] = toGrid(obs.maxX, obs.maxY)
    for (let gx = g1x - margin; gx <= g2x + margin; gx++) {
      for (let gy = g1y - margin; gy <= g2y + margin; gy++) {
        blocked.add(nodeKey(gx, gy))
      }
    }
  }

  const [startGx, startGy] = toGrid(start[0], start[1])
  const [goalGx, goalGy] = toGrid(goal[0], goal[1])

  // 8방향
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ]
  const diagCost = Math.SQRT2

  // 시작/끝이 blocked면 가장 가까운 unblocked로
  const unblock = (gx: number, gy: number): [number, number] => {
    if (!blocked.has(nodeKey(gx, gy))) return [gx, gy]
    for (let r = 1; r <= 10; r++) {
      for (const [dx, dy] of dirs) {
        const nx = gx + dx * r, ny = gy + dy * r
        if (!blocked.has(nodeKey(nx, ny)) && nx >= 0 && ny >= 0 && nx <= cols && ny <= rows) {
          return [nx, ny]
        }
      }
    }
    return [gx, gy]
  }

  const [sGx, sGy] = unblock(startGx, startGy)
  const [eGx, eGy] = unblock(goalGx, goalGy)

  // open set (간단한 배열 기반 — 그리드가 작으므로 충분)
  const open: AStarNode[] = []
  const closed = new Set<string>()
  const gScores = new Map<string, number>()

  const startNode: AStarNode = {
    x: sGx,
    y: sGy,
    g: 0,
    h: heuristic(sGx, sGy, eGx, eGy),
    f: heuristic(sGx, sGy, eGx, eGy),
    parent: null,
  }
  open.push(startNode)
  gScores.set(nodeKey(sGx, sGy), 0)

  let found: AStarNode | null = null
  let iterations = 0
  const maxIterations = cols * rows * 2

  while (open.length > 0 && iterations < maxIterations) {
    iterations++

    // find lowest f
    let bestIdx = 0
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i
    }
    const current = open.splice(bestIdx, 1)[0]
    const key = nodeKey(current.x, current.y)

    if (current.x === eGx && current.y === eGy) {
      found = current
      break
    }

    closed.add(key)

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx
      const ny = current.y + dy
      const nKey = nodeKey(nx, ny)

      if (nx < 0 || ny < 0 || nx > cols || ny > rows) continue
      if (closed.has(nKey)) continue
      if (blocked.has(nKey)) continue

      const moveCost = dx !== 0 && dy !== 0 ? diagCost : 1
      const tentG = current.g + moveCost

      const existingG = gScores.get(nKey)
      if (existingG !== undefined && tentG >= existingG) continue

      gScores.set(nKey, tentG)
      const h = heuristic(nx, ny, eGx, eGy)

      const neighbor: AStarNode = {
        x: nx,
        y: ny,
        g: tentG,
        h,
        f: tentG + h,
        parent: current,
      }

      // 기존 open에 있으면 제거 후 재추가
      const existIdx = open.findIndex((n) => n.x === nx && n.y === ny)
      if (existIdx >= 0) open.splice(existIdx, 1)
      open.push(neighbor)
    }
  }

  // 경로 복원
  if (!found) {
    // 경로를 못 찾으면 직선 연결
    return {
      points: [start, goal],
      length: heuristic(start[0], start[1], goal[0], goal[1]),
      isValid: false,
    }
  }

  const gridPath: [number, number][] = []
  let node: AStarNode | null = found
  while (node) {
    gridPath.unshift(toWorld(node.x, node.y))
    node = node.parent
  }

  // 경로 단순화 (Douglas-Peucker 비슷하게 — 직선 구간 합치기)
  const simplified = simplifyPath(gridPath, gridSize * 0.8)

  // 시작/끝을 정확한 좌표로 교체
  if (simplified.length > 0) {
    simplified[0] = start
    simplified[simplified.length - 1] = goal
  }

  // 전체 길이 계산
  let totalLength = 0
  for (let i = 1; i < simplified.length; i++) {
    totalLength += heuristic(
      simplified[i - 1][0], simplified[i - 1][1],
      simplified[i][0], simplified[i][1],
    )
  }

  // 경로 유효성 (모든 점이 사이트 내부 또는 근처)
  const isValid = simplified.every(
    ([x, y]) =>
      isInsidePolygon(x, y, siteFootprint) ||
      heuristic(x, y, start[0], start[1]) < gridSize * 2 ||
      heuristic(x, y, goal[0], goal[1]) < gridSize * 2,
  )

  return {
    points: simplified,
    length: totalLength,
    isValid,
  }
}

/** 경로 단순화 — 연속 직선 구간을 합침 */
function simplifyPath(
  path: [number, number][],
  tolerance: number,
): [number, number][] {
  if (path.length <= 2) return [...path]

  const result: [number, number][] = [path[0]]

  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1]
    const next = path[i + 1]
    const curr = path[i]

    // 이전→다음 직선과 현재 점 사이 거리
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) continue

    const dist = Math.abs(dx * (prev[1] - curr[1]) - dy * (prev[0] - curr[0])) / len
    if (dist > tolerance) {
      result.push(curr)
    }
  }

  result.push(path[path.length - 1])
  return result
}
