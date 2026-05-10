'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  adminApi,
  PreprocessBuilding,
  PreprocessBuildingDetail,
  PreprocessStatus,
} from '@/lib/api'
import { SmallBtn, Badge } from './AdminUI'

// PNG 타입별 탭 정의
const PNG_TABS = [
  { key: 'original', label: '원본', prefix: 'original_' },
  { key: 'overlay', label: '4색 합성', prefix: 'overlay_' },
  { key: 'floorplans', label: '평면도', prefix: 'floorplans_' },
  { key: 'openings', label: '출입구/창문', prefix: 'openings_' },
  { key: 'thumb', label: '썸네일', prefix: 'thumb_' },
]

interface Props {
  aiUrl: string
  refreshKey?: number
}

export default function PreprocessGallery({ aiUrl, refreshKey = 0 }: Props) {
  const [buildings, setBuildings] = useState<PreprocessBuilding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 선택된 건물 상세
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PreprocessBuildingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // 탭
  const [activeTab, setActiveTab] = useState('original')

  // 전처리 실행 상태
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<{
    total: number
    processed: number
    failed: number
  } | null>(null)

  // 폴링 상태
  const [pollingStatus, setPollingStatus] = useState<Record<string, PreprocessStatus>>({})

  const loadBuildings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listPreprocessBuildings()
      setBuildings(res.buildings || [])
    } catch (e: any) {
      setError(e.message || '건물 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBuildings()
  }, [loadBuildings, refreshKey])

  // 건물 선택 시 상세 로드
  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    adminApi
      .getPreprocessBuilding(selectedId)
      .then((res) => setDetail(res))
      .catch((e) => {
        setError(e.message)
        setDetail(null)
      })
      .finally(() => setDetailLoading(false))
  }, [selectedId])

  // 전처리 실행
  const handleRunPreprocess = async () => {
    if (!confirm('미처리 건물을 모두 전처리하시겠습니까?')) return
    setRunning(true)
    setRunResult(null)
    try {
      const res = await adminApi.runPreprocess({ mock: false })
      setRunResult({
        total: res.total,
        processed: res.processed,
        failed: res.failed,
      })
      await loadBuildings()
    } catch (e: any) {
      setError(e.message || '전처리 실행 실패')
    } finally {
      setRunning(false)
    }
  }

  // 개별 재처리
  const handleReprocess = async (buildingId: string) => {
    if (!confirm(`${buildingId} 를 재처리하시겠습니까?`)) return
    try {
      await adminApi.reprocessBuilding(buildingId)
      // 폴링 시작
      pollStatus(buildingId)
    } catch (e: any) {
      alert(e.message || '재처리 요청 실패')
    }
  }

  // 상태 폴링
  const pollStatus = useCallback((buildingId: string) => {
    const poll = async () => {
      try {
        const status = await adminApi.getPreprocessStatus(buildingId)
        setPollingStatus((prev) => ({ ...prev, [buildingId]: status }))
        if (status.status === 'running') {
          setTimeout(poll, 2000)
        } else {
          // 완료 시 목록 갱신
          loadBuildings()
        }
      } catch {
        // 무시
      }
    }
    poll()
  }, [loadBuildings])

  // 현재 탭에 해당하는 이미지 필터링
  const getTabImages = (images: string[], tabKey: string): string[] => {
    const tab = PNG_TABS.find((t) => t.key === tabKey)
    if (!tab) return []
    return images.filter((img) => img.startsWith(tab.prefix) || img.includes(`/${tab.prefix}`))
  }

  // 이미지 URL 생성
  const getImageUrl = (buildingId: string, filename: string): string => {
    return adminApi.getPreprocessImageUrl(buildingId, filename)
  }

  const unprocessedCount = buildings.filter((b) => !b.processed).length
  const processedCount = buildings.filter((b) => b.processed).length

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">DXF 전처리 갤러리</h3>
          <p className="text-xs text-white/40 mt-1">
            처리됨 {processedCount}개 / 미처리 {unprocessedCount}개
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary"
            onClick={handleRunPreprocess}
            disabled={running || unprocessedCount === 0}
          >
            {running ? '처리 중...' : '지금 시작'}
          </button>
          <button className="btn-secondary" onClick={loadBuildings}>
            새로고침
          </button>
        </div>
      </div>

      {runResult && (
        <div className="mb-4 p-3 rounded-lg border border-emerald-400/30 bg-emerald-500/5 text-sm">
          전처리 완료: 총 {runResult.total}개 중 {runResult.processed}개 처리,{' '}
          {runResult.failed}개 실패
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-400/30 bg-red-500/5 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-white/40">불러오는 중...</p>
      ) : buildings.length === 0 ? (
        <p className="text-sm text-white/40">등록된 건물이 없습니다.</p>
      ) : (
        <div className="flex gap-6">
          {/* 왼쪽: 건물 카드 그리드 */}
          <div className="w-1/3 max-h-[600px] overflow-y-auto pr-2">
            <div className="grid grid-cols-2 gap-3">
              {buildings.map((b) => {
                const status = pollingStatus[b.building_id]
                const isRunning = status?.status === 'running'
                return (
                  <div
                    key={b.building_id}
                    onClick={() => setSelectedId(b.building_id)}
                    className={`
                      p-3 rounded-lg border cursor-pointer transition-all
                      ${
                        selectedId === b.building_id
                          ? 'border-blue-400 bg-blue-500/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20'
                      }
                    `}
                  >
                    {/* 썸네일 */}
                    {b.processed ? (
                      <img
                        src={getImageUrl(b.building_id, `thumb_${b.files[0]?.replace('.dxf', '').replace('.DXF', '')}.png`)}
                        alt={b.building_id}
                        className="w-full h-20 object-contain bg-black/20 rounded mb-2"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="w-full h-20 bg-white/5 rounded mb-2 flex items-center justify-center text-white/30 text-xs">
                        미처리
                      </div>
                    )}
                    <div className="text-xs font-mono truncate" title={b.building_id}>
                      {b.building_id}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-white/40">
                        {b.file_count}파일 / {b.floor_count}층
                      </span>
                      {isRunning ? (
                        <Badge variant="warning">
                          {status.progress}%
                        </Badge>
                      ) : b.processed ? (
                        <Badge variant="success">완료</Badge>
                      ) : (
                        <Badge variant="neutral">대기</Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 오른쪽: 상세 뷰어 */}
          <div className="flex-1 border-l border-white/10 pl-6">
            {!selectedId ? (
              <p className="text-sm text-white/40">건물을 선택하세요.</p>
            ) : detailLoading ? (
              <p className="text-sm text-white/40">로딩 중...</p>
            ) : !detail ? (
              <p className="text-sm text-white/40">상세 정보를 불러올 수 없습니다.</p>
            ) : (
              <>
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-semibold">{detail.building_id}</h4>
                    <p className="text-xs text-white/40 mt-0.5">
                      {detail.manifest?.files.length || 0}개 파일 /{' '}
                      {detail.manifest?.floors.length || 0}층
                    </p>
                  </div>
                  <SmallBtn
                    variant="primary"
                    onClick={() => handleReprocess(detail.building_id)}
                  >
                    재처리
                  </SmallBtn>
                </div>

                {/* 탭 */}
                <div className="flex gap-1 mb-4 border-b border-white/10 pb-2">
                  {PNG_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`
                        px-3 py-1.5 text-xs rounded-t transition-colors
                        ${
                          activeTab === tab.key
                            ? 'bg-white/10 text-white'
                            : 'text-white/50 hover:text-white/70'
                        }
                      `}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* 이미지 그리드 */}
                <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto">
                  {getTabImages(detail.images, activeTab).length === 0 ? (
                    <p className="col-span-2 text-xs text-white/40">
                      해당 유형의 이미지가 없습니다.
                    </p>
                  ) : (
                    getTabImages(detail.images, activeTab).map((img) => (
                      <div key={img} className="bg-black/20 rounded overflow-hidden">
                        <img
                          src={getImageUrl(detail.building_id, img)}
                          alt={img}
                          className="w-full h-40 object-contain"
                        />
                        <div className="px-2 py-1 text-[10px] text-white/40 truncate">
                          {img}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 매니페스트 정보 */}
                {detail.manifest && (
                  <div className="mt-4 p-3 rounded-lg bg-white/5 text-xs">
                    <div className="font-semibold mb-2">층 정보</div>
                    <div className="space-y-1">
                      {detail.manifest.floors.map((f) => (
                        <div
                          key={`${f.file_id}-${f.floor_index}`}
                          className="flex items-center gap-2"
                        >
                          <span className="font-mono text-white/60">
                            {f.floor_label}
                          </span>
                          <span className="text-white/40">
                            벽 {f.wall_layers.length}개 / 문 {f.door_layers.length}개 / 창{' '}
                            {f.window_layers.length}개
                          </span>
                          {f.main_entrance && (
                            <Badge variant="success">출입구</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
