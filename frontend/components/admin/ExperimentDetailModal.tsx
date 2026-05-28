'use client'

import { useEffect, useState } from 'react'
import { adminApi, AIExperiment } from '@/lib/api'
import { SmallBtn } from '@/components/admin/AdminUI'

interface Props {
  runId: string
  onClose: () => void
  /** 비교 기준이 되는 활성(운영) 모델 */
  activeModel?: AIExperiment | null
  /** AI 서버 URL (다운로드용) */
  aiUrl?: string
  /** 삭제 시 콜백 */
  onDelete?: (runId: string) => Promise<boolean>
}

const CLASS_LABELS = ['wall', 'door', 'window', 'other']

function pct(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

/** 두 값 비교하여 차이와 방향 반환 */
function comparePct(current: unknown, baseline: unknown): { diff: string; direction: 'up' | 'down' | 'same' | null } {
  if (typeof current !== 'number' || !Number.isFinite(current)) return { diff: '', direction: null }
  if (typeof baseline !== 'number' || !Number.isFinite(baseline)) return { diff: '', direction: null }

  const diffVal = (current - baseline) * 100
  if (Math.abs(diffVal) < 0.01) return { diff: '±0', direction: 'same' }

  const sign = diffVal > 0 ? '+' : ''
  return {
    diff: `${sign}${diffVal.toFixed(2)}%p`,
    direction: diffVal > 0 ? 'up' : 'down'
  }
}

/** 비교 지표 표시 컴포넌트 */
function MetricCompare({ direction, diff }: { direction: 'up' | 'down' | 'same' | null; diff: string }) {
  if (!direction || !diff) return null

  const colors = {
    up: 'text-emerald-600 dark:text-emerald-400',
    down: 'text-red-600 dark:text-red-400',
    same: 'text-white/40'
  }
  const arrows = {
    up: '↑',
    down: '↓',
    same: '→'
  }

  return (
    <span className={`text-[10px] ml-1.5 ${colors[direction]}`}>
      {arrows[direction]} {diff}
    </span>
  )
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  } catch {
    return iso
  }
}

/** confusion matrix 의 색상 강도 (배경색 강조용) */
function cmColor(v: number, max: number): string {
  if (max === 0 || v === 0) return 'transparent'
  const ratio = Math.min(v / max, 1)
  // 파란색 강도 0.05 ~ 0.55
  const alpha = 0.05 + ratio * 0.5
  return `rgba(59, 130, 246, ${alpha})`
}

