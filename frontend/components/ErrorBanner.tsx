'use client'

import { useEffect } from 'react'
import { useProjectStore } from '@/store/projectStore'

/**
 * 에러 배너 컴포넌트
 * projectStore.error 상태를 구독하여 에러 발생 시 상단에 배너 표시
 */
export default function ErrorBanner() {
  const error = useProjectStore((state) => state.error)
  const setError = useProjectStore((state) => state.setError)

  // 5초 후 자동으로 에러 메시지 제거
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [error, setError])

  if (!error) return null

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-slide-down">
      <div className="bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-lg">
        {/* 에러 아이콘 */}
        <svg
          className="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>

        {/* 에러 메시지 */}
        <span className="text-sm font-medium">{error}</span>

        {/* 닫기 버튼 */}
        <button
          onClick={() => setError(null)}
          className="ml-2 hover:bg-red-600 rounded p-1 transition-colors"
          aria-label="닫기"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
