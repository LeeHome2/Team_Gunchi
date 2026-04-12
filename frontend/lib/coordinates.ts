/**
 * Module: Coordinate Utilities
 * 좌표 변환 및 계산 유틸리티
 */

/**
 * 경위도 1도당 미터 계산
 */
export function getMetersPerDegree(latitude: number) {
  const latRad = latitude * Math.PI / 180
  return {
    lon: 111320 * Math.cos(latRad),  // 경도 1도당 미터
    lat: 111320,                      // 위도 1도당 미터
  }
}

/**
 * 미터를 경위도 차이로 변환
 */
export function metersToDegreeDelta(
  meters: { x: number; y: number },
  latitude: number
) {
  const { lon: mPerDegLon, lat: mPerDegLat } = getMetersPerDegree(latitude)
  return {
    lon: meters.x / mPerDegLon,
    lat: meters.y / mPerDegLat,
  }
}

/**
 * 경위도 차이를 미터로 변환
 */
export function degreeDeltaToMeters(
  degrees: { lon: number; lat: number },
  latitude: number
) {
  const { lon: mPerDegLon, lat: mPerDegLat } = getMetersPerDegree(latitude)
  return {
    x: degrees.lon * mPerDegLon,
    y: degrees.lat * mPerDegLat,
  }
}

/**
 * 중심점 기준으로 좌표 회전
 */
export function rotatePoint(
  point: [number, number],
  center: [number, number],
  angleDegrees: number
): [number, number] {
  const rad = angleDegrees * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const dx = point[0] - center[0]
  const dy = point[1] - center[1]

  return [
    cos * dx - sin * dy + center[0],
    sin * dx + cos * dy + center[1],
  ]
}

/**
 * Footprint 이동 및 회전 변환
 */
export function transformFootprint(
  footprint: number[][],
  centroid: [number, number],
  offsetMeters: { x: number; y: number },
  rotationDegrees: number
): number[][] {
  const { lon: mPerDegLon, lat: mPerDegLat } = getMetersPerDegree(centroid[1])

  // 이동된 중심점
  const newCenterLon = centroid[0] + (offsetMeters.x / mPerDegLon)
  const newCenterLat = centroid[1] + (offsetMeters.y / mPerDegLat)

  return footprint.map(coord => {
    // 이동
    const movedLon = coord[0] + (offsetMeters.x / mPerDegLon)
    const movedLat = coord[1] + (offsetMeters.y / mPerDegLat)

    // 회전
    return rotatePoint(
      [movedLon, movedLat],
      [newCenterLon, newCenterLat],
      rotationDegrees
    )
  })
}

/**
 * 폴리곤 면적 계산 (Shoelace formula)
 * @param footprint 경위도 좌표 [[lon, lat], ...]
 * @param latitude 면적 계산 기준 위도
 * @returns 면적 (제곱미터)
 */
export function calculateArea(footprint: number[][], latitude: number): number {
  const { lon: mPerDegLon, lat: mPerDegLat } = getMetersPerDegree(latitude)

  // 미터 단위로 변환
  const metersCoords = footprint.map(([lon, lat]) => [
    lon * mPerDegLon,
    lat * mPerDegLat,
  ])

  // Shoelace formula
  let area = 0
  const n = metersCoords.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += metersCoords[i][0] * metersCoords[j][1]
    area -= metersCoords[j][0] * metersCoords[i][1]
  }

  return Math.abs(area) / 2
}

/**
 * 폴리곤 중심점 계산
 */
export function calculateCentroid(footprint: number[][]): [number, number] {
  const n = footprint.length
  const sum = footprint.reduce(
    (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]],
    [0, 0]
  )
  return [sum[0] / n, sum[1] / n]
}
