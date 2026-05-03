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
  /** kind=collect 일 때 dxf_dir 입력란을 prefill (업로드 모달에서 넘겨받음) */
  prefillDxfDir?: string | null
  onClose: () => void
  onCompleted?: (info: { run_id?: string; job_id?: string }) => void
}

// 분할 비율 프리셋
const SPLIT_PRESETS: Array<{ label: string; train: number; val: number }> = [
  { label: '7 : 1.5 : 1.5  (기본)', train: 0.70, val: 0.15 },
  { label: '8 : 1 : 1', train: 0.80, val: 0.10 },
  { label: '7 : 2 : 1', train: 0.70, val: 0.20 },
  { label: '6 : 2 : 2', train: 0.60, val: 0.20 },
  { label: '5 : 2.5 : 2.5', train: 0.50, val: 0.25 },
]

export default function AIJobModal({ kind, aiUrl, prefillDxfDir, onClose, onCompleted }: Props) {
  // 재학습 파라미터
  const [runId, setRunId] = useState('')
  const [maxIter, setMaxIter] = useState(200)
  const [maxDepth, setMaxDepth] = useState(7)
  const [learningRate, setLearningRate] = useState(0.08)
  const [trainRatio, setTrainRatio] = useState(0.70)
  const [valRatio, setValRatio] = useState(0.15)

  // 재수집 파라미터
  const [dxfDir, setDxfDir] = useState(prefillDxfDir || '')
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
              train_ratio: Number(trainRatio),
              val_ratio: Number(valRatio),
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

            {/* 학습/검증/테스트 분할 비율 (교수님 지적사항 #3) */}
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white/80">
                    학습 / 검증 / 테스트 분할 비율
                  </div>
                  <div className="text-[10px] text-white/50 mt-0.5">
                    파일 단위 split. 비율을 바꿔가며 성능 비교 가능
                  </div>
                </div>
                <span className="text-xs font-mono text-blue-300">
                  {(trainRatio * 100).toFixed(0)} :{' '}
                  {(valRatio * 100).toFixed(0)} :{' '}
                  {((1 - trainRatio - valRatio) * 100).toFixed(0)}
                </span>
              </div>

              {/* 프리셋 버튼들 */}
              <div className="flex flex-wrap gap-1.5">
                {SPLIT_PRESETS.map((p) => {
                  const active =
                    Math.abs(trainRatio - p.train) < 0.005 &&
                    Math.abs(valRatio - p.val) < 0.005
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setTrainRatio(p.train)
                        setValRatio(p.val)
                      }}
                      className={`px-2 py-1 text-[10px] font-mono rounded border ${
                        active
                          ? 'bg-blue-500/30 border-blue-400/60 text-blue-100'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>

              {/* 직접 입력 (소수) */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] text-emerald-300 mb-0.5">
                    Train
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="0.95"
                    value={trainRatio}
                    onChange={(e) => setTrainRatio(Number(e.target.value))}
                    className="input-field text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-amber-300 mb-0.5">
                    Val
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="0.5"
                    value={valRatio}
                    onChange={(e) => setValRatio(Number(e.target.value))}
                    className="input-field text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-blue-300 mb-0.5">
                    Test (자동)
                  </label>
                  <input
                    type="number"
                    value={(1 - trainRatio - valRatio).toFixed(2)}
                    disabled
                    className="input-field text-xs opacity-50"
                  />
                </div>
              </div>
              {(trainRatio + valRatio >= 1 || trainRatio <= 0) && (
                <p className="text-[10px] text-red-300">
                  ⚠ 잘못된 비율입니다 (train+val &lt; 1, train &gt; 0)
                </p>
              )}
            </div>
          </div>
        )}

        {!response && kind === 'collect' && (
          <div className="space-y-3">
            {prefillDxfDir ? (
              <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/30 rounded p-2">
                ✅ 방금 업로드한 데이터셋 경로가 자동 입력되었습니다. 그대로 시작하면 됩니다.
              </div>
            ) : (
              <div className="text-xs text-sky-300 bg-sky-500/10 border border-sky-400/30 rounded p-2">
                ℹ 경로는 <b>학과 AI 서버(Linux)</b> 의 절대 경로입니다. 본인 PC 경로(C:\…) 가 아닙니다.
              </div>
            )}
            <Field label="DXF 디렉토리 (비우면 기본값 ~/데이터셋1-dxf/dxf 사용)">
              <input
                value={dxfDir}
                onChange={(e) => setDxfDir(e.target.value)}
                placeholder="(비워두면 기본 데이터셋 — 보통 이대로 두면 됩니다)"
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
