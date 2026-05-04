'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useProjectStore } from '@/store/projectStore'
import type {
  ParkingZoneData,
  ParkingEntranceData,
  ParkingPathData,
} from '@/store/projectStore'

/**
 * Cesium 뷰어 위에 주차 오브젝트를 렌더링하는 훅.
 *
 * 렌더링 대상:
 *   1) 주차영역 (슬롯, 차로, 구역 경계, 라벨) — parkingTransform 적용
 *   2) 입구 오브젝트 — entranceTransform 적용 (독립 이동/회전)
 *   3) 경로 (입구→주차영역) — 두 변환 모두 반영
 *
 * 모든 좌표는 로컬 m 기준이며,
 * modelTransform + 개별 transform으로 경위도 변환합니다.
 */
export function useParkingZone() {
  const viewer = useProjectStore((s) => s.viewer)
  const parkingZone = useProjectStore((s) => s.parkingZone)
  const parkingEntrance = useProjectStore((s) => s.parkingEntrance)
  const parkingPath = useProjectStore((s) => s.parkingPath)
  const isParkingVisible = useProjectStore((s) => s.isParkingVisible)
  const modelTransform = useProjectStore((s) => s.modelTransform)
  const parkingTransform = useProjectStore((s) => s.parkingTransform)
  const entranceTransform = useProjectStore((s) => s.entranceTransform)
  const selectedBlockInfo = useProjectStore((s) => s.selectedBlockInfo)
  const site = useProjectStore((s) => s.site)
  const gridRotation = useProjectStore((s) => s.gridRotation)

  const entityIdsRef = useRef<string[]>([])

  // 드래그 중 실시간 접근용 ref
  const parkingTransformRef = useRef(parkingTransform)
  parkingTransformRef.current = parkingTransform
  const entranceTransformRef = useRef(entranceTransform)
  entranceTransformRef.current = entranceTransform

  // 주차영역 중심 (회전축으로 사용)
  const zoneCenterRef = useRef<[number, number]>([0, 0])
  // 입구 중심 (회전축으로 사용)
  const entranceCenterRef = useRef<[number, number]>([0, 0])

  // ── 좌표 변환 (주차영역용) — zoneCenter 기준 시계방향 회전 ──
  const toLatLonParking = useCallback(
    (localX: number, localY: number): [number, number] => {
      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)

      const pt = parkingTransformRef.current
      const [cx, cy] = zoneCenterRef.current
      const rotRad = (pt.rotation * Math.PI) / 180
      const cos = Math.cos(rotRad)
      const sin = Math.sin(rotRad)

      // 중심 기준으로 상대 좌표 계산 → 시계방향 회전 → 복원
      const dx = localX - cx
      const dy = localY - cy
      const rx = dx * cos + dy * sin + cx  // 시계방향: +sin
      const ry = -dx * sin + dy * cos + cy // 시계방향: -sin

      const lon = originLon + rx / mPerDegLon + pt.longitude
      const lat = originLat + ry / mPerDegLat + pt.latitude
      return [lon, lat]
    },
    [modelTransform.longitude, modelTransform.latitude],
  )

  // ── 좌표 변환 (입구용) — entrance center 기준 시계방향 회전 ──
  const toLatLonEntrance = useCallback(
    (localX: number, localY: number): [number, number] => {
      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)

      const et = entranceTransformRef.current
      const [cx, cy] = entranceCenterRef.current
      const rotRad = (et.rotation * Math.PI) / 180
      const cos = Math.cos(rotRad)
      const sin = Math.sin(rotRad)

      // 중심 기준으로 상대 좌표 계산 → 시계방향 회전 → 복원
      const dx = localX - cx
      const dy = localY - cy
      const rx = dx * cos + dy * sin + cx
      const ry = -dx * sin + dy * cos + cy

      const lon = originLon + rx / mPerDegLon + et.longitude
      const lat = originLat + ry / mPerDegLat + et.latitude
      return [lon, lat]
    },
    [modelTransform.longitude, modelTransform.latitude],
  )

  // 폴리곤 → Cesium Cartesian3
  const polygonToPositions = useCallback(
    (polygon: number[][], toLatLon: (x: number, y: number) => [number, number]) => {
      const Cesium = (window as any).Cesium
      if (!Cesium) return []
      return polygon.map(([x, y]) => {
        const [lon, lat] = toLatLon(x, y)
        return Cesium.Cartesian3.fromDegrees(lon, lat)
      })
    },
    [],
  )

  // ── 클리어 ──
  const clearEntities = useCallback(() => {
    if (!viewer) return
    for (const id of entityIdsRef.current) {
      const ent = viewer.entities.getById(id)
      if (ent) viewer.entities.remove(ent)
    }
    entityIdsRef.current = []
  }, [viewer])

  // 높이 상수 (2D + 약간의 높이)
  const ZONE_HEIGHT = 0.3
  const ENTRANCE_HEIGHT = 0.5
  const PATH_HEIGHT = 0.4

  // ── 주차영역 렌더링 ──
  const renderZone = useCallback(
    (zone: ParkingZoneData, ids: string[]) => {
      if (!viewer) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      // 회전 중심을 존 중심으로 설정
      if (zone.zoneCenter.length === 2) {
        zoneCenterRef.current = [zone.zoneCenter[0], zone.zoneCenter[1]]
      }

      // 1. 구역 경계
      const zoneId = '_parking_zone_boundary'
      viewer.entities.add({
        id: zoneId,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            polygonToPositions(zone.zonePolygon, toLatLonParking),
          ),
          material: Cesium.Color.fromCssColorString('#1e3a5f').withAlpha(0.15),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#3b82f6'),
          outlineWidth: 2,
          height: ZONE_HEIGHT,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      })
      ids.push(zoneId)

      // 2. 차로
      zone.aisles.forEach((aisle, i) => {
        const id = `_parking_aisle_${i}`
        viewer.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              polygonToPositions(aisle.polygon, toLatLonParking),
            ),
            material: Cesium.Color.fromCssColorString('#94a3b8').withAlpha(0.3),
            height: ZONE_HEIGHT,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
        })
        ids.push(id)

        // 차로 중심선
        if (aisle.polygon.length >= 4) {
          const lineId = `_parking_aisle_line_${i}`
          const p = aisle.polygon
          const midStart = [(p[0][0] + p[3][0]) / 2, (p[0][1] + p[3][1]) / 2]
          const midEnd = [(p[1][0] + p[2][0]) / 2, (p[1][1] + p[2][1]) / 2]
          const [sLon, sLat] = toLatLonParking(midStart[0], midStart[1])
          const [eLon, eLat] = toLatLonParking(midEnd[0], midEnd[1])
          viewer.entities.add({
            id: lineId,
            polyline: {
              positions: [
                Cesium.Cartesian3.fromDegrees(sLon, sLat),
                Cesium.Cartesian3.fromDegrees(eLon, eLat),
              ],
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.WHITE.withAlpha(0.6),
                dashLength: 8,
              }),
              clampToGround: true,
            },
          })
          ids.push(lineId)
        }
      })

      // 3. 슬롯
      zone.slots.forEach((slot) => {
        const id = `_parking_slot_${slot.id}`
        const color =
          slot.slot_type === 'disabled'
            ? Cesium.Color.fromCssColorString('#facc15').withAlpha(0.55)
            : Cesium.Color.fromCssColorString('#60a5fa').withAlpha(0.50)
        const outlineColor =
          slot.slot_type === 'disabled'
            ? Cesium.Color.fromCssColorString('#ca8a04')
            : Cesium.Color.fromCssColorString('#2563eb')

        viewer.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              polygonToPositions(slot.polygon, toLatLonParking),
            ),
            material: color,
            outline: true,
            outlineColor,
            outlineWidth: 1,
            height: ZONE_HEIGHT,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
        })
        ids.push(id)
      })

      // 4. 구역 라벨
      if (zone.zoneCenter.length === 2) {
        const [cLon, cLat] = toLatLonParking(zone.zoneCenter[0], zone.zoneCenter[1])
        const labelId = '_parking_zone_label'
        viewer.entities.add({
          id: labelId,
          position: Cesium.Cartesian3.fromDegrees(cLon, cLat, 1.0),
          label: {
            text: `주차 ${zone.totalSlots}대`,
            font: 'bold 14px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString('#1e3a5f'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        ids.push(labelId)
      }
    },
    [viewer, polygonToPositions, toLatLonParking],
  )

  // ── 입구 오브젝트 렌더링 ──
  const renderEntrance = useCallback(
    (entrance: ParkingEntranceData, ids: string[]) => {
      if (!viewer) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      // 회전 중심을 입구 중심으로 설정
      entranceCenterRef.current = [entrance.cx, entrance.cy]

      // 입구 폴리곤 (주황/빨강 계열)
      const entId = '_parking_entrance'
      viewer.entities.add({
        id: entId,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            polygonToPositions(entrance.polygon, toLatLonEntrance),
          ),
          material: Cesium.Color.fromCssColorString('#f97316').withAlpha(0.7),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#c2410c'),
          outlineWidth: 2,
          height: ENTRANCE_HEIGHT,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      })
      ids.push(entId)

      // 입구 라벨
      const [eLon, eLat] = toLatLonEntrance(entrance.cx, entrance.cy)
      const entLabelId = '_parking_entrance_label'
      viewer.entities.add({
        id: entLabelId,
        position: Cesium.Cartesian3.fromDegrees(eLon, eLat, 1.5),
        label: {
          text: '🅿 입구',
          font: 'bold 13px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#c2410c'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      ids.push(entLabelId)

      // 입구 방향 화살표 (입구 앞쪽 작은 삼각형)
      const headRad = (entrance.heading * Math.PI) / 180
      const arrowLen = entrance.depth * 0.8
      const arrowTipX = entrance.cx + Math.sin(headRad) * arrowLen
      const arrowTipY = entrance.cy + Math.cos(headRad) * arrowLen
      const [tLon, tLat] = toLatLonEntrance(arrowTipX, arrowTipY)
      const arrowId = '_parking_entrance_arrow'
      viewer.entities.add({
        id: arrowId,
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(eLon, eLat),
            Cesium.Cartesian3.fromDegrees(tLon, tLat),
          ],
          width: 4,
          material: new Cesium.PolylineArrowMaterialProperty(
            Cesium.Color.fromCssColorString('#f97316'),
          ),
          clampToGround: true,
        },
      })
      ids.push(arrowId)
    },
    [viewer, polygonToPositions, toLatLonEntrance],
  )

  // ── 그리드 시각화 렌더링 (폴리라인 방식 - 선택 영역 내부만) ──
  const renderGrid = useCallback(
    (path: ParkingPathData, ids: string[]) => {
      if (!viewer || !path.grid) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      const { gridSize, bounds } = path.grid
      if (!bounds) return

      // 선택된 블록 폴리곤 가져오기 (위경도)
      const blockPolygons: number[][][] = selectedBlockInfo?.coordinates ?? []
      const sitePolygon = site?.footprint
      if (blockPolygons.length === 0 && !sitePolygon) return

      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)

      // 위경도 → 로컬 미터 변환
      const toLocal = (lon: number, lat: number): [number, number] => [
        (lon - originLon) * mPerDegLon,
        (lat - originLat) * mPerDegLat,
      ]

      // 로컬 미터 → 위경도 변환
      const toLatLon = (x: number, y: number): [number, number] => [
        originLon + x / mPerDegLon,
        originLat + y / mPerDegLat,
      ]

      // 모든 블록 폴리곤을 로컬 좌표로 변환
      const localPolygons: number[][][] = blockPolygons.map(poly =>
        poly.map(([lon, lat]) => toLocal(lon, lat))
      )
      if (localPolygons.length === 0 && sitePolygon) {
        localPolygons.push(sitePolygon.map(([lon, lat]) => toLocal(lon, lat)))
      }

      // 점이 폴리곤 내부인지 확인 (ray-casting)
      const isInsidePolygon = (px: number, py: number, polygon: number[][]): boolean => {
        let inside = false
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i][0], yi = polygon[i][1]
          const xj = polygon[j][0], yj = polygon[j][1]
          const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
          if (intersect) inside = !inside
        }
        return inside
      }

      // 점이 어느 폴리곤에든 속하는지 확인
      const isInsideAnyPolygon = (px: number, py: number): boolean => {
        return localPolygons.some(poly => isInsidePolygon(px, py, poly))
      }

      // 선분과 폴리곤 변의 교차점 계산
      const lineIntersection = (
        x1: number, y1: number, x2: number, y2: number,
        x3: number, y3: number, x4: number, y4: number
      ): [number, number] | null => {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if (Math.abs(denom) < 1e-10) return null
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
        }
        return null
      }

      // 선분을 폴리곤으로 클리핑하여 내부 세그먼트 반환
      const clipLineToPolygons = (
        x1: number, y1: number, x2: number, y2: number
      ): Array<[[number, number], [number, number]]> => {
        const segments: Array<[[number, number], [number, number]]> = []

        // 모든 폴리곤과의 교차점 수집
        const intersections: { t: number; point: [number, number] }[] = []
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)

        for (const poly of localPolygons) {
          for (let i = 0; i < poly.length; i++) {
            const j = (i + 1) % poly.length
            const inter = lineIntersection(x1, y1, x2, y2, poly[i][0], poly[i][1], poly[j][0], poly[j][1])
            if (inter) {
              const t = len > 0 ? Math.sqrt((inter[0] - x1) ** 2 + (inter[1] - y1) ** 2) / len : 0
              intersections.push({ t, point: inter })
            }
          }
        }

        // t 값으로 정렬
        intersections.sort((a, b) => a.t - b.t)

        // 시작점과 끝점 추가
        const points: { t: number; point: [number, number] }[] = [
          { t: 0, point: [x1, y1] },
          ...intersections,
          { t: 1, point: [x2, y2] },
        ]

        // 연속된 점들의 중점이 폴리곤 내부인 세그먼트만 추가
        for (let i = 0; i < points.length - 1; i++) {
          const midX = (points[i].point[0] + points[i + 1].point[0]) / 2
          const midY = (points[i].point[1] + points[i + 1].point[1]) / 2
          if (isInsideAnyPolygon(midX, midY)) {
            segments.push([points[i].point, points[i + 1].point])
          }
        }

        return segments
      }

      // 그리드 회전 (store에서 구독한 값 사용)
      const currentGridRotation = useProjectStore.getState().gridRotation
      const rotRad = (currentGridRotation * Math.PI) / 180
      const cos = Math.cos(rotRad)
      const sin = Math.sin(rotRad)

      const { minX, minY, maxX, maxY } = bounds
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      // 회전 적용
      const rotate = (x: number, y: number): [number, number] => {
        const dx = x - centerX, dy = y - centerY
        return [dx * cos + dy * sin + centerX, -dx * sin + dy * cos + centerY]
      }

      // 가시성 개선: 보라색이 위성 이미지에서 잘 안 보였음. 노란 톤으로 변경하고
      // alpha 1.0, width 도 키워서 확실히 보이게 함.
      const gridColor = Cesium.Color.fromCssColorString('#fde047').withAlpha(0.95)
      let lineId = 0

      // 수직선
      for (let x = minX; x <= maxX; x += gridSize) {
        const [rx1, ry1] = rotate(x, minY)
        const [rx2, ry2] = rotate(x, maxY)
        const segments = clipLineToPolygons(rx1, ry1, rx2, ry2)

        for (const [[sx1, sy1], [sx2, sy2]] of segments) {
          const [lon1, lat1] = toLatLon(sx1, sy1)
          const [lon2, lat2] = toLatLon(sx2, sy2)
          const id = `_parking_grid_v_${lineId++}`
          viewer.entities.add({
            id,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray([lon1, lat1, lon2, lat2]),
              width: 3,
              material: gridColor,
              clampToGround: true,
            },
          })
          ids.push(id)
        }
      }

      // 수평선
      for (let y = minY; y <= maxY; y += gridSize) {
        const [rx1, ry1] = rotate(minX, y)
        const [rx2, ry2] = rotate(maxX, y)
        const segments = clipLineToPolygons(rx1, ry1, rx2, ry2)

        for (const [[sx1, sy1], [sx2, sy2]] of segments) {
          const [lon1, lat1] = toLatLon(sx1, sy1)
          const [lon2, lat2] = toLatLon(sx2, sy2)
          const id = `_parking_grid_h_${lineId++}`
          viewer.entities.add({
            id,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray([lon1, lat1, lon2, lat2]),
              width: 3,
              material: gridColor,
              clampToGround: true,
            },
          })
          ids.push(id)
        }
      }
    },
    [viewer, modelTransform.longitude, modelTransform.latitude, selectedBlockInfo, site, gridRotation],
  )

  // ── 경로 렌더링 ──
  const renderPath = useCallback(
    (path: ParkingPathData, ids: string[]) => {
      if (!viewer || path.points.length < 2) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      // 경로는 모델 원점 기준 로컬 좌표 → 주차 변환 없이 직접 변환
      // (경로는 이미 절대 로컬 좌표)
      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)

      const positions = path.points.map(([x, y]) => {
        const lon = originLon + x / mPerDegLon
        const lat = originLat + y / mPerDegLat
        return Cesium.Cartesian3.fromDegrees(lon, lat)
      })

      const pathColor = path.isValid
        ? Cesium.Color.fromCssColorString('#10b981') // 초록 (유효)
        : Cesium.Color.fromCssColorString('#ef4444') // 빨강 (무효)

      // 경로 라인
      const pathId = '_parking_path'
      viewer.entities.add({
        id: pathId,
        polyline: {
          positions,
          width: 5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: pathColor.withAlpha(0.8),
            dashLength: 12,
          }),
          clampToGround: true,
        },
      })
      ids.push(pathId)

      // 경로 길이 라벨 (중간 지점)
      const midIdx = Math.floor(path.points.length / 2)
      const [mx, my] = path.points[midIdx]
      const mLon = originLon + mx / mPerDegLon
      const mLat = originLat + my / mPerDegLat
      const pathLabelId = '_parking_path_label'
      viewer.entities.add({
        id: pathLabelId,
        position: Cesium.Cartesian3.fromDegrees(mLon, mLat, 2),
        label: {
          text: `${path.length.toFixed(1)}m`,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: pathColor,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      ids.push(pathLabelId)
    },
    [viewer, modelTransform.longitude, modelTransform.latitude],
  )

  // ── 전체 렌더 (외부 호출용 — 드래그 중 실시간) ──
  const render = useCallback(
    (zone: ParkingZoneData) => {
      if (!viewer) return
      clearEntities()
      const ids: string[] = []

      const path = useProjectStore.getState().parkingPath
      // 그리드를 먼저 그려서 다른 요소 아래에 깔리게
      if (path?.grid) renderGrid(path, ids)

      renderZone(zone, ids)

      const entrance = useProjectStore.getState().parkingEntrance
      if (entrance) renderEntrance(entrance, ids)

      if (path) renderPath(path, ids)

      entityIdsRef.current = ids
    },
    [viewer, clearEntities, renderZone, renderEntrance, renderPath, renderGrid],
  )

  // ── 회전/이동 중 기존 엔티티 위치만 인플레이스 업데이트 (삭제/재생성 없이 빠른 업데이트) ──
  const updatePositionsInPlace = useCallback(
    (zone: ParkingZoneData) => {
      if (!viewer) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      // 존 중심 갱신
      if (zone.zoneCenter.length === 2) {
        zoneCenterRef.current = [zone.zoneCenter[0], zone.zoneCenter[1]]
      }

      // 1. 구역 경계 업데이트
      const boundaryEnt = viewer.entities.getById('_parking_zone_boundary')
      if (boundaryEnt && boundaryEnt.polygon) {
        boundaryEnt.polygon.hierarchy = new Cesium.PolygonHierarchy(
          polygonToPositions(zone.zonePolygon, toLatLonParking),
        )
      }

      // 2. 차로 업데이트
      zone.aisles.forEach((aisle, i) => {
        const aisleEnt = viewer.entities.getById(`_parking_aisle_${i}`)
        if (aisleEnt && aisleEnt.polygon) {
          aisleEnt.polygon.hierarchy = new Cesium.PolygonHierarchy(
            polygonToPositions(aisle.polygon, toLatLonParking),
          )
        }
        // 차로 중심선
        if (aisle.polygon.length >= 4) {
          const lineEnt = viewer.entities.getById(`_parking_aisle_line_${i}`)
          if (lineEnt && lineEnt.polyline) {
            const p = aisle.polygon
            const midStart = [(p[0][0] + p[3][0]) / 2, (p[0][1] + p[3][1]) / 2]
            const midEnd = [(p[1][0] + p[2][0]) / 2, (p[1][1] + p[2][1]) / 2]
            const [sLon, sLat] = toLatLonParking(midStart[0], midStart[1])
            const [eLon, eLat] = toLatLonParking(midEnd[0], midEnd[1])
            lineEnt.polyline.positions = new Cesium.ConstantProperty([
              Cesium.Cartesian3.fromDegrees(sLon, sLat),
              Cesium.Cartesian3.fromDegrees(eLon, eLat),
            ])
          }
        }
      })

      // 3. 슬롯 업데이트
      zone.slots.forEach((slot) => {
        const slotEnt = viewer.entities.getById(`_parking_slot_${slot.id}`)
        if (slotEnt && slotEnt.polygon) {
          slotEnt.polygon.hierarchy = new Cesium.PolygonHierarchy(
            polygonToPositions(slot.polygon, toLatLonParking),
          )
        }
      })

      // 4. 구역 라벨 업데이트
      if (zone.zoneCenter.length === 2) {
        const labelEnt = viewer.entities.getById('_parking_zone_label')
        if (labelEnt) {
          const [cLon, cLat] = toLatLonParking(zone.zoneCenter[0], zone.zoneCenter[1])
          labelEnt.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(cLon, cLat, 1.0),
          )
        }
      }

      // 5. 입구 업데이트
      const entrance = useProjectStore.getState().parkingEntrance
      if (entrance) {
        entranceCenterRef.current = [entrance.cx, entrance.cy]

        const entEnt = viewer.entities.getById('_parking_entrance')
        if (entEnt && entEnt.polygon) {
          entEnt.polygon.hierarchy = new Cesium.PolygonHierarchy(
            polygonToPositions(entrance.polygon, toLatLonEntrance),
          )
        }

        const entLabelEnt = viewer.entities.getById('_parking_entrance_label')
        if (entLabelEnt) {
          const [eLon, eLat] = toLatLonEntrance(entrance.cx, entrance.cy)
          entLabelEnt.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(eLon, eLat, 1.5),
          )
        }

        // 화살표
        const arrowEnt = viewer.entities.getById('_parking_entrance_arrow')
        if (arrowEnt && arrowEnt.polyline) {
          const headRad = (entrance.heading * Math.PI) / 180
          const arrowLen = entrance.depth * 0.8
          const arrowTipX = entrance.cx + Math.sin(headRad) * arrowLen
          const arrowTipY = entrance.cy + Math.cos(headRad) * arrowLen
          const [eLon, eLat] = toLatLonEntrance(entrance.cx, entrance.cy)
          const [tLon, tLat] = toLatLonEntrance(arrowTipX, arrowTipY)
          arrowEnt.polyline.positions = new Cesium.ConstantProperty([
            Cesium.Cartesian3.fromDegrees(eLon, eLat),
            Cesium.Cartesian3.fromDegrees(tLon, tLat),
          ])
        }
      }
    },
    [viewer, polygonToPositions, toLatLonParking, toLatLonEntrance],
  )

  // ── 입구만 인플레이스 업데이트 (회전/이동 중) ──
  const updateEntranceInPlace = useCallback(
    () => {
      if (!viewer) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      const entrance = useProjectStore.getState().parkingEntrance
      if (!entrance) return

      entranceCenterRef.current = [entrance.cx, entrance.cy]

      const entEnt = viewer.entities.getById('_parking_entrance')
      if (entEnt && entEnt.polygon) {
        entEnt.polygon.hierarchy = new Cesium.PolygonHierarchy(
          polygonToPositions(entrance.polygon, toLatLonEntrance),
        )
      }

      const entLabelEnt = viewer.entities.getById('_parking_entrance_label')
      if (entLabelEnt) {
        const [eLon, eLat] = toLatLonEntrance(entrance.cx, entrance.cy)
        entLabelEnt.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(eLon, eLat, 1.5),
        )
      }

      const arrowEnt = viewer.entities.getById('_parking_entrance_arrow')
      if (arrowEnt && arrowEnt.polyline) {
        const headRad = (entrance.heading * Math.PI) / 180
        const arrowLen = entrance.depth * 0.8
        const arrowTipX = entrance.cx + Math.sin(headRad) * arrowLen
        const arrowTipY = entrance.cy + Math.cos(headRad) * arrowLen
        const [eLon, eLat] = toLatLonEntrance(entrance.cx, entrance.cy)
        const [tLon, tLat] = toLatLonEntrance(arrowTipX, arrowTipY)
        arrowEnt.polyline.positions = new Cesium.ConstantProperty([
          Cesium.Cartesian3.fromDegrees(eLon, eLat),
          Cesium.Cartesian3.fromDegrees(tLon, tLat),
        ])
      }
    },
    [viewer, polygonToPositions, toLatLonEntrance],
  )

  // 입구만 리렌더 (드래그 중 — 경로 포함 전체 재생성)
  const renderEntranceOnly = useCallback(
    () => {
      if (!viewer) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      // 기존 입구 + 경로 + 그리드 엔티티 제거
      const entriesToRemove = entityIdsRef.current.filter(
        (id) => id.startsWith('_parking_entrance') || id.startsWith('_parking_path') || id.startsWith('_parking_grid'),
      )
      for (const id of entriesToRemove) {
        const ent = viewer.entities.getById(id)
        if (ent) viewer.entities.remove(ent)
      }
      entityIdsRef.current = entityIdsRef.current.filter(
        (id) => !id.startsWith('_parking_entrance') && !id.startsWith('_parking_path') && !id.startsWith('_parking_grid'),
      )

      const ids: string[] = []

      const path = useProjectStore.getState().parkingPath
      if (path?.grid) renderGrid(path, ids)

      const entrance = useProjectStore.getState().parkingEntrance
      if (entrance) renderEntrance(entrance, ids)

      if (path) renderPath(path, ids)

      entityIdsRef.current = [...entityIdsRef.current, ...ids]
    },
    [viewer, renderEntrance, renderPath, renderGrid],
  )

  // ── 상태 변화에 따른 렌더 / 클리어 ──
  useEffect(() => {
    if (!viewer) return
    if (isParkingVisible && parkingZone) {
      clearEntities()
      const ids: string[] = []
      // 그리드를 먼저 그려서 다른 요소 아래에 깔리게
      if (parkingPath?.grid) renderGrid(parkingPath, ids)
      renderZone(parkingZone, ids)
      if (parkingEntrance) renderEntrance(parkingEntrance, ids)
      if (parkingPath) renderPath(parkingPath, ids)
      entityIdsRef.current = ids
    } else {
      clearEntities()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, parkingZone, parkingEntrance, parkingPath, isParkingVisible, parkingTransform, entranceTransform, gridRotation])

  // 언마운트 시 클리어
  useEffect(() => {
    return () => { clearEntities() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    clearEntities,
    render,
    renderEntranceOnly,
    /** 회전/이동 중 엔티티 삭제 없이 위치만 빠르게 업데이트 */
    updatePositionsInPlace,
    /** 입구만 인플레이스 업데이트 */
    updateEntranceInPlace,
    /** CesiumViewer에서 드래그/회전 중 직접 업데이트할 수 있는 ref */
    parkingTransformRef,
    entranceTransformRef,
  }
}
