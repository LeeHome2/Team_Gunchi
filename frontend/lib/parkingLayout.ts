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

  const slots: ParkingSlotData[] = []
  const aisles: ParkingAisleData[] = []
  let slotId = 0

  // 배치 시작 위치 (사이트 하단에서 시작)
  const startX = siteAABB.minX + MARGIN
  const startY = siteAABB.minY + MARGIN
  const endX = siteAABB.maxX - MARGIN
  const endY = siteAABB.maxY - MARGIN

  if (requiredTotal <= SMALL_THRESHOLD) {
    // ═══ 소규모: 한 줄 나란히 (차로 없음) ═══
    // 직각: 가로로 나란히 배치
    // 평행: 세로로 나란히 배치

    const rowY = startY + slotD / 2
    let x = startX + slotW / 2

    for (let i = 0; i < requiredTotal && x + slotW / 2 <= endX; i++) {
      const isDisabled = slots.filter(s => s.slot_type === 'disabled').length < requiredDisabled
      const w = isDisabled ? slotWDisabled : slotW

      const slot = tryPlaceSlot(x, rowY, w, slotD, isDisabled ? 'disabled' : 'standard', slotId, siteFootprint, exclusions)
      if (slot) {
        slots.push(slot)
        slotId++
      }
      x += w + SLOT_GAP
    }

    // 첫 줄에 다 안 들어가면 두 번째 줄 추가 (차로 없이 바로 뒤)
    if (slots.length < requiredTotal) {
      const row2Y = rowY + slotD + 0.5
      x = startX + slotW / 2
      for (let i = slots.length; i < requiredTotal && x + slotW / 2 <= endX; i++) {
        const isDisabled = slots.filter(s => s.slot_type === 'disabled').length < requiredDisabled
        const w = isDisabled ? slotWDisabled : slotW
        const slot = tryPlaceSlot(x, row2Y, w, slotD, isDisabled ? 'disabled' : 'standard', slotId, siteFootprint, exclusions)
        if (slot) {
          slots.push(slot)
          slotId++
        }
        x += w + SLOT_GAP
      }
    }
  } else {
    // ═══ 중/대규모: 두 줄 마주보기 + 가운데 차로 반복 ═══
    let y = startY + slotD / 2

    while (y + slotD / 2 <= endY && slots.length < requiredTotal) {
      const aisleTopY = y + slotD / 2
      const needsAisle = slots.length > 0 || requiredTotal > SMALL_THRESHOLD

      // ── 아래 줄 ──
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

      // 이 줄에 배치된 게 있으면 차로 추가
      if (slots.length > rowStartCount && needsAisle) {
        const aisleCY = aisleTopY + AISLE_WIDTH / 2
        if (aisleCY + AISLE_WIDTH / 2 + slotD <= endY) {
          const aislePoly = rectPolygon((startX + endX) / 2, aisleCY, endX - startX, AISLE_WIDTH)
          if (aislePoly.some(([px, py]) => isInsidePolygon(px, py, siteFootprint))) {
            aisles.push({ polygon: aislePoly, direction: 'horizontal' })
          }

          // ── 윗 줄 (차로 위) ──
          const topY = aisleCY + AISLE_WIDTH / 2 + slotD / 2
          if (topY + slotD / 2 <= endY) {
            x = startX + slotW / 2
            while (x + slotW / 2 <= endX && slots.length < requiredTotal) {
              const isDisabled = slots.filter(s => s.slot_type === 'disabled').length < requiredDisabled
              const w = isDisabled ? slotWDisabled : slotW
              const slot = tryPlaceSlot(x, topY, w, slotD, isDisabled ? 'disabled' : 'standard', slotId, siteFootprint, exclusions)
              if (slot) {
                slots.push(slot)
                slotId++
              }
              x += w + SLOT_GAP
            }
            y = topY + slotD / 2 + 1 + slotD / 2 // 다음 행 시작
          } else {
            break
          }
        } else {
          break
        }
      } else {
        y += slotD + 0.5
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
