'use client'

import { useEffect, useState } from 'react'
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR')
  } catch {
    return iso
  }
}

function pickAccuracy(e: AIExperiment): number | null {
  const v = e.metrics?.accuracy
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export default function AdminAiPage() {
  const [aiUrl, setAiUrl] = useState('http://ceprj2.gachon.ac.kr:65006')

  const [active, setActive] = useState<AIExperiment | null>(null)
  const [experiments, setExperiments] = useState<AIExperiment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  // 선택된 전처리 완료 데이터셋 (재학습용)
  const [selectedProcessed, setSelectedProcessed] = useState<ProcessedDataset | null>(null)
  // 모델 업로드 모달 표시 여부
  const [modelUploadOpen, setModelUploadOpen] = useState(false)
  // 다운로드 중인 모델 run_id
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [activeRes, expRes] = await Promise.all([
        adminApi.getActiveAIModel().catch(() => ({ active: null }) as any),
        adminApi.listExperiments(50).catch((e) => {
          throw e
        }),
      ])
      const a: AIExperiment | null =
        (activeRes && 'active' in activeRes ? activeRes.active : activeRes) || null
      setActive(a as AIExperiment | null)
      setExperiments(expRes.experiments || [])
    } catch (e: any) {
      setError(e.message || 'AI 서버 통신 실패')
    } finally {
      setLoading(false)
    }
    setDatasetsRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    ;(async () => {
      try {
        const res = await adminApi.getServiceSettings()
        if (res.settings.ai_url) setAiUrl(res.settings.ai_url)
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


  const handleDownloadModel = async (e: AIExperiment) => {
    setDownloadingRunId(e.run_id)
    try {
      const response = await fetch(`${aiUrl}/api/mlops/models/${e.run_id}/download`)
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || errData.message || `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const filename = `model_${e.model_version || e.run_id}.pkl`
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err: any) {
      alert(err.message || '모델 다운로드 실패')
    } finally {
      setDownloadingRunId(null)
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
        </section>

        {/* 데이터셋 / 분할 (진도표 항목 1, 2, 3) */}
        <DatasetsPanel
          aiUrl={aiUrl}
          refreshKey={datasetsRefreshKey}
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
        />

        {/* 전처리 완료 데이터 (학습용) */}
        <ProcessedDatasetsPanel
          aiUrl={aiUrl}
          refreshKey={datasetsRefreshKey}
          selectedDatasetId={selectedProcessed?.id || null}
          onSelectDataset={setSelectedProcessed}
        />

        {/* 관리 작업 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">관리 작업</h3>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => setUploadOpen(true)}
            >
              📤 DXF 데이터셋 업로드
            </button>
            <button
              className="btn-secondary"
              onClick={() => setSelectModalOpen(true)}
            >
              🔄 데이터 전처리
            </button>
            <button
              className="btn-secondary"
              onClick={() => setStubModal('retrain')}
              disabled={!selectedProcessed}
              title={selectedProcessed ? '선택된 데이터셋으로 모델 학습' : '먼저 전처리 완료 데이터를 선택하세요'}
            >
              {selectedProcessed ? '모델 재학습' : '모델 재학습 (선택 필요)'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setModelUploadOpen(true)}
            >
              📥 모델 업로드
            </button>
          </div>
          <p className="mt-3 text-xs text-white/40">
            <b>데이터셋 업로드</b> → DXF zip 전송. <b>전처리</b> → 이미지 변환 및 라벨링.
            <b>재학습</b> → 모델 학습. <b>모델 업로드</b> → 학습된 모델 파일 직접 등록.
          </p>
        </section>

        {/* 작업 진행 상황 */}
        <JobProgressPanel
          aiUrl={aiUrl}
          refreshKey={datasetsRefreshKey}
          onJobCompleted={loadAll}
        />

        {/* 모델 버전 / 실험 목록 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">학습 이력 / 모델 버전</h3>
            <span className="text-xs text-white/40">총 {experiments.length}건</span>
          </div>
          <AdminTable
            headers={[
              '버전',
              '알고리즘',
              '학습일',
              '정확도',
              'F1',
              '상태',
              '관리',
            ]}
          >
            {experiments.map((e) => {
              const acc = pickAccuracy(e)
              const f1 = e.metrics?.f1
              const isActive = activeRunId === e.run_id
              return (
                <Tr key={e.run_id}>
                  <Td className="font-mono font-semibold">
                    {e.model_version || e.run_id.slice(0, 12)}
                  </Td>
                  <Td>{e.algorithm || '—'}</Td>
                  <Td className="text-white/50">{formatDate(e.trained_at)}</Td>
                  <Td>{acc != null ? `${(acc * 100).toFixed(1)}%` : '—'}</Td>
                  <Td>
                    {typeof f1 === 'number' ? `${(f1 * 100).toFixed(1)}%` : '—'}
                  </Td>
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
                        성능
                      </SmallBtn>
                      <SmallBtn
                        onClick={() => handleDownloadModel(e)}
                        disabled={downloadingRunId === e.run_id}
                      >
                        {downloadingRunId === e.run_id ? '⏳' : '⬇️'}
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
                <Td colSpan={7} className="text-center text-white/40">
                  학습 이력이 없습니다.
                </Td>
              </Tr>
            )}
            {loading && (
              <Tr>
                <Td colSpan={7} className="text-center text-white/40">
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
