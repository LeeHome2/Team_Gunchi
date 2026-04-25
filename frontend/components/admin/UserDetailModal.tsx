'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminApi, AdminProject, AdminUser } from '@/lib/api'
import { Badge, SmallBtn } from '@/components/admin/AdminUI'

interface UserDetailModalProps {
  user: AdminUser
  onClose: () => void
  onChanged?: () => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

const STATUS_LABEL: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' }
> = {
  active: { label: '활성', variant: 'success' },
  pending: { label: '대기', variant: 'warning' },
  suspended: { label: '정지', variant: 'danger' },
}

export default function UserDetailModal({
  user,
  onClose,
  onChanged,
}: UserDetailModalProps) {
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listUserProjects(user.id)
      setProjects(res.projects)
    } catch (e: any) {
      setError(e.message || '프로젝트 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (p: AdminProject) => {
    if (!confirm(`프로젝트 "${p.name}"을(를) 삭제하시겠습니까? 연관된 모든 데이터(DXF, 분석 결과 등)가 함께 삭제됩니다.`)) {
      return
    }
    try {
      await adminApi.deleteProject(p.id)
      await load()
      onChanged?.()
    } catch (e: any) {
      alert(e.message || '삭제 실패')
    }
  }

  const status = STATUS_LABEL[user.status] || STATUS_LABEL.active

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{user.name}</h2>
            <div className="text-sm text-white/60 flex items-center gap-3">
              <span>{user.email}</span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <div className="text-xs text-white/40">
              가입일: {formatDate(user.joined_at)} · 최근 로그인: {formatDate(user.last_login_at)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xl leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white/70">
              프로젝트 ({projects.length}개)
            </h3>
            <SmallBtn onClick={load}>새로고침</SmallBtn>
          </div>

          {error && (
            <div className="card p-3 border-red-500/30 bg-red-500/5 text-red-300 text-sm mb-3">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center text-white/40 py-8 text-sm">불러오는 중…</div>
          ) : projects.length === 0 ? (
            <div className="text-center text-white/40 py-8 text-sm">
              이 사용자는 아직 프로젝트가 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-xs text-white/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">이름</th>
                    <th className="text-left px-3 py-2 font-medium">주소</th>
                    <th className="text-left px-3 py-2 font-medium">용도지역</th>
                    <th className="text-left px-3 py-2 font-medium">DXF</th>
                    <th className="text-left px-3 py-2 font-medium">생성일</th>
                    <th className="text-left px-3 py-2 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 text-white/60">{p.address || '—'}</td>
                      <td className="px-3 py-2 text-white/60">{p.zone_type || '—'}</td>
                      <td className="px-3 py-2">
                        {p.has_dxf ? (
                          <Badge variant="success">있음</Badge>
                        ) : (
                          <span className="text-white/30 text-xs">없음</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white/50 text-xs">
                        {formatDate(p.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <SmallBtn variant="danger" onClick={() => handleDelete(p)}>
                          삭제
                        </SmallBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
