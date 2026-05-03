'use client'

/**
 * 학과 AI 서버의 GET /api/mlops/datasets 응답을 시각화.
 *
 * 표시:
 *   - 파이프라인 단계별 통계 (raw_dxf, processed, labeled 등)
 *   - 등록된 데이터셋 버전 목록 (configs/dataset_meta.json)
 *   - 가장 최근 학습의 train/val/test 분할
 *
 * 진도표 항목:
 *   - 학습 데이터셋 등록 기능
 *   - 데이터셋 버전관리 기능
 *   - 학습/검증/테스트 분할 생성 기능
 */
import { useEffect, useRef, useState } from 'react'

interface StageInfo {
  label: string
  path: string
  exists: boolean
  count: number
  size_mb: number
  last_modified: number | null
}

interface DatasetMeta {
  id?: string
  name?: string
  source?: string
  uploaded_at?: string
  uploaded_filename?: string
  dxf_dir?: string
  dxf_count?: number
  size_mb?: number
}

interface DatasetsResponse {
  stages: StageInfo[]
  meta: { datasets?: DatasetMeta[] }
  latest_split: {
    run_id?: string
    created_at?: string | null
    train_files?: number | null
    val_files?: number | null
    test_files?: number | null
    train_rows?: number | null
    val_rows?: number | null
    test_rows?: number | null
    training_time_seconds?: number | null
  } | null
}

interface Props {
  aiUrl: string
  refreshKey?: number  // 부모가 갱신 트리거 가능
  /** 강조할 데이터셋 ID (방금 업로드한 항목 등). 일치하면 행 highlight + NEW 배지 + scrollIntoView */
  highlightDatasetId?: string | null
}

function fmtTime(t: number | null): string {
  if (!t) return '—'
  try {
    return new Date(t * 1000).toLocaleString('ko-KR')
  } catch {
    return '—'
  }
}

