'use client'

import { useCallback, useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import { StatCard } from '@/components/admin/AdminUI'
import { adminApi, AdminLog } from '@/lib/api'

type LogLevel = 'info' | 'warn' | 'error'

const LEVEL_STYLES: Record<
  LogLevel,
  { text: string; bg: string; label: string }
> = {
  info: { text: 'text-white/60', bg: 'bg-white/[0.02]', label: 'INFO' },
  warn: { text: 'text-amber-300', bg: 'bg-amber-500/5', label: 'WARN' },
  error: { text: 'text-red-300', bg: 'bg-red-500/5', label: 'ERROR' },
}

export default function AdminLogsPage() {
  const [filter, setFilter] = useState<'all' | LogLevel>('all')
  const [query, setQuery] = useState('')
  const [logs, setLogs] = useState<AdminLog[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({
    total: 0,
    info: 0,
    warn: 0,
    error: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listLogs({
        level: filter,
        q: query || undefined,
        limit: 300,
      })
      setLogs(res.logs)
      setCounts(res.counts)
    } catch (e: any) {
      setError(e.message || '로그 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [filter, query])

  // Debounced query + poll
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  return (
    <>
      <AdminTopbar
        title="로그"
        description="시스템 로그를 실시간으로 조회하고 이슈를 추적합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="전체 로그"
            value={(counts.total ?? 0).toString()}
            change="버퍼 내 기록"
            changeType="neutral"
          />
          <StatCard
            label="정보"
            value={(counts.info ?? 0).toString()}
            change="정상 이벤트"
            changeType="neutral"
          />
          <StatCard
            label="경고"
            value={(counts.warn ?? 0).toString()}
            change="확인 권장"
            changeType="neutral"
            valueColor="text-amber-300"
          />
          <StatCard
            label="오류"
            value={(counts.error ?? 0).toString()}
            change="즉시 확인"
            changeType="down"
            valueColor="text-red-300"
          />
        </div>

        <div className="card p-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="메시지 / 소스 검색"
            className="input-field flex-1 min-w-[240px] font-mono"
          />
          <div className="flex gap-1 rounded-md border border-white/10 bg-white/5 p-1">
            {(['all', 'info', 'warn', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                  filter === f
                    ? 'bg-brand-500/25 text-brand-200'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                {f === 'all' ? '전체' : LEVEL_STYLES[f].label}
              </button>
            ))}
          </div>
          <button className="btn-secondary" onClick={load}>
            새로고침
          </button>
        </div>

        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="card p-0 overflow-hidden">
          <div className="max-h-[560px] overflow-y-auto">
            {!loading && logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-white/40">
                조건에 맞는 로그가 없습니다.
              </div>
            ) : (
              logs.map((l) => {
                const level = (l.level as LogLevel) || 'info'
                const s = LEVEL_STYLES[level] || LEVEL_STYLES.info
                return (
                  <div
                    key={l.id}
                    className={`flex items-start gap-3 px-4 py-2 border-b border-white/5 font-mono text-[11px] ${s.bg}`}
                  >
                    <span className="text-white/40 shrink-0">{l.ts}</span>
                    <span className={`font-bold shrink-0 w-12 ${s.text}`}>
                      {s.label}
                    </span>
                    <span className="text-brand-300/80 shrink-0 w-40 truncate">
                      {l.source}
                    </span>
                    <span className={`flex-1 break-all ${s.text}`}>
                      {l.message}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </main>
    </>
  )
}
