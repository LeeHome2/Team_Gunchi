'use client'

import { useEffect, useState } from 'react'

interface StageInfo {
  label: string
  path: string
  exists: boolean
  count: number
  size_mb: number
  last_modified: number | null
}

interface ProcessedDataset {
  id: string
  name: string
  source_dataset?: string
  processed_at?: string
  image_count?: number
  labeled_count?: number
  csv_path?: string
  size_mb?: number
  status: 'ready' | 'processing' | 'failed'
}

interface Props {
  aiUrl: string
  refreshKey?: number
  selectedDatasetId?: string | null
  onSelectDataset?: (dataset: ProcessedDataset | null) => void
}

function fmtTime(t: number | null): string {
  if (!t) return '—'
  try {
    return new Date(t * 1000).toLocaleString('ko-KR')
  } catch {
    return '—'
  }
}

export default function ProcessedDatasetsPanel({
  aiUrl,
  refreshKey = 0,
  selectedDatasetId = null,
  onSelectDataset,
}: Props) {
  const [stages, setStages] = useState<StageInfo[]>([])
  const [processedDatasets, setProcessedDatasets] = useState<ProcessedDataset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        // 파이프라인 단계 정보 가져오기
        const res = await fetch(`${aiUrl}/api/mlops/datasets`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        if (alive) {
          setStages(data.stages || [])

          // labeled 단계에서 전처리 완료된 데이터셋 정보 추출
          // (실제 API에서 processed_datasets를 반환하면 그것을 사용)
          if (data.processed_datasets) {
            setProcessedDatasets(data.processed_datasets)
          } else {
            // stages에서 labeled 데이터가 있으면 가상의 데이터셋 생성
            const labeledStage = data.stages?.find((s: StageInfo) =>
              s.label.toLowerCase().includes('labeled') || s.label.toLowerCase().includes('라벨')
            )
            const processedStage = data.stages?.find((s: StageInfo) =>
              s.label.toLowerCase().includes('processed') || s.label.toLowerCase().includes('처리')
            )

            const datasets: ProcessedDataset[] = []

            if (labeledStage && labeledStage.count > 0) {
              datasets.push({
                id: 'labeled_default',
                name: '라벨링 완료 데이터셋',
                processed_at: labeledStage.last_modified
                  ? new Date(labeledStage.last_modified * 1000).toISOString()
                  : undefined,
                labeled_count: labeledStage.count,
                csv_path: labeledStage.path,
                size_mb: labeledStage.size_mb,
                status: 'ready',
              })
            }

            if (processedStage && processedStage.count > 0 && !labeledStage?.count) {
              datasets.push({
                id: 'processed_default',
                name: '이미지 변환 완료',
                processed_at: processedStage.last_modified
                  ? new Date(processedStage.last_modified * 1000).toISOString()
                  : undefined,
                image_count: processedStage.count,
                size_mb: processedStage.size_mb,
                status: 'ready',
              })
            }

            setProcessedDatasets(datasets)
          }
        }
      } catch (e: any) {
        if (alive) setError(e.message || '전처리 데이터 로드 실패')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [aiUrl, refreshKey])

  const labeledStage = stages.find(s =>
    s.label.toLowerCase().includes('labeled') || s.label.toLowerCase().includes('라벨')
  )
  const hasLabeledData = labeledStage && labeledStage.count > 0

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">전처리 완료 데이터</h3>
          <p className="text-xs text-white/40 mt-1">
            모델 학습에 사용할 수 있는 라벨링된 데이터셋
          </p>
        </div>
        {hasLabeledData && (
          <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-3 py-1 text-xs font-semibold text-emerald-300">
            학습 가능
          </span>
        )}
      </div>

      {loading && (
        <div className="text-center text-white/40 text-sm py-4">불러오는 중...</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {/* 파이프라인 단계 요약 */}
          <div className="grid grid-cols-4 gap-3">
            {stages.map((stage, i) => {
              const isOk = stage.exists && stage.count > 0
              return (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    isOk
                      ? 'border-emerald-400/30 bg-emerald-500/5'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="text-xs text-white/50 mb-1">{stage.label}</div>
                  <div className="text-lg font-semibold">
                    {stage.count.toLocaleString()}
                    <span className="text-xs text-white/40 font-normal ml-1">개</span>
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">
                    {stage.size_mb} MB
                  </div>
                </div>
              )
            })}
          </div>

          {/* 전처리 완료 데이터셋 목록 */}
          {processedDatasets.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-xs uppercase tracking-wide text-white/50 font-semibold mb-3">
                학습용 데이터셋 ({processedDatasets.length}개)
              </h4>
              <div className="space-y-2">
                {processedDatasets.map((ds) => {
                  const isSelected = selectedDatasetId === ds.id
                  return (
                    <div
                      key={ds.id}
                      onClick={() => onSelectDataset?.(isSelected ? null : ds)}
                      className={`cursor-pointer rounded-lg border p-4 transition-all ${
                        isSelected
                          ? 'border-brand-400/60 bg-brand-500/15 ring-1 ring-brand-400/40'
                          : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              isSelected
                                ? 'border-brand-400 bg-brand-500'
                                : 'border-white/30'
                            }`}
                          >
                            {isSelected && (
                              <div className="w-2.5 h-2.5 rounded-full bg-white" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-sm flex items-center gap-2">
                              {ds.name}
                              {ds.status === 'ready' && (
                                <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                  READY
                                </span>
                              )}
                              {ds.status === 'processing' && (
                                <span className="rounded-full bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                  처리 중
                                </span>
                              )}
                            </div>
                            {ds.csv_path && (
                              <div className="text-[11px] text-white/40 font-mono mt-0.5">
                                {ds.csv_path}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          {ds.labeled_count != null && (
                            <div>
                              <span className="font-semibold text-emerald-300">
                                {ds.labeled_count.toLocaleString()}
                              </span>
                              <span className="text-white/40 ml-1">라벨</span>
                            </div>
                          )}
                          {ds.image_count != null && (
                            <div>
                              <span className="font-semibold">
                                {ds.image_count.toLocaleString()}
                              </span>
                              <span className="text-white/40 ml-1">이미지</span>
                            </div>
                          )}
                          {ds.size_mb != null && (
                            <div className="text-white/40">{ds.size_mb} MB</div>
                          )}
                        </div>
                      </div>
                      {ds.processed_at && (
                        <div className="mt-2 text-[11px] text-white/40">
                          처리 완료: {new Date(ds.processed_at).toLocaleString('ko-KR')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mt-4 p-6 rounded-lg border border-white/10 bg-white/5 text-center">
              <div className="text-white/40 text-sm mb-2">
                전처리 완료된 데이터셋이 없습니다
              </div>
              <p className="text-xs text-white/30">
                위에서 데이터셋을 선택하고 "🔄 데이터 전처리" 버튼을 눌러<br />
                DXF 파일을 이미지로 변환하고 라벨링하세요.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export type { ProcessedDataset }
