'use client'

import { useEffect, useState } from 'react'
import AppNav from '@/components/AppNav'
import { healthCheck } from '@/lib/api'

type Tab = 'profile' | 'api' | 'ai' | 'appearance' | 'about'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile')
  const [health, setHealth] = useState<any>(null)
  const [apiUrl, setApiUrl] = useState('')

  useEffect(() => {
    setApiUrl(window.location.origin)
    ;(async () => {
      try {
        const res = await healthCheck()
        setHealth(res)
      } catch {
        setHealth({ status: 'error' })
      }
    })()
  }, [])

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <AppNav />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-bold">설정</h1>
        <p className="mt-1 text-sm text-white/50">프로필, API 연결, 테마를 관리합니다.</p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[220px_1fr]">
          {/* Tabs */}
          <nav className="card p-2 h-fit">
            {(
              [
                { id: 'profile', label: '프로필' },
                { id: 'api', label: 'API 연결' },
                { id: 'ai', label: 'AI 모델' },
                { id: 'appearance', label: '테마' },
                { id: 'about', label: '정보' },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  tab === t.id
                    ? 'w-full text-left px-3 py-2 rounded-md text-sm font-semibold bg-brand-500/20 border border-brand-400/30 text-white'
                    : 'w-full text-left px-3 py-2 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5'
                }
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Panel */}
          <div className="card p-6">
            {tab === 'profile' && <ProfilePanel />}
            {tab === 'api' && <ApiPanel apiUrl={apiUrl} health={health} />}
            {tab === 'ai' && <AIModelPanel />}
            {tab === 'appearance' && <AppearancePanel />}
            {tab === 'about' && <AboutPanel />}
          </div>
        </div>
      </main>
    </div>
  )
}

function ProfilePanel() {
  const [name, setName] = useState('이호민')
  const [email, setEmail] = useState('homindol@gmail.com')
  const [org, setOrg] = useState('가천대 SW')

  return (
    <section>
      <h2 className="text-lg font-semibold">프로필</h2>
      <div className="mt-6 flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-brand-gradient flex items-center justify-center text-2xl font-bold text-white">
          {name.slice(0, 1)}
        </div>
        <button className="btn-secondary text-sm">사진 변경</button>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="이름" value={name} onChange={setName} />
        <Field label="이메일" value={email} onChange={setEmail} type="email" />
        <Field label="소속" value={org} onChange={setOrg} />
      </div>
      <div className="mt-6 flex justify-end">
        <button className="btn-primary">저장</button>
      </div>
    </section>
  )
}

