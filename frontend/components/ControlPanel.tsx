'use client'

import { useState } from 'react'
import { useProjectStore } from '@/store/projectStore'

/**
 * 상단 컨트롤 패널
 * - 프로젝트 정보
 * - 뷰 모드 전환
 * - 기타 도구
 */
export default function ControlPanel() {
  const { site, building } = useProjectStore()
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d')

  return (
    <div className="control-panel">
      {/* 프로젝트 정보 */}
      <div className="mb-4">
        <h2 className="font-bold text-lg">건물 배치 분석</h2>
        <p className="text-sm text-gray-600">Cesium 3D 뷰어</p>
      </div>

      {/* 상태 요약 */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${
              site ? 'bg-green-500' : 'bg-gray-300'
            }`}
          ></span>
          <span>대지: {site ? '로드됨' : '없음'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${
              building ? 'bg-green-500' : 'bg-gray-300'
            }`}
          ></span>
          <span>건물: {building ? `${building.height}m / ${building.floors}층` : '없음'}</span>
        </div>
      </div>

      {/* 뷰 모드 */}
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700 mb-2 block">뷰 모드</label>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1.5 text-sm rounded ${
              viewMode === '3d'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            3D
          </button>
          <button
            onClick={() => setViewMode('2d')}
            className={`px-3 py-1.5 text-sm rounded ${
              viewMode === '2d'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            2D
          </button>
        </div>
      </div>

      {/* 빠른 위치 이동 */}
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700 mb-2 block">빠른 이동</label>
        <select className="input-field text-sm">
          <option value="seongnam">성남시</option>
          <option value="seoul">서울</option>
          <option value="busan">부산</option>
          <option value="incheon">인천</option>
        </select>
      </div>

      {/* 도움말 */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          <strong>조작법:</strong><br />
          • 좌클릭 드래그: 회전<br />
          • 우클릭 드래그: 이동<br />
          • 스크롤: 줌
        </p>
      </div>
    </div>
  )
}