export default function ExperimentDetailModal({ runId, onClose, activeModel, aiUrl, onDelete }: Props) {
  const [exp, setExp] = useState<AIExperiment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // 비교 기준 모델의 메트릭
  const baseMetrics = (activeModel?.metrics || {}) as Record<string, any>
  const isComparing = activeModel && activeModel.run_id !== runId

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await adminApi.getExperiment(runId)
        if (alive) setExp(res)
      } catch (e: any) {
        if (alive) setError(e.message || '실험 상세 로드 실패')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [runId])

  const metrics = (exp?.metrics || {}) as Record<string, any>
  const cmRaw = metrics.confusion_matrix
  const cmLabels: string[] =
    Array.isArray(metrics.confusion_matrix_labels) && metrics.confusion_matrix_labels.length > 0
      ? (metrics.confusion_matrix_labels as string[])
      : CLASS_LABELS
  // CM 이 객체인 경우 (label → row) 도 대응
  const cm: number[][] | null = Array.isArray(cmRaw)
    ? (cmRaw as number[][])
    : cmRaw && typeof cmRaw === 'object'
    ? cmLabels.map((lab) => (cmRaw as Record<string, number[]>)[lab] || [])
    : null
  const cmMax = cm ? Math.max(...cm.flat(), 0) : 0

  const perClass = metrics.per_class as
    | Record<string, { precision: number; recall: number; f1: number; support: number }>
    | undefined

  // train_info 는 백엔드가 [k: string]: unknown 로 내려줌
  const trainInfo = (exp as any)?.train_info as
    | {
        train_files?: string[] | number
        val_files?: string[] | number
        test_files?: string[] | number
        train_rows?: number
        val_rows?: number
        test_rows?: number
        training_time_seconds?: number
      }
    | undefined

  // 파일 수: 배열이면 length, 숫자면 그대로
  const fileCount = (v: any): number | null => {
    if (Array.isArray(v)) return v.length
    if (typeof v === 'number') return v
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">실험 상세</h2>
            <div className="text-xs font-mono text-white/50">{runId}</div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xl leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {loading && (
            <div className="text-center text-white/40 text-sm py-8">불러오는 중…</div>
          )}
          {error && (
            <div className="card p-3 border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-300 text-sm">
              {error}
            </div>
          )}
          {exp && !loading && (
            <>
              {/* 메타 정보 */}
              <section>
                <h3 className="text-sm font-semibold text-white/70 mb-2">기본 정보</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-white/40">모델 버전</div>
                    <div className="font-mono">{exp.model_version || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/40">알고리즘</div>
                    <div>{exp.algorithm || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/40">학습 시각</div>
                    <div>{fmt(exp.trained_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/40">배포 시각</div>
                    <div>{fmt(exp.deployed_at)}</div>
                  </div>
                </div>
              </section>

              {/* 학습/검증/테스트 분할 */}
              {trainInfo && (
                <section>
                  <h3 className="text-sm font-semibold text-white/70 mb-2">
                    학습 / 검증 / 테스트 분할
                  </h3>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <SplitCard
                      label="Train"
                      files={fileCount(trainInfo.train_files)}
                      rows={trainInfo.train_rows}
                      colorClass="text-emerald-600 dark:text-emerald-300"
                    />
                    <SplitCard
                      label="Val"
                      files={fileCount(trainInfo.val_files)}
                      rows={trainInfo.val_rows}
                      colorClass="text-amber-600 dark:text-amber-300"
                    />
                    <SplitCard
                      label="Test"
                      files={fileCount(trainInfo.test_files)}
                      rows={trainInfo.test_rows}
                      colorClass="text-blue-600 dark:text-blue-300"
                    />
                  </div>
                  {trainInfo.training_time_seconds != null && (
                    <p className="mt-2 text-xs text-white/50">
                      학습 소요 시간:{' '}
                      <span className="font-mono">
                        {trainInfo.training_time_seconds.toFixed(1)} s
                      </span>
                    </p>
                  )}
                </section>
              )}

              {/* 메트릭 */}
              <section>
                <h3 className="text-sm font-semibold text-white/70 mb-2">
                  성능 지표
                  {isComparing && (
                    <span className="ml-2 text-[10px] font-normal text-white/40">
                      (vs 운영 모델: {activeModel?.model_version || activeModel?.run_id?.slice(0, 12)})
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    ['Accuracy', metrics.accuracy, baseMetrics.accuracy],
                    ['Precision', metrics.precision ?? metrics.precision_macro, baseMetrics.precision ?? baseMetrics.precision_macro],
                    ['Recall', metrics.recall ?? metrics.recall_macro, baseMetrics.recall ?? baseMetrics.recall_macro],
                    ['F1', metrics.f1 ?? metrics.f1_macro, baseMetrics.f1 ?? baseMetrics.f1_macro],
                  ].map(([label, v, baseV]) => {
                    const comparison = isComparing ? comparePct(v, baseV) : null
                    return (
                      <div
                        key={label as string}
                        className="rounded-md border border-white/10 bg-white/5 p-3"
                      >
                        <div className="text-xs text-white/40">{label as string}</div>
                        <div className="text-lg font-semibold mt-1">
                          {pct(v)}
                          {comparison && <MetricCompare direction={comparison.direction} diff={comparison.diff} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* 클래스별 성능 (오분류 분석 핵심) */}
              {perClass && Object.keys(perClass).length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-white/70 mb-2">
                    클래스별 성능
                  </h3>
                  <div className="overflow-auto rounded-md border border-white/10">
                    <table className="w-full text-xs">
                      <thead className="bg-white/[0.04]">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-white/60">
                            클래스
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-white/60">
                            Precision
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-white/60">
                            Recall
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-white/60">
                            F1
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-white/60">
                            Support
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {cmLabels.map((cls) => {
                          const m = perClass[cls]
                          if (!m) return null
                          return (
                            <tr key={cls} className="border-t border-white/5">
                              <td className="px-3 py-1.5 font-mono">{cls}</td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {pct(m.precision)}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {pct(m.recall)}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {pct(m.f1)}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-white/60">
                                {m.support}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Confusion Matrix (라벨 + 색상 강조) */}
              {cm && cm.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-white/70 mb-2">
                    Confusion Matrix
                    <span className="ml-2 text-[10px] font-normal text-white/40">
                      (행 = 실제, 열 = 예측)
                    </span>
                  </h3>
                  <div className="overflow-auto rounded-md border border-white/10">
                    <table className="text-xs font-mono">
                      <thead>
                        <tr>
                          <th className="px-2 py-1.5 bg-white/[0.04] text-white/40 text-[10px] uppercase">
                            실제 \ 예측
                          </th>
                          {cmLabels.map((lab) => (
                            <th
                              key={lab}
                              className="px-3 py-1.5 bg-white/[0.04] text-white/60 font-semibold"
                            >
                              {lab}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cm.map((row, i) => (
                          <tr key={i}>
                            <th className="px-3 py-1.5 bg-white/[0.04] text-white/60 font-semibold text-left">
                              {cmLabels[i] || `class_${i}`}
                            </th>
                            {row.map((v, j) => {
                              const isDiagonal = i === j
                              return (
                                <td
                                  key={j}
                                  className="px-3 py-1.5 text-right border-l border-white/5"
                                  style={{ backgroundColor: cmColor(v, cmMax) }}
                                  title={`실제 ${cmLabels[i]} → 예측 ${cmLabels[j]}: ${v}`}
                                >
                                  <span
                                    className={
                                      isDiagonal
                                        ? 'text-emerald-700 dark:text-emerald-200 font-semibold'
                                        : v > 0
                                        ? 'text-amber-700 dark:text-amber-200'
                                        : 'text-white/30'
                                    }
                                  >
                                    {v}
                                  </span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[10px] text-white/40">
                    대각선(녹색) = 정분류 · 비대각선(주황) = 오분류
                  </p>
                </section>
              )}

              {/* 하이퍼파라미터 */}
              {exp.hyperparameters && Object.keys(exp.hyperparameters).length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-white/70 mb-2">
                    하이퍼파라미터
                  </h3>
                  <pre className="text-xs font-mono text-white/70 rounded-md border border-white/10 bg-navy-950 p-3 overflow-auto max-h-48">
                    {JSON.stringify(exp.hyperparameters, null, 2)}
                  </pre>
                </section>
              )}

              {exp.notes && (
                <section>
                  <h3 className="text-sm font-semibold text-white/70 mb-2">메모</h3>
                  <p className="text-sm text-white/60">{exp.notes}</p>
                </section>
              )}
            </>
          )}
        </div>

        <div className="border-t border-white/10 p-4 flex justify-between">
          <div className="flex items-center gap-2">
            {(() => {
              const isActiveModel = activeModel && activeModel.run_id === runId
              if (isActiveModel) {
                return (
                  <span className="text-xs text-white/40">
                    운영 중인 모델은 삭제할 수 없습니다
                  </span>
                )
              }
              if (onDelete && exp) {
                return (
                  <button
                    onClick={async () => {
                      const modelName = exp.model_version || exp.run_id
                      if (!confirm(`'${modelName}' 모델을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
                        return
                      }
                      setDeleting(true)
                      try {
                        const success = await onDelete(runId)
                        if (success) {
                          onClose()
                        }
                      } finally {
                        setDeleting(false)
                      }
                    }}
                    disabled={deleting}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-500/20 disabled:opacity-50 transition"
                  >
                    {deleting ? '삭제 중...' : '🗑️ 모델 삭제'}
                  </button>
                )
              }
              return null
            })()}
          </div>
          <div className="flex items-center gap-2">
            {aiUrl && exp && (
              <button
                onClick={async () => {
                  setDownloading(true)
                  try {
                    const response = await fetch(`${aiUrl}/api/mlops/models/${runId}/download`)
                    if (!response.ok) {
                      const errData = await response.json().catch(() => ({}))
                      throw new Error(errData.detail || errData.message || `HTTP ${response.status}`)
                    }
                    const blob = await response.blob()
                    const filename = `model_${exp.model_version || runId}.pkl`
                    const url = window.URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = filename
                    document.body.appendChild(a)
                    a.click()
                    window.URL.revokeObjectURL(url)
                    document.body.removeChild(a)
                  } catch (err: any) {
                    alert(err.message || '모델 다운로드 실패')
                  } finally {
                    setDownloading(false)
                  }
                }}
                disabled={downloading}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 border border-white/20 hover:bg-white/20 disabled:opacity-50 transition"
              >
                {downloading ? '다운로드 중...' : '⬇️ 모델 다운로드'}
              </button>
            )}
            <SmallBtn onClick={onClose}>닫기</SmallBtn>
          </div>
        </div>
      </div>
    </div>
  )
}

function SplitCard({
  label,
  files,
  rows,
  colorClass,
}: {
  label: string
  files: number | null
  rows?: number
  colorClass: string
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-3">
      <div className={`text-xs ${colorClass} font-semibold`}>{label}</div>
      <div className="mt-1 text-base font-semibold">
        {files != null ? files : '—'}{' '}
        <span className="text-xs text-white/50 font-normal">파일</span>
      </div>
      <div className="text-xs text-white/50 font-mono mt-0.5">
        {rows != null ? rows.toLocaleString() : '—'} rows
      </div>
    </div>
  )
}
