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
  const [deployingRunId, setDeployingRunId] = useState<string | null>(null)

  const [checking, setChecking] = useState(false)
  const [conn, setConn] = useState<AIConnectionCheckResult | null>(null)

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
      // active 응답은 {active: ...} 또는 raw experiment 둘 다 가능
      const a: AIExperiment | null =
        (activeRes && 'active' in activeRes ? activeRes.active : activeRes) || null
      setActive(a as AIExperiment | null)
      setExperiments(expRes.experiments || [])
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
        // 새 URL이 저장됐다면 활성 모델 / 실험 목록도 다시 받아온다
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
            <div className="flex gap-2">
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
                    <span className="text-[11px] text-white/50">
                      · URL 저장됨
                    </span>
                  )}
                </div>

                <div className="grid gap-1.5 text-xs">
                  <div className="flex gap-2">
                    <span className="text-white/40 w-16 flex-shrink-0">대상</span>
                    <span className="font-mono text-white/80 break-all">
                      {conn.url}
                    </span>
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

        {/* 관리 작업 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">관리 작업</h3>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => setStubModal('collect')}
            >
              데이터 재수집
            </button>
            <button
              className="btn-secondary"
              onClick={() => setStubModal('retrain')}
            >
              모델 재학습
            </button>
          </div>
          <p className="mt-3 text-xs text-white/40">
            데이터 수집과 학습은 학과 서버에서 직접 실행하는 배치 작업으로, AWS에서 트리거할 수 있는 API가 없습니다.
          </p>
        </section>

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
                    {typeof f1 === 'number'
                      ? `${(f1 * 100).toFixed(1)}%`
                      : '—'}
                  </Td>
                  <Td>
                    {isActive ? (
                      <Badge variant="success">운영</Badge>
                    ) : (
                      <Badge variant="neutral">대기</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1.5">
                      <SmallBtn onClick={() => setDetailRunId(e.run_id)}>
                        성능 확인
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
        <StubModal kind={stubModal} onClose={() => setStubModal(null)} />
      )}
    </>
  )
}

function StubModal({
  kind,
  onClose,
}: {
  kind: 'retrain' | 'collect'
  onClose: () => void
}) {
  const isRetrain = kind === 'retrain'
  const title = isRetrain ? '모델 재학습' : '데이터 재수집'
  const cmd = isRetrain
    ? 'cd ~/Team_Gunchi_classifier && python -m training.train --output models/$(date +%Y%m%d_%H%M%S)'
    : 'cd ~/Team_Gunchi_classifier && python -m training.collect_data --refresh'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xl leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-4 text-sm">
          <p className="text-white/70">
            {title} 작업은 학과 서버에서 직접 실행해야 합니다. AI 분류 서버는 GPU
            정책상 추론 전용으로 동작하며, 학습/데이터 수집은 별도 배치 스크립트로
            관리됩니다.
          </p>
          <div>
            <div className="text-xs text-white/50 mb-1.5">실행 명령 (예시)</div>
            <pre className="font-mono text-xs rounded-md border border-white/10 bg-navy-950 p-3 overflow-auto">
              ssh ceprj2.gachon.ac.kr{'\n'}
              {cmd}
            </pre>
          </div>
          <p className="text-xs text-white/40">
            완료 후 본 화면에서 새로 생성된 실험을 확인하고 [적용] 버튼으로 운영에
            반영하세요.
          </p>
        </div>
        <div className="border-t border-white/10 p-4 flex justify-end">
          <SmallBtn onClick={onClose}>닫기</SmallBtn>
        </div>
      </div>
    </div>
  )
}
