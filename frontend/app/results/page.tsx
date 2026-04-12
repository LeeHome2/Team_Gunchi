'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppNav from '@/components/AppNav'
import { listProjects } from '@/lib/api'

interface Project {
  id: string
  name: string
  address?: string | null
  created_at?: string
  status?: string
}

/**
 * Results index — list of recent projects with their compliance scores.
 * Clicking a project navigates to /results/[id].
 */
export default function ResultsIndexPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const result = await listProjects(0, 50)
        setProjects(result?.projects || result || [])
      } catch (err: any) {
        setError(err?.message || '프로젝트를 불러올 수 없습니다.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <AppNav />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-3xl font-bold">검토 결과</h1>
        <p className="mt-1 text-sm text-white/50">
          DXF 업로드 후 자동 생성된 규제 준수 검토 리포트를 확인합니다.
        </p>

        {error && (
          <div className="mt-6 rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-8">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="spinner" />
            </div>
          ) : projects.length === 0 ? (
            <div className="card p-12 text-center">
              <h3 className="text-lg font-semibold">결과 없음</h3>
              <p className="mt-1 text-sm text-white/50">
                먼저 프로젝트를 생성하고 DXF를 업로드하세요.
              </p>
              <Link href="/projects" className="btn-primary mt-6 inline-flex">
                프로젝트로 이동
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((p, i) => (
                <Link
                  key={p.id}
                  href={`/results/${p.id}`}
                  className="card card-hover p-5 block"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="tag-brand text-[10px]">Report</div>
                      <h3 className="mt-2 font-semibold text-white line-clamp-1">
                        {p.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-white/40 line-clamp-1">
                        {p.address || '주소 미지정'}
                      </p>
                    </div>
                    <ScoreRing score={mockScore(i)} />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <MiniStat label="건폐율" value="49%" ok />
                    <MiniStat label="용적률" value="198%" ok />
                    <MiniStat label="이격거리" value="1.8m" warn />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function mockScore(i: number) {
  return [98.2, 94.5, 87.1, 91.3, 76.8, 99.1][i % 6]
}

function ScoreRing({ score }: { score: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  const color =
    score >= 90 ? '#22C55E' : score >= 75 ? '#F59E0B' : '#EF4444'

  return (
    <div className="relative h-14 w-14">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} stroke="rgba(255,255,255,0.1)" strokeWidth="4" fill="none" />
        <circle
          cx="28"
          cy="28"
          r={r}
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
        {score.toFixed(0)}
      </div>
    </div>
  )
}

function MiniStat({ label, value, ok, warn }: { label: string; value: string; ok?: boolean; warn?: boolean }) {
  const color = warn ? 'text-amber-300' : ok ? 'text-emerald-300' : 'text-white/70'
  return (
    <div className="rounded-md bg-white/5 px-2 py-1.5 border border-white/5">
      <div className="text-[10px] text-white/40">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  )
}
