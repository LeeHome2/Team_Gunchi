'use client'

import { useState } from 'react'

interface Entity {
  entity_id: string
  entity_type: string
  raw_layer: string
  length: number
  bbox_width: number
  bbox_height: number
  aspect_ratio: number
}

interface ClassifyResult {
  file_id: string
  model_version: string
  predictions: Array<{
    entity_id: string
    predicted_class: string
    confidence: number
    raw_layer?: string
  }>
  summary?: {
    total: number
    class_counts: Record<string, number>
  }
  error?: string
}

interface Props {
  aiUrl: string
}

// 기본 샘플 엔티티 (AI 서버 대시보드와 동일)
const DEFAULT_ENTITIES: Entity[] = [
  { entity_id: '1', entity_type: 'LINE', raw_layer: 'WALL', length: 3.5, bbox_width: 3.5, bbox_height: 0.01, aspect_ratio: 350 },
  { entity_id: '2', entity_type: 'ARC', raw_layer: 'DOOR', length: 1.5, bbox_width: 0.9, bbox_height: 0.9, aspect_ratio: 1.0 },
  { entity_id: '3', entity_type: 'LINE', raw_layer: 'WINDOW-ASAAS-0025', length: 1.2, bbox_width: 1.2, bbox_height: 0.01, aspect_ratio: 120 },
  { entity_id: '4', entity_type: 'LINE', raw_layer: 'BoundaryWall_Main', length: 5.0, bbox_width: 5.0, bbox_height: 0.01, aspect_ratio: 500 },
  { entity_id: '5', entity_type: 'TEXT', raw_layer: 'DIMENSIONS', length: 0, bbox_width: 2, bbox_height: 0.3, aspect_ratio: 6.7 },
]

