'use client'

import { useCallback, useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import {
  AdminTable,
  Tr,
  Td,
  Badge,
  SmallBtn,
  StatCard,
} from '@/components/admin/AdminUI'
import { adminApi, AdminUser } from '@/lib/api'

const STATUS_LABEL: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' }
> = {
  active: { label: '활성', variant: 'success' },
  pending: { label: '대기', variant: 'warning' },
  suspended: { label: '정지', variant: 'danger' },
}

type StatusFilter = 'all' | 'active' | 'pending' | 'suspended'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listUsers({
        status: filter,
        query: query || undefined,
      })
      setUsers(res.users)
      setCounts(res.counts)
    } catch (e: any) {
      setError(e.message || '사용자 목록 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [filter, query])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  const handleCreate = async () => {
    const name = prompt('이름을 입력하세요')
    if (!name) return
    const email = prompt('이메일을 입력하세요')
    if (!email) return
    try {
      await adminApi.createUser({ name, email, status: 'pending' })
      await load()
    } catch (e: any) {
      alert(e.message || '생성 실패')
    }
  }

  const toggleStatus = async (u: AdminUser) => {
    const next = u.status === 'suspended' ? 'active' : 'suspended'
    try {
      await adminApi.updateUserStatus(u.id, next)
      await load()
    } catch (e: any) {
      alert(e.message || '상태 변경 실패')
    }
  }

  const total = counts.total ?? users.length
  const totalActive = counts.active ?? 0
  const totalPending = counts.pending ?? 0
  const totalSuspended = counts.suspended ?? 0

  return (
    <>
      <AdminTopbar
        title="사용자 관리"
        description="가입한 사용자 계정을 조회하고 상태를 관리합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {/* KPI */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="전체 사용자"
            value={total.toString()}
            change="DB 기준"
          />
          <StatCard
            label="활성"
            value={totalActive.toString()}
            change="정상 이용 중"
            changeType="up"
          />
          <StatCard
            label="대기"
            value={totalPending.toString()}
            change="승인 대기"
            changeType="neutral"
          />
          <StatCard
            label="정지"
            value={totalSuspended.toString()}
            change="제재된 계정"
            changeType="down"
          />
        </div>

        {/* Toolbar */}
        <div className="card p-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 / 이메일 검색"
            className="input-field flex-1 min-w-[240px]"
          />
          <div className="flex gap-1 rounded-md border border-white/10 bg-white/5 p-1">
            {(['all', 'active', 'pending', 'suspended'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                  filter === f
                    ? 'bg-brand-500/25 text-brand-200'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                {f === 'all' ? '전체' : STATUS_LABEL[f].label}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={handleCreate}>
            + 사용자 추가
          </button>
        </div>

        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Table */}
        <AdminTable
          headers={[
            'ID',
            '이름',
            '이메일',
            '가입일',
            '프로젝트',
            '상태',
            '관리',
          ]}
        >
          {users.map((u) => {
            const s = STATUS_LABEL[u.status] || STATUS_LABEL.active
            return (
              <Tr key={u.id}>
                <Td className="font-mono text-white/60">
                  {u.id.slice(0, 8)}
                </Td>
                <Td className="font-medium">{u.name}</Td>
                <Td className="text-white/60">{u.email}</Td>
                <Td className="text-white/50">{formatDate(u.joined_at)}</Td>
                <Td>{u.project_count}</Td>
                <Td>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </Td>
                <Td>
                  <div className="flex gap-1.5">
                    <SmallBtn>상세</SmallBtn>
                    {u.status === 'suspended' ? (
                      <SmallBtn variant="primary" onClick={() => toggleStatus(u)}>
                        복구
                      </SmallBtn>
                    ) : (
                      <SmallBtn variant="danger" onClick={() => toggleStatus(u)}>
                        정지
                      </SmallBtn>
                    )}
                  </div>
                </Td>
              </Tr>
            )
          })}
          {!loading && users.length === 0 && (
            <Tr>
              <Td className="text-center text-white/40" colSpan={7}>
                {error
                  ? '데이터를 불러올 수 없습니다.'
                  : '검색 조건에 해당하는 사용자가 없습니다.'}
              </Td>
            </Tr>
          )}
          {loading && (
            <Tr>
              <Td className="text-center text-white/40" colSpan={7}>
                불러오는 중…
              </Td>
            </Tr>
          )}
        </AdminTable>
      </main>
    </>
  )
}
