'use client'

import { useEffect, useState, useCallback, RefObject } from 'react'

interface CompassProps {
  viewerRef: RefObject<any>
  isLoaded: boolean
}

/**
 * 나침반 위젯 — 카메라 heading에 따라 회전하며, 클릭 시 북쪽으로 리셋
 */
export default function Compass({ viewerRef, isLoaded }: CompassProps) {
  const [heading, setHeading] = useState(0) // 라디안

  // 카메라 heading 추적
  useEffect(() => {
    if (!viewerRef.current || !isLoaded) return

    const viewer = viewerRef.current
    const scene = viewer.scene

    // 초기값 설정
    setHeading(viewer.camera.heading)

    // postRender 이벤트로 카메라 변경 감지
    const removeListener = scene.postRender.addEventListener(() => {
      setHeading(viewer.camera.heading)
    })

    return () => {
      try {
        removeListener()
      } catch {}
    }
  }, [viewerRef, isLoaded])

  // 북쪽으로 리셋 (heading = 0)
  const resetToNorth = useCallback(() => {
    if (!viewerRef.current) return
    const viewer = viewerRef.current
    const Cesium = (window as any).Cesium
    if (!Cesium) return

    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: 0, // 북쪽
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll,
      },
      duration: 0.5,
    })
  }, [viewerRef])

  if (!isLoaded) return null

  // heading을 도 단위로 변환 (0~360)
  const headingDeg = ((heading * 180) / Math.PI + 360) % 360

  return (
    <div
      className="absolute bottom-28 left-2 z-10 cursor-pointer select-none"
      onClick={resetToNorth}
      title="클릭하여 북쪽으로 정렬"
    >
      <div className="w-14 h-14 bg-white/90 rounded-full shadow-lg border border-gray-200 flex items-center justify-center">
        {/* 나침반 배경 원 */}
        <div className="relative w-12 h-12">
          {/* 방위 표시 (고정) */}
          <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-0.5 text-[10px] font-bold text-red-600">
            N
          </span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-0.5 text-[10px] font-medium text-gray-400">
            S
          </span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-0.5 text-[10px] font-medium text-gray-400">
            W
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-0.5 text-[10px] font-medium text-gray-400">
            E
          </span>

          {/* 나침반 바늘 (회전) */}
          <svg
            viewBox="0 0 48 48"
            className="w-full h-full"
            style={{ transform: `rotate(${-headingDeg}deg)` }}
          >
            {/* 북쪽 바늘 (빨간색) */}
            <polygon
              points="24,6 21,24 27,24"
              fill="#DC2626"
              stroke="#991B1B"
              strokeWidth="0.5"
            />
            {/* 남쪽 바늘 (흰색) */}
            <polygon
              points="24,42 21,24 27,24"
              fill="#E5E7EB"
              stroke="#9CA3AF"
              strokeWidth="0.5"
            />
            {/* 중심점 */}
            <circle cx="24" cy="24" r="3" fill="#374151" />
          </svg>
        </div>
      </div>

      {/* 현재 방위각 표시 */}
      <div className="text-center mt-1 text-[10px] text-gray-600 font-medium bg-white/80 rounded px-1">
        {Math.round(headingDeg)}°
      </div>
    </div>
  )
}
