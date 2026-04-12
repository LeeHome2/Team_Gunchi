/**
 * 일조권 분석 모듈
 *
 * 건축 가능 영역(buildableArea)에 대해 Ray Casting 기반 일조 분석을 수행합니다.
 * - 그리드 포인트 생성 (turf.pointGrid)
 * - 시간별 태양 방향 계산
 * - pickFromRay로 그림자 판정
 */

import * as turf from '@turf/turf'

// ─── 타입 정의 ───

export interface SunlightPoint {
  longitude: number
  latitude: number
  sunlightHours: number        // 0 ~ 13 (6시~18시 중 일조 받은 시간)
  hourlyDetail: boolean[]      // 13개 요소, 각 시간대별 일조 여부
}

export interface SunlightAnalysisResult {
  analysisDate: string         // ISO date string (YYYY-MM-DD)
  gridSpacing: number          // 그리드 간격 (미터)
  totalPoints: number
  points: SunlightPoint[]
  statistics: {
    averageSunlightHours: number
    minSunlightHours: number
    maxSunlightHours: number
  }
}

export interface AnalysisProgress {
  currentStep: number          // 현재 시간 스텝 (0~12)
  totalSteps: number           // 13
  currentHour: number          // 현재 분석 중인 시각 (6~18)
  percentComplete: number      // 0~100
}

// ─── 상수 ───

const START_HOUR = 6
const END_HOUR = 18
const TOTAL_STEPS = END_HOUR - START_HOUR + 1  // 13
const MAX_POINTS = 10000  // 최대 분석 포인트 수 (성능 제한)

// ─── 유틸리티 함수 ───

/**
 * buildableArea 폴리곤 내부에 그리드 포인트 생성
 *
 * @param buildableArea - GeoJSON Polygon (건축 가능 영역)
 * @param gridSpacing - 그리드 간격 (미터)
 * @returns 그리드 포인트 배열 [[lon, lat], ...]
 */
export function generateGridPoints(
  buildableArea: GeoJSON.Polygon,
  gridSpacing: number = 2
): [number, number][] {
  try {
    // bbox 계산
    const polygon = turf.polygon(buildableArea.coordinates)
    const bbox = turf.bbox(polygon)  // [minLng, minLat, maxLng, maxLat]

    // 포인트 그리드 생성 (단위: km)
    const grid = turf.pointGrid(bbox, gridSpacing / 1000, {
      units: 'kilometers',
      mask: polygon,  // 폴리곤 내부만
    })

    // 좌표 추출
    const points: [number, number][] = grid.features.map((feature) => {
      const coords = feature.geometry.coordinates
      return [coords[0], coords[1]]
    })

    console.log(`그리드 포인트 생성: ${points.length}개 (간격: ${gridSpacing}m)`)
    return points
  } catch (error) {
    console.error('그리드 포인트 생성 실패:', error)
    return []
  }
}

/**
 * 현재 시각의 태양 방향 벡터 가져오기
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @param referencePoint - 기준 위치 (Cartesian3, 선택적)
 * @returns 태양 방향 벡터 (Cartesian3) - 지면에서 태양을 향하는 방향
 */
export function getSunDirection(viewer: any, referencePoint?: any): any {
  const Cesium = (window as any).Cesium
  if (!Cesium || !viewer) return null

  try {
    const currentTime = viewer.clock.currentTime

    // 방법 1: Simon1994PlanetaryPositions로 태양 위치 계산 (ICRF 좌표계)
    const sunPositionICRF = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(currentTime)

    // ICRF → Fixed (지구 고정 좌표계) 변환
    const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(currentTime)

    if (!icrfToFixed) {
      // 변환 행렬이 없으면 대체 방법 사용
      console.log('ICRF 변환 불가, 대체 방법 사용')
      return getDefaultSunDirection(viewer, currentTime)
    }

    const sunPositionFixed = Cesium.Matrix3.multiplyByVector(
      icrfToFixed,
      sunPositionICRF,
      new Cesium.Cartesian3()
    )

    // 기준점이 없으면 카메라 위치 또는 원점 사용
    const origin = referencePoint || viewer.camera.positionWC || new Cesium.Cartesian3(0, 0, 0)

    // 기준점에서 태양을 향하는 방향 벡터
    const sunDirection = Cesium.Cartesian3.subtract(
      sunPositionFixed,
      origin,
      new Cesium.Cartesian3()
    )

    // 정규화
    Cesium.Cartesian3.normalize(sunDirection, sunDirection)

    return sunDirection
  } catch (error) {
    console.error('태양 방향 계산 실패:', error)
    return getDefaultSunDirection(viewer, viewer.clock.currentTime)
  }
}

