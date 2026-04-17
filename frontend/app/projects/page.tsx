'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AppNav from '@/components/AppNav'
import { listProjects, createProject, deleteProject } from '@/lib/api'

interface Project {
  id: string
  name: string
  address?: string | null
  created_at?: string
  updated_at?: string
  status?: string
}

// 세션에서 현재 로그인된 사용자 정보 가져오기
function getCurrentUser(): { user_id?: string; name?: string; email?: string } | null {
  if (typeof window === 'undefined') return null
  const stored = sessionStorage.getItem('geonchi_user')
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchProjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const user = getCurrentUser()
      const result = await listProjects(0, 100, user?.user_id)
      setProjects(result?.projects || result || [])
    } catch (err: any) {
      setError(err?.message || '프로젝트를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const user = getCurrentUser()
      const proj = await createProject(newName, newAddress || undefined, user?.user_id)
      setShowCreate(false)
      setNewName('')
      setNewAddress('')
      // Navigate into editor with the new project
      if (proj?.id) {
        router.push(`/editor?projectId=${proj.id}&name=${encodeURIComponent(newName)}`)
      } else {
        fetchProjects()
      }
    } catch (err: any) {
      setError(err?.message || '프로젝트 생성에 실패했습니다.')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return
    try {
      await deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch (err: any) {
      setError(err?.message || '삭제에 실패했습니다.')
    }
  }

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <AppNav />

      <main className="relative">
        <div className="absolute inset-x-0 top-0 h-96 bg-radial-glow pointer-events-none" />

        <div className="relative mx-auto max-w-7xl px-6 py-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">내 프로젝트</h1>
              <p className="mt-1 text-sm text-white/50">
                DXF 도면 기반 3D 건물 프로젝트 전체 목록
              </p>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              새 프로젝트
            </button>
          </div>

          {error && (
            <div className="mt-6 rounded-md border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
              <button
                onClick={fetchProjects}
                className="ml-3 underline hover:text-red-200"
              >
                재시도
              </button>
            </div>
          )}

          <div className="mt-8">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="spinner" />
              </div>
            ) : projects.length === 0 ? (
              <EmptyState onCreate={() => setShowCreate(true)} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <ProjectCard key={p.id} project={p} onDelete={() => handleDelete(p.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md animate-slide-up">
            <h3 className="text-lg font-semibold">새 프로젝트 생성</h3>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/80">
                  프로젝트 이름 *
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="예: 판교 주거단지 A동"
                  className="input-field"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/80">
                  주소 (선택)
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="예: 경기도 성남시 분당구..."
                  className="input-field"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="btn-secondary text-sm"
                >
                  취소
                </button>
                <button type="submit" disabled={creating} className="btn-primary text-sm">
                  {creating ? '생성 중...' : '생성 후 에디터 열기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="card p-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/15 border border-brand-400/30">
        <svg className="h-7 w-7 text-brand-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold">아직 프로젝트가 없습니다</h3>
      <p className="mt-1 text-sm text-white/50">
        첫 번째 프로젝트를 만들고 DXF 도면을 업로드해 보세요.
      </p>
      <button onClick={onCreate} className="btn-primary mt-6">
        새 프로젝트 만들기
      </button>
    </div>
  )
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const formatted = project.created_at
    ? new Date(project.created_at).toLocaleDateString('ko-KR')
    : '—'

  return (
    <div className="card card-hover p-5 relative group">
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-brand-500/15 border border-brand-400/30 flex items-center justify-center">
          <svg className="h-5 w-5 text-brand-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
          className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition-all"
          aria-label="삭제"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>

      <Link href={`/editor?projectId=${project.id}&name=${encodeURIComponent(project.name)}`} className="mt-4 block">
        <h3 className="font-semibold text-white line-clamp-1">{project.name}</h3>
        <p className="mt-1 text-xs text-white/40 line-clamp-1">
          {project.address || '주소 미지정'}
        </p>
      </Link>

      <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-white/40">
        <span>생성 {formatted}</span>
        <span className="tag-brand text-[10px] py-0.5 px-1.5">
          {project.status || 'Active'}
        </span>
      </div>
    </div>
  )
}
