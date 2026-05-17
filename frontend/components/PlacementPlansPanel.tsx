'use client'

import { useState, useCallback } from 'react'
import { useProjectStore, PlacementPlan } from '@/store/projectStore'

/**
 * 배치안 목록 패널 (좌측 사이드바)
 * - 배치안 추가
 * - 배치안 선택/로드
 * - 배치안 삭제
 */
export default function PlacementPlansPanel() {
  const {
    placementPlans,
    activePlanId,
    saveCurrentAsPlan,
    loadPlan,
    removePlacementPlan,
    setPlansOpen,
  } = useProjectStore()

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newPlanName, setNewPlanName] = useState('')
  const [newPlanDesc, setNewPlanDesc] = useState('')

  const handleAddPlan = useCallback(() => {
    if (!newPlanName.trim()) return
    saveCurrentAsPlan(newPlanName.trim(), newPlanDesc.trim() || undefined)
    setNewPlanName('')
    setNewPlanDesc('')
    setShowAddDialog(false)
  }, [newPlanName, newPlanDesc, saveCurrentAsPlan])

  const handleSelectPlan = useCallback(
    (plan: PlacementPlan) => {
      loadPlan(plan.id)
    },
    [loadPlan]
  )

  const handleDeletePlan = useCallback(
    (e: React.MouseEvent, planId: string) => {
      e.stopPropagation()
      if (confirm('이 배치안을 삭제하시겠습니까?')) {
        removePlacementPlan(planId)
      }
    },
    [removePlacementPlan]
  )

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="h-full flex flex-col bg-navy-850">
      {/* 헤더 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">배치안 목록</h2>
        <button
          onClick={() => setPlansOpen(false)}
          className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
          title="닫기"
        >
          <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 배치안 추가 버튼 */}
      <div className="flex-shrink-0 p-3 border-b border-white/5">
        <button
          onClick={() => setShowAddDialog(true)}
          className="w-full btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          배치안 추가
        </button>
      </div>

      {/* 배치안 목록 */}
      <div className="flex-1 overflow-y-auto">
        {placementPlans.length === 0 ? (
          <div className="p-4 text-center text-white/40 text-sm">
            <p className="mb-2">저장된 배치안이 없습니다</p>
            <p className="text-xs">현재 배치를 배치안으로 저장하세요</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {placementPlans.map((plan, index) => (
              <div
                key={plan.id}
                onClick={() => handleSelectPlan(plan)}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  activePlanId === plan.id
                    ? 'bg-brand-500/20 border border-brand-400/50'
                    : 'bg-white/5 border border-transparent hover:bg-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-white/40">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <h3 className="text-sm font-medium text-white truncate">
                        {plan.name}
                      </h3>
                    </div>
                    {plan.description && (
                      <p className="text-xs text-white/50 mt-1 truncate">
                        {plan.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-white/40">
                      <span>{formatDate(plan.createdAt)}</span>
                      {plan.aiScore && (
                        <>
                          <span>·</span>
                          <span className="text-brand-400">
                            점수: {plan.aiScore.overallScore}점
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeletePlan(e, plan.id)}
                    className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors group"
                    title="삭제"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-white/40 group-hover:text-red-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
                {/* 간단한 정보 표시 */}
                <div className="mt-2 flex items-center gap-3 text-xs text-white/40">
                  <span>
                    건물 {(plan.massPlacement?.length ?? (plan as any).generatedMasses?.length ?? 0)}개
                  </span>
                  {plan.parkingZone && (
                    <span>
                      주차 {plan.parkingZone.totalSlots}대
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 배치안 추가 다이얼로그 */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">새 배치안 저장</h3>
            <p className="text-sm text-white/60 mb-4">
              현재 편집 중인 배치를 새 배치안으로 저장합니다.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  배치안 이름 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  placeholder="예: A안 - 남향 배치"
                  className="input-field"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPlan()
                    if (e.key === 'Escape') setShowAddDialog(false)
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  설명 (선택)
                </label>
                <textarea
                  value={newPlanDesc}
                  onChange={(e) => setNewPlanDesc(e.target.value)}
                  placeholder="배치안에 대한 간단한 설명"
                  rows={2}
                  className="input-field resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowAddDialog(false)
                  setNewPlanName('')
                  setNewPlanDesc('')
                }}
                className="btn-secondary text-sm"
              >
                취소
              </button>
              <button
                onClick={handleAddPlan}
                disabled={!newPlanName.trim()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
