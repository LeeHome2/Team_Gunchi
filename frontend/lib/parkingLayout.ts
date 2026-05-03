/**
 * 주차 레이아웃 생성 — 주택 부지용
 *
 * 주택 부지 내 주차구역을 설계합니다.
 * - 소규모 (1~6대): 한 줄 나란히 배치 (차로 없음)
 * - 중규모 (7~12대): 두 줄 마주보기 + 가운데 차로
 * - 대규모 (13대+): 여러 줄 + 차로 반복
 *
 * 건물 배제, 사이트 경계 검사를 수행합니다.
 */

import type {
  ParkingSlotData,
  ParkingAisleData,
  ParkingZoneData,
  ParkingEntranceData,
  ParkingLayoutPattern,
} from '@/store/projectStore'

// ─── 치수 상수 (미터) ───

const SLOT_WIDTH = 2.5
const SLOT_DEPTH_PERP = 5.0
const SLOT_DEPTH_PARA = 2.3 // 평행: 폭 방향이 짧음
const SLOT_LENGTH_PARA = 6.0 // 평행: 길이 방향
const SLOT_WIDTH_DISABLED = 3.3
const AISLE_WIDTH = 6.0
const SLOT_GAP = 0.15 // 슬롯 간 간격
const MARGIN = 1.5 // 사이트 경계 마진
const ENTRANCE_WIDTH = 5.0
const ENTRANCE_DEPTH = 2.5

/** 소규모 기준 (이 이하면 차로 없이 나란히) */
const SMALL_THRESHOLD = 6

// ─── 유틸리티 ───

interface AABB { minX: number; minY: number; maxX: number; maxY: number }

