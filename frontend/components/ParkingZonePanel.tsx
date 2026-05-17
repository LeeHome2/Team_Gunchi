'use client'

import { useState, useCallback, useEffect } from 'react'
import * as turf from '@turf/turf'
import { useProjectStore } from '@/store/projectStore'
import type { ParkingZoneData, ParkingLayoutPattern } from '@/store/projectStore'
import { generateParkingLayout } from '@/lib/parkingLayout'
import { findParkingPath, findBoundaryPoint } from '@/lib/parkingPathfinder'

/**
 * 주차구역 배치 패널 (v2)
 *
 * 주요 기능:
 * - 주차 대수 입력 → 직각/평행 패턴으로 슬롯 자동 배치
 * - 입구 오브젝트 독립 생성 (별도 이동/회전 가능)
 * - A* 자동 경로 탐색 (입구→주차영역)
 * - 선택 블록 영역 내에서만 배치
 */
export default function ParkingZonePanel() {
  const {
    site,
    building,
    modelTransform,
    parkingZone,
    parkingEntrance,
    parkingPath,
    isParkingVisible,
    selectedBlockInfo,
    loadedModelEntity,
    generatedMasses,
    loadedMassGlbUrl,  // 현재 로드된 매스 GLB URL
    parkingOrigin,     // 주차구역 원점 (고정)
    parkingConfig,
    gridRotation,
    parkingTransform,
    entranceTransform,
    setParkingConfig,
    setParkingZone,
    setParkingEntrance,
    setParkingPath,
    setIsParkingVisible,
    setParkingTransform,
    setParkingOrigin,
    setEntranceTransform,
    setGridRotation,
    clearParking,
    setError,
  } = useProjectStore()

  const [parkingCount, setParkingCount] = useState(1)
  const [disabledCount, setDisabledCount] = useState(0)  // 기본값 0
  const [layoutPattern, setLayoutPattern] = useState<ParkingLayoutPattern>(
    parkingConfig.layoutPattern || 'perpendicular',
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  // 그리드 회전 슬라이더용 로컬 상태 (드래그 중 부드러운 UI)
  const [localGridRotation, setLocalGridRotation] = useState(gridRotation)

  const areaM2 = selectedBlockInfo?.totalArea ?? site?.area ?? 0

  // 경위도 → 로컬 미터 (parkingOrigin 기준, 없으면 modelTransform 사용)
  const toLocal = useCallback(
    (footprint: number[][]): number[][] => {
      const originLon = parkingOrigin?.longitude ?? modelTransform.longitude
      const originLat = parkingOrigin?.latitude ?? modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)
      return footprint.map(([lon, lat]) => [
        (lon - originLon) * mPerDegLon,
        (lat - originLat) * mPerDegLat,
      ])
    },
    [parkingOrigin, modelTransform.longitude, modelTransform.latitude],
  )

  // 모든 건물 footprint를 로컬 좌표 AABB 장애물로 변환
  // GLB boundingBox가 있으면 더 정확한 크기를 사용
  const collectObstacles = useCallback(() => {
    const obstacles: { minX: number; minY: number; maxX: number; maxY: number }[] = []
    const additionalFootprintsLocal: number[][][] = []
    const addedKeys = new Set<string>()  // 중복 감지용

    // AABB 키 생성 (중복 체크용) - 크기 기반으로 변경
    const makeKey = (width: number, height: number) =>
      `${width.toFixed(0)},${height.toFixed(0)}`

    // 장애물 추가 헬퍼 (중복 방지)
    const addObstacle = (
      minX: number, minY: number, maxX: number, maxY: number,
      source: string
    ) => {
      const width = maxX - minX
      const height = maxY - minY
      const key = makeKey(width, height)

      if (addedKeys.has(key)) {
        console.log(`[collectObstacles] 중복 스킵 (${source}): ${width.toFixed(1)} x ${height.toFixed(1)} m`)
        return false
      }

      addedKeys.add(key)
      obstacles.push({ minX, minY, maxX, maxY })
      console.log(`[collectObstacles] 추가 (${source}): ${width.toFixed(1)} x ${height.toFixed(1)} m`)
      return true
    }

    // 1. 생성된 매스 모델들 중 현재 로드된 것만 사용 (GLB boundingBox 우선)
    for (const mass of generatedMasses) {
      // 현재 로드된 매스만 장애물로 추가 (loadedMassGlbUrl과 매칭)
      const isCurrentlyLoaded = loadedMassGlbUrl && (
        mass.glbUrl === loadedMassGlbUrl ||
        mass.glbUrlNoRoof === loadedMassGlbUrl
      )

      if (!isCurrentlyLoaded) {
        console.log(`[collectObstacles] 스킵 (미로드): mass[${mass.id?.substring(0, 8)}]`)
        continue
      }

      if (mass.boundingBox) {
        // GLB boundingBox 사용
        // 건물 위치를 parkingOrigin 기준 로컬 좌표로 계산
        // DXF 파일마다 좌표 방향이 다르므로 swap 적용 (CesiumViewer와 동일)
        const width = mass.boundingBox.depth
        const depth = mass.boundingBox.width
        const halfW = width / 2
        const halfD = depth / 2

        // 건물 중심(modelTransform)의 parkingOrigin 기준 오프셋 계산
        const originLon = parkingOrigin?.longitude ?? modelTransform.longitude
        const originLat = parkingOrigin?.latitude ?? modelTransform.latitude
        const latRad = (originLat * Math.PI) / 180
        const mPerDegLon = 111_320 * Math.cos(latRad)
        const mPerDegLat = 111_320
        const offsetX = (modelTransform.longitude - originLon) * mPerDegLon
        const offsetY = (modelTransform.latitude - originLat) * mPerDegLat

        // 매스 회전 적용 (modelTransform.rotation)
        const rotRad = (modelTransform.rotation * Math.PI) / 180
        const cosR = Math.cos(rotRad)
        const sinR = Math.sin(rotRad)

        // 회전된 4개 코너 계산 (시계방향 — Cesium 매스와 동일)
        const corners = [
          [-halfW, -halfD],
          [halfW, -halfD],
          [halfW, halfD],
          [-halfW, halfD],
        ].map(([x, y]) => {
          // 시계방향 회전: +sin for x, -sin for y
          const rx = x * cosR + y * sinR
          const ry = -x * sinR + y * cosR
          return [offsetX + rx, offsetY + ry]
        })

        // 회전된 코너들의 AABB 계산
        const cXs = corners.map(c => c[0])
        const cYs = corners.map(c => c[1])
        const minX = Math.min(...cXs)
        const minY = Math.min(...cYs)
        const maxX = Math.max(...cXs)
        const maxY = Math.max(...cYs)

        if (addObstacle(minX, minY, maxX, maxY, `mass.boundingBox[${mass.id?.substring(0, 8)}] rot=${modelTransform.rotation.toFixed(0)}°`)) {
          // 회전된 폴리곤 저장 (정확한 충돌 검사용)
          additionalFootprintsLocal.push(corners)
        }
      } else if (mass.footprint && mass.footprint.length >= 3) {
        // boundingBox 없으면 footprint 사용
        const local = toLocal(mass.footprint)
        const minX = Math.min(...local.map(p => p[0]))
        const minY = Math.min(...local.map(p => p[1]))
        const maxX = Math.max(...local.map(p => p[0]))
        const maxY = Math.max(...local.map(p => p[1]))

        if (addObstacle(minX, minY, maxX, maxY, `mass.footprint[${mass.id?.substring(0, 8)}]`)) {
          additionalFootprintsLocal.push(local)
        }
      }
    }

    // 2. 메인 건물 - generatedMasses에서 boundingBox로 추가된 게 있으면 스킵
    // (DXF footprint는 GLB boundingBox보다 부정확하므로 GLB가 있으면 사용 안 함)
    const hasAnyBoundingBox = generatedMasses.some(m => m.boundingBox)
    if (!hasAnyBoundingBox && loadedModelEntity && building?.footprint && building.footprint.length >= 3) {
      const local = toLocal(building.footprint)
      const minX = Math.min(...local.map(p => p[0]))
      const minY = Math.min(...local.map(p => p[1]))
      const maxX = Math.max(...local.map(p => p[0]))
      const maxY = Math.max(...local.map(p => p[1]))

      addObstacle(minX, minY, maxX, maxY, 'building.footprint (fallback)')
    } else if (hasAnyBoundingBox && loadedModelEntity && building?.footprint) {
      console.log('[collectObstacles] building.footprint 스킵 (GLB boundingBox 사용)')
    }

    console.log(`[collectObstacles] 총 ${obstacles.length}개 장애물`)
    return { obstacles, additionalFootprintsLocal }
  }, [building, loadedModelEntity, generatedMasses, loadedMassGlbUrl, toLocal, modelTransform.longitude, modelTransform.latitude, modelTransform.rotation, parkingOrigin])

  // 주차구역 + 입구 생성
  const handleGenerate = useCallback(() => {
    if (parkingCount <= 0) {
      setError('주차 대수를 입력해주세요')
      return
    }

    // 선택된 모든 블록의 좌표를 합쳐서 하나의 경계 폴리곤 생성
    let combinedFootprint: number[][] | null = null
    if (selectedBlockInfo?.coordinates && selectedBlockInfo.coordinates.length > 0) {
      const blockCoords = selectedBlockInfo.coordinates

      if (blockCoords.length === 1) {
        // 단일 블록: 해당 블록의 폴리곤 그대로 사용
        combinedFootprint = blockCoords[0]
      } else {
        // 다중 블록: turf.union으로 합필
        try {
          let merged: any = turf.polygon([blockCoords[0]])
          for (let i = 1; i < blockCoords.length; i++) {
            const nextPoly = turf.polygon([blockCoords[i]])
            const unionResult = turf.union(turf.featureCollection([merged, nextPoly]))
            if (unionResult) {
              merged = unionResult
            }
          }

          // MultiPolygon인 경우 가장 큰 폴리곤 선택
          if (merged.geometry.type === 'MultiPolygon') {
            let largestArea = 0
            let largestPoly: number[][] = merged.geometry.coordinates[0][0]
            for (const poly of merged.geometry.coordinates) {
              const area = turf.area(turf.polygon(poly))
              if (area > largestArea) {
                largestArea = area
                largestPoly = poly[0]
              }
            }
            combinedFootprint = largestPoly
          } else {
            combinedFootprint = merged.geometry.coordinates[0]
          }
        } catch (err) {
          console.error('블록 합필 오류:', err)
          // 실패 시 첫 번째 블록만 사용
          combinedFootprint = blockCoords[0]
        }
      }
    }

    const siteFootprint = combinedFootprint ?? site?.footprint
    if (!siteFootprint || siteFootprint.length < 3) {
      setError('영역을 먼저 선택해주세요')
      return
    }

    setIsGenerating(true)
    try {
      // 사이트 중심점 계산 (주차구역 원점으로 사용)
      const siteCentroid = selectedBlockInfo?.centroid
        ?? (siteFootprint.length > 0
          ? [
              siteFootprint.reduce((s, p) => s + p[0], 0) / siteFootprint.length,
              siteFootprint.reduce((s, p) => s + p[1], 0) / siteFootprint.length,
            ] as [number, number]
          : null)

      if (!siteCentroid) {
        setError('사이트 중심점을 계산할 수 없습니다')
        return
      }

      // 주차구역 원점을 사이트 중심으로 먼저 설정 (toLocal에서 사용)
      const newParkingOrigin = {
        longitude: siteCentroid[0],
        latitude: siteCentroid[1],
      }
      setParkingOrigin(newParkingOrigin)

      // 사이트 중심 기준으로 로컬 좌표 변환
      const latRad = (siteCentroid[1] * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)
      const toLocalWithOrigin = (footprint: number[][]): number[][] =>
        footprint.map(([lon, lat]) => [
          (lon - siteCentroid[0]) * mPerDegLon,
          (lat - siteCentroid[1]) * mPerDegLat,
        ])

      const siteLocal = toLocalWithOrigin(siteFootprint)

      // collectObstacles도 새 원점 기준으로 재계산
      const obstacles: { minX: number; minY: number; maxX: number; maxY: number }[] = []
      const additionalFootprintsLocal: number[][][] = []

      // 매스 모델 장애물 (사이트 중심 기준)
      for (const mass of generatedMasses) {
        const isCurrentlyLoaded = loadedMassGlbUrl && (
          mass.glbUrl === loadedMassGlbUrl ||
          mass.glbUrlNoRoof === loadedMassGlbUrl
        )
        if (!isCurrentlyLoaded) continue

        if (mass.boundingBox) {
          const width = mass.boundingBox.depth
          const depth = mass.boundingBox.width
          const halfW = width / 2
          const halfD = depth / 2

          // 건물 중심의 사이트 중심 기준 오프셋
          const offsetX = (modelTransform.longitude - siteCentroid[0]) * mPerDegLon
          const offsetY = (modelTransform.latitude - siteCentroid[1]) * mPerDegLat

          // 회전 적용
          const rotRad = (modelTransform.rotation * Math.PI) / 180
          const cosR = Math.cos(rotRad)
          const sinR = Math.sin(rotRad)

          const corners = [
            [-halfW, -halfD],
            [halfW, -halfD],
            [halfW, halfD],
            [-halfW, halfD],
          ].map(([x, y]) => {
            const rx = x * cosR + y * sinR
            const ry = -x * sinR + y * cosR
            return [offsetX + rx, offsetY + ry]
          })

          const cXs = corners.map(c => c[0])
          const cYs = corners.map(c => c[1])
          obstacles.push({
            minX: Math.min(...cXs),
            minY: Math.min(...cYs),
            maxX: Math.max(...cXs),
            maxY: Math.max(...cYs),
          })
          additionalFootprintsLocal.push(corners)
        } else if (mass.footprint?.length >= 3) {
          const local = toLocalWithOrigin(mass.footprint)
          obstacles.push({
            minX: Math.min(...local.map(p => p[0])),
            minY: Math.min(...local.map(p => p[1])),
            maxX: Math.max(...local.map(p => p[0])),
            maxY: Math.max(...local.map(p => p[1])),
          })
          additionalFootprintsLocal.push(local)
        }
      }

      // 메인 건물 (레이아웃용)
      const buildingLocal = loadedModelEntity && building?.footprint
        ? toLocalWithOrigin(building.footprint)
        : []

      const result = generateParkingLayout({
        siteFootprint: siteLocal,
        buildingFootprint: buildingLocal.length >= 3 ? buildingLocal : [],
        additionalFootprints: additionalFootprintsLocal.length > 0
          ? additionalFootprintsLocal
          : undefined,
        requiredTotal: parkingCount,
        requiredDisabled: disabledCount,
        pattern: layoutPattern,
        heading: 0,
      })

      // 입구를 필지 경계 위에 배치
      const boundaryPt = findBoundaryPoint(siteLocal, 'top')
      const entrance = {
        ...result.entrance,
        cx: boundaryPt[0],
        cy: boundaryPt[1],
        polygon: [
          [boundaryPt[0] - result.entrance.width / 2, boundaryPt[1] - result.entrance.depth / 2],
          [boundaryPt[0] + result.entrance.width / 2, boundaryPt[1] - result.entrance.depth / 2],
          [boundaryPt[0] + result.entrance.width / 2, boundaryPt[1] + result.entrance.depth / 2],
          [boundaryPt[0] - result.entrance.width / 2, boundaryPt[1] + result.entrance.depth / 2],
        ],
      }

      // Store 업데이트
      setParkingZone(result.zone)
      setParkingEntrance(entrance)
      setParkingConfig({ layoutPattern })
      setIsParkingVisible(true)

      // 변환 초기화 (원점은 이미 siteCentroid로 설정됨)
      setParkingTransform({ longitude: 0, latitude: 0, rotation: 0 })
      setEntranceTransform({ longitude: 0, latitude: 0, rotation: 0 })

      // 경로 탐색 (항상 수행 — 그리드 데이터도 함께 반환)
      if (result.zone.slots.length > 0) {
        const path = findParkingPath({
          start: [entrance.cx, entrance.cy],
          goal: result.zone.zoneCenter as [number, number],
          siteFootprint: siteLocal,
          obstacles,
          obstaclePolygons: additionalFootprintsLocal,  // 회전된 폴리곤 사용
          gridSize: 2,
          returnGrid: showGrid,
          gridRotation,
        })
        setParkingPath(path)
      } else {
        setParkingPath(null)
      }
    } catch (err: any) {
      setError(err.message || '주차구역 배치 실패')
    } finally {
      setIsGenerating(false)
    }
  }, [
    parkingCount, disabledCount, layoutPattern, site, building, selectedBlockInfo,
    loadedModelEntity, generatedMasses, loadedMassGlbUrl, modelTransform, showGrid, gridRotation,
    setParkingZone, setParkingEntrance, setParkingPath, setParkingConfig,
    setIsParkingVisible, setParkingTransform, setParkingOrigin, setEntranceTransform, setError,
  ])

  // 경로 재탐색 (입구/주차영역 이동 후)
  const handleRecalcPath = useCallback(() => {
    if (!parkingZone || !parkingEntrance) return

    // 선택된 모든 블록의 좌표를 합쳐서 하나의 경계 폴리곤 생성
    let combinedFootprint: number[][] | null = null
    if (selectedBlockInfo?.coordinates && selectedBlockInfo.coordinates.length > 0) {
      const blockCoords = selectedBlockInfo.coordinates

      if (blockCoords.length === 1) {
        // 단일 블록: 해당 블록의 폴리곤 그대로 사용
        combinedFootprint = blockCoords[0]
      } else {
        // 다중 블록: turf.union으로 합필
        try {
          let merged: any = turf.polygon([blockCoords[0]])
          for (let i = 1; i < blockCoords.length; i++) {
            const nextPoly = turf.polygon([blockCoords[i]])
            const unionResult = turf.union(turf.featureCollection([merged, nextPoly]))
            if (unionResult) {
              merged = unionResult
            }
          }

          // MultiPolygon인 경우 가장 큰 폴리곤 선택
          if (merged.geometry.type === 'MultiPolygon') {
            let largestArea = 0
            let largestPoly: number[][] = merged.geometry.coordinates[0][0]
            for (const poly of merged.geometry.coordinates) {
              const area = turf.area(turf.polygon(poly))
              if (area > largestArea) {
                largestArea = area
                largestPoly = poly[0]
              }
            }
            combinedFootprint = largestPoly
          } else {
            combinedFootprint = merged.geometry.coordinates[0]
          }
        } catch (err) {
          console.error('블록 합필 오류:', err)
          // 실패 시 첫 번째 블록만 사용
          combinedFootprint = blockCoords[0]
        }
      }
    }

    const siteFootprint = combinedFootprint ?? site?.footprint
    if (!siteFootprint || siteFootprint.length < 3) return

    const siteLocal = toLocal(siteFootprint)
    const { obstacles, additionalFootprintsLocal } = collectObstacles()

    // transform 오프셋을 로컬 미터로 변환
    const latRad = (modelTransform.latitude * Math.PI) / 180
    const mPerDegLon = 111_320 * Math.cos(latRad)
    const mPerDegLat = 111_320

    // 입구 위치에 entranceTransform 오프셋 적용
    const entranceX = parkingEntrance.cx + entranceTransform.longitude * mPerDegLon
    const entranceY = parkingEntrance.cy + entranceTransform.latitude * mPerDegLat

    // 주차구역 중심에 parkingTransform 오프셋 적용
    const zoneX = parkingZone.zoneCenter[0] + parkingTransform.longitude * mPerDegLon
    const zoneY = parkingZone.zoneCenter[1] + parkingTransform.latitude * mPerDegLat

    const path = findParkingPath({
      start: [entranceX, entranceY],
      goal: [zoneX, zoneY],
      siteFootprint: siteLocal,
      obstacles,
      obstaclePolygons: additionalFootprintsLocal,  // 회전된 폴리곤 사용
      gridSize: 2,
      returnGrid: showGrid,
      gridRotation,
    })
    setParkingPath(path)
  }, [parkingZone, parkingEntrance, selectedBlockInfo, site, showGrid, collectObstacles, toLocal, setParkingPath,
      modelTransform.latitude, parkingTransform.longitude, parkingTransform.latitude,
      entranceTransform.longitude, entranceTransform.latitude, gridRotation])

  // transform 변경 또는 그리드 회전 변경 시 자동으로 경로 재계산
  useEffect(() => {
    if (parkingZone && parkingEntrance && isParkingVisible) {
      handleRecalcPath()
    }
  }, [parkingTransform.longitude, parkingTransform.latitude, parkingTransform.rotation,
      entranceTransform.longitude, entranceTransform.latitude, entranceTransform.rotation,
      handleRecalcPath, parkingZone, parkingEntrance, isParkingVisible, gridRotation])

  // gridRotation 외부 변경 시 로컬 상태 동기화
  useEffect(() => {
    setLocalGridRotation(gridRotation)
  }, [gridRotation])

  // 제거
  const handleClear = () => {
    clearParking()
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">주차구역 배치</h3>

      {/* 영역 면적 */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">선택 영역 면적</span>
          <span className="font-medium">
            {areaM2 > 0 ? `${areaM2.toFixed(1)} m²` : '영역 미선택'}
          </span>
        </div>
        {(loadedModelEntity || generatedMasses.length > 0) && (
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-600">건물 매스</span>
            <span className="text-green-600 font-medium">
              {(loadedModelEntity ? 1 : 0) + generatedMasses.length}개 인식
            </span>
          </div>
        )}
      </div>

      {/* 배치 패턴 선택 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">배치 패턴</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setLayoutPattern('perpendicular')}
            className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs transition-colors ${
              layoutPattern === 'perpendicular'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="4" width="6" height="10" rx="0.5" />
              <rect x="12" y="4" width="6" height="10" rx="0.5" />
              <rect x="20" y="4" width="6" height="10" rx="0.5" />
              <line x1="2" y1="16" x2="30" y2="16" strokeDasharray="2 2" />
            </svg>
            <span className="font-medium">직각 (90°)</span>
          </button>
          <button
            onClick={() => setLayoutPattern('parallel')}
            className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs transition-colors ${
              layoutPattern === 'parallel'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="6" width="10" height="4" rx="0.5" />
              <rect x="4" y="12" width="10" height="4" rx="0.5" />
              <rect x="4" y="18" width="10" height="4" rx="0.5" />
              <line x1="16" y1="2" x2="16" y2="30" strokeDasharray="2 2" />
            </svg>
            <span className="font-medium">평행 (0°)</span>
          </button>
        </div>
      </div>

      {/* 주차 대수 입력 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">주차 대수</label>
          <input
            type="number"
            min={1}
            max={200}
            value={parkingCount}
            onChange={(e) => setParkingCount(Math.max(1, Number(e.target.value)))}
            className="input-field text-center"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">장애인 전용</label>
          <input
            type="number"
            min={0}
            max={parkingCount}
            value={disabledCount}
            onChange={(e) => setDisabledCount(Math.max(0, Number(e.target.value)))}
            className="input-field text-center"
          />
        </div>
      </div>

      {/* 생성 버튼 */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || parkingCount <= 0 || areaM2 === 0}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isGenerating && (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {parkingZone ? '재배치' : '주차구역 생성'}
      </button>

      {/* ─── 결과 표시 ─── */}
      {parkingZone && (
        <>
          {/* 조작 안내 */}
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
            <p className="font-medium">오브젝트 조작</p>
            <p>• <span className="font-semibold text-blue-800">주차영역</span> — 좌클릭 드래그: 이동, 휠클릭: 회전</p>
            <p>• <span className="font-semibold text-orange-600">입구</span> — 좌클릭 드래그: 이동, 휠클릭: 회전</p>
          </div>

          {/* 표시/숨기기 */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isParkingVisible}
                onChange={(e) => setIsParkingVisible(e.target.checked)}
                className="rounded border-gray-300"
              />
              지도에 표시
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                className="rounded border-gray-300"
              />
              그리드 표시 (건물/경로 시각화)
            </label>

            {/* 그리드 회전 슬라이더 */}
            {showGrid && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>그리드 방향</span>
                  <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{localGridRotation}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={180}
                  step={5}
                  value={localGridRotation}
                  onChange={(e) => setLocalGridRotation(Number(e.target.value))}
                  onPointerUp={() => setGridRotation(localGridRotation)}
                  onTouchEnd={() => setGridRotation(localGridRotation)}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>0°</span>
                  <span>90°</span>
                  <span>180°</span>
                </div>
              </div>
            )}
          </div>

          {/* 결과 요약 */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-3">
            <h4 className="font-medium text-sm border-b pb-2">배치 결과</h4>

            {/* 대수 */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-white rounded p-2 text-center">
                <div className="font-bold text-lg text-gray-800">{parkingZone.totalSlots}</div>
                <div className="text-gray-500">배치 대수</div>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <div className="font-bold text-lg text-blue-600">{parkingZone.standardSlots}</div>
                <div className="text-gray-500">일반</div>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <div className="font-bold text-lg text-yellow-600">{parkingZone.disabledSlots}</div>
                <div className="text-gray-500">장애인</div>
              </div>
            </div>

            {/* 면적/크기 */}
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>주차 면적</span>
                <span className="text-gray-800 font-medium">{parkingZone.totalAreaM2.toFixed(0)} m²</span>
              </div>
              <div className="flex justify-between">
                <span>구역 크기</span>
                <span className="text-gray-800">{parkingZone.zoneWidth.toFixed(1)} × {parkingZone.zoneDepth.toFixed(1)}m</span>
              </div>
            </div>

            {/* 입구 정보 */}
            {parkingEntrance && (
              <div className="flex items-center gap-2 text-xs bg-orange-50 rounded p-2 text-orange-700">
                <span className="text-base">🅿</span>
                <span>입구 배치됨 ({parkingEntrance.width}m × {parkingEntrance.depth}m)</span>
              </div>
            )}

            {/* 경로 정보 */}
            {parkingPath && (
              <div className={`flex items-center gap-2 text-xs rounded p-2 ${
                parkingPath.isValid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span>
                  경로 {parkingPath.length.toFixed(1)}m
                  {parkingPath.isValid ? ' (유효)' : ' (영역 초과 — 위치 조정 필요)'}
                </span>
              </div>
            )}

            {/* 경로 재탐색 버튼 */}
            {parkingEntrance && parkingZone && (
              <button
                onClick={handleRecalcPath}
                className="w-full text-xs py-1.5 rounded border border-gray-300 hover:bg-gray-100 transition-colors text-gray-600"
              >
                경로 재탐색
              </button>
            )}

            {/* 경고 */}
            {parkingZone.warnings.length > 0 && (
              <div className="space-y-1">
                {parkingZone.warnings.map((w: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
                    <span className="flex-shrink-0">⚠</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 배치 결과 — 단순 카운트 표시 */}
            <div className="rounded p-2 text-xs font-medium text-center bg-green-50 text-green-700 border border-green-200">
              주차 슬롯 {parkingZone.totalSlots}대 배치됨 (요청 {parkingCount}대)
            </div>
          </div>

          {/* 제거 */}
          <button
            onClick={handleClear}
            className="w-full text-red-600 text-sm hover:text-red-700 py-1"
          >
            전체 제거
          </button>
        </>
      )}

      {!selectedBlockInfo && !site && (
        <p className="text-sm text-gray-400 text-center py-2">
          먼저 영역을 선택해주세요
        </p>
      )}
    </div>
  )
}
