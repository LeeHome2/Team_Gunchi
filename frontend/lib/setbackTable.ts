/**
 * 이격거리 테이블 (건축법 시행령 별표 2 기준 - 서울시)
 *
 * 건축선으로부터 건축물까지 띄어야 하는 거리 및
 * 인접 대지경계선으로부터 건축물까지 띄어야 하는 거리
 */

// 용도지역 타입
export type ZoneType =
  | '제1종전용주거지역'
  | '제2종전용주거지역'
  | '제1종일반주거지역'
  | '제2종일반주거지역'
  | '제3종일반주거지역'
  | '준주거지역'
  | '중심상업지역'
  | '일반상업지역'
  | '근린상업지역'
  | '유통상업지역'
  | '전용공업지역'
  | '일반공업지역'
  | '준공업지역'
  | '보전녹지지역'
  | '생산녹지지역'
  | '자연녹지지역'
  | '관리지역'
  | '농림지역'
  | '자연환경보전지역'
  | '미지정'

// 건축물 용도 타입
export type BuildingUseType =
  | '공장'
  | '판매시설'
  | '숙박시설'
  | '공동주택'
  | '단독주택'
  | '근린생활시설'
  | '업무시설'
  | '기타'

// 용도지역 그룹화 (이격거리 규정이 동일한 지역끼리 그룹화)
export type ZoneGroup = '주거지역' | '상업지역' | '공업지역' | '녹지지역' | '관리지역' | '기타'

// 용도지역 코드 → 이름 매핑 (V-World WFS 응답값 기준)
export const ZONE_CODE_MAP: Record<string, ZoneType> = {
  // 주거지역
  'UQA100': '제1종전용주거지역',
  'UQA110': '제2종전용주거지역',
  'UQA120': '제1종일반주거지역',
  'UQA121': '제2종일반주거지역',
  'UQA122': '제3종일반주거지역',
  'UQA130': '준주거지역',
  // 상업지역
  'UQA200': '중심상업지역',
  'UQA210': '일반상업지역',
  'UQA220': '근린상업지역',
  'UQA230': '유통상업지역',
  // 공업지역
  'UQA300': '전용공업지역',
  'UQA310': '일반공업지역',
  'UQA320': '준공업지역',
  // 녹지지역
  'UQA410': '보전녹지지역',
  'UQA420': '생산녹지지역',
  'UQA430': '자연녹지지역',
}

// 용도지역 → 그룹 매핑
export function getZoneGroup(zone: ZoneType): ZoneGroup {
  if (zone.includes('주거')) return '주거지역'
  if (zone.includes('상업')) return '상업지역'
  if (zone.includes('공업')) return '공업지역'
  if (zone.includes('녹지')) return '녹지지역'
  if (zone === '관리지역') return '관리지역'
  return '기타'
}

// 건축선 이격거리 테이블 (단위: m)
// 건축선 = 도로에 접한 대지경계선
interface SetbackFromBuildingLine {
  default: number
  factory?: number      // 공장
  retail?: number       // 판매시설
  lodging?: number      // 숙박시설
}

const SETBACK_FROM_BUILDING_LINE: Record<ZoneGroup, SetbackFromBuildingLine> = {
  '주거지역': {
    default: 1,
    factory: 2,
    retail: 1.5,
    lodging: 1.5,
  },
  '상업지역': {
    default: 0,
  },
  '공업지역': {
    default: 1,
    factory: 1.5,
  },
  '녹지지역': {
    default: 2,
  },
  '관리지역': {
    default: 1.5,
  },
  '기타': {
    default: 1,
  },
}

// 인접 대지경계선 이격거리 테이블 (단위: m)
// 인접 대지경계선 = 도로가 아닌 인접 필지와의 경계선
interface SetbackFromAdjacentLot {
  default: number
  apartment?: number  // 공동주택
}

