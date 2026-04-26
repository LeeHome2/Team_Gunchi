'use client'

/**
 * AI 서버 작업 트리거 모달.
 *
 * 학과 AI 서버(http://ceprj2.gachon.ac.kr:65006)의
 *   - POST /api/mlops/train          (모델 재학습)
 *   - POST /api/mlops/datasets/build (데이터 재수집)
 * 를 직접 호출한다 (CORS 허용 상태).
 *
 * 응답으로 받은 run_id 또는 job_id 로 로그/상태를 폴링할 수 있다.
 */
import { useEffect, useState } from 'react'

type ModalKind = 'retrain' | 'collect'

interface Props {
  kind: ModalKind
  aiUrl: string                     // ex) http://ceprj2.gachon.ac.kr:65006
  onClose: () => void
  onCompleted?: (info: { run_id?: string; job_id?: string }) => void
}

export default function AIJobModal({ kind, aiUrl, onClose, onCompleted }: Props) {
  // 재학습 파라미터
  const [runId, setRunId] = useState('')
  const [maxIter, setMaxIter] = useState(200)
  const [maxDepth, setMaxDepth] = useState(7)
  const [learningRate, setLearningRate] = useState(0.08)

  // 재수집 파라미터
  const [dxfDir, setDxfDir] = useState('')
  const [mock, setMock] = useState(false)
  const [limit, setLimit] = useState<number | ''>('')

  // 진행 상태
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<any>(null)
  const [logTail, setLogTail] = useState<string[]>([])
  const [polling, setPolling] = useState(false)

  // 응답 받은 후 로그 폴링
  useEffect(() => {
    if (!response?.run_id && !response?.job_id) return
    const id = response.run_id || response.job_id
    setPolling(true)
    let cancelled = false
    const tick = async () => {
      try {
        const r = await fetch(`${aiUrl}/api/mlops/jobs/${id}/log?tail=80`)
        if (r.ok) {
          const d = await r.json()
          if (!cancelled) setLogTail(d.tail || [])
        }
      } catch {}
    }
    tick()
    const interval = setInterval(tick, 2500)
    return () => {
      cancelled = true
      clearInterval(interval)
      setPolling(false)
    }
  }, [response, aiUrl])

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    setResponse(null)
    setLogTail([])
    try {
      const url =
        kind === 'retrain'
          ? `${aiUrl}/api/mlops/train`
          : `${aiUrl}/api/mlops/datasets/build`
      const body: Record<string, any> =
        kind === 'retrain'
          ? {
              run_id: runId || undefined,
              max_iter: Number(maxIter),
              max_depth: Number(maxDepth),
              learning_rate: Number(learningRate),
            }
          : {
              dxf_dir: dxfDir || undefined,
              mock,
              limit: limit === '' ? undefined : Number(limit),
            }
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok || data.success === false) {
        throw new Error(data.error || data.detail || `HTTP ${r.status}`)
      }
      setResponse(data)
      onCompleted?.(data)
    } catch (e: any) {
      setError(e?.message || '요청 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const title = kind === 'retrain' ? '🎯 모델 재학습' : '📦 데이터 재수집'
  const description =
    kind === 'retrain'
      ? '학과 AI 서버의 train.py 를 호출해 새 모델을 학습합니다.'
      : 'build_training_dataset.py 를 호출해 DXF→CSV→bbox→crop→label 전체 파이프라인 실행합니다.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 m-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-xs text-white/50 mt-1">{description}</p>
            <p className="text-xs text-white/40 mt-1 font-mono">{aiUrl}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-2xl leading-none">
            ×
          </button>
        </div>

        {/* 파라미터 입력 */}
        {!response && kind === 'retrain' && (
          <div className="space-y-3">
            <Field label="Run ID (비우면 자동 생성)">
              <input
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                placeholder="v_demo_2026..."
                className="input-field font-mono text-sm"
              />
            </Field>
            <Grid3>
              <Field label="Max Iter">
                <input
                  type="number"
                  value={maxIter}
                  onChange={(e) => setMaxIter(Number(e.target.value))}
                  className="input-field"
                />
              </Field>
              <Field label="Max Depth">
                <input
                  type="number"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  className="input-field"
                />
              </Field>
              <Field label="Learning Rate">
                <input
                  type="number"
                  step="0.01"
                  value={learningRate}
                  onChange={(e) => setLearningRate(Number(e.target.value))}
                  className="input-field"
                />
              </Field>
            </Grid3>
          </div>
        )}

        {!response && kind === 'collect' && (
          <div className="space-y-3">
            <Field label="DXF 디렉토리 (비우면 기본 ~/데이터셋1-dxf/dxf)">
              <input
                value={dxfDir}
                onChange={(e) => setDxfDir(e.target.value)}
                placeholder="/home/t26206/데이터셋1-dxf/dxf"
                className="input-field font-mono text-sm"
              />
            </Field>
            <Grid3>
              <Field label="Mock 모드 (vLLM 호출 없이)">
                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={mock}
                    onChange={(e) => setMock(e.target.checked)}
                  />
                  <span className="text-sm text-white/70">활성화</span>
                </label>
              </Field>
              <Field label="처리 개수 제한 (디버그)">
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="(전체)"
                  className="input-field"
                />
              </Field>
              <div />
            </Grid3>
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">
              ⚠ Mock 끄면 학과 vLLM Vision API 호출 (토큰 소모, ~80k for 98 files)
            </div>
          </div>
        )}

        {/* 액션 */}
        {!response && (
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onClose} className="btn-secondary text-sm">
              취소
            </button>
            <button onClick={submit} disabled={submitting} className="btn-primary text-sm">
              {submitting ? '시작 중...' : kind === 'retrain' ? '학습 시작' : '빌드 시작'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* 응답 + 로그 폴링 */}
        {response && (
          <div className="space-y-3">
            <div className="px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
              ✅ {response.message || '시작됨'}
            </div>
            <Grid3>
              <Field label="ID">
                <div className="font-mono text-xs break-all">
                  {response.run_id || response.job_id}
                </div>
              </Field>
              <Field label="PID">
                <div className="font-mono text-xs">{response.pid}</div>
              </Field>
              <Field label="로그">
                <div className="font-mono text-[10px] break-all text-white/50">
                  {response.log_path}
                </div>
              </Field>
            </Grid3>

            <div>
              <div className="text-xs text-white/60 mb-1 flex items-center gap-2">
                실시간 로그 {polling && <span className="text-emerald-300">●</span>}
              </div>
              <pre className="bg-black/60 rounded p-2 text-[11px] max-h-64 overflow-y-auto font-mono whitespace-pre-wrap break-all">
                {logTail.length > 0 ? logTail.join('\n') : '로그 로딩 중...'}
              </pre>
            </div>

            <div className="flex justify-end">
              <button onClick={onClose} className="btn-secondary text-sm">
                닫기 (작업은 백그라운드에서 계속)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-white/60 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>
}
