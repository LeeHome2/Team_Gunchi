/**
 * A* 경로 탐색 — 입구에서 주차영역까지의 최적 경로
 *
 * 블록(사이트) 내에서 건물 등 장애물을 회피하면서
 * 입구 중심 → 주차영역 중심으로 가는 경로를 찾습니다.
 *
 * v2: 다중 장애물 + 그리드 시각화 데이터 반환
 */

import type { ParkingPathData, ParkingGridData, ParkingGridCell } from '@/store/projectStore'

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

// ─── A* 구현 ───

interface AStarNode {
  x: number
  y: number
  g: number // cost from start
  h: number // heuristic to goal
  f: number // g + h
  parent: AStarNode | null
}

/** 맨해튼 거리 (4방향 그리드용) */
function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1)
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
  /** 그리드 해상도 (m, 기본 0.5m - 더 세밀한 해상도) */
  gridSize?: number
  /** 장애물 주변 마진 (그리드 셀 수, 기본 1) - vehicleWidth 사용 시 자동 계산됨 */
  obstacleMargin?: number
  /** 그리드 시각화 데이터 반환 여부 (기본 true) */
  returnGrid?: boolean
  /** 그리드 회전 각도 (도, 기본 0) */
  gridRotation?: number
  /** 차량 너비 (m, 기본 2.5m) - 이동 경로의 폭 */
  vehicleWidth?: number
}

/**
 * A* 경로 탐색 실행
 *
 * 사이트 AABB를 그리드로 분할하고, 장애물 셀을 차단,
 * 8방향 이동으로 최적 경로를 탐색합니다.
 */