const SETBACK_FROM_ADJACENT_LOT: Record<ZoneGroup, SetbackFromAdjacentLot> = {
  '주거지역': {
    default: 0.5,
    apartment: 1,
  },
  '상업지역': {
    default: 0,
  },
  '공업지역': {
    default: 0.5,
  },
  '녹지지역': {
    default: 1,
  },
  '관리지역': {
    default: 1,
  },
  '기타': {
    default: 0.5,
  },
}

// 도로폭에 따른 건축선 후퇴 거리 (단위: m)
// 건축법 시행령 제31조 (대지와 도로의 관계)
export interface RoadSetbackRule {
  condition: string
  setbackFromCenterline: number  // 도로중심선에서 후퇴 거리
  description: string
}

export const ROAD_SETBACK_RULES: RoadSetbackRule[] = [
  {
    condition: '4m 이상 도로',
    setbackFromCenterline: 0,  // 건축선 = 도로경계선
    description: '일반적인 경우, 도로경계선이 건축선이 됨',
  },
  {
    condition: '4m 미만 도로',
    setbackFromCenterline: 2,
    description: '도로중심선에서 2m 후퇴',
  },
  {
    condition: '막다른 도로 (10m 이하)',
    setbackFromCenterline: 2,
    description: '도로중심선에서 2m 후퇴',
  },
  {
    condition: '막다른 도로 (35m 이하)',
    setbackFromCenterline: 3,
    description: '도로중심선에서 3m 후퇴',
  },
]

// 도로 모퉁이 가각전제 (건축법 시행령 제31조 제4항)
export interface CornerCutRule {
  roadWidthSum: string      // 두 도로 폭의 합
  cutDistance: number       // 가각전제 거리 (m)
}

export const CORNER_CUT_RULES: CornerCutRule[] = [
  { roadWidthSum: '8m 미만', cutDistance: 2 },
  { roadWidthSum: '8m 이상 ~ 12m 미만', cutDistance: 3 },
  { roadWidthSum: '12m 이상', cutDistance: 4 },
]

/**
 * 건축선으로부터의 이격거리 계산
 * @param zone 용도지역
 * @param buildingUse 건축물 용도
 * @returns 이격거리 (m)
 */
export function getSetbackFromBuildingLine(
  zone: ZoneType,
  buildingUse: BuildingUseType = '기타'
): number {
  const group = getZoneGroup(zone)
  const table = SETBACK_FROM_BUILDING_LINE[group]

  switch (buildingUse) {
    case '공장':
      return table.factory ?? table.default
    case '판매시설':
      return table.retail ?? table.default
    case '숙박시설':
      return table.lodging ?? table.default
    default:
      return table.default
  }
}

/**
 * 인접 대지경계선으로부터의 이격거리 계산
 * @param zone 용도지역
 * @param buildingUse 건축물 용도
 * @returns 이격거리 (m)
 */
export function getSetbackFromAdjacentLot(
  zone: ZoneType,
  buildingUse: BuildingUseType = '기타'
): number {
  const group = getZoneGroup(zone)
  const table = SETBACK_FROM_ADJACENT_LOT[group]

  if (buildingUse === '공동주택') {
    return table.apartment ?? table.default
  }
  return table.default
}

/**
 * 도로폭에 따른 건축선 후퇴 거리 계산
 * @param roadWidth 도로폭 (m)
 * @param isDeadEnd 막다른 도로 여부
 * @param deadEndLength 막다른 도로 길이 (m)
 * @returns 도로중심선에서 후퇴 거리 (m), 0이면 도로경계선이 건축선
 */
export function getRoadSetback(
  roadWidth: number,
  isDeadEnd: boolean = false,
  deadEndLength: number = 0
): number {
  // 막다른 도로인 경우
  if (isDeadEnd) {
    if (deadEndLength <= 10) return 2
    if (deadEndLength <= 35) return 3
    return 2  // 35m 초과 막다른 도로는 일반 도로 취급
  }

  // 일반 도로
  if (roadWidth >= 4) return 0  // 도로경계선 = 건축선
  return 2  // 4m 미만: 중심선에서 2m 후퇴
}

/**
 * 이격거리 정보 조회 (종합)
 */