export default function QuickClassifyPanel({ aiUrl }: Props) {
  const [entities, setEntities] = useState<Entity[]>(DEFAULT_ENTITIES)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ClassifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [jsonInput, setJsonInput] = useState('')

  const runClassify = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const payload = {
        file_id: 'admin_quick_test',
        entities,
        log_predictions: false,
      }

      const res = await fetch(`${aiUrl}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`)
      }

      setResult(data)
    } catch (e: any) {
      setError(e.message || '분류 요청 실패')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setEntities(DEFAULT_ENTITIES)
    setResult(null)
    setError(null)
    setEditMode(false)
  }

  const handleEditJson = () => {
    setJsonInput(JSON.stringify(entities, null, 2))
    setEditMode(true)
  }

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonInput)
      if (!Array.isArray(parsed)) {
        throw new Error('배열 형식이어야 합니다')
      }
      setEntities(parsed)
      setEditMode(false)
      setResult(null)
    } catch (e: any) {
      alert(`JSON 파싱 오류: ${e.message}`)
    }
  }

  const getClassColor = (cls: string) => {
    const colors: Record<string, string> = {
      WALL: 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-500/30',
      DOOR: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
      WINDOW: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
      STAIR: 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/30',
      COLUMN: 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/30',
      ETC: 'bg-gray-500/20 text-gray-600 dark:text-gray-300 border-gray-500/30',
    }
    return colors[cls] || colors.ETC
  }

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">🧪 Quick Classification Test</h3>
          <p className="text-xs text-white/50 mt-1">
            운영 모델로 엔티티 분류를 테스트하고 JSON 응답을 확인합니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editMode && (
            <>
              <button
                className="btn-secondary text-xs"
                onClick={handleEditJson}
              >
                ✏️ JSON 편집
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={handleReset}
              >
                ↻ 초기화
              </button>
            </>
          )}
        </div>
      </div>

      {/* 입력 엔티티 */}
      {!editMode ? (
        <div className="mb-4">
          <div className="text-xs text-white/60 mb-2">
            테스트 엔티티 ({entities.length}개)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/5">
                <tr className="text-white/50">
                  <th className="text-left px-2 py-1.5 font-medium">ID</th>
                  <th className="text-left px-2 py-1.5 font-medium">Type</th>
                  <th className="text-left px-2 py-1.5 font-medium">Layer</th>
                  <th className="text-right px-2 py-1.5 font-medium">Length</th>
                  <th className="text-right px-2 py-1.5 font-medium">W×H</th>
                  <th className="text-right px-2 py-1.5 font-medium">Aspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {entities.map((e, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-2 py-1.5 font-mono">{e.entity_id}</td>
                    <td className="px-2 py-1.5">{e.entity_type}</td>
                    <td className="px-2 py-1.5 font-mono text-white/70">{e.raw_layer}</td>
                    <td className="px-2 py-1.5 text-right">{e.length}</td>
                    <td className="px-2 py-1.5 text-right text-white/60">
                      {e.bbox_width}×{e.bbox_height}
                    </td>
                    <td className="px-2 py-1.5 text-right text-white/60">{e.aspect_ratio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <div className="text-xs text-white/60 mb-2">
            JSON 편집 (entities 배열)
          </div>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="w-full h-48 rounded-lg border border-white/10 bg-black/20 p-3 text-xs font-mono text-white/80 focus:outline-none focus:border-brand-400/50"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              className="btn-secondary text-xs"
              onClick={() => setEditMode(false)}
            >
              취소
            </button>
            <button
              className="btn-primary text-xs"
              onClick={handleApplyJson}
            >
              적용
            </button>
          </div>
        </div>
      )}

      {/* 실행 버튼 */}
      {!editMode && (
        <div className="flex items-center gap-3 mb-4">
          <button
            className="btn-primary"
            onClick={runClassify}
            disabled={loading || entities.length === 0}
          >
            {loading ? '추론 중...' : '▶ 분류 실행'}
          </button>
          <span className="text-xs text-white/40">
            POST {aiUrl}/api/classify
          </span>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 결과 */}
      {result && (
        <div className="space-y-4">
          {/* 요약 */}
          <div className="p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">
                ✅ 분류 완료
              </div>
              <div className="text-xs text-white/50 font-mono">
                모델: {result.model_version}
              </div>
            </div>

            {result.summary && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.summary.class_counts).map(([cls, count]) => (
                  <span
                    key={cls}
                    className={`px-2 py-1 rounded border text-xs font-medium ${getClassColor(cls)}`}
                  >
                    {cls}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 예측 결과 테이블 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-white/60">
                예측 결과 ({result.predictions?.length || 0}개)
              </div>
              <button
                className="text-xs text-brand-400 hover:text-brand-300"
                onClick={() => setShowJson(!showJson)}
              >
                {showJson ? '테이블 보기' : 'JSON 보기'}
              </button>
            </div>

            {showJson ? (
              <pre className="p-3 rounded-lg bg-black/30 border border-white/10 text-xs font-mono text-white/80 overflow-x-auto max-h-64 overflow-y-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/5">
                    <tr className="text-white/50">
                      <th className="text-left px-2 py-1.5 font-medium">Entity ID</th>
                      <th className="text-left px-2 py-1.5 font-medium">Raw Layer</th>
                      <th className="text-left px-2 py-1.5 font-medium">Predicted</th>
                      <th className="text-right px-2 py-1.5 font-medium">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {result.predictions?.map((p, i) => (
                      <tr key={i} className="hover:bg-white/5">
                        <td className="px-2 py-1.5 font-mono">{p.entity_id}</td>
                        <td className="px-2 py-1.5 font-mono text-white/60">
                          {p.raw_layer || '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${getClassColor(p.predicted_class)}`}>
                            {p.predicted_class}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <span className={`font-mono ${
                            p.confidence >= 0.9 ? 'text-emerald-600 dark:text-emerald-400' :
                            p.confidence >= 0.7 ? 'text-amber-600 dark:text-amber-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>
                            {(p.confidence * 100).toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
