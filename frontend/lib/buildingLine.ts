/**
 * 건축선 계산 로직
 *
 * 대지경계선의 각 변(edge)을 분석하여:
 * - 도로에 접한 변 → 건축선 적용
 * - 인접 대지에 접한 변 → 인접대지 이격거리 적용
 */

import * as turf from '@turf/turf'
import {
  ZoneType,
  BuildingUseType,
  getSetbackFromBuildingLine,
  getSetbackFromAdjacentLot,
  getRoadSetback,
  DEFAULT_SETBACKS,
} from './setbackTable'

// GeoJSON 타입 정의
export interface Coordinate {
  lon: number
  lat: number
}

export interface Edge {
  index: number
  start: Coordinate
  end: Coordinate
  length: number  // 미터
  lineString: GeoJSON.Feature<GeoJSON.LineString>
}

export interface AdjacentInfo {
  edge: Edge
  type: 'road' | 'adjacent_lot' | 'unknown'
  roadParcel?: GeoJSON.Feature  // 도로 필지 정보
  setbackDistance: number       // 이격거리 (m)
}

export interface BuildingLineResult {
  // 원본 대지경계선
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>
  // 각 변의 인접 정보
  edgeInfos: AdjacentInfo[]
  // 도로 접촉 변
  roadEdges: AdjacentInfo[]
  // 인접 대지 접촉 변
  adjacentLotEdges: AdjacentInfo[]
  // 용도지역
  zoneType: ZoneType
  // 건축선 (offset 적용된 폴리곤)
  buildingLine: GeoJSON.Feature<GeoJSON.Polygon> | null
  // 건축 가능 영역
  buildableArea: GeoJSON.Feature<GeoJSON.Polygon> | null
}

/**
 * 폴리곤의 각 변(edge)을 LineString으로 추출
 */
export function getPolygonEdges(polygon: GeoJSON.Feature<GeoJSON.Polygon>): Edge[] {
  const coords = polygon.geometry.coordinates[0]  // 외부 링만
  const edges: Edge[] = []

  for (let i = 0; i < coords.length - 1; i++) {
    const start = { lon: coords[i][0], lat: coords[i][1] }
    const end = { lon: coords[i + 1][0], lat: coords[i + 1][1] }

    const lineString = turf.lineString([coords[i], coords[i + 1]])
    const length = turf.length(lineString, { units: 'meters' })

    edges.push({
      index: i,
      start,
      end,
      length,
      lineString,
    })
  }

  return edges
}

/**
 * 두 라인이 겹치거나 매우 가까운지 확인 (공유 경계)
 */
function edgesShareBoundary(
  edge: GeoJSON.Feature<GeoJSON.LineString>,
  otherPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  tolerance: number = 0.5  // 미터
): boolean {
  try {
    // 폴리곤을 라인으로 변환
    const polygonLine = turf.polygonToLine(otherPolygon)

    // 라인들 사이의 거리 계산
    // 엣지의 중점이 다른 폴리곤의 경계에 가까운지 확인
    const midpoint = turf.midpoint(
      turf.point([edge.geometry.coordinates[0][0], edge.geometry.coordinates[0][1]]),
      turf.point([edge.geometry.coordinates[1][0], edge.geometry.coordinates[1][1]])
    )

    const distance = turf.pointToLineDistance(midpoint, polygonLine as any, { units: 'meters' })

    return distance <= tolerance
  } catch (e) {
    console.warn('Error checking edge boundary:', e)
    return false
  }
}

/**
 * 대지경계선의 각 변이 도로와 접하는지 판별
 */
export function findRoadAdjacentEdges(
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  nearbyParcels: GeoJSON.Feature<GeoJSON.Polygon>[],
  zoneType: ZoneType = '미지정',
  buildingUse: BuildingUseType = '기타',
  roadWidth: number = 4
): AdjacentInfo[] {
  const edges = getPolygonEdges(cadastralPolygon)
  const roadParcels = nearbyParcels.filter(p => p.properties?.isRoad === true)

  const edgeInfos: AdjacentInfo[] = []

  for (const edge of edges) {
    let isRoadAdjacent = false
    let roadParcel: GeoJSON.Feature | undefined

    // 각 변이 도로 필지와 경계를 공유하는지 확인
    for (const road of roadParcels) {
      if (edgesShareBoundary(edge.lineString, road as GeoJSON.Feature<GeoJSON.Polygon>)) {
        isRoadAdjacent = true
        roadParcel = road
        break
      }
    }

    if (isRoadAdjacent) {
      // 도로 접촉 변 → 건축선 이격거리 적용
      const buildingLineSetback = getSetbackFromBuildingLine(zoneType, buildingUse)
      const roadSetback = getRoadSetback(roadWidth)

      edgeInfos.push({
        edge,
        type: 'road',
        roadParcel,
        setbackDistance: buildingLineSetback + roadSetback,
      })
    } else {
      // 비접촉 변 → 인접 대지 이격거리 적용
      edgeInfos.push({
        edge,
        type: 'adjacent_lot',
        setbackDistance: getSetbackFromAdjacentLot(zoneType, buildingUse),
      })
    }
  }

  return edgeInfos
}

