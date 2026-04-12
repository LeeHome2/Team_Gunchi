'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useProjectStore } from '@/store/projectStore'
import type { ParkingZoneData } from '@/store/projectStore'

/**
 * Cesium 뷰어 위에 주차구역(슬롯·차로·진입로·구역 경계)을
 * 2D 폴리곤 오버레이로 시각화하는 훅.
 *
 * 좌표 변환:
 *   백엔드 배치 알고리즘은 로컬 미터(m) 좌표를 반환한다.
 *   이 훅에서 modelTransform.longitude/latitude 기준으로
 *   미터 → 경위도 변환 후 Cesium GroundPrimitive(PolygonGraphics)로 렌더링한다.
 */
export function useParkingZone() {
  const viewer = useProjectStore((s) => s.viewer)
  const parkingZone = useProjectStore((s) => s.parkingZone)
  const isParkingVisible = useProjectStore((s) => s.isParkingVisible)
  const modelTransform = useProjectStore((s) => s.modelTransform)
  const parkingTransform = useProjectStore((s) => s.parkingTransform)

  // Cesium Entity ID 목록 (cleanup 용)
  const entityIdsRef = useRef<string[]>([])

  // parkingTransform ref (드래그 중 실시간 접근용)
  const parkingTransformRef = useRef(parkingTransform)
  parkingTransformRef.current = parkingTransform

  // ── 좌표 변환: 로컬 m → 경위도 (parkingTransform offset 적용) ──
  const toLatLon = useCallback(
    (localX: number, localY: number): [number, number] => {
      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)

      // parkingTransform rotation 적용 (로컬 좌표 회전)
      const pt = parkingTransformRef.current
      const rotRad = (pt.rotation * Math.PI) / 180
      const cos = Math.cos(rotRad)
      const sin = Math.sin(rotRad)
      const rx = localX * cos - localY * sin
      const ry = localX * sin + localY * cos

      const lon = originLon + rx / mPerDegLon + pt.longitude
      const lat = originLat + ry / mPerDegLat + pt.latitude
      return [lon, lat]
    },
    [modelTransform.longitude, modelTransform.latitude],
  )

  // ── 폴리곤 좌표 배열 → Cesium Cartesian3 배열 ─────────
  const polygonToPositions = useCallback(
    (polygon: number[][]) => {
      const Cesium = (window as any).Cesium
      if (!Cesium) return []
      return polygon.map(([x, y]) => {
        const [lon, lat] = toLatLon(x, y)
        return Cesium.Cartesian3.fromDegrees(lon, lat)
      })
    },
    [toLatLon],
  )

  // ── 모든 주차 엔티티 제거 ──────────────────────────────
  const clearEntities = useCallback(() => {
    if (!viewer) return
    for (const id of entityIdsRef.current) {
      const ent = viewer.entities.getById(id)
      if (ent) viewer.entities.remove(ent)
    }
    entityIdsRef.current = []
  }, [viewer])

  // ── 주차구역 렌더링 ───────────────────────────────────
  const render = useCallback(
    (zone: ParkingZoneData) => {
      if (!viewer) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      clearEntities()
      const ids: string[] = []

      // 1. 구역 경계 (반투명 네이비)
      const zoneId = '_parking_zone_boundary'
      viewer.entities.add({
        id: zoneId,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            polygonToPositions(zone.zonePolygon),
          ),
          material: Cesium.Color.fromCssColorString('#1e3a5f').withAlpha(0.15),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#3b82f6'),
          outlineWidth: 2,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      })
      ids.push(zoneId)

      // 2. 차로 (반투명 그레이 폴리곤 + 중심 통행 라인)
      zone.aisles.forEach((aisle, i) => {
        const id = `_parking_aisle_${i}`
        viewer.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              polygonToPositions(aisle.polygon),
            ),
            material: Cesium.Color.fromCssColorString('#94a3b8').withAlpha(0.3),
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        })
        ids.push(id)

        // 차로 중심 통행 라인 (화살표 느낌의 대시 라인)
        if (aisle.polygon.length >= 4) {
          const lineId = `_parking_aisle_line_${i}`
          // 차로 폴리곤의 중심선 계산 (상하 or 좌우 중심)
          const p = aisle.polygon
          const midStart = [(p[0][0] + p[3][0]) / 2, (p[0][1] + p[3][1]) / 2]
          const midEnd = [(p[1][0] + p[2][0]) / 2, (p[1][1] + p[2][1]) / 2]
          const [sLon, sLat] = toLatLon(midStart[0], midStart[1])
          const [eLon, eLat] = toLatLon(midEnd[0], midEnd[1])
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
            ? Cesium.Color.fromCssColorString('#facc15').withAlpha(0.55) // 장애인: 노랑
            : Cesium.Color.fromCssColorString('#60a5fa').withAlpha(0.50) // 일반: 파랑

        const outlineColor =
          slot.slot_type === 'disabled'
            ? Cesium.Color.fromCssColorString('#ca8a04')
            : Cesium.Color.fromCssColorString('#2563eb')

        viewer.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              polygonToPositions(slot.polygon),
            ),
            material: color,
            outline: true,
            outlineColor,
            outlineWidth: 1,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        })
        ids.push(id)
      })

      // 4. 진입로 (빨간 점 + 라벨)
      if (zone.accessPoint) {
        const [lon, lat] = toLatLon(zone.accessPoint.x, zone.accessPoint.y)
        const apId = '_parking_access_point'
        viewer.entities.add({
          id: apId,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 1.0),
          point: {
            pixelSize: 12,
            color: Cesium.Color.fromCssColorString('#ef4444'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: '진입로',
            font: '12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        ids.push(apId)

        // 진입로 → 도로 연결선
        if (zone.accessPoint.road_x != null && zone.accessPoint.road_y != null) {
          const [rLon, rLat] = toLatLon(
            zone.accessPoint.road_x,
            zone.accessPoint.road_y,
          )
          const lineId = '_parking_access_line'
          viewer.entities.add({
            id: lineId,
            polyline: {
              positions: [
                Cesium.Cartesian3.fromDegrees(lon, lat),
                Cesium.Cartesian3.fromDegrees(rLon, rLat),
              ],
              width: 4,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('#ef4444'),
                dashLength: 12,
              }),
              clampToGround: true,
            },
          })
          ids.push(lineId)
        }
      }

      // 5. 구역 중심 라벨
      if (zone.zoneCenter.length === 2) {
        const [cLon, cLat] = toLatLon(zone.zoneCenter[0], zone.zoneCenter[1])
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

      entityIdsRef.current = ids
    },
    [viewer, clearEntities, polygonToPositions, toLatLon],
  )

  // ── 상태 변화에 따른 렌더 / 클리어 ────────────────────
  useEffect(() => {
    if (!viewer) return
    if (isParkingVisible && parkingZone) {
      render(parkingZone)
    } else {
      clearEntities()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, parkingZone, isParkingVisible, parkingTransform])

  // 컴포넌트 언마운트 시 클리어
  useEffect(() => {
    return () => {
      clearEntities()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { clearEntities, render }
}