function ApiPanel({ apiUrl, health }: { apiUrl: string; health: any }) {
  const ok = health?.status === 'healthy' || health?.status === 'ok'
  return (
    <section>
      <h2 className="text-lg font-semibold">API 연결</h2>
      <p className="mt-1 text-sm text-white/50">
        백엔드 서버 주소와 연결 상태를 확인합니다.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/80">
            백엔드 URL
          </label>
          <input className="input-field font-mono" value={apiUrl} readOnly />
          <p className="mt-1 text-xs text-white/40">
            .env.local의 NEXT_PUBLIC_API_URL을 통해 변경할 수 있습니다.
          </p>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">백엔드 상태</div>
              <div className="text-xs text-white/50">
                GET /health
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  ok ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                }`}
              />
              <span className={ok ? 'text-emerald-300 text-sm' : 'text-red-300 text-sm'}>
                {ok ? '정상' : health === null ? '확인 중...' : '오프라인'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="text-sm font-semibold text-amber-300">AI 서버 상태</div>
          <p className="mt-1 text-xs text-white/60">
            학과 서버(ceprj2) HTTP 엔드포인트 연결은 현재 Mock fallback 상태입니다.
            팀원과 FastAPI 엔드포인트 연동 후 자동으로 실서버를 사용합니다.
          </p>
        </div>
      </div>
    </section>
  )
}

// ============================================================================
// AI Model Panel (사용자용 — 읽기 전용)
//
// 학과 분류 서버(/api/ai/active-model)에서 현재 적용 중인 모델 정보를 직접
// 가져와 표시한다. 서버 연결 실패 시에만 mock 표시로 fallback.
// 모델 교체·활성화는 관리자 콘솔(/admin/ai)에서만 가능하다.
// ============================================================================

interface ActiveModelInfo {
  active: {
    run_id?: string
    model_version?: string
    algorithm?: string
    deployed_at?: string | null
    metrics?: {
      accuracy?: number
      f1?: number
      [k: string]: unknown
    }
    [k: string]: unknown
  } | null
  ai_server?: string
  reason?: string
}

const MOCK_FALLBACK = {
  name: 'Layer Classifier (Mock)',
  version: 'mock-v1.0',
  type: 'classifier',
  description:
    'AI 서버 연결이 끊겼을 때 사용하는 규칙 기반 분류기. 레이어명 키워드(WALL/벽 등)로 추정합니다.',
  accuracy: null as number | null,
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR')
  } catch {
    return iso
  }
}

function AIModelPanel() {
  const [info, setInfo] = useState<ActiveModelInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/active-model')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ActiveModelInfo = await res.json()
      setInfo(data)
    } catch (e: any) {
      setError(e.message || 'AI 모델 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMounted(true)
    load()
  }, [])

  const isLive = !!info?.active
  const accuracy = info?.active?.metrics?.accuracy
  const display = isLive
    ? {
        name: info!.active!.algorithm
          ? `${info!.active!.algorithm} Classifier`
          : 'Layer Classifier',
        version: info!.active!.model_version || info!.active!.run_id || '—',
        type: 'classifier',
        description: '학과 AI 서버에서 운영 중인 실제 분류 모델입니다.',
        accuracy: typeof accuracy === 'number' ? accuracy : null,
      }
    : MOCK_FALLBACK

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">AI 모델</h2>
          <p className="mt-1 text-sm text-white/50">
            현재 시스템이 사용하는 AI 모델 정보입니다. 읽기 전용이며, 변경은 관리자만 할 수
            있어요.
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/60 flex-shrink-0">
          읽기 전용
        </span>
      </div>

      {/* Admin-only notice */}
      <div className="mt-5 rounded-lg border border-amber-400/25 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-8 w-8 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <svg className="h-4 w-4 text-amber-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-7a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2zm10-11V7a4 4 0 10-8 0v4h8z" />
            </svg>
          </div>
          <div className="flex-1 text-xs text-white/70">
            <div className="text-sm font-semibold text-amber-200 mb-0.5">관리자 전용 설정</div>
            AI 분류기 모델 교체·활성화, AI 서버 엔드포인트 변경은{' '}
            <span className="font-mono text-amber-200">/admin/ai</span> 관리자 콘솔에서만
            수행할 수 있습니다. 일반 사용자는 현재 적용된 모델 정보를 확인만 할 수 있어요.
          </div>
        </div>
      </div>

      {/* Current model card (read-only) */}
      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-white/40">현재 활성 모델</div>
            <div className="mt-1 text-base font-semibold text-white">
              {loading ? '불러오는 중…' : display.name}
            </div>
            <div className="mt-0.5 font-mono text-xs text-white/50 break-all">
              {display.version}
            </div>
            {isLive && info?.active?.deployed_at && (
              <div className="mt-1 text-[11px] text-white/40">
                배포: {fmtDate(info.active.deployed_at as string)}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {isLive ? (
              <span className="rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                서버 연결됨
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/15 border border-amber-400/30 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                Mock fallback
              </span>
            )}
            <button
              onClick={load}
              className="text-[11px] text-white/50 hover:text-white underline-offset-2 hover:underline"
            >
              새로고침
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm text-white/60">{display.description}</p>
        {display.accuracy != null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>정확도</span>
              <span className="font-mono text-white/80">
                {(display.accuracy * 100).toFixed(1)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-emerald-400"
                style={{ width: `${display.accuracy * 100}%` }}
              />
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs text-red-300">{error}</div>
        )}
        {!isLive && !loading && info?.reason && (
          <div className="mt-3 text-[11px] text-white/40">
            상태: {info.reason === 'unreachable'
              ? 'AI 서버 연결 실패'
              : info.reason === 'no_active_model'
                ? '운영 중인 모델이 없습니다'
                : info.reason}
          </div>
        )}
      </div>

      {/* AI server endpoint (read-only display) */}
      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <div className="text-sm font-semibold text-white/80">AI 서버 엔드포인트</div>
        <p className="mt-1 text-xs text-white/50">
          백엔드 <span className="font-mono">/api/classify</span> 프록시가 요청을 전달할 주소입니다.
        </p>
        <div className="mt-3">
          <input
            type="text"
            value={mounted ? info?.ai_server || '—' : ''}
            readOnly
            className="input-field font-mono text-white/70 cursor-not-allowed"
            aria-readonly
          />
        </div>
      </div>
    </section>
  )
}

function AppearancePanel() {
  type Theme = 'light' | 'dark'
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const initial = document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
    setTheme(initial)
    setMounted(true)
  }, [])

  const apply = (next: Theme) => {
    setTheme(next)
    const root = document.documentElement
    if (next === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    try {
      localStorage.setItem('geonchi.theme', next)
    } catch {
      // ignore
    }
  }

  const options: { id: Theme; label: string; description: string }[] = [
    {
      id: 'light',
      label: '라이트',
      description: '밝은 배경과 높은 가독성',
    },
    {
      id: 'dark',
      label: '다크',
      description: '눈의 피로가 적은 어두운 테마',
    },
  ]

  return (
    <section>
      <h2 className="text-lg font-semibold">테마</h2>
      <p className="mt-1 text-sm text-white/50">
        라이트 / 다크 모드를 선택합니다. 선택 즉시 전체 인터페이스에 적용되고 다음 방문 시에도 유지됩니다.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const active = mounted && theme === opt.id
          const isLight = opt.id === 'light'
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => apply(opt.id)}
              aria-pressed={active}
              className={`rounded-lg border p-4 text-left transition-all ${
                active
                  ? 'border-brand-400/60 bg-brand-500/10 ring-2 ring-brand-400/30'
                  : 'border-white/10 bg-white/5 hover:border-white/25'
              }`}
            >
              <div
                className={`h-16 rounded mb-3 flex items-center justify-center ${
                  isLight
                    ? 'bg-gradient-to-br from-white to-slate-200 text-slate-700'
                    : 'bg-gradient-to-br from-navy-800 to-navy-950 text-white/70'
                }`}
              >
                {isLight ? (
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4" />
                    <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                  </svg>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{opt.label}</div>
                {active && (
                  <span className="text-xs font-semibold text-brand-300">적용 중</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-white/50">{opt.description}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AboutPanel() {
  return (
    <section>
      <h2 className="text-lg font-semibold">정보</h2>
      <dl className="mt-6 divide-y divide-white/5">
        {[
          ['제품', 'Geonchi — Build Smarter. Verify Instantly.'],
          ['버전', 'v2.4 Technical Preview'],
          ['엔진', 'CesiumJS 1.114 · Next.js 14 · FastAPI'],
          ['팀', '가천대 종합프로젝트 6조'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-3 text-sm">
            <dt className="text-white/50">{k}</dt>
            <dd className="text-white font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-white/80">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
      />
    </div>
  )
}