/**
 * 각 변별 이격거리를 적용한 건축선 계산
 * (각 edge를 개별적으로 내부로 평행이동)
 */
export function calculateBuildingLine(
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  edgeInfos: AdjacentInfo[]
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  try {
    // 모든 이격거리가 동일한 경우 단순 buffer 사용
    const setbacks = edgeInfos.map(e => e.setbackDistance)
    const uniqueSetbacks = Array.from(new Set(setbacks))

    if (uniqueSetbacks.length === 1 && uniqueSetbacks[0] > 0) {
      // 균일한 이격거리: turf.buffer 사용 (음수로 내부 offset)
      const buffered = turf.buffer(cadastralPolygon, -uniqueSetbacks[0], { units: 'meters' })
      return buffered as GeoJSON.Feature<GeoJSON.Polygon>
    }

    // 이격거리가 다른 경우: 최소 이격거리로 일괄 적용 (간소화)
    // TODO: 각 edge별 개별 offset은 복잡하므로 백엔드 Shapely 권장
    const minSetback = Math.min(...setbacks.filter(s => s > 0), DEFAULT_SETBACKS.fromAdjacentLot)

    if (minSetback > 0) {
      const buffered = turf.buffer(cadastralPolygon, -minSetback, { units: 'meters' })
      return buffered as GeoJSON.Feature<GeoJSON.Polygon>
    }

    return cadastralPolygon
  } catch (e) {
    console.error('Error calculating building line:', e)
    return null
  }
}

/**
 * 전체 건축선 계산 프로세스
 */
export async function analyzeBuildingLine(
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  nearbyParcels: GeoJSON.Feature<GeoJSON.Polygon>[],
  zoneType: ZoneType = '미지정',
  buildingUse: BuildingUseType = '기타',
  roadWidth: number = 4
): Promise<BuildingLineResult> {
  // 1. 각 변의 인접 정보 분석
  const edgeInfos = findRoadAdjacentEdges(
    cadastralPolygon,
    nearbyParcels,
    zoneType,
    buildingUse,
    roadWidth
  )

  // 2. 도로/인접대지 구분
  const roadEdges = edgeInfos.filter(e => e.type === 'road')
  const adjacentLotEdges = edgeInfos.filter(e => e.type === 'adjacent_lot')

  // 3. 건축선 계산
  const buildingLine = calculateBuildingLine(cadastralPolygon, edgeInfos)

  return {
    cadastralPolygon,
    edgeInfos,
    roadEdges,
    adjacentLotEdges,
    zoneType,
    buildingLine,
    buildableArea: buildingLine,  // 현재는 건축선 = 건축 가능 영역
  }
}

/**
 * 용도지역 조회 API 호출
 */
export async function fetchZoneType(lon: number, lat: number): Promise<ZoneType> {
  try {
    const response = await fetch(`/api/zone/wfs?lon=${lon}&lat=${lat}`)
    if (!response.ok) {
      console.warn('Failed to fetch zone type:', response.status)
      return '미지정'
    }

    const data = await response.json()
    return data.zoneType || '미지정'
  } catch (e) {
    console.error('Error fetching zone type:', e)
    return '미지정'
  }
}

/**
 * 주변 필지 조회 API 호출
 */
export async function fetchNearbyParcels(
  bbox: { west: number; south: number; east: number; north: number }
): Promise<GeoJSON.Feature<GeoJSON.Polygon>[]> {
  try {
    const bboxStr = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
    const response = await fetch(`/api/cadastral/wfs?bbox=${bboxStr}`)

    if (!response.ok) {
      console.warn('Failed to fetch nearby parcels:', response.status)
      return []
    }

    const data = await response.json()
    return data.features || []
  } catch (e) {
    console.error('Error fetching nearby parcels:', e)
    return []
  }
}

/**
 * 폴리곤의 바운딩 박스 확장
 */
export function expandBbox(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
  bufferMeters: number = 50
): { west: number; south: number; east: number; north: number } {
  const bbox = turf.bbox(polygon)
  const bufferDeg = bufferMeters / 111320  // 대략적인 미터→도 변환

  return {
    west: bbox[0] - bufferDeg,
    south: bbox[1] - bufferDeg,
    east: bbox[2] + bufferDeg,
    north: bbox[3] + bufferDeg,
  }
}
