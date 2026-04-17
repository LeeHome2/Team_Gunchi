'use client'

import { useState, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import type { ParkingZoneData, ParkingLayoutPattern } from '@/store/projectStore'
import { generateParkingLayout } from '@/lib/parkingLayout'
import { findParkingPath } from '@/lib/parkingPathfinder'

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
    parkingConfig,
    setParkingConfig,
    setParkingZone,
    setParkingEntrance,
    setParkingPath,
    setIsParkingVisible,
    setParkingTransform,
    setEntranceTransform,
    clearParking,
    setError,
  } = useProjectStore()

  const [parkingCount, setParkingCount] = useState(10)
  const [disabledCount, setDisabledCount] = useState(1)
  const [layoutPattern, setLayoutPattern] = useState<ParkingLayoutPattern>(
    parkingConfig.layoutPattern || 'perpendicular',
  )
  const [isGenerating, setIsGenerating] = useState(false)

  const areaM2 = selectedBlockInfo?.totalArea ?? site?.area ?? 0

  // 경위도 → 로컬 미터
  const toLocal = useCallback(
    (footprint: number[][]): number[][] => {
      const originLon = modelTransform.longitude
      const originLat = modelTransform.latitude
      const latRad = (originLat * Math.PI) / 180
      const mPerDegLat = 111_320
      const mPerDegLon = 111_320 * Math.cos(latRad)
      return footprint.map(([lon, lat]) => [
        (lon - originLon) * mPerDegLon,
        (lat - originLat) * mPerDegLat,
      ])
    },
    [modelTransform.longitude, modelTransform.latitude],
  )

  // 주차구역 + 입구 생성
  const handleGenerate = useCallback(() => {
    if (parkingCount <= 0) {
      setError('주차 대수를 입력해주세요')
      return
    }

    const siteFootprint = selectedBlockInfo?.coordinates?.[0] ?? site?.footprint
    if (!siteFootprint || siteFootprint.length < 3) {
      setError('영역을 먼저 선택해주세요')
      return
    }

    setIsGenerating(true)
    try {
      const siteLocal = toLocal(siteFootprint)
      const buildingLocal = loadedModelEntity && building?.footprint
        ? toLocal(building.footprint)
        : []

      const result = generateParkingLayout({
        siteFootprint: siteLocal,
        buildingFootprint: buildingLocal.length >= 3 ? buildingLocal : [],
        requiredTotal: parkingCount,
        requiredDisabled: disabledCount,
        pattern: layoutPattern,
        heading: 0,
      })

      // Store 업데이트
      setParkingZone(result.zone)
      setParkingEntrance(result.entrance)
      setParkingConfig({ layoutPattern })
      setIsParkingVisible(true)

      // 변환 초기화
      setParkingTransform({ longitude: 0, latitude: 0, rotation: 0 })
      setEntranceTransform({ longitude: 0, latitude: 0, rotation: 0 })

      // 경로 탐색 (소규모 주차(≤6대)에서는 경로 불필요 — 주택 부지 내 단순 배치)
      if (result.zone.slots.length > 0 && parkingCount > 6) {
        const obstacles = buildingLocal.length >= 3
          ? [{
              minX: Math.min(...buildingLocal.map(p => p[0])) - 1,
              minY: Math.min(...buildingLocal.map(p => p[1])) - 1,
              maxX: Math.max(...buildingLocal.map(p => p[0])) + 1,
              maxY: Math.max(...buildingLocal.map(p => p[1])) + 1,
            }]
          : []

        const path = findParkingPath({
          start: [result.entrance.cx, result.entrance.cy],
          goal: result.zone.zoneCenter as [number, number],
          siteFootprint: siteLocal,
          obstacles,
          gridSize: 2,
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
    loadedModelEntity, modelTransform, toLocal,
    setParkingZone, setParkingEntrance, setParkingPath, setParkingConfig,
    setIsParkingVisible, setParkingTransform, setEntranceTransform, setError,
  ])

  // 경로 재탐색 (입구/주차영역 이동 후)
  const handleRecalcPath = useCallback(() => {
    if (!parkingZone || !parkingEntrance) return
    const siteFootprint = selectedBlockInfo?.coordinates?.[0] ?? site?.footprint
    if (!siteFootprint || siteFootprint.length < 3) return

    const siteLocal = toLocal(siteFootprint)
    const buildingLocal = loadedModelEntity && building?.footprint
      ? toLocal(building.footprint)
      : []

    const obstacles = buildingLocal.length >= 3
      ? [{
          minX: Math.min(...buildingLocal.map(p => p[0])) - 1,
          minY: Math.min(...buildingLocal.map(p => p[1])) - 1,
          maxX: Math.max(...buildingLocal.map(p => p[0])) + 1,
          maxY: Math.max(...buildingLocal.map(p => p[1])) + 1,
        }]
      : []

    const path = findParkingPath({
      start: [parkingEntrance.cx, parkingEntrance.cy],
      goal: parkingZone.zoneCenter as [number, number],
      siteFootprint: siteLocal,
      obstacles,
      gridSize: 2,
    })
    setParkingPath(path)
  }, [parkingZone, parkingEntrance, selectedBlockInfo, site, building, loadedModelEntity, toLocal, setParkingPath])

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
        {loadedModelEntity && (
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-600">건물 배치됨</span>
            <span className="text-green-600 font-medium">✓</span>
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
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isParkingVisible}
              onChange={(e) => setIsParkingVisible(e.target.checked)}
              className="rounded border-gray-300"
            />
            지도에 표시
          </label>

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

            {/* 충족 여부 */}
            <div className={`rounded p-2 text-xs font-medium text-center ${
              parkingZone.totalSlots >= parkingCount
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {parkingZone.totalSlots >= parkingCount
                ? `주차 기준 충족 (${parkingZone.totalSlots} / ${parkingCount}대)`
                : `주차 기준 미달 (${parkingZone.totalSlots} / ${parkingCount}대)`}
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
