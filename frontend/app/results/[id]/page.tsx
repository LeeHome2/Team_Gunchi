'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import AppNav from '@/components/AppNav'
import { getProject } from '@/lib/api'

interface ProjectDetail {
  id: string
  name: string
  address?: string | null
  created_at?: string
  status?: string
  metadata?: Record<string, any>
}

export default function ResultDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const p = await getProject(id)
        setProject(p)
      } catch (err: any) {
        setError(err?.message || '프로젝트를 불러올 수 없습니다.')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  // mock metrics (real values come from validate-placement response)
  const metrics = {
    coverage: { value: 49.2, limit: 60, unit: '%' },
    far: { value: 198, limit: 250, unit: '%' },
    setback: { value: 1.8, limit: 2.0, unit: 'm' },
    height: { value: 28, limit: 30, unit: 'm' },
  }

  const violations = [
    { level: 'warn', title: '이격거리 부족', detail: '북측 경계선 기준 0.2m 부족 (요구 2.0m)' },
    { level: 'ok', title: '건폐율 준수', detail: '49.2% / 제한 60%' },
    { level: 'ok', title: '용적률 준수', detail: '198% / 제한 250%' },
    { level: 'ok', title: '높이 제한 준수', detail: '28m / 제한 30m' },
  ]

  const score = 94.5

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <AppNav />

      <main className="mx-auto max-w-7xl px-6 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-white/40 mb-6">
          <Link href="/results" className="hover:text-white">결과</Link>
          <span>/</span>
          <span className="text-white/70">{project?.name || id}</span>
        </nav>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="spinner" />
          </div>
        ) : error ? (
          <div className="card p-8 text-center">
            <p className="text-red-300">{error}</p>
            <Link href="/results" className="btn-secondary mt-4 inline-flex">
              목록으로
            </Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h1 className="text-3xl font-bold">{project?.name}</h1>
                <p className="mt-1 text-sm text-white/50">
                  {project?.address || '주소 미지정'} · 생성 {project?.created_at ? new Date(project.created_at).toLocaleString('ko-KR') : '—'}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/editor?projectId=${id}`} className="btn-secondary">
                  에디터에서 열기
                </Link>
                <button className="btn-primary">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  PDF 다운로드
                </button>
              </div>
            </div>

            {/* Score + metrics */}
            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {/* Big score */}
              <div className="card p-8 relative overflow-hidden lg:col-span-1">
                <div className="absolute inset-0 bg-radial-glow opacity-70" />
                <div className="relative">
                  <div className="tag-brand">Compliance Score</div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-6xl font-bold heading-gradient">{score}</span>
                    <span className="text-2xl font-semibold text-white/60">%</span>
                  </div>
                  <p className="mt-2 text-sm text-white/60">
                    전체 4개 항목 중 3개 준수, 1개 경고
                  </p>
                  <div className="mt-6 divider" />
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <StatBox label="준수" value="3" color="text-emerald-300" />
                    <StatBox label="경고" value="1" color="text-amber-300" />
                    <StatBox label="위반" value="0" color="text-red-300" />
                  </div>
                </div>
              </div>

              {/* Metrics grid */}
              <div className="card p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold">상세 지표</h3>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <MetricBar
                    label="건폐율"
                    value={metrics.coverage.value}
                    limit={metrics.coverage.limit}
                    unit={metrics.coverage.unit}
                  />
                  <MetricBar
                    label="용적률"
                    value={metrics.far.value}
                    limit={metrics.far.limit}
                    unit={metrics.far.unit}
                  />
                  <MetricBar
                    label="이격거리"
                    value={metrics.setback.value}
                    limit={metrics.setback.limit}
                    unit={metrics.setback.unit}
                    minMode
                  />
                  <MetricBar
                    label="높이"
                    value={metrics.height.value}
                    limit={metrics.height.limit}
                    unit={metrics.height.unit}
                  />
                </div>
              </div>
            </div>

            {/* Violations list */}
            <div className="mt-6 card p-6">
              <h3 className="text-lg font-semibold">검토 항목</h3>
              <ul className="mt-4 divide-y divide-white/5">
                {violations.map((v, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span
                      className={
                        v.level === 'ok'
                          ? 'tag-ok mt-0.5'
                          : v.level === 'warn'
                          ? 'tag-warn mt-0.5'
                          : 'tag-err mt-0.5'
                      }
                    >
                      {v.level === 'ok' ? '준수' : v.level === 'warn' ? '경고' : '위반'}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-white">{v.title}</div>
                      <div className="text-xs text-white/50">{v.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/5 p-2">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-white/40 uppercase tracking-wider">{label}</div>
    </div>
  )
}

function MetricBar({
  label,
  value,
  limit,
  unit,
  minMode = false,
}: {
  label: string
  value: number
  limit: number
  unit: string
  minMode?: boolean
}) {
  // minMode: value must be >= limit
  const ratio = minMode ? value / limit : value / limit
  const pct = Math.min(100, Math.max(0, ratio * 100))
  const ok = minMode ? value >= limit : value <= limit
  const warn = minMode ? value >= limit * 0.9 && value < limit : value > limit * 0.9 && value <= limit

  const color = ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-400'

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-mono text-white">
          {value}
          {unit}
          <span className="text-white/40">
            {' '}/ {limit}
            {unit}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
