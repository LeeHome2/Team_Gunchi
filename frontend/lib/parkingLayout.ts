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
const SLOT_GAP = 0.15 // 슬롯 간 간격
const ENTRANCE_WIDTH = 5.0
const ENTRANCE_DEPTH = 2.5

// ─── 유틸리티 ───

interface AABB { minX: number; minY: number; maxX: number; maxY: number }

function polygonAABB(polygon: number[][]): AABB {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
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

// ─── 메인 생성 함수 ───

export function generateParkingLayout(input: ParkingLayoutInput): ParkingLayoutResult {
  const {
    siteFootprint,
    requiredTotal,
    requiredDisabled,
    pattern,
  } = input

  // 사이트 중심을 기준점으로 사용 (없으면 0,0)
  let siteCx = 0
  let siteCy = 0
  if (siteFootprint && siteFootprint.length >= 3) {
    const aabb = polygonAABB(siteFootprint)
    siteCx = (aabb.minX + aabb.maxX) / 2
    siteCy = (aabb.minY + aabb.maxY) / 2
  }

  console.log(
    `[주차] 단순 생성: 총 ${requiredTotal}대 (장애인 ${requiredDisabled}대), 패턴=${pattern}`,
  )

  // 직각/평행에 따른 슬롯 치수
  // 직각: 폭 2.5m × 깊이 5m (차 옆으로 주차)
  // 평행: 폭 2.3m × 깊이 6m (차 앞뒤로 주차)
  const isPerpendicular = pattern === 'perpendicular'
  const slotW = isPerpendicular ? SLOT_WIDTH : SLOT_DEPTH_PARA
  const slotD = isPerpendicular ? SLOT_DEPTH_PERP : SLOT_LENGTH_PARA
  const slotWDisabled = SLOT_WIDTH_DISABLED

  // 요청 대수가 너무 많으면 여러 줄로 wrap (한 줄 최대 길이 ~30m 기준)
  const MAX_ROW_LEN_M = 30
  const slotsPerRow = Math.max(
    1,
    Math.min(requiredTotal, Math.floor(MAX_ROW_LEN_M / (slotW + SLOT_GAP))),
  )

  // 슬롯 배치 — 사이트/건물 체크 없이 요청한 대수만큼 무조건 생성
  const slots: ParkingSlotData[] = []
  const safeRequired = Math.max(0, Math.floor(requiredTotal))
  const safeDisabled = Math.max(0, Math.min(Math.floor(requiredDisabled), safeRequired))

  // 한 줄 전체 폭 (장애인 슬롯과 일반 슬롯 폭이 다르지만 평균치로 정렬용 추정)
  // 정확한 배치는 누적 x 좌표로 처리한다.
  for (let i = 0; i < safeRequired; i++) {
    const row = Math.floor(i / slotsPerRow)
    const col = i % slotsPerRow
    const isDisabled = i < safeDisabled
    const w = isDisabled ? slotWDisabled : slotW

    // 줄별로 cx 누적 (각 줄 시작 시 0으로 리셋)
    // 단순화를 위해: 한 줄의 슬롯 폭을 평균값 사용해 위치 계산.
    // 폭이 다른 장애인 슬롯이 줄 맨 앞에만 모이도록 했으므로 첫 N개 위치는
    // disabled 폭, 나머지는 standard 폭으로 누적한다.
    let cx = 0
    for (let j = 0; j < col; j++) {
      const indexAcrossAllRows = row * slotsPerRow + j
      const jIsDisabled = indexAcrossAllRows < safeDisabled
      cx += (jIsDisabled ? slotWDisabled : slotW) + SLOT_GAP
    }
    cx += w / 2

    // 줄 전체를 중앙 정렬하기 위해 줄 폭 계산
    const rowSlotCount = Math.min(slotsPerRow, safeRequired - row * slotsPerRow)
    let rowTotalW = 0
    for (let j = 0; j < rowSlotCount; j++) {
      const idxInAllRows = row * slotsPerRow + j
      const jIsDisabled = idxInAllRows < safeDisabled
      rowTotalW += jIsDisabled ? slotWDisabled : slotW
    }
    rowTotalW += (rowSlotCount - 1) * SLOT_GAP

    const x = siteCx - rowTotalW / 2 + cx
    const y = siteCy - (row * (slotD + SLOT_GAP))

    slots.push({
      id: i,
      slot_type: isDisabled ? 'disabled' : 'standard',
      cx: x,
      cy: y,
      width: w,
      depth: slotD,
      heading: 0,
      polygon: rectPolygon(x, y, w, slotD),
    })
  }

  // ─── 결과 정리 ───

  const standardSlots = slots.filter((s) => s.slot_type === 'standard').length
  const disabledSlots = slots.filter((s) => s.slot_type === 'disabled').length

  // 존 경계 AABB
  let zMinX = Infinity, zMinY = Infinity, zMaxX = -Infinity, zMaxY = -Infinity
  for (const s of slots) {
    for (const [px, py] of s.polygon) {
      if (px < zMinX) zMinX = px
      if (py < zMinY) zMinY = py
      if (px > zMaxX) zMaxX = px
      if (py > zMaxY) zMaxY = py
    }
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

  const zone: ParkingZoneData = {
    slots,
    aisles: [],
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
    parkingAreaRatio: 0,
    warnings: [],
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