export default function DatasetsPanel({
  aiUrl,
  refreshKey = 0,
  highlightDatasetId = null,
}: Props) {
  const [data, setData] = useState<DatasetsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)

  // highlightDatasetId 가 들어오면 해당 행으로 스크롤
  useEffect(() => {
    if (!highlightDatasetId || !highlightRowRef.current) return
    const t = setTimeout(() => {
      highlightRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    return () => clearTimeout(t)
  }, [highlightDatasetId, data])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const r = await fetch(`${aiUrl}/api/mlops/datasets`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = await r.json()
        if (alive) setData(d)
      } catch (e: any) {
        if (alive) setError(e.message || '데이터셋 정보 로드 실패')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [aiUrl, refreshKey])

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">데이터셋 / 분할</h3>
        <span className="text-xs text-white/40">
          {data?.meta?.datasets?.length ?? 0}개 등록 · 학과 AI 서버
        </span>
      </div>

      {loading && (
        <div className="text-center text-white/40 text-sm py-4">불러오는 중…</div>
      )}
      {error && (
        <div className="card p-3 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-5">
          {/* 단계별 통계 */}
          <div>
            <h4 className="text-xs uppercase tracking-wide text-white/50 font-semibold mb-2">
              파이프라인 단계
            </h4>
            <div className="overflow-auto rounded-md border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.04]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-white/60">단계</th>
                    <th className="px-3 py-2 text-right font-medium text-white/60">개수</th>
                    <th className="px-3 py-2 text-right font-medium text-white/60">크기</th>
                    <th className="px-3 py-2 text-left font-medium text-white/60">상태</th>
                    <th className="px-3 py-2 text-left font-medium text-white/60">
                      마지막 수정
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.stages.map((s, i) => {
                    const ok = s.exists && s.count > 0
                    return (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-3 py-1.5 text-white/80">{s.label}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          <span className="font-semibold">{s.count.toLocaleString()}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-white/60">
                          {s.size_mb} MB
                        </td>
                        <td className="px-3 py-1.5">
                          {ok ? (
                            <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                              OK
                            </span>
                          ) : (
                            <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/40">
                              EMPTY
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-white/40 text-[11px]">
                          {fmtTime(s.last_modified)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 등록된 데이터셋 목록 */}
          {data.meta?.datasets && data.meta.datasets.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wide text-white/50 font-semibold mb-2 flex items-center justify-between">
                <span>등록된 데이터셋 버전 ({data.meta.datasets.length}개)</span>
                {highlightDatasetId && (
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 normal-case tracking-normal">
                    ⬆ 방금 업로드된 항목 강조됨
                  </span>
                )}
              </h4>
              <div className="overflow-auto rounded-md border border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-white/[0.04]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-white/60">이름</th>
                      <th className="px-3 py-2 text-left font-medium text-white/60">소스</th>
                      <th className="px-3 py-2 text-right font-medium text-white/60">DXF</th>
                      <th className="px-3 py-2 text-right font-medium text-white/60">크기</th>
                      <th className="px-3 py-2 text-left font-medium text-white/60">등록 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.meta.datasets
                      .slice() // copy before reverse
                      .reverse() // 최신이 위로
                      .map((ds, i) => {
                        const isHighlighted =
                          !!highlightDatasetId && ds.id === highlightDatasetId
                        return (
                          <tr
                            key={ds.id || i}
                            ref={isHighlighted ? highlightRowRef : null}
                            className={
                              isHighlighted
                                ? 'border-t border-emerald-400/40 bg-emerald-500/10 ring-2 ring-emerald-400/40'
                                : 'border-t border-white/5'
                            }
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white text-sm">
                                  {ds.name || ds.id || '—'}
                                </span>
                                {isHighlighted && (
                                  <span className="rounded-full bg-emerald-500/25 border border-emerald-300/60 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200 uppercase">
                                    🆕 NEW
                                  </span>
                                )}
                              </div>
                              {ds.id && (
                                <div className="text-[10px] font-mono text-white/40 mt-0.5">
                                  {ds.id}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                                {ds.source || 'manual'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              {ds.dxf_count ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-white/60">
                              {ds.size_mb ?? '—'} MB
                            </td>
                            <td className="px-3 py-2 text-white/50 text-[11px]">
                              {ds.uploaded_at || '—'}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 최근 학습의 train/val/test 분할 */}
          <div>
            <h4 className="text-xs uppercase tracking-wide text-white/50 font-semibold mb-2">
              가장 최근 학습의 분할
              {data.latest_split?.run_id && (
                <span className="ml-2 text-[10px] font-mono normal-case text-blue-300">
                  {data.latest_split.run_id}
                </span>
              )}
            </h4>

            {data.latest_split ? (
              <div className="grid grid-cols-3 gap-3 text-sm">
                {[
                  {
                    name: 'Train',
                    files: data.latest_split.train_files,
                    rows: data.latest_split.train_rows,
                    color: 'text-emerald-300',
                  },
                  {
                    name: 'Val',
                    files: data.latest_split.val_files,
                    rows: data.latest_split.val_rows,
                    color: 'text-amber-300',
                  },
                  {
                    name: 'Test',
                    files: data.latest_split.test_files,
                    rows: data.latest_split.test_rows,
                    color: 'text-blue-300',
                  },
                ].map((s) => (
                  <div
                    key={s.name}
                    className="rounded-md border border-white/10 bg-white/5 p-3"
                  >
                    <div className={`text-xs ${s.color} font-semibold`}>{s.name}</div>
                    <div className="mt-1 text-base font-semibold">
                      {s.files ?? '—'}{' '}
                      <span className="text-xs text-white/50 font-normal">파일</span>
                    </div>
                    <div className="text-xs text-white/50 font-mono mt-0.5">
                      {s.rows != null ? s.rows.toLocaleString() : '—'} rows
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/40">아직 학습 이력이 없습니다.</p>
            )}

            {data.latest_split?.training_time_seconds != null && (
              <p className="mt-2 text-xs text-white/50">
                학습 소요:{' '}
                <span className="font-mono">
                  {data.latest_split.training_time_seconds.toFixed(1)} s
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