export function findParkingPath(input: PathfinderInput): ParkingPathData {
  const {
    start, goal, siteFootprint, obstacles,
    gridSize = 2,  // 그리드 해상도 (m)
    obstacleMargin = 1,  // 장애물 마진 (그리드 셀 수)
    returnGrid = true,
    gridRotation = 0,
    vehicleWidth = 2.5,  // 차량 너비 (m) - 시각화용
  } = input

  // 회전 중심 계산 (사이트 중심)
  const allXs = siteFootprint.map((p) => p[0])
  const allYs = siteFootprint.map((p) => p[1])
  const centerX = (Math.min(...allXs) + Math.max(...allXs)) / 2
  const centerY = (Math.min(...allYs) + Math.max(...allYs)) / 2

  // 회전 함수 - 그리드가 +θ로 회전하면 좌표계는 -θ로 회전
  const rotRad = (-gridRotation * Math.PI) / 180  // 부호 반전
  const cos = Math.cos(rotRad)
  const sin = Math.sin(rotRad)

  // 좌표를 회전 (좌표계를 -θ 회전 = 점을 +θ 반대방향 회전)
  const rotatePoint = (x: number, y: number): [number, number] => {
    const dx = x - centerX
    const dy = y - centerY
    return [dx * cos - dy * sin + centerX, dx * sin + dy * cos + centerY]
  }

  // 역회전 (결과를 원래 좌표계로)
  const unrotatePoint = (x: number, y: number): [number, number] => {
    const dx = x - centerX
    const dy = y - centerY
    return [dx * cos + dy * sin + centerX, -dx * sin + dy * cos + centerY]
  }

  // 원본 좌표계의 AABB (시각화용 bounds)
  // 회전 시 대각선이 더 길어지므로 패딩 확장 (최대 sqrt(2) ≈ 1.414 at 45°)
  const width = Math.max(...allXs) - Math.min(...allXs)
  const height = Math.max(...allYs) - Math.min(...allYs)
  const diagonal = Math.sqrt(width * width + height * height)
  // 회전 각도에 따른 확장 (0°에서 5m, 45°에서 대각선/2 + 5m)
  const rotationFactor = Math.abs(Math.sin(2 * Math.abs(gridRotation) * Math.PI / 180))  // 0~1, 45°에서 최대
  const padding = 5 + (diagonal / 2) * rotationFactor
  const origMinX = Math.min(...allXs) - padding
  const origMinY = Math.min(...allYs) - padding
  const origMaxX = Math.max(...allXs) + padding
  const origMaxY = Math.max(...allYs) + padding

  // 입력값들을 회전 (내부 계산용)
  const rotatedStart = rotatePoint(start[0], start[1])
  const rotatedGoal = rotatePoint(goal[0], goal[1])
  const rotatedFootprint = siteFootprint.map(([x, y]) => rotatePoint(x, y))
  const rotatedObstacles = obstacles.map((obs) => {
    const corners = [
      rotatePoint(obs.minX, obs.minY),
      rotatePoint(obs.maxX, obs.minY),
      rotatePoint(obs.maxX, obs.maxY),
      rotatePoint(obs.minX, obs.maxY),
    ]
    const rxs = corners.map((c) => c[0])
    const rys = corners.map((c) => c[1])
    return {
      minX: Math.min(...rxs),
      minY: Math.min(...rys),
      maxX: Math.max(...rxs),
      maxY: Math.max(...rys),
    }
  })

  // 그리드 계산용 AABB (회전된 좌표 사용)
  const xs = rotatedFootprint.map((p) => p[0])
  const ys = rotatedFootprint.map((p) => p[1])
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

  // 장애물 그리드 마크 (다중 장애물 지원) - 회전된 장애물 사용
  const blocked = new Set<string>()
  const buildingCells = new Set<string>()  // 건물 영역 셀 (별도 표시용)

  // 디버그: 원본 장애물 정보 출력
  console.log('[ParkingPathfinder] Original obstacles:')
  obstacles.forEach((obs, i) => {
    console.log(`  [${i}] ${(obs.maxX - obs.minX).toFixed(1)} x ${(obs.maxY - obs.minY).toFixed(1)} m at (${obs.minX.toFixed(1)}, ${obs.minY.toFixed(1)}) ~ (${obs.maxX.toFixed(1)}, ${obs.maxY.toFixed(1)})`)
  })
  console.log('[ParkingPathfinder] Site footprint bounds:', {
    minX: Math.min(...siteFootprint.map(p => p[0])).toFixed(1),
    minY: Math.min(...siteFootprint.map(p => p[1])).toFixed(1),
    maxX: Math.max(...siteFootprint.map(p => p[0])).toFixed(1),
    maxY: Math.max(...siteFootprint.map(p => p[1])).toFixed(1),
  })

  for (const obs of rotatedObstacles) {
    const [g1x, g1y] = toGrid(obs.minX, obs.minY)
    const [g2x, g2y] = toGrid(obs.maxX, obs.maxY)
    for (let gx = g1x - obstacleMargin; gx <= g2x + obstacleMargin; gx++) {
      for (let gy = g1y - obstacleMargin; gy <= g2y + obstacleMargin; gy++) {
        blocked.add(nodeKey(gx, gy))
        // 마진 없는 영역만 건물로 표시
        if (gx >= g1x && gx <= g2x && gy >= g1y && gy <= g2y) {
          buildingCells.add(nodeKey(gx, gy))
        }
      }
    }
  }

  // 사이트 외부 셀도 차단 - 회전된 폴리곤 사용
  for (let gx = 0; gx <= cols; gx++) {
    for (let gy = 0; gy <= rows; gy++) {
      const [wx, wy] = toWorld(gx, gy)
      if (!isInsidePolygon(wx, wy, rotatedFootprint)) {
        blocked.add(nodeKey(gx, gy))
      }
    }
  }

  // 그리드 시각화 데이터 생성 - 회전된 좌표계 사용
  let gridData: ParkingGridData | undefined
  if (returnGrid) {
    const cells: ParkingGridCell[] = []
    // 사이트 내부 셀만 포함 (성능)
    for (let gx = 0; gx <= cols; gx++) {
      for (let gy = 0; gy <= rows; gy++) {
        const [wx, wy] = toWorld(gx, gy)
        if (isInsidePolygon(wx, wy, rotatedFootprint)) {
          // 셀 좌표는 원래 좌표계로 역변환하여 저장
          const [origX, origY] = unrotatePoint(wx, wy)
          const key = nodeKey(gx, gy)
          cells.push({
            x: origX,
            y: origY,
            blocked: blocked.has(key),
            isBuilding: buildingCells.has(key),  // 건물 영역 표시
          })
        }
      }
    }
    // 디버그 로그
    const buildingCount = cells.filter(c => c.isBuilding).length
    console.log('[ParkingPathfinder] Grid stats:', {
      totalCells: cells.length,
      buildingCells: buildingCount,
      blockedCells: cells.filter(c => c.blocked).length,
      buildingCellsSet: buildingCells.size,
      obstacles: obstacles.length,
      rotatedObstacles: rotatedObstacles.length,
    })
    gridData = {
      cells,
      gridSize,
      cols,
      rows,
      bounds: { minX: origMinX, minY: origMinY, maxX: origMaxX, maxY: origMaxY },
      // 회전된 좌표계 원점 및 회전 중심 (그리드 선 렌더링용)
      rotatedOrigin: { x: sMinX, y: sMinY, rotation: gridRotation, centerX, centerY },
    }
  }

  // 회전된 시작/목표 좌표를 그리드로 변환
  const [startGx, startGy] = toGrid(rotatedStart[0], rotatedStart[1])
  const [goalGx, goalGy] = toGrid(rotatedGoal[0], rotatedGoal[1])

  // 4방향 (상하좌우만 - 그리드를 따라 이동)
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ]

  // 시작/끝이 blocked면 가장 가까운 unblocked로
  const unblock = (gx: number, gy: number): [number, number] => {
    if (!blocked.has(nodeKey(gx, gy))) return [gx, gy]
    for (let r = 1; r <= 15; r++) {
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

      const moveCost = 1  // 4방향 이동이므로 모든 이동 비용 동일
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
    return {
      points: [start, goal],
      length: heuristic(start[0], start[1], goal[0], goal[1]),
      isValid: false,
      grid: gridData,
      vehicleWidth,
    }
  }

  // 회전된 좌표계에서 경로 복원 후 원래 좌표계로 역변환
  const gridPath: [number, number][] = []
  let node: AStarNode | null = found
  while (node) {
    const [rotX, rotY] = toWorld(node.x, node.y)
    // 역회전하여 원래 좌표계로 변환
    gridPath.unshift(unrotatePoint(rotX, rotY))
    node = node.parent
  }

  // 경로 단순화
  const simplified = simplifyPath(gridPath, gridSize * 0.8)

  // 시작/끝을 정확한 원래 좌표로 교체
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

  // 경로 유효성 (모든 점이 사이트 내부 또는 근처) - 원래 좌표계 사용
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
    grid: gridData,
    vehicleWidth,  // 경로 시각화용 차량 너비
  }
}

