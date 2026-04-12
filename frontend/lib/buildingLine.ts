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
 * 다중 샘플 포인트로 판별 정확도 향상
 */
function edgesShareBoundary(
  edge: GeoJSON.Feature<GeoJSON.LineString>,
  otherPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  tolerance: number = 1.5  // 미터 (WFS 좌표 정밀도 고려)
): boolean {
  try {
    const polygonLine = turf.polygonToLine(otherPolygon)

    const start = edge.geometry.coordinates[0]
    const end = edge.geometry.coordinates[1]

    // 변을 따라 여러 지점 샘플링 (25%, 50%, 75%)
    const sampleRatios = [0.25, 0.5, 0.75]
    let closeCount = 0

    for (const ratio of sampleRatios) {
      const samplePoint = turf.point([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ])

      const distance = turf.pointToLineDistance(samplePoint, polygonLine as any, { units: 'meters' })

      if (distance <= tolerance) {
        closeCount++
      }
    }

    // 샘플 중 2개 이상 가까우면 경계 공유로 판정
    return closeCount >= 2
  } catch (e) {
    console.warn('Error checking edge boundary:', e)
    return false
  }
}

/**
 * 두 폴리곤이 같은 필지인지 확인 (PNU 또는 좌표 기반)
 */
function isSameParcel(
  a: GeoJSON.Feature<GeoJSON.Polygon>,
  b: GeoJSON.Feature<GeoJSON.Polygon>
): boolean {
  // PNU가 있으면 PNU로 비교
  if (a.properties?.pnu && b.properties?.pnu) {
    return a.properties.pnu === b.properties.pnu
  }
  // PNU 없으면 첫 좌표로 비교
  const ac = a.geometry.coordinates[0]?.[0]
  const bc = b.geometry.coordinates[0]?.[0]
  if (ac && bc) {
    return Math.abs(ac[0] - bc[0]) < 0.000001 && Math.abs(ac[1] - bc[1]) < 0.000001
  }
  return false
}

/**
 * 대지경계선의 각 변이 도로와 접하는지 판별
 *
 * 3단계 판별:
 * 1) 명시적 도로 필지(jimok='도')와 맞닿는지 확인
 * 2) 비도로 필지와 맞닿는지 확인 → 인접 대지
 * 3) 어떤 필지와도 안 맞닿으면 → 빈 공간 = 도로로 추정
 */
export function findRoadAdjacentEdges(
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  nearbyParcels: GeoJSON.Feature<GeoJSON.Polygon>[],
  zoneType: ZoneType = '미지정',
  buildingUse: BuildingUseType = '기타',
  roadWidth: number = 4
): AdjacentInfo[] {
  const edges = getPolygonEdges(cadastralPolygon)

  // 자기 자신 제외한 주변 필지
  const otherParcels = nearbyParcels.filter(p => !isSameParcel(p, cadastralPolygon))

  // 명시적 도로 필지 (jimok='도' or jimokCd='07')
  const roadParcels = otherParcels.filter(p => p.properties?.isRoad === true)
  // 비도로 필지
  const nonRoadParcels = otherParcels.filter(p => !p.properties?.isRoad)

  const edgeInfos: AdjacentInfo[] = []

  for (const edge of edges) {
    let detectedType: 'road' | 'adjacent_lot' | 'unknown' = 'unknown'
    let roadParcel: GeoJSON.Feature | undefined

    // --- 1단계: 명시적 도로 필지와 맞닿는지 확인 ---
    for (const road of roadParcels) {
      if (edgesShareBoundary(edge.lineString, road as GeoJSON.Feature<GeoJSON.Polygon>)) {
        detectedType = 'road'
        roadParcel = road
        break
      }
    }

    // --- 2단계: 비도로 필지(대지, 공장용지 등)와 맞닿는지 확인 ---
    if (detectedType === 'unknown') {
      let isAdjacentToNonRoad = false
      for (const parcel of nonRoadParcels) {
        if (edgesShareBoundary(edge.lineString, parcel as GeoJSON.Feature<GeoJSON.Polygon>)) {
          isAdjacentToNonRoad = true
          break
        }
      }

      if (isAdjacentToNonRoad) {
        detectedType = 'adjacent_lot'
      }
    }

    // --- 3단계: 아무 필지와도 안 맞닿으면 → 빈 공간 = 도로 ---
    if (detectedType === 'unknown') {
      detectedType = 'road'
      console.log(`Edge ${edge.index}: 인접 필지 없음 → 도로로 추정 (빈 공간 휴리스틱)`)
    }

    if (detectedType === 'road') {
      const buildingLineSetback = getSetbackFromBuildingLine(zoneType, buildingUse)
      const roadSetback = getRoadSetback(roadWidth)

      edgeInfos.push({
        edge,
        type: 'road',
        roadParcel,
        setbackDistance: buildingLineSetback + roadSetback,
      })
    } else {
      edgeInfos.push({
        edge,
        type: 'adjacent_lot',
        setbackDistance: getSetbackFromAdjacentLot(zoneType, buildingUse),
      })
    }
  }

  console.log(`건축선 분석: 전체 ${edges.length}변, 도로 ${edgeInfos.filter(e => e.type === 'road').length}변, 인접대지 ${edgeInfos.filter(e => e.type === 'adjacent_lot').length}변`)

  return edgeInfos
}

/**
 * 변(edge)을 폴리곤 내부 방향으로 평행이동
 */
