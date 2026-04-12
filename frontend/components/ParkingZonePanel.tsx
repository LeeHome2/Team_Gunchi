'use client'

import { useState, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import type { ParkingZoneData } from '@/store/projectStore'
import { generateParkingLayout } from '@/lib/api'

/**
 * 주차구역 배치 패널 (재설계)
 *
 * - 선택 영역 면적 자동 표시
 * - 주차 대수 직접 입력
 * - 건물 겹침 회피 + 도로 동선 연결
 * - 생성 후 이동/회전 가능 (Cesium 드래그/휠)
 */
export default function ParkingZonePanel() {
  const {
    site,
    building,
    modelTransform,
    parkingZone,
    isParkingVisible,
    selectedBlockInfo,
    loadedModelEntity,
    setParkingZone,
    setIsParkingVisible,
    setError,
  } = useProjectStore()

  const [parkingCount, setParkingCount] = useState(10)
  const [disabledCount, setDisabledCount] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)

  // 선택 영역 면적 (이미 계산되어 있음)
  const areaM2 = selectedBlockInfo?.totalArea ?? site?.area ?? 0

  // 좌표 변환: 경위도 → 로컬 미터
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

  // 주차구역 생성
  const handleGenerate = useCallback(async () => {
    if (parkingCount <= 0) {
      setError('주차 대수를 입력해주세요')
      return
    }

    // 선택된 블록 좌표 또는 사이트 footprint 사용
    const siteFootprint = selectedBlockInfo?.coordinates?.[0] ?? site?.footprint
    if (!siteFootprint || siteFootprint.length < 3) {
      setError('영역을 먼저 선택해주세요')
      return
    }

    // 건물 footprint — 로드된 모델의 바운더리를 사용하거나 building 정보 사용
    const buildingFootprint = building?.footprint ?? siteFootprint

    setIsGenerating(true)
    try {
      const siteLocal = toLocal(siteFootprint)
      const buildingLocal = loadedModelEntity
        ? toLocal(buildingFootprint)
        : [] // 건물 없으면 빈 배열

      const res = await generateParkingLayout({
        site_footprint: siteLocal,
        building_footprint: buildingLocal.length >= 3 ? buildingLocal : siteLocal,
        required_total: parkingCount,
        required_disabled: disabledCount,
        preferred_heading: modelTransform.rotation,
      })

      const zone: ParkingZoneData = {
        slots: res.slots,
        aisles: res.aisles,
        accessPoint: res.access_point,
        zonePolygon: res.zone_polygon,
        zoneCenter: res.zone_center,
        zoneRotation: res.zone_rotation,
        zoneWidth: res.zone_width,
        zoneDepth: res.zone_depth,
        totalSlots: res.total_slots,
        standardSlots: res.standard_slots,
        disabledSlots: res.disabled_slots,
        totalAreaM2: res.total_area_m2,
        parkingAreaRatio: res.parking_area_ratio,
        warnings: res.warnings,
      }

      setParkingZone(zone)
      setIsParkingVisible(true)
    } catch (err: any) {
      setError(err.message || '주차구역 배치 실패')
    } finally {
      setIsGenerating(false)
    }
  }, [
    parkingCount, disabledCount, site, building, selectedBlockInfo,
    loadedModelEntity, modelTransform, toLocal,
    setParkingZone, setIsParkingVisible, setError,
  ])

  // 주차구역 제거
  const handleClear = () => {
    setParkingZone(null as any)
    setIsParkingVisible(false)
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">주차구역 배치</h3>

      {/* 영역 면적 표시 */}
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
            <span className="text-green-600 font-medium">O</span>
          </div>
        )}
      </div>

      {/* 주차 대수 입력 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          주차 대수
        </label>
        <input
          type="number"
          min={1}
          max={200}
          value={parkingCount}
          onChange={(e) => setParkingCount(Math.max(1, Number(e.target.value)))}
          className="input-field"
          placeholder="필요 주차 대수"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          장애인 전용 대수
        </label>
        <input
          type="number"
          min={0}
          max={parkingCount}
          value={disabledCount}
          onChange={(e) => setDisabledCount(Math.max(0, Number(e.target.value)))}
          className="input-field"
          placeholder="장애인 전용"
        />
      </div>

      {/* 생성 버튼 */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || parkingCount <= 0}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isGenerating && (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        주차구역 생성
      </button>

      {/* 조작 안내 */}
      {parkingZone && (
        <>
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            <p className="font-medium mb-1">주차구역 조작</p>
            <p>- 좌클릭 드래그: 이동</p>
            <p>- 휠클릭 드래그: 회전</p>
          </div>

          {/* 표시/숨기기 토글 */}
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
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <h4 className="font-medium text-sm border-b pb-2">배치 결과</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white rounded p-2 text-center">
                <div className="font-bold text-lg text-gray-800">{parkingZone.totalSlots}</div>
                <div className="text-gray-500">배치 대수</div>
              </div>
              <div className="bg-white rounded p-2 text-center">
                <div className="font-bold text-lg text-gray-800">{parkingZone.totalAreaM2.toFixed(0)}</div>
                <div className="text-gray-500">면적 (m²)</div>
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

            <div className="flex justify-between text-xs text-gray-500">
              <span>구역 크기</span>
              <span className="text-gray-700">
                {parkingZone.zoneWidth.toFixed(1)} x {parkingZone.zoneDepth.toFixed(1)}m
              </span>
            </div>

            {/* 동선 연결 정보 */}
            {parkingZone.accessPoint && (
              <div className="flex items-start gap-1.5 text-xs text-green-700 bg-green-50 rounded p-2">
                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                <span>
                  {parkingZone.accessPoint.road_x != null
                    ? '도로 연결 동선이 표시되었습니다'
                    : '진입로가 설정되었습니다'}
                </span>
              </div>
            )}

            {/* 경고 */}
            {parkingZone.warnings.length > 0 && (
              <div className="space-y-1">
                {parkingZone.warnings.map((w: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
                    <span className="flex-shrink-0">!</span>
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

          {/* 제거 버튼 */}
          <button
            onClick={handleClear}
            className="w-full text-red-600 text-sm hover:text-red-700"
          >
            주차구역 제거
          </button>
        </>
      )}

      {/* 안내 */}
      {!selectedBlockInfo && !site && (
        <p className="text-sm text-gray-400 text-center py-2">
          먼저 영역을 선택해주세요
        </p>
      )}
    </div>
  )
}
