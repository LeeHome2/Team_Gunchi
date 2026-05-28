'use client'

import { useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import { Badge } from '@/components/admin/AdminUI'
import { adminApi, AdminEndpointStatus, RetrainStatus } from '@/lib/api'

const STATUS_VARIANT: Record<
  string,
  { variant: 'success' | 'warning' | 'danger'; label: string }
> = {
  ok: { variant: 'success', label: '정상' },
  degraded: { variant: 'warning', label: '지연' },
  down: { variant: 'danger', label: '중단' },
}

// 서비스 설정 접근 비밀번호 (실제로는 환경변수나 DB에서 관리)
const SERVICE_ACCESS_PASSWORD = 'admin'

export default function AdminServicePage() {
  // 비밀번호 인증 상태
  const [verified, setVerified] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const [settings, setSettings] = useState<Record<string, string>>({})
  const [endpoints, setEndpoints] = useState<AdminEndpointStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probingEndpoints, setProbingEndpoints] = useState(false)

  // DB 전환 상태
  const [dbType, setDbType] = useState<string>('rds')
  const [dbUrl, setDbUrl] = useState<string>('')
  const [rdsAvailable, setRdsAvailable] = useState(true)
  const [dbSwitching, setDbSwitching] = useState(false)

  // 재학습 스케줄러 상태
  const [retrainStatus, setRetrainStatus] = useState<RetrainStatus | null>(null)
  const [loadingRetrainStatus, setLoadingRetrainStatus] = useState(false)
  const [triggeringRetrain, setTriggeringRetrain] = useState(false)

  const handleVerify = async () => {
    setVerifying(true)
    setAuthError(null)

    // 서버에서 비밀번호 검증 (service_settings의 service_password와 비교)
    try {
      const res = await adminApi.getServiceSettings()
      const storedPassword = res.settings.service_password || SERVICE_ACCESS_PASSWORD

      if (password === storedPassword) {
        setVerified(true)
      } else {
        setAuthError('비밀번호가 일치하지 않습니다')
      }
    } catch {
      // 설정 로드 실패 시 기본 비밀번호로 검증
      if (password === SERVICE_ACCESS_PASSWORD) {
        setVerified(true)
      } else {
        setAuthError('비밀번호가 일치하지 않습니다')
      }
    } finally {
      setVerifying(false)
    }
  }

  const loadSettings = async () => {
    try {
      const res = await adminApi.getServiceSettings()
      setSettings(res.settings)
    } catch (e: any) {
      setError(e.message || '설정 로드 실패')
    }
  }

  const loadDbStatus = async () => {
    try {
      const res = await adminApi.getDatabaseStatus()
      setDbType(res.type)
      setDbUrl(res.url)
      setRdsAvailable(res.rds_available)
    } catch {
      // DB 상태 로드 실패 시 무시
    }
  }

  const handleDbSwitch = async (target: 'rds' | 'sqlite') => {
    if (target === dbType) return
    const label = target === 'rds' ? 'RDS (PostgreSQL)' : 'SQLite (로컬)'
    if (!confirm(`데이터베이스를 ${label}(으)로 전환하시겠습니까?\n\n전환 시 현재 세션의 데이터는 유지되지 않을 수 있습니다.`)) {
      return
    }
    setDbSwitching(true)
    try {
      const res = await adminApi.switchDatabase(target)
      setDbType(res.type)
      setDbUrl(res.url)
      setRdsAvailable(res.rds_available)
      alert(`${label}(으)로 전환 완료!`)
    } catch (e: any) {
      alert(e.message || 'DB 전환 실패')
    } finally {
      setDbSwitching(false)
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

  const loadRetrainStatus = async () => {
    setLoadingRetrainStatus(true)
    try {
      const res = await adminApi.getRetrainStatus()
      setRetrainStatus(res)
    } catch {
      setRetrainStatus(null)
    } finally {
      setLoadingRetrainStatus(false)
    }
  }

  const handleTriggerRetrain = async () => {
    if (!confirm('지금 즉시 재학습을 시작하시겠습니까?\n\n이 작업은 AI 서버에 학습 요청을 보내며, 완료까지 시간이 걸릴 수 있습니다.')) {
      return
    }
    setTriggeringRetrain(true)
    try {
      const res = await adminApi.triggerRetrain()
      if (res.success) {
        alert('재학습이 트리거되었습니다.\n\nAI 서버에서 학습이 진행됩니다.')
        await loadRetrainStatus()
        await loadSettings()
      } else {
        alert(`재학습 트리거 실패: ${res.error || '알 수 없는 오류'}`)
      }
    } catch (e: any) {
      alert(`재학습 트리거 실패: ${e.message || '서버 오류'}`)
    } finally {
      setTriggeringRetrain(false)
    }
  }

  useEffect(() => {
    if (!verified) return
    ;(async () => {
      setLoading(true)
      await Promise.all([loadSettings(), loadDbStatus()])
      setLoading(false)
      loadEndpoints()
      loadRetrainStatus()
    })()
  }, [verified])

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

  // update() 직후 saveAll() 을 부르면 React state 업데이트가 비동기라
  // saveAll 이 옛 값을 백엔드에 다시 저장해버린다. 토글류는 명시적인 값을
  // 받아 즉시 저장하도록 별도 헬퍼를 둔다.
  const saveImmediate = async (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    try {
      await adminApi.putServiceSetting(key, value)
    } catch (e: any) {
      alert(e.message || '저장 실패')
    }
  }

  const apiUrl = settings.api_url ?? ''
  const aiUrl = settings.ai_url ?? ''
  const rateLimit = settings.rate_limit ?? '100'
  const timeoutVal = settings.timeout ?? '30'

  // 업로드 제한
  const maxDxfSizeMb = settings.max_dxf_size_mb ?? '50'

  // 재학습 트리거 설정
  // 빈 문자열도 fallback (`??` 는 nullish만 잡으므로 || 사용)
  const retrainThreshold = settings.retrain_confidence_threshold || '70'
  const retrainEnabled = settings.retrain_auto_enabled === 'true'

  // 주기별 재학습 설정
  const [retrainTab, setRetrainTab] = useState<'confidence' | 'periodic'>('confidence')
  const periodicRetrainEnabled = settings.periodic_retrain_enabled === 'true'
  const periodicRetrainInterval = settings.periodic_retrain_interval ?? '14' // 기본 2주(14일)
  const periodicRetrainLastRun = settings.periodic_retrain_last_run ?? ''

  // 비밀번호 미인증 시 인증 화면 표시
  if (!verified) {
    return (
      <>
        <AdminTopbar
          title="서비스 설정"
          description="API · 엔드포인트 · 로깅 · 오류 처리 등 서비스 운영 정책을 관리합니다."
        />
        <main className="flex-1 p-8 flex items-center justify-center">
          <div className="card p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">🔐</div>
              <h2 className="text-lg font-semibold">비밀번호 확인</h2>
              <p className="text-sm text-white/50 mt-1">
                서비스 설정에 접근하려면 비밀번호를 입력하세요
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleVerify()
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-white/80 mb-1.5">
                  비밀번호
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  className="input-field"
                  autoFocus
                />
              </div>

              {authError && (
                <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-600 dark:text-red-300">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={verifying || !password}
              >
                {verifying ? '확인 중…' : '확인'}
              </button>
            </form>

            <p className="text-xs text-white/40 text-center mt-4">
              초기 비밀번호: admin
            </p>
          </div>
        </main>
      </>
    )
  }

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

        {/* 데이터베이스 선택 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-1">데이터베이스</h3>
          <p className="text-xs text-white/50 mb-4">
            사용할 데이터베이스를 선택합니다. 기본값은 RDS (PostgreSQL)입니다.
          </p>
          <div className="space-y-3">
            <label
              className={`flex items-start gap-3 rounded-md border p-4 cursor-pointer transition-colors ${
                dbType === 'rds'
                  ? 'border-brand-500/60 bg-brand-500/10'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              } ${!rdsAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="db-type"
                checked={dbType === 'rds'}
                disabled={!rdsAvailable || dbSwitching}
                onChange={() => handleDbSwitch('rds')}
                className="mt-1 accent-brand-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">RDS (PostgreSQL)</span>
                  <Badge variant="success">권장</Badge>
                  {dbType === 'rds' && <Badge variant="success">사용 중</Badge>}
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  AWS RDS 프로덕션 데이터베이스 — 팀 공유 데이터
                </div>
                {!rdsAvailable && (
                  <div className="text-xs text-amber-400 mt-1">
                    DATABASE_URL 환경변수가 설정되지 않아 사용 불가
                  </div>
                )}
              </div>
            </label>

            <label
              className={`flex items-start gap-3 rounded-md border p-4 cursor-pointer transition-colors ${
                dbType === 'sqlite'
                  ? 'border-brand-500/60 bg-brand-500/10'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <input
                type="radio"
                name="db-type"
                checked={dbType === 'sqlite'}
                disabled={dbSwitching}
                onChange={() => handleDbSwitch('sqlite')}
                className="mt-1 accent-brand-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">SQLite (로컬)</span>
                  {dbType === 'sqlite' && <Badge variant="warning">사용 중</Badge>}
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  로컬 개발용 경량 데이터베이스 — backend/data/building.db
                </div>
              </div>
            </label>
          </div>

          {dbUrl && (
            <div className="mt-3 px-3 py-2 rounded bg-white/5 border border-white/10">
              <span className="text-xs text-white/40">연결 주소: </span>
              <span className="text-xs font-mono text-white/60 break-all">{dbUrl}</span>
            </div>
          )}

          {dbSwitching && (
            <div className="mt-3 text-sm text-amber-400">전환 중…</div>
          )}
        </section>

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

        {/* 업로드 제한 설정 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-1">업로드 제한</h3>
          <p className="text-xs text-white/50 mb-4">
            DXF 파일 업로드 시 최대 허용 용량을 설정합니다.
          </p>
          <div className="flex gap-4 items-end">
            <div className="flex-1 max-w-xs">
              <label className="mb-1.5 block text-sm font-medium text-white/80">
                DXF 최대 업로드 용량 (MB)
              </label>
              <input
                type="number"
                value={maxDxfSizeMb}
                onChange={(e) => update('max_dxf_size_mb', e.target.value)}
                min="1"
                max="500"
                className="input-field font-mono text-sm"
              />
            </div>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => saveAll(['max_dxf_size_mb'])}
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
          <p className="text-xs text-white/40 mt-2">
            권장: 50MB 이하. 대용량 파일은 처리 시간이 길어질 수 있습니다.
          </p>
        </section>

        {/* AI 재학습 트리거 설정 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-1">AI 재학습 트리거</h3>
          <p className="text-xs text-white/50 mb-4">
            신뢰도 기반 또는 주기별로 모델 재학습을 트리거합니다.
          </p>

          {/* 탭 */}
          <div className="flex border-b border-white/10 mb-4">
            <button
              onClick={() => setRetrainTab('confidence')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                retrainTab === 'confidence'
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-white/50 hover:text-white/80'
              }`}
            >
              신뢰도 기반
            </button>
            <button
              onClick={() => setRetrainTab('periodic')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                retrainTab === 'periodic'
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-white/50 hover:text-white/80'
              }`}
            >
              주기별 재학습
            </button>
          </div>

          {/* 신뢰도 기반 탭 */}
          {retrainTab === 'confidence' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-4">
                <div>
                  <div className="text-sm font-semibold">자동 재학습 트리거</div>
                  <div className="text-xs text-white/50 mt-0.5">
                    신뢰도 기준 미달 시 AI 서버에 학습 잡을 즉시 추가합니다.
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = retrainEnabled ? 'false' : 'true'
                    saveImmediate('retrain_auto_enabled', next)
                  }}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    retrainEnabled ? 'bg-brand-500' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      retrainEnabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/80">
                  신뢰도 임계값 (%)
                </label>
                <div className="flex gap-4 items-center">
                  <input
                    type="range"
                    value={retrainThreshold}
                    onChange={(e) => update('retrain_confidence_threshold', e.target.value)}
                    min="50"
                    max="95"
                    step="5"
                    className="flex-1 accent-brand-500"
                  />
                  <div className="w-16 text-center">
                    <span className="text-lg font-semibold font-mono">{retrainThreshold}</span>
                    <span className="text-white/50">%</span>
                  </div>
                </div>
                <p className="text-xs text-white/40 mt-2">
                  최근 7일 평균 추론 신뢰도가 이 값 미만이면 학습 잡을 자동
                  추가합니다. (권장: 70~80%)
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  disabled={saving}
                  onClick={() => saveAll(['retrain_confidence_threshold', 'retrain_auto_enabled'])}
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          )}

          {/* 주기별 재학습 탭 */}
          {retrainTab === 'periodic' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-4">
                <div>
                  <div className="text-sm font-semibold">주기별 자동 재학습</div>
                  <div className="text-xs text-white/50 mt-0.5">
                    설정된 주기마다 자동으로 모델 재학습 실행
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next = periodicRetrainEnabled ? 'false' : 'true'
                    saveImmediate('periodic_retrain_enabled', next)
                  }}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    periodicRetrainEnabled ? 'bg-brand-500' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      periodicRetrainEnabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/80">
                  재학습 주기
                </label>
                <select
                  value={periodicRetrainInterval}
                  onChange={(e) => update('periodic_retrain_interval', e.target.value)}
                  className="input-field text-sm"
                >
                  <option value="7">1주일마다</option>
                  <option value="14">2주일마다</option>
                  <option value="30">1개월마다</option>
                  <option value="60">2개월마다</option>
                  <option value="90">3개월마다</option>
                </select>
              </div>

              {/* 스케줄러 상태 표시 */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">스케줄러 상태</div>
                  <button
                    onClick={loadRetrainStatus}
                    disabled={loadingRetrainStatus}
                    className="text-xs text-brand-400 hover:text-brand-300"
                  >
                    {loadingRetrainStatus ? '새로고침 중…' : '새로고침'}
                  </button>
                </div>

                {retrainStatus ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${retrainStatus.scheduler_running ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      <span className="text-sm">
                        {retrainStatus.scheduler_running ? '스케줄러 실행 중' : '스케줄러 중지됨'}
                      </span>
                    </div>
                    {retrainStatus.last_auto_retrain && (
                      <div className="text-xs text-white/50">
                        마지막 자동 재학습: {new Date(retrainStatus.last_auto_retrain).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                        {retrainStatus.last_auto_retrain_reason && (
                          <span className="text-white/40"> ({retrainStatus.last_auto_retrain_reason})</span>
                        )}
                      </div>
                    )}
                    {retrainStatus.periodic.next_run && (
                      <div className="text-xs text-white/50">
                        다음 주기별 재학습: {new Date(retrainStatus.periodic.next_run).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                      </div>
                    )}
                    <div className="text-xs text-white/40">
                      (매 1시간마다 조건 체크)
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-white/40">
                    {loadingRetrainStatus ? '상태 로딩 중…' : '스케줄러 상태를 불러올 수 없습니다'}
                  </div>
                )}
              </div>

              {periodicRetrainLastRun && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-white/50 mb-1">마지막 주기별 재학습</div>
                  <div className="text-sm font-mono">
                    {new Date(periodicRetrainLastRun).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </div>
                  <div className="text-xs text-white/40 mt-2">
                    다음 예정: {(() => {
                      const last = new Date(periodicRetrainLastRun)
                      const next = new Date(last.getTime() + Number(periodicRetrainInterval) * 24 * 60 * 60 * 1000)
                      return next.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
                    })()}
                  </div>
                </div>
              )}

              {!periodicRetrainLastRun && periodicRetrainEnabled && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-300">
                  아직 주기별 재학습이 실행된 적이 없습니다. 활성화 후 첫 주기가 지나면 자동 실행됩니다.
                </div>
              )}

              <div className="flex justify-between items-center">
                <button
                  onClick={handleTriggerRetrain}
                  disabled={triggeringRetrain}
                  className="btn-secondary flex items-center gap-2"
                >
                  <span>🔄</span>
                  {triggeringRetrain ? '재학습 트리거 중…' : '지금 재학습 실행'}
                </button>
                <button
                  className="btn-primary"
                  disabled={saving}
                  onClick={() => saveAll(['periodic_retrain_enabled', 'periodic_retrain_interval'])}
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          )}
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

        {/* 접근 비밀번호 변경 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-1">접근 비밀번호 변경</h3>
          <p className="text-xs text-white/50 mb-4">
            서비스 설정 페이지 접근 시 요구되는 비밀번호를 변경합니다.
          </p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-white/80 mb-1.5">
                새 비밀번호
              </label>
              <input
                type="password"
                value={settings.service_password ?? ''}
                onChange={(e) => update('service_password', e.target.value)}
                placeholder="새 비밀번호 입력"
                className="input-field font-mono text-sm"
              />
            </div>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => saveAll(['service_password'])}
            >
              {saving ? '저장 중…' : '비밀번호 저장'}
            </button>
          </div>
        </section>
      </main>
    </>
  )
}
