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

  // ── 그리드 시각화 렌더링 ──
  const renderGrid = useCallback(
    (path: ParkingPathData, ids: string[]) => {
      if (!viewer || !path.grid) return
      const Cesium = (window as any).Cesium
      if (!Cesium) return

      const { cells, gridSize } = path.grid
      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)

      const halfGrid = gridSize / 2

      // 셀 수가 많으면 성능을 위해 건물(blocked) 셀만 렌더
      const maxCells = 2000
      const renderAll = cells.length <= maxCells

      cells.forEach((cell, i) => {
        // 통과 가능 셀은 연하게, 건물 셀은 빨간색으로
        if (!renderAll && !cell.blocked) return

        const id = `_parking_grid_${i}`
        const lon = originLon + cell.x / mPerDegLon
        const lat = originLat + cell.y / mPerDegLat

        // 셀 네 꼭짓점
        const dLon = halfGrid / mPerDegLon
        const dLat = halfGrid / mPerDegLat
        const positions = Cesium.Cartesian3.fromDegreesArray([
          lon - dLon, lat - dLat,
          lon + dLon, lat - dLat,
          lon + dLon, lat + dLat,
          lon - dLon, lat + dLat,
        ])

        const color = cell.blocked
          ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.25) // 장애물: 연한 빨강
          : Cesium.Color.fromCssColorString('#6b7280').withAlpha(0.08) // 통과 가능: 아주 연한 회색
        const outlineColor = cell.blocked
          ? Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.4)
          : Cesium.Color.fromCssColorString('#9ca3af').withAlpha(0.15)

        viewer.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: color,
            outline: true,
            outlineColor,
            outlineWidth: 1,
            height: 0.1,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
        })
        ids.push(id)
      })
    },
    [viewer, modelTransform.longitude, modelTransform.latitude],
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
  }, [viewer, parkingZone, parkingEntrance, parkingPath, isParkingVisible, parkingTransform, entranceTransform])

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