/**
 * 대체 태양 방향 계산 (시간 기반 근사)
 */
function getDefaultSunDirection(viewer: any, currentTime: any): any {
  const Cesium = (window as any).Cesium

  try {
    // 현재 시간에서 시각 추출
    const date = Cesium.JulianDate.toDate(currentTime)
    const hour = date.getHours()

    // 태양 고도각 근사 (6시~18시, 정오에 최대)
    const solarNoon = 12
    const hourAngle = (hour - solarNoon) * 15 * Math.PI / 180  // 시간당 15도

    // 한국 위도(37도) 기준 태양 고도 근사
    const declination = 0  // 춘추분점 근사
    const latitude = 37 * Math.PI / 180

    // 태양 고도각
    const elevation = Math.asin(
      Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle)
    )

    // 태양 방위각 (남쪽 기준)
    const azimuth = hourAngle

    // 방향 벡터 생성 (ENU 좌표계)
    const x = -Math.sin(azimuth) * Math.cos(elevation)
    const y = Math.cos(azimuth) * Math.cos(elevation)
    const z = Math.sin(elevation)

    console.log(`대체 태양 방향 계산: ${hour}시, 고도=${(elevation * 180 / Math.PI).toFixed(1)}°`)

    return new Cesium.Cartesian3(x, y, z)
  } catch (error) {
    // 최종 폴백: 정오 기준 상향 방향
    console.log('대체 태양 방향도 실패, 상향 벡터 사용')
    return new (window as any).Cesium.Cartesian3(0, 0.5, 0.866)  // 60도 상향
  }
}

/**
 * 단일 포인트에서 일조 여부 판정
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @param longitude - 경도
 * @param latitude - 위도
 * @param sunDirection - 태양 방향 벡터
 * @param terrainHeight - 지형 높이 (미터, 기본값 50.0 - 한국 평균 지형고도)
 * @param sampleOffset - 지형 위 샘플 오프셋 (미터, 기본값 1.5)
 * @returns true = 일조, false = 그림자
 */
export function checkShadowAtPoint(
  viewer: any,
  longitude: number,
  latitude: number,
  sunDirection: any,
  terrainHeight: number = 50.0,
  sampleOffset: number = 1.5
): boolean {
  const Cesium = (window as any).Cesium
  if (!Cesium || !viewer || !sunDirection) return true  // 기본값: 일조

  try {
    // 지형 높이 + 오프셋에서 ray 시작 (지면 충돌 방지)
    const sampleHeight = terrainHeight + sampleOffset
    const groundPoint = Cesium.Cartesian3.fromDegrees(
      longitude,
      latitude,
      sampleHeight
    )

    // Ray 생성 (포인트 → 태양 방향)
    const ray = new Cesium.Ray(groundPoint, sunDirection)

    // pickFromRay 실행 - 3D 타일셋만 검사 (지형 제외)
    const result = viewer.scene.pickFromRay(ray, [], 0.1, false)

    // hit 없음 = 일조, hit 있음 = 그림자
    if (!result || !result.object) {
      return true  // 일조
    }

    return false  // 그림자
  } catch (error) {
    // 에러 시 기본값 일조로 처리
    return true
  }
}

/**
 * 태양 고도 확인 (해가 떠있는지)
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @returns true = 해가 떠있음, false = 해가 지평선 아래
 */
function isSunAboveHorizon(viewer: any): boolean {
  const Cesium = (window as any).Cesium
  if (!Cesium || !viewer) return true

  try {
    const sunDirection = getSunDirection(viewer)
    if (!sunDirection) return true

    // 태양 방향의 z 성분이 양수면 해가 떠있음
    // (단순화된 판정 - 실제로는 위치에 따라 다름)
    return sunDirection.z > 0.05
  } catch {
    return true
  }
}

/**
 * 건축 가능 영역에 대한 일조량 분석 실행
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @param buildableArea - GeoJSON Polygon (건축 가능 영역)
 * @param analysisDate - 분석할 날짜
 * @param gridSpacing - 그리드 간격 (미터, 기본값 2)
 * @param onProgress - 진행률 콜백 (UI 업데이트용)
 * @returns 분석 결과
 */
