'use client'

import { useEffect, useState } from 'react'
import { adminApi, AIExperiment } from '@/lib/api'
import { SmallBtn } from '@/components/admin/AdminUI'

interface Props {
  runId: string
  onClose: () => void
}

function pct(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR')
  } catch {
    return iso
  }
}

export default function ExperimentDetailModal({ runId, onClose }: Props) {
  const [exp, setExp] = useState<AIExperiment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const metrics = exp?.metrics || {}
  const cm = metrics.confusion_matrix as number[][] | undefined

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
            <div className="card p-3 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
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

              {/* 메트릭 */}
              <section>
                <h3 className="text-sm font-semibold text-white/70 mb-2">성능 지표</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    ['Accuracy', metrics.accuracy],
                    ['F1', metrics.f1],
                    ['Precision', metrics.precision],
                    ['Recall', metrics.recall],
                  ].map(([label, v]) => (
                    <div
                      key={label as string}
                      className="rounded-md border border-white/10 bg-white/5 p-3"
                    >
                      <div className="text-xs text-white/40">{label as string}</div>
                      <div className="text-lg font-semibold mt-1">{pct(v)}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Confusion Matrix */}
              {Array.isArray(cm) && cm.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-white/70 mb-2">
                    Confusion Matrix
                  </h3>
                  <div className="overflow-auto rounded-md border border-white/10">
                    <table className="text-xs font-mono">
                      <tbody>
                        {cm.map((row, i) => (
                          <tr key={i}>
                            {row.map((v, j) => (
                              <td
                                key={j}
                                className="px-3 py-1.5 text-right border border-white/5 bg-white/[0.02]"
                              >
                                {v}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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

        <div className="border-t border-white/10 p-4 flex justify-end">
          <SmallBtn onClick={onClose}>닫기</SmallBtn>
        </div>
      </div>
    </div>
  )
}
