'use client'

import { useEffect, useState } from 'react'
import { DatasetMeta } from './DatasetsPanel'

interface Props {
  aiUrl: string
  onSelect: (dataset: DatasetMeta) => void
  onClose: () => void
}

export default function DatasetSelectModal({ aiUrl, onSelect, onClose }: Props) {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${aiUrl}/api/mlops/datasets`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setDatasets(data.meta?.datasets || [])
      } catch (e: any) {
        setError(e.message || '데이터셋 목록 로드 실패')
      } finally {
        setLoading(false)
      }
    })()
  }, [aiUrl])

  const selectedDataset = datasets.find((d) => d.id === selectedId) || null

  const handleConfirm = () => {
    if (selectedDataset) {
      onSelect(selectedDataset)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-navy-800 border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold">데이터 전처리</h2>
          <p className="text-sm text-white/50 mt-1">전처리할 데이터셋을 선택하세요</p>
        </div>

        {/* Process Explanation */}
        <div className="px-6 py-4 border-b border-white/10 bg-white/5">
          <h3 className="text-sm font-semibold text-white/80 mb-2">전처리 과정</h3>
          <ol className="text-xs text-white/60 space-y-1.5 list-decimal list-inside">
            <li><b className="text-white/80">DXF 파싱</b> — 업로드된 DXF 파일에서 레이어/엔티티 추출</li>
            <li><b className="text-white/80">이미지 변환</b> — DXF를 PNG 이미지로 렌더링</li>
            <li><b className="text-white/80">자동 라벨링</b> — 레이어명 기반으로 클래스 라벨 생성</li>
            <li><b className="text-white/80">CSV 생성</b> — 학습용 labeled 데이터셋 구축</li>
          </ol>
          <p className="text-xs text-white/40 mt-2">
            전처리 완료 후 "모델 재학습" 버튼으로 학습을 시작할 수 있습니다.
          </p>
        </div>

        {/* Dataset List */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <h3 className="text-sm font-semibold text-white/80 mb-3">데이터셋 선택</h3>

          {loading && (
            <div className="text-center text-white/40 text-sm py-8">불러오는 중...</div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && datasets.length === 0 && (
            <div className="text-center text-white/40 text-sm py-8">
              등록된 데이터셋이 없습니다.<br />
              먼저 "DXF 데이터셋 업로드"로 데이터셋을 등록하세요.
            </div>
          )}

          {!loading && datasets.length > 0 && (
            <div className="space-y-2">
              {datasets
                .slice()
                .reverse()
                .map((ds) => {
                  const isSelected = selectedId === ds.id
                  return (
                    <div
                      key={ds.id}
                      onClick={() => setSelectedId(ds.id || null)}
                      className={`cursor-pointer rounded-lg border p-3 transition-all ${
                        isSelected
                          ? 'border-brand-400/60 bg-brand-500/15 ring-1 ring-brand-400/40'
                          : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isSelected
                                ? 'border-brand-400 bg-brand-500'
                                : 'border-white/30'
                            }`}
                          >
                            {isSelected && (
                              <div className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-sm">
                              {ds.name || ds.id || '이름 없음'}
                            </div>
                            <div className="text-[11px] text-white/50 font-mono mt-0.5">
                              {ds.dxf_dir || '경로 없음'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right text-xs text-white/50">
                          <div>{ds.dxf_count ?? '—'} DXF</div>
                          <div>{ds.size_mb ?? '—'} MB</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={!selectedDataset}
          >
            {selectedDataset
              ? `'${selectedDataset.name || selectedDataset.id}' 전처리 시작`
              : '데이터셋을 선택하세요'}
          </button>
        </div>
      </div>
    </div>
  )
}
