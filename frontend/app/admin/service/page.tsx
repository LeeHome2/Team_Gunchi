'use client'

import { useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import { Badge } from '@/components/admin/AdminUI'
import { adminApi, AdminEndpointStatus } from '@/lib/api'

const STATUS_VARIANT: Record<
  string,
  { variant: 'success' | 'warning' | 'danger'; label: string }
> = {
  ok: { variant: 'success', label: '정상' },
  degraded: { variant: 'warning', label: '지연' },
  down: { variant: 'danger', label: '중단' },
}

export default function AdminServicePage() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [endpoints, setEndpoints] = useState<AdminEndpointStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probingEndpoints, setProbingEndpoints] = useState(false)

  const loadSettings = async () => {
    try {
      const res = await adminApi.getServiceSettings()
      setSettings(res.settings)
    } catch (e: any) {
      setError(e.message || '설정 로드 실패')
    }
  }

  const loadEndpoints = async () => {
    setProbingEndpoints(true)
    try {
      const res = await adminApi.listServiceEndpoints()
      setEndpoints(res.endpoints)
    } catch {
      setEndpoints([])
    } finally {
      setProbingEndpoints(false)
    }
  }

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      await loadSettings()
      setLoading(false)
      // Fire-and-forget: endpoint probing can take ~1s, don't block the
      // initial render for it.
      loadEndpoints()
    })()
  }, [])

  const update = (key: string, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }))

  const saveAll = async (keys: string[]) => {
    setSaving(true)
    try {
      for (const key of keys) {
        await adminApi.putServiceSetting(key, settings[key] ?? '')
      }
      alert('저장되었습니다.')
    } catch (e: any) {
      alert(e.message || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const toggleMaintenance = async () => {
    const next = settings.maintenance === 'true' ? 'false' : 'true'
    update('maintenance', next)
    try {
      await adminApi.putServiceSetting('maintenance', next)
    } catch (e: any) {
      alert(e.message || '저장 실패')
    }
  }

  const apiUrl = settings.api_url ?? ''
  const aiUrl = settings.ai_url ?? ''
  const rateLimit = settings.rate_limit ?? '100'
  const timeoutVal = settings.timeout ?? '30'
  const logLevel = (settings.log_level ?? 'info').toLowerCase()
  const logRetention = settings.log_retention_days ?? '30'
  const errorMode = settings.error_mode ?? 'notify'
  const maintenance = settings.maintenance === 'true'

  return (
    <>
      <AdminTopbar
        title="서비스 설정"
        description="API · 엔드포인트 · 로깅 · 오류 처리 등 서비스 운영 정책을 관리합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}
        {loading && (
          <div className="card p-4 text-sm text-white/40">
            설정을 불러오는 중…
          </div>
        )}

        {/* API 설정 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">API 설정</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                Core API URL
              </label>
              <input
                value={apiUrl}
                onChange={(e) => update('api_url', e.target.value)}
                className="input-field font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                AI 서버 URL
              </label>
              <input
                value={aiUrl}
                onChange={(e) => update('ai_url', e.target.value)}
                className="input-field font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                요청 제한 (req/min)
              </label>
              <input
                type="number"
                value={rateLimit}
                onChange={(e) => update('rate_limit', e.target.value)}
                className="input-field font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                타임아웃 (초)
              </label>
              <input
                type="number"
                value={timeoutVal}
                onChange={(e) => update('timeout', e.target.value)}
                className="input-field font-mono text-sm"
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() =>
                saveAll(['api_url', 'ai_url', 'rate_limit', 'timeout'])
              }
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </section>

        {/* 엔드포인트 상태 */}
        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">엔드포인트 상태</h3>
            <button
              className="btn-secondary"
              onClick={loadEndpoints}
              disabled={probingEndpoints}
            >
              {probingEndpoints ? '점검 중…' : '상태 재점검'}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {endpoints.length === 0 && !probingEndpoints && (
              <p className="text-sm text-white/40">엔드포인트 정보가 없습니다.</p>
            )}
            {endpoints.map((e) => {
              const s = STATUS_VARIANT[e.status] || STATUS_VARIANT.down
              return (
                <div
                  key={`${e.name}-${e.url}`}
                  className="rounded-lg border border-white/10 bg-white/5 p-4 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {e.name}
                    </div>
                    <div className="text-xs font-mono text-white/50 truncate">
                      {e.url}
                    </div>
                  </div>
                  <span className="text-xs font-mono text-white/60 shrink-0">
                    {e.latency_ms != null ? `${e.latency_ms}ms` : '—'}
                  </span>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </div>
              )
            })}
          </div>
        </section>

        {/* 로깅 + 오류 처리 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-6">
            <h3 className="text-base font-semibold mb-4">로깅 설정</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/80">
                  로그 레벨
                </label>
                <select
                  value={logLevel}
                  onChange={(e) => update('log_level', e.target.value)}
                  className="input-field font-mono text-sm"
                >
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/80">
                  로그 보관 기간 (일)
                </label>
                <input
                  type="number"
                  value={logRetention}
                  onChange={(e) =>
                    update('log_retention_days', e.target.value)
                  }
                  className="input-field font-mono text-sm"
                />
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  disabled={saving}
                  onClick={() => saveAll(['log_level', 'log_retention_days'])}
                >
                  {saving ? '저장 중…' : '로깅 저장'}
                </button>
              </div>
            </div>
          </section>

          <section className="card p-6">
            <h3 className="text-base font-semibold mb-4">오류 처리</h3>
            <div className="space-y-2">
              {(['silent', 'notify', 'halt'] as const).map((m) => (
                <label
                  key={m}
                  className="flex items-start gap-3 rounded-md border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10"
                >
                  <input
                    type="radio"
                    name="error-mode"
                    checked={errorMode === m}
                    onChange={() => update('error_mode', m)}
                    className="mt-1 accent-brand-500"
                  />
                  <div>
                    <div className="text-sm font-semibold">
                      {m === 'silent' && '조용히 기록'}
                      {m === 'notify' && '관리자 알림'}
                      {m === 'halt' && '서비스 중단'}
                    </div>
                    <div className="text-xs text-white/50 mt-0.5">
                      {m === 'silent' && '로그에만 기록하고 정상 응답 유지'}
                      {m === 'notify' && '슬랙 · 이메일로 즉시 알림 발송'}
                      {m === 'halt' && '해당 엔드포인트를 일시 정지'}
                    </div>
                  </div>
                </label>
              ))}
              <div className="flex justify-end pt-2">
                <button
                  className="btn-primary"
                  disabled={saving}
                  onClick={() => saveAll(['error_mode'])}
                >
                  {saving ? '저장 중…' : '오류 정책 저장'}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* 유지보수 모드 */}
        <section className="card p-6 flex items-center gap-4">
          <div className="flex-1">
            <h3 className="text-base font-semibold">유지보수 모드</h3>
            <p className="text-xs text-white/50 mt-0.5">
              활성화하면 모든 사용자에게 점검 안내 페이지가 표시됩니다.
            </p>
          </div>
          <button
            onClick={toggleMaintenance}
            className={`relative h-7 w-12 rounded-full transition-colors ${
              maintenance ? 'bg-amber-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                maintenance ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
          {maintenance && <Badge variant="warning">점검 중</Badge>}
        </section>
      </main>
    </>
  )
}