export async function analyzeSunlight(
  viewer: any,
  buildableArea: GeoJSON.Polygon,
  analysisDate: Date,
  gridSpacing: number = 2,
  onProgress?: (progress: AnalysisProgress) => void
): Promise<SunlightAnalysisResult> {
  const Cesium = (window as any).Cesium
  if (!Cesium || !viewer) {
    throw new Error('Cesium Viewer가 초기화되지 않았습니다')
  }

  // 1. 그리드 포인트 생성 (포인트 수가 너무 많으면 간격 자동 조정)
  let actualGridSpacing = gridSpacing
  let gridPoints = generateGridPoints(buildableArea, actualGridSpacing)

  // 포인트 수가 MAX_POINTS 초과 시 간격 자동 증가
  while (gridPoints.length > MAX_POINTS && actualGridSpacing < 20) {
    actualGridSpacing = actualGridSpacing * 1.5
    console.log(`포인트 수가 너무 많음, 간격 조정: ${actualGridSpacing.toFixed(1)}m`)
    gridPoints = generateGridPoints(buildableArea, actualGridSpacing)
  }

  // 여전히 너무 많으면 샘플링
  if (gridPoints.length > MAX_POINTS) {
    const step = Math.ceil(gridPoints.length / MAX_POINTS)
    gridPoints = gridPoints.filter((_, idx) => idx % step === 0)
    console.log(`샘플링 적용: ${gridPoints.length}개 포인트`)
  }

  if (gridPoints.length === 0) {
    throw new Error('분석할 포인트가 없습니다')
  }

  // 2. 지형 높이 추정 (분석 영역 중심점 기준)
  // bbox에서 중심점 계산
  const polygon = turf.polygon(buildableArea.coordinates)
  const centroid = turf.centroid(polygon)
  const [centerLon, centerLat] = centroid.geometry.coordinates

  // 지형 높이 샘플링 (카메라 위치 기반 추정)
  let terrainHeight = 50.0  // 기본값
  try {
    const cameraPosition = viewer.camera.positionCartographic
    if (cameraPosition) {
      // 카메라 위치 근처의 지형 높이 사용
      terrainHeight = Math.max(cameraPosition.height * 0.01, 30)  // 최소 30m
    }
    // 글로브에서 직접 높이 샘플링 시도
    const cartographic = Cesium.Cartographic.fromDegrees(centerLon, centerLat)
    const sampledHeight = viewer.scene.globe.getHeight(cartographic)
    if (sampledHeight !== undefined && sampledHeight > 0) {
      terrainHeight = sampledHeight
    }
  } catch (e) {
    console.log('지형 높이 샘플링 실패, 기본값 사용:', terrainHeight)
  }

  console.log(`일조 분석 시작: ${gridPoints.length}개 포인트, ${TOTAL_STEPS}개 시간 스텝`)
  console.log(`분석 중심: [${centerLon.toFixed(6)}, ${centerLat.toFixed(6)}], 지형 높이: ${terrainHeight.toFixed(1)}m`)

  // 3. 각 포인트의 일조 기록 초기화
  const sunlightRecords: Map<number, boolean[]> = new Map()
  gridPoints.forEach((_, idx) => {
    sunlightRecords.set(idx, new Array(TOTAL_STEPS).fill(false))
  })

  // 4. 현재 시간 백업 (분석 후 복원용)
  const originalTime = viewer.clock.currentTime.clone()

  // 5. 시간 순회 + Ray Casting
  let debugLoggedOnce = false
  for (let step = 0; step < TOTAL_STEPS; step++) {
    const hour = START_HOUR + step

    // Cesium 시계를 해당 시각으로 설정
    const analysisTime = new Date(analysisDate)
    analysisTime.setHours(hour, 0, 0, 0)
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(analysisTime)

    // 씬 렌더 → 태양 위치 업데이트
    viewer.scene.render()

    // 태양 고도 체크 (해가 지평선 아래면 모두 그림자)
    if (!isSunAboveHorizon(viewer)) {
      console.log(`${hour}시: 해가 지평선 아래 - 모든 포인트 그림자 처리`)
      // 모든 포인트를 그림자로 유지 (이미 false로 초기화됨)
    } else {
      // 태양 방향 벡터 가져오기
      const sunDirection = getSunDirection(viewer)

      // 디버그: 첫 번째 유효 시간에만 태양 방향 출력
      if (sunDirection && !debugLoggedOnce) {
        console.log(`${hour}시 태양 방향:`, {
          x: sunDirection.x.toFixed(4),
          y: sunDirection.y.toFixed(4),
          z: sunDirection.z.toFixed(4),
        })
        debugLoggedOnce = true
      }

      if (sunDirection) {
        let sunlitCount = 0
        // 각 포인트에서 ray casting
        for (let i = 0; i < gridPoints.length; i++) {
          const [lon, lat] = gridPoints[i]
          const isSunlit = checkShadowAtPoint(viewer, lon, lat, sunDirection, terrainHeight)

          if (isSunlit) {
            sunlightRecords.get(i)![step] = true
            sunlitCount++
          }
        }
        console.log(`${hour}시: 일조 ${sunlitCount}/${gridPoints.length} 포인트`)
      }
    }

    // 진행률 콜백
    onProgress?.({
      currentStep: step,
      totalSteps: TOTAL_STEPS,
      currentHour: hour,
      percentComplete: Math.round(((step + 1) / TOTAL_STEPS) * 100),
    })

    // UI 블로킹 방지 — 각 시간 스텝 사이에 yield
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  // 5. 시간 복원
  viewer.clock.currentTime = originalTime
  viewer.scene.requestRender()

  // 6. 결과 집계
  const points: SunlightPoint[] = gridPoints.map((coords, idx) => {
    const hourlyDetail = sunlightRecords.get(idx)!
    const sunlightHours = hourlyDetail.filter(Boolean).length

    return {
      longitude: coords[0],
      latitude: coords[1],
      sunlightHours,
      hourlyDetail,
    }
  })

  // 통계 계산 (대용량 배열에서 spread 연산자 대신 reduce 사용)
  let totalHours = 0
  let minHours = Infinity
  let maxHours = -Infinity

  for (const point of points) {
    const h = point.sunlightHours
    totalHours += h
    if (h < minHours) minHours = h
    if (h > maxHours) maxHours = h
  }

  const result: SunlightAnalysisResult = {
    analysisDate: analysisDate.toISOString().split('T')[0],
    gridSpacing: actualGridSpacing,
    totalPoints: points.length,
    points,
    statistics: {
      averageSunlightHours: points.length > 0 ? totalHours / points.length : 0,
      minSunlightHours: points.length > 0 ? minHours : 0,
      maxSunlightHours: points.length > 0 ? maxHours : 0,
    },
  }

  console.log('일조 분석 완료:', {
    totalPoints: result.totalPoints,
    avgHours: result.statistics.averageSunlightHours.toFixed(1),
    minHours: result.statistics.minSunlightHours,
    maxHours: result.statistics.maxSunlightHours,
  })

  return result
}

/**
 * 특정 시각의 단일 포인트 일조 상태 확인 (디버그/테스트용)
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @param longitude - 경도
 * @param latitude - 위도
 * @returns 일조 여부
 */
export function checkSinglePointSunlight(
  viewer: any,
  longitude: number,
  latitude: number
): boolean {
  const sunDirection = getSunDirection(viewer)
  if (!sunDirection) return true

  return checkShadowAtPoint(viewer, longitude, latitude, sunDirection)
}

/**
 * 태양 방향 디버그 출력 (테스트용)
 */
export function debugSunDirection(viewer: any): void {
  const Cesium = (window as any).Cesium
  if (!Cesium || !viewer) return

  const lightDir = viewer.scene.light.direction
  const sunDir = getSunDirection(viewer)

  console.log('=== 태양 방향 디버그 ===')
  console.log('light.direction (태양→지면):', {
    x: lightDir.x.toFixed(4),
    y: lightDir.y.toFixed(4),
    z: lightDir.z.toFixed(4),
  })
  console.log('sunDirection (지면→태양):', {
    x: sunDir?.x.toFixed(4),
    y: sunDir?.y.toFixed(4),
    z: sunDir?.z.toFixed(4),
  })

  const currentTime = Cesium.JulianDate.toDate(viewer.clock.currentTime)
  console.log('현재 시각:', currentTime.toLocaleString())
}
