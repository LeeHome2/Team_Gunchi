'use client'

import { useState, useEffect } from 'react'
import { useProjectStore } from '@/store/projectStore'

interface SamplePreset {
  id: string
  name: string
  description: string
  filename: string
  wall_layers: string[]
  door_layers: string[]
  window_layers: string[]
  height: number
  tags: string[]
  file_size_kb: number
}

interface SampleCardsProps {
  onSampleGenerated?: (result: any) => void
}

export default function SampleCards({ onSampleGenerated }: SampleCardsProps) {
  const [samples, setSamples] = useState<SamplePreset[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { setMassGlbToLoad, addGeneratedMass } = useProjectStore()

  // 샘플 목록 로드
  useEffect(() => {
    const fetchSamples = async () => {
      try {
        const res = await fetch('/api/samples')
        if (!res.ok) throw new Error('샘플 목록 로드 실패')
        const data = await res.json()
        setSamples(data.samples || [])
      } catch (err) {
        console.error('샘플 로드 오류:', err)
        setError('샘플 목록을 불러올 수 없습니다')
      } finally {
        setLoading(false)
      }
    }
    fetchSamples()
  }, [])

  // 샘플로 매스 생성
  const handleGenerate = async (preset: SamplePreset) => {
    if (generatingId) return

    setGeneratingId(preset.id)
    setError(null)

    try {
      const res = await fetch(`/api/samples/${preset.id}/generate?height=3.0`, {
        method: 'POST',
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || '매스 생성 실패')
      }

      const result = await res.json()

      // 생성된 매스를 스토어에 추가
      const mass = {
        id: result.model_id,
        fileName: preset.filename,
        label: preset.name,
        glbUrl: result.model_url,
        glbUrlNoRoof: result.model_url_no_roof || undefined,
        footprint: [[0, 0], [10, 0], [10, 10], [0, 10]],  // 더미 footprint
        centroid: [127.0235, 37.5088],  // 기본 위치 (서울)
        area: 100,
        height: result.height || 3.0,
        floors: 1,
        classification: {
          total_entities: 0,
          class_counts: {},
          average_confidence: 1.0,
        },
        boundingBox: result.bounding_box || undefined,
        openings: result.openings || undefined,
        createdAt: Date.now(),
      }

      addGeneratedMass(mass)

      // Cesium에 모델 로드
      setMassGlbToLoad(result.model_url)

      if (onSampleGenerated) {
        onSampleGenerated(result)
      }

      console.log(`[샘플] ${preset.name} 매스 생성 완료:`, result)
    } catch (err) {
      console.error('샘플 매스 생성 오류:', err)
      setError(err instanceof Error ? err.message : '매스 생성에 실패했습니다')
    } finally {
      setGeneratingId(null)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        샘플 로딩 중...
      </div>
    )
  }

  if (error && samples.length === 0) {
    return (
      <div className="text-center py-4 text-red-500 text-sm">
        {error}
      </div>
    )
  }

  if (samples.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        사용 가능한 샘플이 없습니다
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-sm text-gray-700">샘플 도면</h4>
      <p className="text-xs text-gray-500 mb-2">
        클릭하면 즉시 3D 매스가 생성됩니다
      </p>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 p-2 rounded mb-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {samples.map((sample) => (
          <button
            key={sample.id}
            onClick={() => handleGenerate(sample)}
            disabled={generatingId !== null}
            className={`
              relative p-3 rounded-lg border text-left transition-all
              ${generatingId === sample.id
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }
              ${generatingId && generatingId !== sample.id ? 'opacity-50' : ''}
            `}
          >
            {/* 로딩 오버레이 */}
            {generatingId === sample.id && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            <p className="font-medium text-sm text-gray-800 truncate">
              {sample.name}
            </p>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
              {sample.description}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {sample.tags?.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded"
                >
                  {tag}
                </span>
              ))}
              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded">
                {sample.file_size_kb}KB
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
