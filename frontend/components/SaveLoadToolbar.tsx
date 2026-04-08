'use client'

import { useRef, useState } from 'react'

interface SaveLoadToolbarProps {
  onSave: (projectName?: string) => void
  onLoad: (file: File) => Promise<void>
  isSaving: boolean
  isLoading: boolean
  error: string | null
  onClearError: () => void
}

export default function SaveLoadToolbar({
  onSave,
  onLoad,
  isSaving,
  isLoading,
  error,
  onClearError,
}: SaveLoadToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [projectName, setProjectName] = useState('')

  const handleSaveClick = () => {
    setShowSaveDialog(true)
  }

  const handleSaveConfirm = () => {
    onSave(projectName || undefined)
    setShowSaveDialog(false)
    setProjectName('')
  }

  const handleSaveCancel = () => {
    setShowSaveDialog(false)
    setProjectName('')
  }

  const handleLoadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await onLoad(file)
      e.target.value = '' // 입력 초기화
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveConfirm()
    } else if (e.key === 'Escape') {
      handleSaveCancel()
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* 저장 버튼 */}
        <button
          onClick={handleSaveClick}
          disabled={isSaving || isLoading}
          className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
            isSaving
              ? 'bg-gray-300 cursor-wait text-gray-500'
              : 'bg-white/90 hover:bg-gray-100 text-gray-700'
          }`}
          title="프로젝트 저장"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
            />
          </svg>
          <span className="text-sm">{isSaving ? '저장 중...' : '저장'}</span>
        </button>

        {/* 불러오기 버튼 */}
        <button
          onClick={handleLoadClick}
          disabled={isSaving || isLoading}
          className={`rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 transition-colors ${
            isLoading
              ? 'bg-gray-300 cursor-wait text-gray-500'
              : 'bg-white/90 hover:bg-gray-100 text-gray-700'
          }`}
          title="프로젝트 불러오기"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          <span className="text-sm">{isLoading ? '불러오는 중...' : '불러오기'}</span>
        </button>

        {/* 숨겨진 파일 입력 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* 저장 다이얼로그 */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96 max-w-[90vw]">
            <h3 className="text-lg font-medium text-gray-800 mb-4">프로젝트 저장</h3>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="프로젝트 이름 (선택사항)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <p className="text-sm text-gray-500 mb-4">
              이름을 입력하지 않으면 오늘 날짜로 저장됩니다.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleSaveCancel}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveConfirm}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 에러 토스트 */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50 max-w-md">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="flex-1">{error}</span>
          <button
            onClick={onClearError}
            className="hover:bg-red-600 rounded p-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* 로딩 오버레이 */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 flex items-center gap-4">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-700">프로젝트를 불러오는 중...</span>
          </div>
        </div>
      )}
    </>
  )
}