function offsetEdgeInward(
  edge: Edge,
  distance: number,
  polygon: GeoJSON.Feature<GeoJSON.Polygon>
): GeoJSON.Feature<GeoJSON.LineString> {
  const dx = edge.end.lon - edge.start.lon
  const dy = edge.end.lat - edge.start.lat
  const len = Math.sqrt(dx * dx + dy * dy)

  if (len === 0) return edge.lineString

  // 법선 벡터 (왼쪽/오른쪽 둘 다 계산)
  const nx = -dy / len
  const ny = dx / len

  // 미터 → 도 변환 (위도에 따른 보정)
  const latRad = ((edge.start.lat + edge.end.lat) / 2) * (Math.PI / 180)
  const meterPerDegLon = 111320 * Math.cos(latRad)
  const meterPerDegLat = 110540

  const offsetLon = (distance * nx) / meterPerDegLon
  const offsetLat = (distance * ny) / meterPerDegLat

  // 두 방향 중 폴리곤 내부 방향 선택
  const mid1 = turf.point([
    (edge.start.lon + edge.end.lon) / 2 + offsetLon,
    (edge.start.lat + edge.end.lat) / 2 + offsetLat,
  ])
  const mid2 = turf.point([
    (edge.start.lon + edge.end.lon) / 2 - offsetLon,
    (edge.start.lat + edge.end.lat) / 2 - offsetLat,
  ])

  const inside1 = turf.booleanPointInPolygon(mid1, polygon)
  const inside2 = turf.booleanPointInPolygon(mid2, polygon)

  let finalOffsetLon = offsetLon
  let finalOffsetLat = offsetLat

  if (inside2 && !inside1) {
    finalOffsetLon = -offsetLon
    finalOffsetLat = -offsetLat
  }
  // inside1이면 원래 방향 유지, 둘 다 true/false면 기본 방향

  return turf.lineString([
    [edge.start.lon + finalOffsetLon, edge.start.lat + finalOffsetLat],
    [edge.end.lon + finalOffsetLon, edge.end.lat + finalOffsetLat],
  ])
}

/**
 * 두 직선의 교점 계산
 */
function lineIntersection(
  l1: GeoJSON.Feature<GeoJSON.LineString>,
  l2: GeoJSON.Feature<GeoJSON.LineString>
): [number, number] | null {
  const [x1, y1] = l1.geometry.coordinates[0]
  const [x2, y2] = l1.geometry.coordinates[1]
  const [x3, y3] = l2.geometry.coordinates[0]
  const [x4, y4] = l2.geometry.coordinates[1]

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)

  if (Math.abs(denom) < 1e-12) return null  // 평행

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom

  return [
    x1 + t * (x2 - x1),
    y1 + t * (y2 - y1),
  ]
}

/**
 * 각 변별 이격거리를 적용한 건축선 계산
 * 각 edge를 개별적으로 내부 방향 평행이동 후 교점으로 건축선 폴리곤 생성
 */
export function calculateBuildingLine(
  cadastralPolygon: GeoJSON.Feature<GeoJSON.Polygon>,
  edgeInfos: AdjacentInfo[]
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  try {
    const setbacks = edgeInfos.map(e => e.setbackDistance)

    // 이격거리가 모두 0이면 원본 반환
    if (setbacks.every(s => s === 0)) return cadastralPolygon

    // 모든 이격거리가 동일한 경우 단순 buffer 사용 (안정적)
    const uniqueSetbacks = Array.from(new Set(setbacks))
    if (uniqueSetbacks.length === 1 && uniqueSetbacks[0] > 0) {
      const buffered = turf.buffer(cadastralPolygon, -uniqueSetbacks[0], { units: 'meters' })
      if (buffered) return buffered as GeoJSON.Feature<GeoJSON.Polygon>
    }

    // --- 변별 개별 오프셋으로 건축선 계산 ---
    // 1. 각 변을 이격거리만큼 내부로 평행이동
    const offsetLines = edgeInfos.map(info =>
      offsetEdgeInward(info.edge, info.setbackDistance, cadastralPolygon)
    )

    // 2. 인접한 오프셋 라인끼리 교점 계산 → 건축선 꼭짓점
    const buildingLineCoords: [number, number][] = []

    for (let i = 0; i < offsetLines.length; i++) {
      const nextIdx = (i + 1) % offsetLines.length
      const intersection = lineIntersection(offsetLines[i], offsetLines[nextIdx])

      if (intersection) {
        buildingLineCoords.push(intersection)
      } else {
        // 평행한 경우 → 현재 라인의 끝점 사용
        const coords = offsetLines[i].geometry.coordinates
        buildingLineCoords.push(coords[1] as [number, number])
      }
    }

    // 3. 폴리곤 닫기
    if (buildingLineCoords.length >= 3) {
      buildingLineCoords.push(buildingLineCoords[0])

      const buildingLinePoly = turf.polygon([buildingLineCoords])

      // 4. 원본 폴리곤과 교차시켜서 건축 가능 영역만 추출
      try {
        const clipped = turf.intersect(
          turf.featureCollection([cadastralPolygon, buildingLinePoly])
        )
        if (clipped && clipped.geometry.type === 'Polygon') {
          return clipped as GeoJSON.Feature<GeoJSON.Polygon>
        }
      } catch {
        // intersect 실패 시 그냥 오프셋 폴리곤 반환
      }

      return buildingLinePoly as GeoJSON.Feature<GeoJSON.Polygon>
    }

    // 폴백: 최소 이격거리로 buffer
    const minSetback = Math.min(...setbacks.filter(s => s > 0))
    if (minSetback > 0) {
      const buffered = turf.buffer(cadastralPolygon, -minSetback, { units: 'meters' })
      if (buffered) return buffered as GeoJSON.Feature<GeoJSON.Polygon>
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
