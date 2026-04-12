/**
 * 일조 분석 히트맵 시각화 모듈
 *
 * 일조 분석 결과를 Cesium Entity로 시각화합니다.
 * - 포인트 기반 시각화 (기본)
 * - 사각형 셀 기반 시각화 (옵션)
 */

import type { SunlightAnalysisResult, SunlightPoint } from './sunlightAnalysis'

// ─── 타입 정의 ───

export interface HeatmapOptions {
  /** 시각화 방식: 'point' | 'cell' */
  mode?: 'point' | 'cell'
  /** 포인트 크기 (픽셀) */
  pointSize?: number
  /** 투명도 (0~1) */
  alpha?: number
  /** 고도 (미터) */
  elevation?: number
  /** 최대 일조시간 (색상 스케일 기준) */
  maxHours?: number
}

const DEFAULT_OPTIONS: Required<HeatmapOptions> = {
  mode: 'point',
  pointSize: 10,
  alpha: 0.7,
  elevation: 0.5,
  maxHours: 13,
}

// ─── 색상 유틸리티 ───

/**
 * 일조시간 비율에 따른 색상 계산
 * 빨강(0h) → 노랑(중간) → 초록(최대)
 *
 * @param ratio - 일조시간 비율 (0~1)
 * @param alpha - 투명도
 * @returns Cesium.Color
 */
function getHeatmapColor(Cesium: any, ratio: number, alpha: number): any {
  // HSL 색상: 빨강(0) → 노랑(0.17) → 초록(0.33)
  const hue = ratio * 0.33
  return Cesium.Color.fromHsl(hue, 1.0, 0.5, alpha)
}

/**
 * 일조시간에 따른 색상 등급 (범례용)
 */
export function getColorLegend(): Array<{ hours: number; color: string; label: string }> {
  return [
    { hours: 0, color: '#ff0000', label: '0시간 (음영)' },
    { hours: 3, color: '#ff6600', label: '3시간' },
    { hours: 6, color: '#ffcc00', label: '6시간' },
    { hours: 9, color: '#99cc00', label: '9시간' },
    { hours: 13, color: '#00cc00', label: '13시간 (최대)' },
  ]
}

// ─── 히트맵 렌더링 ───

/**
 * 일조 분석 결과를 Cesium 히트맵으로 시각화
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @param result - 일조 분석 결과
 * @param options - 시각화 옵션
 * @returns 생성된 Entity 배열
 */
export function renderSunlightHeatmap(
  viewer: any,
  result: SunlightAnalysisResult,
  options: HeatmapOptions = {}
): any[] {
  const Cesium = (window as any).Cesium
  if (!Cesium || !viewer) {
    console.error('Cesium Viewer가 없습니다')
    return []
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const entities: any[] = []

  console.log(`히트맵 렌더링: ${result.points.length}개 포인트, 모드=${opts.mode}`)

  if (opts.mode === 'point') {
    // 포인트 기반 시각화
    for (const point of result.points) {
      const ratio = point.sunlightHours / opts.maxHours
      const color = getHeatmapColor(Cesium, ratio, opts.alpha)

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          point.longitude,
          point.latitude,
          opts.elevation
        ),
        point: {
          pixelSize: opts.pointSize,
          color: color,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          sunlightHours: point.sunlightHours,
          hourlyDetail: point.hourlyDetail,
          type: 'sunlight-heatmap',
        },
      })

      entities.push(entity)
    }
  } else if (opts.mode === 'cell') {
    // 사각형 셀 기반 시각화
    const halfGrid = result.gridSpacing / 2

    for (const point of result.points) {
      const ratio = point.sunlightHours / opts.maxHours
      const color = getHeatmapColor(Cesium, ratio, opts.alpha)

      // 셀 경계 계산 (미터 → 도 변환)
      const latRad = point.latitude * (Math.PI / 180)
      const metersPerDegLon = 111320 * Math.cos(latRad)
      const metersPerDegLat = 110540

      const halfLon = halfGrid / metersPerDegLon
      const halfLat = halfGrid / metersPerDegLat

      const west = point.longitude - halfLon
      const east = point.longitude + halfLon
      const south = point.latitude - halfLat
      const north = point.latitude + halfLat

      const entity = viewer.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(west, south, east, north),
          material: color,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        properties: {
          sunlightHours: point.sunlightHours,
          hourlyDetail: point.hourlyDetail,
          type: 'sunlight-heatmap',
        },
      })

      entities.push(entity)
    }
  }

  viewer.scene.requestRender()
  console.log(`히트맵 렌더링 완료: ${entities.length}개 엔티티 생성`)

  return entities
}

