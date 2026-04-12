'use client'

import { useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import { StatCard, Badge } from '@/components/admin/AdminUI'
import { adminApi, healthCheck } from '@/lib/api'

interface DashboardData {
  total_users: number
  total_projects: number
  total_validations: number
  valid_count: number
  invalid_count: number
  pass_rate: number
  weekly: Array<{ day: string; count: number }>
  recent_projects: any[]
  recent_events: any[]
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [health, setHealth] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await adminApi.dashboard()
        if (!cancelled) setData(res)
      } catch (e: any) {
        if (!cancelled) setError(e.message || '대시보드 로드 실패')
      }
      try {
        const h = await healthCheck()
        if (!cancelled) setHealth(h)
      } catch {
        if (!cancelled) setHealth({ status: 'error' })
      }
    }

    load()
    const timer = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const backendOk = health?.status === 'healthy' || health?.status === 'ok'
  const weeklyCounts = (data?.weekly || []).map((w) => w.count)
  const weeklyBars = weeklyCounts.length === 7 ? weeklyCounts : [0, 0, 0, 0, 0, 0, 0]
  const maxBar = Math.max(1, ...weeklyBars)
  const dayLabels = ['월', '화', '수', '목', '금', '토', '일']

  return (
    <>
      <AdminTopbar
        title="대시보드"
        description="시스템 전반의 상태와 주요 지표를 확인합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* KPI row */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="전체 사용자"
            value={data ? data.total_users.toLocaleString() : '—'}
            change="DB 기준"
          />
          <StatCard
            label="활성 프로젝트"
            value={data ? data.total_projects.toLocaleString() : '—'}
            change="전체 프로젝트"
          />
          <StatCard
            label="총 검토 수"
            value={data ? data.total_validations.toLocaleString() : '—'}
            change={
              data
                ? `적합률 ${data.pass_rate.toFixed(1)}%`
                : '—'
            }
            changeType={data && data.pass_rate >= 50 ? 'up' : 'down'}
          />
          <StatCard
            label="서버 상태"
            value={backendOk ? '정상 가동' : '오프라인'}
            change={`적합 ${data?.valid_count ?? 0} · 부적합 ${data?.invalid_count ?? 0}`}
            valueColor={backendOk ? 'text-emerald-300' : 'text-red-300'}
          />
        </div>

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="text-xs font-semibold text-white/60 mb-4">
              주간 신규 프로젝트
            </div>
            <div className="flex items-end gap-2 h-24">
              {weeklyBars.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-brand-400/70 hover:bg-brand-400 transition-colors"
                  style={{ height: `${(h / maxBar) * 100}%` }}
                  title={`${h}건`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-white/30">
              {dayLabels.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="text-xs font-semibold text-white/60 mb-4">
              최근 이벤트
            </div>
            <ul className="space-y-0 font-mono text-[11px]">
              {(data?.recent_events || []).length === 0 && (
                <li className="text-white/30 px-3 py-2">이벤트가 없습니다.</li>
              )}
              {(data?.recent_events || []).slice(0, 6).map((e: any) => {
                const color =
                  e.level === 'error'
                    ? 'bg-red-500/10 text-red-300'
                    : e.level === 'warn'
                    ? 'bg-amber-500/10 text-amber-300'
                    : 'text-white/60'
                return (
                  <li key={e.id} className={`px-3 py-2 rounded ${color}`}>
                    [{e.ts?.slice(5, 16) || '—'}] {e.message}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Recent projects table */}
        <div className="card p-5">
          <h3 className="text-base font-semibold mb-4">최근 프로젝트</h3>
          {!data || data.recent_projects.length === 0 ? (
            <p className="text-sm text-white/40">표시할 프로젝트가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    이름
                  </th>
                  <th className="text-left py-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    주소
                  </th>
                  <th className="text-left py-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    생성
                  </th>
                  <th className="text-left py-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    상태
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.recent_projects.map((p: any) => (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 font-medium text-white">{p.name}</td>
                    <td className="py-3 text-white/50">{p.address || '—'}</td>
                    <td className="py-3 text-white/50">
                      {p.created_at
                        ? new Date(p.created_at).toLocaleDateString('ko-KR')
                        : '—'}
                    </td>
                    <td className="py-3">
                      <Badge variant="success">Active</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  )
}
