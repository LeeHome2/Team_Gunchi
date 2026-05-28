'use client'

import { useEffect, useState, useCallback } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import {
  AdminTable,
  Tr,
  Td,
  Badge,
  SmallBtn,
} from '@/components/admin/AdminUI'
import { adminApi, AIExperiment, AIConnectionCheckResult } from '@/lib/api'
import ExperimentDetailModal from '@/components/admin/ExperimentDetailModal'
import AIJobModal from '@/components/admin/AIJobModal'
import DatasetUploadModal from '@/components/admin/DatasetUploadModal'
import DatasetsPanel, { DatasetMeta } from '@/components/admin/DatasetsPanel'
import ProcessedDatasetsPanel, { ProcessedDataset } from '@/components/admin/ProcessedDatasetsPanel'
import DatasetSelectModal from '@/components/admin/DatasetSelectModal'
import ModelUploadModal from '@/components/admin/ModelUploadModal'
import JobProgressPanel from '@/components/admin/JobProgressPanel'
import QuickClassifyPanel from '@/components/admin/QuickClassifyPanel'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  } catch {
    return iso
  }
}

function pickAccuracy(e: AIExperiment): number | null {
  const v = e.metrics?.accuracy
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 메트릭에서 숫자 값 안전하게 추출 */
function pickMetric(metrics: AIExperiment['metrics'], ...keys: string[]): number | undefined {
  if (!metrics) return undefined
  for (const key of keys) {
    const v = metrics[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

export default function AdminAiPage() {
  const [aiUrl, setAiUrl] = useState('http://ceprj2.gachon.ac.kr:65006')

  const [active, setActive] = useState<AIExperiment | null>(null)
  const [experiments, setExperiments] = useState<AIExperiment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mlopsStats, setMlopsStats] = useState<{
    total_predictions: number
    total_test_samples: number
    test_misclassifications: number
    test_accuracy: number | null
    misclassification_rate: number
    average_confidence: number | null
  } | null>(null)

  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const [stubModal, setStubModal] = useState<'retrain' | 'collect' | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [collectPrefillDir, setCollectPrefillDir] = useState<string | null>(null)
  const [deployingRunId, setDeployingRunId] = useState<string | null>(null)

  const [checking, setChecking] = useState(false)
  const [conn, setConn] = useState<AIConnectionCheckResult | null>(null)

  // DatasetsPanel 갱신 트리거 (업로드/빌드 후 증가시킴)
  const [datasetsRefreshKey, setDatasetsRefreshKey] = useState(0)
  // 방금 업로드한 데이터셋 ID — 표에서 행 강조 + 자동 스크롤
  const [highlightDatasetId, setHighlightDatasetId] = useState<string | null>(null)
  // 현재 선택된 데이터셋
  const [selectedDataset, setSelectedDataset] = useState<DatasetMeta | null>(null)
  // 데이터셋 선택 모달 표시 여부
  const [selectModalOpen, setSelectModalOpen] = useState(false)
  // 선택된 전처리 완료 데이터셋 (재학습용) — service_settings.retrain_dataset_id 에 영속.
  // 미선택 시 '기본 라벨링 데이터셋' (id='default', 98 DXF → 190k labeled rows) 자동 적용.
  const [selectedProcessed, setSelectedProcessed] = useState<ProcessedDataset | null>(null)
  // DB 에서 마지막 선택을 복원하기 위한 id (ProcessedDatasetsPanel 이 목록 로드 후 매칭)
  const [savedRetrainDatasetId, setSavedRetrainDatasetId] = useState<string | null>(null)

  // 사용자가 데이터셋 선택 시 즉시 service_settings 에 저장 (페이지 재진입/자동 재학습 모두 반영)
  const handleSelectProcessed = useCallback((ds: ProcessedDataset | null) => {
    setSelectedProcessed(ds)
    setSavedRetrainDatasetId(ds?.id || null)
    adminApi
      .putServiceSetting('retrain_dataset_id', ds?.id || '')
      .catch((e) => console.warn('retrain_dataset_id 저장 실패:', e))
  }, [])
  // 모델 업로드 모달 표시 여부
  const [modelUploadOpen, setModelUploadOpen] = useState(false)

  // 하위 컴포넌트에 전달할 preloaded 데이터 (API 호출 최적화)
  const [preloadedDatasets, setPreloadedDatasets] = useState<any>(null)
  const [preloadedJobs, setPreloadedJobs] = useState<any[]>([])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      // 모든 API를 한 번에 병렬 호출 (기존: 3개 → 최적화: 5개)
      const [activeRes, expRes, statsRes, datasetsRes, jobsRes] = await Promise.all([
        adminApi.getActiveAIModel().catch(() => ({ active: null }) as any),
        adminApi.listExperiments(100).catch((e) => { throw e }),
        fetch(`${aiUrl}/api/mlops/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${aiUrl}/api/mlops/datasets`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${aiUrl}/api/mlops/jobs`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      const a: AIExperiment | null =
        (activeRes && 'active' in activeRes ? activeRes.active : activeRes) || null
      setActive(a as AIExperiment | null)
      setExperiments(expRes.experiments || [])
      setMlopsStats(statsRes)
      setPreloadedDatasets(datasetsRes)
      setPreloadedJobs(jobsRes?.jobs || [])
    } catch (e: any) {
      setError(e.message || 'AI 서버 통신 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const res = await adminApi.getServiceSettings()
        if (res.settings.ai_url) setAiUrl(res.settings.ai_url)
        // 저장된 재학습 대상 데이터셋 id 복원
        if (res.settings.retrain_dataset_id) {
          setSavedRetrainDatasetId(res.settings.retrain_dataset_id)
        }
      } catch {
        /* ignore */
      }
    })()
    loadAll()
  }, [])

  const handleCheckConnection = async () => {
    setChecking(true)
    setConn(null)
    try {
      const res = await adminApi.checkAIConnection({ url: aiUrl, save: true })
      setConn(res)
      if (res.reachable) {
        await loadAll()
      }
    } catch (e: any) {
      setConn({
        url: aiUrl,
        reachable: false,
        health: null,
        service_info: null,
        active_model: null,
        latency_ms: null,
        error: e.message || '연결 점검 실패',
        saved: false,
      })
    } finally {
      setChecking(false)
    }
  }

  const handleDeploy = async (e: AIExperiment) => {
    if (!confirm(`이 모델을 운영에 적용하시겠습니까?\n\n버전: ${e.model_version || e.run_id}`)) {
      return
    }
    setDeployingRunId(e.run_id)
    try {
      await adminApi.deployAIModel({ run_id: e.run_id, environment: 'production' })
      await loadAll()
    } catch (err: any) {
      alert(err.message || '모델 적용 실패')
    } finally {
      setDeployingRunId(null)
    }
  }

  const activeRunId = active?.run_id

  return (
    <>
      <AdminTopbar
        title="AI 모델 관리"
        description="학과 AI 분류 서버의 학습 이력과 운영 모델을 관리합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {/* 엔드포인트 설정 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">엔드포인트 설정</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                AI 서버 URL
              </label>
              <input
                value={aiUrl}
                onChange={(e) => setAiUrl(e.target.value)}
                className="input-field font-mono text-sm"
              />
              <p className="mt-1 text-xs text-white/40">
                연결 확인 성공 시 자동으로 <code>service_settings.ai_url</code>에 저장됩니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                onClick={handleCheckConnection}
                disabled={checking}
              >
                {checking ? '확인 중…' : '연결 확인'}
              </button>
              <button className="btn-secondary" onClick={loadAll}>
                새로고침
              </button>
              <a
                href={aiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary inline-flex items-center gap-1"
              >
                AI 서버 대시보드 ↗
              </a>
            </div>

            {conn && (
              <div
                className={`rounded-lg border p-4 text-sm ${
                  conn.reachable
                    ? 'border-emerald-400/30 bg-emerald-500/5'
                    : 'border-red-400/30 bg-red-500/5'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {conn.reachable ? (
                    <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                      연결됨
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-500/15 border border-red-400/30 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                      연결 실패
                    </span>
                  )}
                  {conn.latency_ms != null && (
                    <span className="text-xs text-white/50 font-mono">
                      {conn.latency_ms} ms
                    </span>
                  )}
                  {conn.saved && (
                    <span className="text-[11px] text-white/50">· URL 저장됨</span>
                  )}
                </div>

                <div className="grid gap-1.5 text-xs">
                  <div className="flex gap-2">
                    <span className="text-white/40 w-16 flex-shrink-0">대상</span>
                    <span className="font-mono text-white/80 break-all">{conn.url}</span>
                  </div>
                  {conn.service_info && typeof conn.service_info === 'object' && (
                    <div className="flex gap-2">
                      <span className="text-white/40 w-16 flex-shrink-0">서비스</span>
                      <span className="text-white/80">
                        {(conn.service_info as any).service || '—'}{' '}
                        <span className="text-white/50 font-mono">
                          v{(conn.service_info as any).version || '?'}
                        </span>
                      </span>
                    </div>
                  )}
                  {conn.active_model && typeof conn.active_model === 'object' && (
                    <div className="flex gap-2">
                      <span className="text-white/40 w-16 flex-shrink-0">활성 모델</span>
                      <span className="font-mono text-white/80 break-all">
                        {(conn.active_model as any).model_version ||
                          (conn.active_model as any).run_id ||
                          '없음'}
                      </span>
                    </div>
                  )}
                  {conn.error && (
                    <div className="flex gap-2">
                      <span className="text-white/40 w-16 flex-shrink-0">오류</span>
                      <span className="text-red-300 break-all">{conn.error}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* 활성 모델 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">현재 운영 모델</h3>
          {loading ? (
            <p className="text-sm text-white/40">불러오는 중…</p>
          ) : !active ? (
            <p className="text-sm text-white/40">운영 중인 모델이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/40">버전</div>
                <div className="font-mono mt-1">
                  {active.model_version || active.run_id.slice(0, 12)}
                </div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/40">알고리즘</div>
                <div className="mt-1">{active.algorithm || '—'}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/40">정확도</div>
                <div className="mt-1 font-semibold">
                  {pickAccuracy(active) != null
                    ? `${(pickAccuracy(active)! * 100).toFixed(2)}%`
                    : '—'}
                </div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-white/40">배포 시각</div>
                <div className="mt-1">{formatDate(active.deployed_at)}</div>
              </div>
            </div>
          )}

          {/* 분류 통계 (테스트셋 기반) */}
          {mlopsStats && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <h4 className="text-sm font-medium text-white/60 mb-3">분류 통계 <span className="text-xs text-white/30">(테스트셋 평가 기준)</span></h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-white/40">테스트 샘플 수</div>
                  <div className="mt-1 font-semibold text-brand-300">
                    {mlopsStats.total_test_samples.toLocaleString()}개
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-white/40">오분류 횟수</div>
                  <div className={`mt-1 font-semibold ${mlopsStats.test_misclassifications > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {mlopsStats.test_misclassifications.toLocaleString()}개
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-white/40">오분류율</div>
                  <div className={`mt-1 font-semibold ${mlopsStats.misclassification_rate > 10 ? 'text-red-400' : mlopsStats.misclassification_rate > 5 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {mlopsStats.misclassification_rate}%
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-white/40">운영 평균 신뢰도</div>
                  <div className="mt-1 font-semibold">
                    {mlopsStats.average_confidence != null
                      ? `${(mlopsStats.average_confidence * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Quick Classification Test */}
        <QuickClassifyPanel aiUrl={aiUrl} />

        {/* 데이터셋 / 분할 (진도표 항목 1, 2, 3) */}
        <DatasetsPanel
          aiUrl={aiUrl}
          refreshKey={datasetsRefreshKey}
          preloadedData={preloadedDatasets}
          highlightDatasetId={highlightDatasetId}
          selectedDatasetId={selectedDataset?.id || null}
          onSelectDataset={setSelectedDataset}
          onDeleteDataset={async (datasetId, datasetName) => {
            try {
              const res = await fetch(`${aiUrl}/api/mlops/datasets/${datasetId}`, {
                method: 'DELETE',
              })
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.detail || errData.message || `HTTP ${res.status}`)
              }
              // 삭제 성공 시 목록 새로고침
              setDatasetsRefreshKey((k) => k + 1)
              return true
            } catch (e: any) {
              alert(`데이터셋 삭제 실패: ${e.message}`)
              return false
            }
          }}
          onUploadClick={() => setUploadOpen(true)}
        />

        {/* 전처리 완료 데이터 (학습용) */}
        <ProcessedDatasetsPanel
          aiUrl={aiUrl}
          refreshKey={datasetsRefreshKey}
          preloadedData={preloadedDatasets}
          selectedDatasetId={selectedProcessed?.id || savedRetrainDatasetId || 'default'}
          onSelectDataset={handleSelectProcessed}
          onPreprocessClick={() => setSelectModalOpen(true)}
        />

        {/* 모델 학습 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">모델 학습</h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={() => setStubModal('retrain')}
              disabled={!selectedProcessed}
              title={selectedProcessed ? '선택된 데이터셋으로 모델 학습' : '먼저 전처리 완료 데이터를 선택하세요'}
            >
              🚀 {selectedProcessed ? '모델 재학습' : '모델 재학습 (선택 필요)'}
            </button>
            {selectedProcessed && (
              <span className="text-xs text-white/50">
                선택된 데이터: <span className="text-brand-300 font-medium">{selectedProcessed.name}</span>
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-white/40">
            위 전처리 완료 데이터에서 학습용 데이터셋을 선택한 후 재학습 버튼을 클릭하세요.
          </p>
        </section>

        {/* 작업 진행 상황 */}
        <JobProgressPanel
          aiUrl={aiUrl}
          refreshKey={datasetsRefreshKey}
          preloadedJobs={preloadedJobs}
          preloadedExperiments={experiments}
          onJobCompleted={loadAll}
        />

        {/* 모델 버전 / 실험 목록 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">학습 이력 / 모델 버전</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40">총 {experiments.length}건</span>
              <button
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 border border-white/20 hover:bg-white/20 text-white transition flex items-center gap-1.5 disabled:opacity-50"
                onClick={loadAll}
                disabled={loading}
                title="목록 새로고침"
              >
                {loading ? (
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                새로고침
              </button>
              <button
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 border border-white/20 hover:bg-white/20 text-white transition"
                onClick={() => setModelUploadOpen(true)}
              >
                📥 모델 업로드
              </button>
            </div>
          </div>
          <AdminTable
            headers={[
              '버전',
              '알고리즘',
              '학습일',
              'Accuracy',
              'Precision',
              'Recall',
              'F1',
              '상태',
              '관리',
            ]}
          >
            {experiments.map((e) => {
              const acc = pickAccuracy(e)
              const precision = pickMetric(e.metrics, 'precision', 'precision_macro')
              const recall = pickMetric(e.metrics, 'recall', 'recall_macro')
              const f1 = pickMetric(e.metrics, 'f1', 'f1_macro')
              const isActive = activeRunId === e.run_id

              // 운영 모델 대비 비교 (운영 모델 자신은 비교 제외)
              const activeAcc = pickMetric(active?.metrics, 'accuracy')
              const activePrecision = pickMetric(active?.metrics, 'precision', 'precision_macro')
              const activeRecall = pickMetric(active?.metrics, 'recall', 'recall_macro')
              const activeF1 = pickMetric(active?.metrics, 'f1', 'f1_macro')

              const getDiff = (v: number | undefined, base: number | undefined) => {
                if (isActive || v == null || base == null) return null
                const diff = (v - base) * 100
                if (Math.abs(diff) < 0.01) return { text: '', color: '' }
                const sign = diff > 0 ? '+' : ''
                return {
                  text: `${diff > 0 ? '↑' : '↓'}${sign}${diff.toFixed(1)}`,
                  color: diff > 0 ? 'text-emerald-400' : 'text-red-400'
                }
              }

              const formatMetric = (v: number | undefined, base: number | undefined) => {
                if (v == null) return '—'
                const diff = getDiff(v, base)
                return (
                  <span className="inline-flex items-center gap-0.5">
                    {(v * 100).toFixed(1)}%
                    {diff && diff.text && <span className={`text-[10px] ${diff.color}`}>{diff.text}</span>}
                  </span>
                )
              }

              return (
                <Tr key={e.run_id}>
                  <Td className="font-mono font-semibold">
                    {e.model_version || e.run_id.slice(0, 12)}
                  </Td>
                  <Td>{e.algorithm || '—'}</Td>
                  <Td className="text-white/50">{formatDate(e.trained_at)}</Td>
                  <Td>{formatMetric(acc ?? undefined, activeAcc)}</Td>
                  <Td>{formatMetric(precision, activePrecision)}</Td>
                  <Td>{formatMetric(recall, activeRecall)}</Td>
                  <Td>{formatMetric(f1, activeF1)}</Td>
                  <Td>
                    {isActive ? (
                      <Badge variant="success">운영</Badge>
                    ) : (
                      <Badge variant="neutral">대기</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1.5 flex-wrap">
                      <SmallBtn onClick={() => setDetailRunId(e.run_id)}>
                        상세
                      </SmallBtn>
                      {!isActive && (
                        <SmallBtn
                          variant="primary"
                          onClick={() => handleDeploy(e)}
                          disabled={deployingRunId === e.run_id}
                        >
                          {deployingRunId === e.run_id ? '적용 중…' : '적용'}
                        </SmallBtn>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
            {!loading && experiments.length === 0 && (
              <Tr>
                <Td colSpan={9} className="text-center text-white/40">
                  학습 이력이 없습니다.
                </Td>
              </Tr>
            )}
            {loading && (
              <Tr>
                <Td colSpan={9} className="text-center text-white/40">
                  불러오는 중…
                </Td>
              </Tr>
            )}
          </AdminTable>
        </section>
      </main>

      {detailRunId && (
        <ExperimentDetailModal
          runId={detailRunId}
          onClose={() => setDetailRunId(null)}
          activeModel={active}
          aiUrl={aiUrl}
          onDelete={async (runId) => {
            try {
              const res = await fetch(`${aiUrl}/api/mlops/experiments/${runId}`, {
                method: 'DELETE',
              })
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.detail || errData.message || `HTTP ${res.status}`)
              }
              // 삭제 성공 시 목록 새로고침
              await loadAll()
              return true
            } catch (e: any) {
              alert(`모델 삭제 실패: ${e.message}`)
              return false
            }
          }}
        />
      )}

      {stubModal && (
        <AIJobModal
          kind={stubModal}
          aiUrl={aiUrl}
          prefillDxfDir={stubModal === 'collect' ? collectPrefillDir : null}
          onClose={() => {
            setStubModal(null)
            setCollectPrefillDir(null)
          }}
          onCompleted={() => {
            loadAll()
          }}
        />
      )}

      {uploadOpen && (
        <DatasetUploadModal
          aiUrl={aiUrl}
          onClose={() => setUploadOpen(false)}
          onUploaded={(result) => {
            // 새 데이터셋을 데이터셋 패널에서 강조 + 스크롤
            setHighlightDatasetId(result.dataset_id)
            setDatasetsRefreshKey((k) => k + 1)
            // 강조 효과는 8초 후 자동 해제 (사용자가 인지하면 충분)
            setTimeout(() => setHighlightDatasetId(null), 8000)

            if (!result.auto_build) {
              setUploadOpen(false)
              setCollectPrefillDir(result.dxf_dir)
              setStubModal('collect')
            } else {
              loadAll()
            }
          }}
        />
      )}

      {selectModalOpen && (
        <DatasetSelectModal
          aiUrl={aiUrl}
          onClose={() => setSelectModalOpen(false)}
          onSelect={(dataset) => {
            setSelectModalOpen(false)
            setCollectPrefillDir(dataset.dxf_dir || null)
            setStubModal('collect')
          }}
        />
      )}

      {modelUploadOpen && (
        <ModelUploadModal
          aiUrl={aiUrl}
          onClose={() => setModelUploadOpen(false)}
          onUploaded={() => {
            loadAll()
          }}
        />
      )}
    </>
  )
}