/** 경로 단순화 — 방향이 바뀌는 지점(꺾이는 점)만 유지 */
function simplifyPath(
  path: [number, number][],
  _tolerance: number,  // 이제 사용하지 않음 (그리드 경로용)
): [number, number][] {
  if (path.length <= 2) return [...path]

  const result: [number, number][] = [path[0]]

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]
    const curr = path[i]
    const next = path[i + 1]

    // 이전→현재 방향
    const dx1 = Math.sign(curr[0] - prev[0])
    const dy1 = Math.sign(curr[1] - prev[1])

    // 현재→다음 방향
    const dx2 = Math.sign(next[0] - curr[0])
    const dy2 = Math.sign(next[1] - curr[1])

    // 방향이 바뀌면 꺾이는 지점이므로 유지
    if (dx1 !== dx2 || dy1 !== dy2) {
      result.push(curr)
    }
  }

  result.push(path[path.length - 1])
  return result
}

/**
 * 폴리곤 경계 위에서 특정 방향(도로 쪽)에 가장 가까운 점 찾기
 * 입구를 필지 경계에 배치할 때 사용
 */
export function findBoundaryPoint(
  siteFootprint: number[][],
  preferredDirection: 'top' | 'bottom' | 'left' | 'right' = 'top',
): [number, number] {
  const xs = siteFootprint.map((p) => p[0])
  const ys = siteFootprint.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2

  // 경계선 위의 점들을 세밀하게 샘플링
  const boundaryPoints: [number, number][] = []
  for (let i = 0; i < siteFootprint.length; i++) {
    const a = siteFootprint[i]
    const b = siteFootprint[(i + 1) % siteFootprint.length]
    // 각 변을 10등분
    for (let t = 0; t <= 1; t += 0.1) {
      boundaryPoints.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ])
    }
  }

  // 방향에 따라 정렬
  let sorted: [number, number][]
  switch (preferredDirection) {
    case 'top':
      sorted = boundaryPoints.sort((a, b) => b[1] - a[1]) // y가 큰 쪽
      break
    case 'bottom':
      sorted = boundaryPoints.sort((a, b) => a[1] - b[1]) // y가 작은 쪽
      break
    case 'left':
      sorted = boundaryPoints.sort((a, b) => a[0] - b[0])
      break
    case 'right':
      sorted = boundaryPoints.sort((a, b) => b[0] - a[0])
      break
  }

  // 중앙에 가까운 점을 우선 (상위 5개 후보 중 중앙에 가장 가까운 것)
  const candidates = sorted.slice(0, 5)
  candidates.sort((a, b) => Math.abs(a[0] - cx) - Math.abs(b[0] - cx))
  return candidates[0]
}
