'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import AppNav from '@/components/AppNav'
import { getProject } from '@/lib/api'

interface ValidationData {
  id: string
  is_valid: boolean
  building_coverage?: { value: number; limit: number; status: string }
  setback?: { min_distance_m: number; required_m: number; status: string }
  height_check?: { value_m: number; limit_m: number; status: string }
  violations?: Array<{ code?: string; message: string }>
  zone_type?: string
  created_at?: string
}

interface ProjectDetail {
  id: string
  name: string
  address?: string | null
  created_at?: string
  zone_type?: string | null
  validation_results?: ValidationData[]
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

  // 가장 최근 validation 결과 사용
  const latest = project?.validation_results?.[project.validation_results.length - 1]
  const hasValidation = !!latest?.building_coverage

  // 실제 데이터가 있으면 사용, 없으면 '데이터 없음' 표시
  const metrics = hasValidation
    ? {
        coverage: {
          value: latest!.building_coverage!.value,
          limit: latest!.building_coverage!.limit,
          unit: '%',
        },
        setback: {
          value: latest!.setback?.min_distance_m ?? 0,
          limit: latest!.setback?.required_m ?? 0,
          unit: 'm',
        },
        height: {
          value: latest!.height_check?.value_m ?? 0,
          limit: latest!.height_check?.limit_m ?? 0,
          unit: 'm',
        },
      }
    : null

  const violations = hasValidation
    ? [
        {
          level: latest!.building_coverage?.status === 'OK' ? 'ok' : 'warn',
          title: '건폐율',
          detail: `${latest!.building_coverage!.value.toFixed(1)}% / 제한 ${latest!.building_coverage!.limit}%`,
        },
        {
          level: latest!.setback?.status === 'OK' ? 'ok' : 'warn',
          title: '이격거리',
          detail: `최소 ${latest!.setback?.min_distance_m?.toFixed(1)}m / 요구 ${latest!.setback?.required_m}m`,
        },
        {
          level: latest!.height_check?.status === 'OK' ? 'ok' : 'warn',
          title: '높이 제한',
          detail: `${latest!.height_check?.value_m}m / 제한 ${latest!.height_check?.limit_m}m`,
        },
        ...(latest!.violations || []).map((v) => ({
          level: 'err' as const,
          title: v.code || '위반',
          detail: v.message,
        })),
      ]
    : []

  const okCount = violations.filter((v) => v.level === 'ok').length
  const warnCount = violations.filter((v) => v.level === 'warn').length
  const errCount = violations.filter((v) => v.level === 'err').length
  const totalChecks = violations.length || 1
  const score = hasValidation ? Math.round((okCount / totalChecks) * 100) : null

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <AppNav />

      <main className="mx-auto max-w-7xl px-6 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-white/40 mb-6">
          <Link href="/results" className="hover:text-white">
            결과
          </Link>
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
                  {project?.address || '주소 미지정'} · 생성{' '}
                  {project?.created_at
                    ? new Date(project.created_at).toLocaleString('ko-KR')
                    : '—'}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/editor?projectId=${id}`} className="btn-secondary">
                  에디터에서 열기
                </Link>
              </div>
            </div>

            {!hasValidation ? (
              <div className="mt-10 card p-12 text-center">
                <p className="text-white/50 text-lg">
                  아직 배치 검토가 수행되지 않았습니다.
                </p>
                <p className="text-white/30 text-sm mt-2">
                  에디터에서 건물을 배치하고 &ldquo;4. 검토&rdquo; 탭에서 규정 검토를 실행하세요.
                </p>
                <Link href={`/editor?projectId=${id}`} className="btn-primary mt-6 inline-flex">
                  에디터로 이동
                </Link>
              </div>
            ) : (
              <>
                {/* Score + metrics */}
                <div className="mt-10 grid gap-6 lg:grid-cols-3">
                  {/* Big score */}
                  <div className="card p-8 relative overflow-hidden lg:col-span-1">
                    <div className="absolute inset-0 bg-radial-glow opacity-70" />
                    <div className="relative">
                      <div className="tag-brand">Compliance Score</div>
                      <div className="mt-4 flex items-baseline gap-2">
                        <span className="text-6xl font-bold heading-gradient">
                          {score}
                        </span>
                        <span className="text-2xl font-semibold text-white/60">%</span>
                      </div>
                      <p className="mt-2 text-sm text-white/60">
                        전체 {totalChecks}개 항목 중 {okCount}개 준수
                        {warnCount > 0 && `, ${warnCount}개 경고`}
                        {errCount > 0 && `, ${errCount}개 위반`}
                      </p>
                      <div className="mt-6 divider" />
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <StatBox label="준수" value={String(okCount)} color="text-emerald-300" />
                        <StatBox label="경고" value={String(warnCount)} color="text-amber-300" />
                        <StatBox label="위반" value={String(errCount)} color="text-red-300" />
                      </div>
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div className="card p-6 lg:col-span-2">
                    <h3 className="text-lg font-semibold">상세 지표</h3>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {metrics && (
                        <>
                          <MetricBar
                            label="건폐율"
                            value={metrics.coverage.value}
                            limit={metrics.coverage.limit}
                            unit={metrics.coverage.unit}
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
                        </>
                      )}
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
  const ratio = minMode ? value / limit : value / limit
  const pct = Math.min(100, Math.max(0, ratio * 100))
  const ok = minMode ? value >= limit : value <= limit
  const warn = minMode
    ? value >= limit * 0.9 && value < limit
    : value > limit * 0.9 && value <= limit

  const color = ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-400'

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-mono text-white">
          {value.toFixed(1)}
          {unit}
          <span className="text-white/40">
            {' '}
            / {limit}
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
