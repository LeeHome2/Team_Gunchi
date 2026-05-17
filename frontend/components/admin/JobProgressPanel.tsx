'use client'

import { useEffect, useState, useCallback } from 'react'

interface JobInfo {
  job_id: string
  type: 'train' | 'build' | 'preprocess'
  status: 'running' | 'completed' | 'failed' | 'pending'
  progress?: number
  started_at?: string
  completed_at?: string
  message?: string
  log_tail?: string[]
}

interface Props {
  aiUrl: string
  refreshKey?: number
  onJobCompleted?: () => void
}

export default function JobProgressPanel({ aiUrl, refreshKey = 0, onJobCompleted }: Props) {
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [logTails, setLogTails] = useState<Record<string, string[]>>({})

  // 작업 목록 폴링
  // AI 분류 서버 버그 회피: 학습이 실제로는 끝났는데 잡 큐의 상태 메타가
  // 'running 0%' 로 남는 경우가 있다. 동시에 /api/mlops/experiments 를
  // 조회해 같은 run_id 가 completed 면 표시를 보정한다.
  const fetchJobs = useCallback(async () => {
    try {
      const [jobsRes, expRes] = await Promise.all([
        fetch(`${aiUrl}/api/mlops/jobs`),
        fetch(`${aiUrl}/api/mlops/experiments?limit=100`).catch(() => null),
      ])
      if (!jobsRes.ok) throw new Error(`HTTP ${jobsRes.status}`)
      const data = await jobsRes.json()

      // 완료된 실험의 run_id 집합 (실패 시 빈 set — 보정 없이 진행)
      let completedRunIds = new Set<string>()
      if (expRes && expRes.ok) {
        try {
          const expData = await expRes.json()
          completedRunIds = new Set(
            (expData.experiments || [])
              .filter((e: any) => e.status === 'completed')
              .map((e: any) => e.run_id as string),
          )
        } catch {
          /* ignore */
        }
      }

      const prevRunningIds = jobs.filter((j) => j.status === 'running').map((j) => j.job_id)
      const rawJobs: JobInfo[] = data.jobs || []
      const newJobs: JobInfo[] = rawJobs.map((j) => {
        // 보정 1: train 잡인데 실험 DB 에 completed 면 처리됨
        if (j.status === 'running' && completedRunIds.has(j.job_id)) {
          return { ...j, status: 'completed', progress: 100, message: '완료됨' }
        }
        // 보정 2: build/train 잡이 progress=100% 인데 status 가 running 으로
        //         남아있는 경우(메시지가 '완료' 포함하면 더 확실). 학과 서버의
        //         잡 상태 update 누락 버그 회피.
        if (
          j.status === 'running' &&
          j.progress >= 100 &&
          /완료|complete/i.test(j.message || '')
        ) {
          return { ...j, status: 'completed' }
        }
        return j
      })
      setJobs(newJobs)

      // 완료된 작업 감지
      const nowCompletedIds = newJobs
        .filter((j) => j.status === 'completed' && prevRunningIds.includes(j.job_id))
        .map((j) => j.job_id)

      if (nowCompletedIds.length > 0) {
        onJobCompleted?.()
      }

      setError(null)
    } catch (e: any) {
      // 404면 엔드포인트 없음 - 조용히 실패
      if (!e.message?.includes('404')) {
        setError(e.message || '작업 목록 로드 실패')
      }
    } finally {
      setLoading(false)
    }
  }, [aiUrl, jobs, onJobCompleted])

  // 로그 폴링
  const fetchLog = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`${aiUrl}/api/mlops/jobs/${jobId}/log?tail=30`)
      if (res.ok) {
        const data = await res.json()
        setLogTails(prev => ({ ...prev, [jobId]: data.tail || [] }))
      }
    } catch {
      // 무시
    }
  }, [aiUrl])

  // 초기 로드 및 폴링
  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 5000) // 5초마다 폴링
    return () => clearInterval(interval)
  }, [aiUrl, refreshKey])

  // 확장된 작업의 로그 폴링
  useEffect(() => {
    if (!expandedJobId) return
    fetchLog(expandedJobId)
    const interval = setInterval(() => fetchLog(expandedJobId), 3000)
    return () => clearInterval(interval)
  }, [expandedJobId, fetchLog])

  const runningJobs = jobs.filter(j => j.status === 'running')
  const recentJobs = jobs.filter(j => j.status !== 'running').slice(0, 5)

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'train': return '모델 학습'
      case 'build': return '데이터 전처리'
      case 'preprocess': return '전처리'
      default: return type
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 border border-blue-400/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            진행 중
          </span>
        )
      case 'completed':
        return (
          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            완료
          </span>
        )
      case 'failed':
        return (
          <span className="rounded-full bg-red-500/20 border border-red-400/40 px-2 py-0.5 text-[10px] font-semibold text-red-300">
            실패
          </span>
        )
      default:
        return (
          <span className="rounded-full bg-white/10 border border-white/20 px-2 py-0.5 text-[10px] font-semibold text-white/50">
            {status}
          </span>
        )
    }
  }

  const formatTime = (iso?: string) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('ko-KR')
    } catch {
      return iso
    }
  }

  // 진행 중인 작업이 없으면 숨김
  if (!loading && runningJobs.length === 0 && recentJobs.length === 0) {
    return null
  }

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold">작업 진행 상황</h3>
          {runningJobs.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 border border-blue-400/40 px-2.5 py-1 text-xs font-semibold text-blue-300">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              {runningJobs.length}개 진행 중
            </span>
          )}
        </div>
        <button
          onClick={fetchJobs}
          className="text-xs text-white/50 hover:text-white/80 transition"
        >
          새로고침
        </button>
      </div>

      {loading && (
        <div className="text-center text-white/40 text-sm py-4">불러오는 중...</div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
          {error}
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {/* 진행 중인 작업 */}
          {runningJobs.map((job) => (
            <div
              key={job.job_id}
              className="rounded-lg border border-blue-400/30 bg-blue-500/5 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusBadge(job.status)}
                  <span className="font-semibold text-sm">{getTypeLabel(job.type)}</span>
                </div>
                <button
                  onClick={() => setExpandedJobId(expandedJobId === job.job_id ? null : job.job_id)}
                  className="text-xs text-white/50 hover:text-white/80"
                >
                  {expandedJobId === job.job_id ? '접기' : '로그 보기'}
                </button>
              </div>

              <div className="text-xs text-white/50 mb-2">
                <span className="font-mono">{job.job_id}</span>
                {job.started_at && (
                  <span className="ml-2">· 시작: {formatTime(job.started_at)}</span>
                )}
              </div>

              {/* 진행률 바 */}
              {job.progress != null && (
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-white/60 mb-1">
                    <span>{job.message || '처리 중...'}</span>
                    <span>{job.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 로그 */}
              {expandedJobId === job.job_id && (
                <div className="mt-3">
                  <div className="text-xs text-white/50 mb-1 flex items-center gap-2">
                    실시간 로그
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <pre className="bg-black/60 rounded p-2 text-[11px] max-h-48 overflow-y-auto font-mono whitespace-pre-wrap break-all">
                    {logTails[job.job_id]?.join('\n') || '로그 로딩 중...'}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {/* 최근 완료된 작업 */}
          {recentJobs.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs uppercase tracking-wide text-white/50 font-semibold mb-2">
                최근 작업
              </h4>
              <div className="space-y-2">
                {recentJobs.map((job) => (
                  <div
                    key={job.job_id}
                    className={`rounded-lg border p-3 ${
                      job.status === 'completed'
                        ? 'border-emerald-400/20 bg-emerald-500/5'
                        : job.status === 'failed'
                        ? 'border-red-400/20 bg-red-500/5'
                        : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusBadge(job.status)}
                        <span className="text-sm">{getTypeLabel(job.type)}</span>
                        <span className="text-xs font-mono text-white/40">{job.job_id.slice(0, 12)}</span>
                      </div>
                      <div className="text-xs text-white/40">
                        {formatTime(job.completed_at || job.started_at)}
                      </div>
                    </div>
                    {job.message && (
                      <div className="text-xs text-white/50 mt-1">{job.message}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