/**
 * 히트맵 제거
 *
 * @param viewer - Cesium.Viewer 인스턴스
 * @param entities - 제거할 Entity 배열
 */
export function clearSunlightHeatmap(viewer: any, entities: any[]): void {
  if (!viewer) return

  entities.forEach((entity) => {
    try {
      viewer.entities.remove(entity)
    } catch (e) {
      // 이미 제거된 엔티티 무시
    }
  })

  viewer.scene.requestRender()
  console.log(`히트맵 제거: ${entities.length}개 엔티티`)
}

/**
 * 히트맵 가시성 토글
 *
 * @param entities - Entity 배열
 * @param visible - 가시성
 */
export function toggleHeatmapVisibility(entities: any[], visible: boolean): void {
  entities.forEach((entity) => {
    entity.show = visible
  })
}

// ─── 범례 컴포넌트용 데이터 ───

/**
 * 범례 색상 배열 생성
 * @param steps - 색상 단계 수
 * @param maxHours - 최대 일조시간
 */
export function generateLegendColors(
  steps: number = 6,
  maxHours: number = 13
): Array<{ hours: number; color: string }> {
  const colors: Array<{ hours: number; color: string }> = []

  for (let i = 0; i < steps; i++) {
    const ratio = i / (steps - 1)
    const hours = Math.round(ratio * maxHours)

    // HSL to RGB 변환
    const hue = ratio * 0.33
    const h = hue * 360
    const s = 100
    const l = 50

    const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100
    const x = c * (1 - Math.abs((h / 60) % 2 - 1))
    const m = l / 100 - c / 2

    let r = 0, g = 0, b = 0
    if (h < 60) { r = c; g = x; b = 0 }
    else if (h < 120) { r = x; g = c; b = 0 }

    r = Math.round((r + m) * 255)
    g = Math.round((g + m) * 255)
    b = Math.round((b + m) * 255)

    const color = `rgb(${r}, ${g}, ${b})`
    colors.push({ hours, color })
  }

  return colors
}

// ─── 포인트 정보 조회 ───

/**
 * 특정 좌표의 일조 정보 조회
 *
 * @param result - 분석 결과
 * @param longitude - 경도
 * @param latitude - 위도
 * @param tolerance - 허용 오차 (도)
 * @returns 해당 포인트의 일조 정보 또는 null
 */
export function getPointInfo(
  result: SunlightAnalysisResult,
  longitude: number,
  latitude: number,
  tolerance: number = 0.00005
): SunlightPoint | null {
  for (const point of result.points) {
    const lonDiff = Math.abs(point.longitude - longitude)
    const latDiff = Math.abs(point.latitude - latitude)

    if (lonDiff < tolerance && latDiff < tolerance) {
      return point
    }
  }

  return null
}

/**
 * 시간대별 일조 상태를 문자열로 변환
 *
 * @param hourlyDetail - 시간대별 일조 여부 배열
 * @returns 시간대별 상태 문자열 배열
 */
export function formatHourlyDetail(
  hourlyDetail: boolean[]
): Array<{ hour: number; status: string }> {
  const START_HOUR = 6

  return hourlyDetail.map((isSunlit, index) => ({
    hour: START_HOUR + index,
    status: isSunlit ? '일조' : '음영',
  }))
}