function polygonAABB(polygon: number[][]): AABB {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function isInsidePolygon(px: number, py: number, polygon: number[][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function rectPolygon(cx: number, cy: number, w: number, d: number): number[][] {
  const hw = w / 2, hd = d / 2
  return [
    [cx - hw, cy - hd],
    [cx + hw, cy - hd],
    [cx + hw, cy + hd],
    [cx - hw, cy + hd],
  ]
}

function rectFullyInside(rect: number[][], polygon: number[][]): boolean {
  return rect.every(([x, y]) => isInsidePolygon(x, y, polygon))
}

function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function rectOverlapsExclusion(rect: number[][], exclusions: AABB[]): boolean {
  const rAABB = polygonAABB(rect)
  return exclusions.some((ex) => aabbOverlap(rAABB, ex))
}

// ─── 입력/출력 ───

export interface ParkingLayoutInput {
  siteFootprint: number[][]
  buildingFootprint: number[][]
  /** 다중 건물 footprint (각각 로컬 m 좌표 폴리곤) */
  additionalFootprints?: number[][][]
  requiredTotal: number
  requiredDisabled: number
  pattern: ParkingLayoutPattern
  heading?: number
}

export interface ParkingLayoutResult {
  zone: ParkingZoneData
  entrance: ParkingEntranceData
}

// ─── 슬롯 생성 헬퍼 ───

function tryPlaceSlot(
  cx: number, cy: number, w: number, d: number,
  slotType: 'standard' | 'disabled',
  id: number,
  siteFootprint: number[][],
  exclusions: AABB[],
): ParkingSlotData | null {
  const poly = rectPolygon(cx, cy, w, d)
  if (!rectFullyInside(poly, siteFootprint)) return null
  if (rectOverlapsExclusion(poly, exclusions)) return null
  return {
    id,
    slot_type: slotType,
    cx, cy,
    width: w, depth: d,
    heading: 0,
    polygon: poly,
  }
}

// ─── 슬롯 배치 헬퍼 (방향별 시도) ───

interface PlacementAttempt {
  slots: ParkingSlotData[]
  aisles: ParkingAisleData[]
}

function attemptPlacement(
  direction: 'bottom-up' | 'top-down',
  siteAABB: AABB,
  siteFootprint: number[][],
  exclusions: AABB[],
  slotW: number,
  slotD: number,
  slotWDisabled: number,
  requiredTotal: number,
  requiredDisabled: number,
): PlacementAttempt {
  const slots: ParkingSlotData[] = []
  const aisles: ParkingAisleData[] = []
  let slotId = 0

  const startX = siteAABB.minX + MARGIN
  const endX = siteAABB.maxX - MARGIN
  const minY = siteAABB.minY + MARGIN
  const maxY = siteAABB.maxY - MARGIN

  // 방향에 따른 시작/종료 Y 및 증가 방향
  const isBottomUp = direction === 'bottom-up'
  let y = isBottomUp ? minY + slotD / 2 : maxY - slotD / 2
  const yStep = isBottomUp ? 1 : -1

  const shouldContinue = () => {
    if (isBottomUp) return y + slotD / 2 <= maxY
    return y - slotD / 2 >= minY
  }

  const advanceY = (amount: number) => {
    y += yStep * amount
  }

  while (shouldContinue() && slots.length < requiredTotal) {
    // ── 현재 줄 배치 ──
    let x = startX + slotW / 2
    const rowStartCount = slots.length

    while (x + slotW / 2 <= endX && slots.length < requiredTotal) {
      const isDisabled = slots.filter(s => s.slot_type === 'disabled').length < requiredDisabled
      const w = isDisabled ? slotWDisabled : slotW
      const slot = tryPlaceSlot(x, y, w, slotD, isDisabled ? 'disabled' : 'standard', slotId, siteFootprint, exclusions)
      if (slot) {
        slots.push(slot)
        slotId++
      }
      x += w + SLOT_GAP
    }

    // 이 줄에 배치된 게 있으면 차로 추가 후 반대편 줄 시도
    if (slots.length > rowStartCount && requiredTotal > SMALL_THRESHOLD) {
      const aisleY = isBottomUp ? y + slotD / 2 + AISLE_WIDTH / 2 : y - slotD / 2 - AISLE_WIDTH / 2
      const topRowY = isBottomUp ? aisleY + AISLE_WIDTH / 2 + slotD / 2 : aisleY - AISLE_WIDTH / 2 - slotD / 2

      // 차로와 반대편 줄이 영역 안에 있는지 확인
      const aisleInBounds = isBottomUp
        ? aisleY + AISLE_WIDTH / 2 + slotD <= maxY
        : aisleY - AISLE_WIDTH / 2 - slotD >= minY
      const topRowInBounds = isBottomUp
        ? topRowY + slotD / 2 <= maxY
        : topRowY - slotD / 2 >= minY

      if (aisleInBounds && topRowInBounds) {
        const aislePoly = rectPolygon((startX + endX) / 2, aisleY, endX - startX, AISLE_WIDTH)
        if (aislePoly.some(([px, py]) => isInsidePolygon(px, py, siteFootprint))) {
          aisles.push({ polygon: aislePoly, direction: 'horizontal' })
        }

        // ── 반대편 줄 ──
        x = startX + slotW / 2
        while (x + slotW / 2 <= endX && slots.length < requiredTotal) {
          const isDisabled = slots.filter(s => s.slot_type === 'disabled').length < requiredDisabled
          const w = isDisabled ? slotWDisabled : slotW
          const slot = tryPlaceSlot(x, topRowY, w, slotD, isDisabled ? 'disabled' : 'standard', slotId, siteFootprint, exclusions)
          if (slot) {
            slots.push(slot)
            slotId++
          }
          x += w + SLOT_GAP
        }

        // 다음 줄로 이동
        advanceY(slotD + AISLE_WIDTH + slotD + 1)
      } else {
        advanceY(slotD + 0.5)
      }
    } else {
      // 배치된 게 없으면 다음 위치로 빠르게 이동
      advanceY(slotD + 0.5)
    }
  }

  return { slots, aisles }
}

// ─── 메인 생성 함수 ───

export function generateParkingLayout(input: ParkingLayoutInput): ParkingLayoutResult {
  const {
    siteFootprint,
    buildingFootprint,
    additionalFootprints = [],
    requiredTotal,
    requiredDisabled,
    pattern,
  } = input

  const siteAABB = polygonAABB(siteFootprint)
  const siteW = siteAABB.maxX - siteAABB.minX
  const siteH = siteAABB.maxY - siteAABB.minY
  const siteCx = (siteAABB.minX + siteAABB.maxX) / 2
  const siteCy = (siteAABB.minY + siteAABB.maxY) / 2

  // 건물 배제 영역 (다중 건물 지원)
  const exclusions: AABB[] = []
  const allFootprints = [
    buildingFootprint,
    ...additionalFootprints,
  ].filter((fp) => fp.length >= 3)

  for (const fp of allFootprints) {
    const bAABB = polygonAABB(fp)
    exclusions.push({
      minX: bAABB.minX - 1.5, minY: bAABB.minY - 1.5,
      maxX: bAABB.maxX + 1.5, maxY: bAABB.maxY + 1.5,
    })
  }

  // 직각/평행에 따른 슬롯 치수
  const isPerpendicular = pattern === 'perpendicular'
  // 직각: 폭 2.5m × 깊이 5m (차 옆으로 주차)
  // 평행: 폭 2.3m × 깊이 6m (차 앞뒤로 주차)
  const slotW = isPerpendicular ? SLOT_WIDTH : SLOT_DEPTH_PARA
  const slotD = isPerpendicular ? SLOT_DEPTH_PERP : SLOT_LENGTH_PARA
  const slotWDisabled = SLOT_WIDTH_DISABLED

  // 양방향 배치 시도 후 더 좋은 결과 선택
  const bottomUp = attemptPlacement('bottom-up', siteAABB, siteFootprint, exclusions, slotW, slotD, slotWDisabled, requiredTotal, requiredDisabled)
  const topDown = attemptPlacement('top-down', siteAABB, siteFootprint, exclusions, slotW, slotD, slotWDisabled, requiredTotal, requiredDisabled)

  // 더 많은 슬롯이 배치된 결과 선택
  const best = bottomUp.slots.length >= topDown.slots.length ? bottomUp : topDown
  const slots = best.slots
  const aisles = best.aisles

  // 소규모 (슬롯이 부족할 경우) 추가 시도 - 기존 알고리즘 폴백
  if (slots.length < requiredTotal && requiredTotal <= SMALL_THRESHOLD) {
    // 간단한 그리드 스캔으로 빈 공간 찾기
    const scanStep = slotW + SLOT_GAP
    let slotId = slots.length
    for (let scanY = siteAABB.minY + MARGIN + slotD / 2; scanY + slotD / 2 <= siteAABB.maxY - MARGIN && slots.length < requiredTotal; scanY += slotD + 0.5) {
      for (let scanX = siteAABB.minX + MARGIN + slotW / 2; scanX + slotW / 2 <= siteAABB.maxX - MARGIN && slots.length < requiredTotal; scanX += scanStep) {
        // 이미 이 위치에 슬롯이 있는지 확인
        const alreadyPlaced = slots.some(s => Math.abs(s.cx - scanX) < slotW && Math.abs(s.cy - scanY) < slotD)
        if (alreadyPlaced) continue

        const isDisabled = slots.filter(s => s.slot_type === 'disabled').length < requiredDisabled
        const w = isDisabled ? slotWDisabled : slotW
        const slot = tryPlaceSlot(scanX, scanY, w, slotD, isDisabled ? 'disabled' : 'standard', slotId, siteFootprint, exclusions)
        if (slot) {
          slots.push(slot)
          slotId++
        }
      }
    }
  }

  // ─── 결과 정리 ───

  const standardSlots = slots.filter(s => s.slot_type === 'standard').length
  const disabledSlots = slots.filter(s => s.slot_type === 'disabled').length

  // 존 경계 AABB
  const allPoints = [...slots.flatMap(s => s.polygon), ...aisles.flatMap(a => a.polygon)]
  let zMinX = Infinity, zMinY = Infinity, zMaxX = -Infinity, zMaxY = -Infinity
  for (const [px, py] of allPoints) {
    if (px < zMinX) zMinX = px
    if (py < zMinY) zMinY = py
    if (px > zMaxX) zMaxX = px
    if (py > zMaxY) zMaxY = py
  }

  if (slots.length === 0) {
    zMinX = siteCx - 5; zMinY = siteCy - 5
    zMaxX = siteCx + 5; zMaxY = siteCy + 5
  }

  const zonePolygon = [
    [zMinX, zMinY], [zMaxX, zMinY], [zMaxX, zMaxY], [zMinX, zMaxY],
  ]
  const zoneCx = (zMinX + zMaxX) / 2
  const zoneCy = (zMinY + zMaxY) / 2
  const zoneWidth = zMaxX - zMinX
  const zoneDepth = zMaxY - zMinY
  const totalAreaM2 = zoneWidth * zoneDepth

  const warnings: string[] = []
  if (slots.length < requiredTotal) {
    warnings.push(`요구 ${requiredTotal}대 중 ${slots.length}대만 배치됨 (영역 부족)`)
  }
  if (disabledSlots < requiredDisabled) {
    warnings.push(`장애인 주차 ${requiredDisabled}대 중 ${disabledSlots}대만 배치됨`)
  }

  const zone: ParkingZoneData = {
    slots,
    aisles,
    accessPoint: null,
    zonePolygon,
    zoneCenter: [zoneCx, zoneCy],
    zoneRotation: 0,
    zoneWidth,
    zoneDepth,
    totalSlots: slots.length,
    standardSlots,
    disabledSlots,
    totalAreaM2,
    parkingAreaRatio: siteW * siteH > 0 ? totalAreaM2 / (siteW * siteH) : 0,
    warnings,
  }

  // ─── 입구 오브젝트 (존 위쪽 = 도로 쪽) ───
  const entranceCx = zoneCx
  const entranceCy = zMaxY + ENTRANCE_DEPTH / 2 + 0.5
  const entrancePoly = rectPolygon(entranceCx, entranceCy, ENTRANCE_WIDTH, ENTRANCE_DEPTH)

  const entrance: ParkingEntranceData = {
    cx: entranceCx,
    cy: entranceCy,
    width: ENTRANCE_WIDTH,
    depth: ENTRANCE_DEPTH,
    heading: 180, // 주차구역 방향(아래)을 가리킴
    polygon: entrancePoly,
  }

  return { zone, entrance }
}