export interface SetbackInfo {
  zone: ZoneType
  zoneGroup: ZoneGroup
  buildingUse: BuildingUseType
  fromBuildingLine: number      // 건축선 이격거리 (m)
  fromAdjacentLot: number       // 인접대지 이격거리 (m)
  roadSetback: number           // 도로폭 기반 건축선 후퇴 (m)
}

export function getSetbackInfo(
  zone: ZoneType,
  buildingUse: BuildingUseType = '기타',
  roadWidth: number = 4,  // 기본 4m 이상 가정
  isDeadEnd: boolean = false,
  deadEndLength: number = 0
): SetbackInfo {
  return {
    zone,
    zoneGroup: getZoneGroup(zone),
    buildingUse,
    fromBuildingLine: getSetbackFromBuildingLine(zone, buildingUse),
    fromAdjacentLot: getSetbackFromAdjacentLot(zone, buildingUse),
    roadSetback: getRoadSetback(roadWidth, isDeadEnd, deadEndLength),
  }
}

/**
 * 기본 이격거리 (용도지역 미확인 시 사용)
 */
export const DEFAULT_SETBACKS = {
  fromBuildingLine: 1,    // 건축선에서 1m
  fromAdjacentLot: 0.5,   // 인접대지에서 0.5m
  roadSetback: 0,         // 4m 이상 도로 가정
}

/**
 * 용도지역별 규정 한도 (검토 탭에서 사용).
 *
 * 백엔드 backend/services/validation.py 의 ZONE_CONFIGS 와 매핑 일치.
 * VWorld 에서 가져온 zoneType 을 키로 조회하여 건폐율/이격/높이 한도를 자동 적용.
 *
 * height: null = 제한 없음 (또는 별도 규정 적용 필요)
 */
export interface ZoneLimits {
  coverage: number       // 건폐율 한도 (%)
  setback: number        // 인접 대지 최소 이격거리 (m)
  height: number | null  // 최고 높이 (m), null = 제한 없음
}

export const ZONE_LIMITS: Record<ZoneType, ZoneLimits> = {
  '제1종전용주거지역': { coverage: 50, setback: 2.0, height: 10 },
  '제2종전용주거지역': { coverage: 50, setback: 1.5, height: 12 },
  '제1종일반주거지역': { coverage: 60, setback: 1.5, height: 16 },
  '제2종일반주거지역': { coverage: 60, setback: 1.5, height: 20 },
  '제3종일반주거지역': { coverage: 50, setback: 1.5, height: null },
  '준주거지역':         { coverage: 70, setback: 1.0, height: null },
  '중심상업지역':       { coverage: 90, setback: 0.0, height: null },
  '일반상업지역':       { coverage: 80, setback: 0.0, height: null },
  '근린상업지역':       { coverage: 70, setback: 0.5, height: null },
  '유통상업지역':       { coverage: 80, setback: 0.0, height: null },
  '전용공업지역':       { coverage: 70, setback: 1.0, height: null },
  '일반공업지역':       { coverage: 70, setback: 1.0, height: null },
  '준공업지역':         { coverage: 70, setback: 1.0, height: null },
  '보전녹지지역':       { coverage: 20, setback: 1.5, height: null },
  '생산녹지지역':       { coverage: 20, setback: 1.5, height: null },
  '자연녹지지역':       { coverage: 20, setback: 1.5, height: null },
  '관리지역':           { coverage: 40, setback: 1.0, height: null },
  '농림지역':           { coverage: 20, setback: 1.5, height: null },
  '자연환경보전지역':   { coverage: 20, setback: 1.5, height: null },
  '미지정':             { coverage: 60, setback: 1.5, height: null },  // default
}

/**
 * zoneType 으로 ZoneLimits 조회. 없으면 '미지정' 기본값.
 */
export function getZoneLimits(zoneType: ZoneType | string | null | undefined): ZoneLimits {
  if (!zoneType) return ZONE_LIMITS['미지정']
  return (ZONE_LIMITS as Record<string, ZoneLimits>)[zoneType] ?? ZONE_LIMITS['미지정']
}
