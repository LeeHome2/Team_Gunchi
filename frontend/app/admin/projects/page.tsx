'use client'

import { useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import {
  AdminTable,
  Tr,
  Td,
  Badge,
  SmallBtn,
  StatCard,
} from '@/components/admin/AdminUI'
import { adminApi, deleteProject, AdminProject, AdminEndpointStatus } from '@/lib/api'
import ProjectDetailModal from '@/components/admin/ProjectDetailModal'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

function formatArea(area: number | null): string {
  if (!area) return '—'
  return `${Math.round(area).toLocaleString()}㎡`
}

export default function AdminProjectsPage() {
  const [rows, setRows] = useState<AdminProject[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [endpoints, setEndpoints] = useState<AdminEndpointStatus[]>([])
  const [detail, setDetail] = useState<AdminProject | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listProjects()
      setRows(res.projects)
    } catch (e: any) {
      setError(e.message || '프로젝트 목록 로드 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // live endpoint probe for the "지도 데이터 연결 상태" section
    ;(async () => {
      try {
        const res = await adminApi.listServiceEndpoints()
        setEndpoints(res.endpoints)
      } catch {
        setEndpoints([])
      }
    })()
  }, [])

  const handleDelete = async (p: AdminProject) => {
    if (!confirm(`'${p.name}' 프로젝트를 삭제하시겠습니까?`)) return
    try {
      await deleteProject(p.id)
      await load()
    } catch (e: any) {
      alert(e.message || '삭제 실패')
    }
  }

  const filtered = rows.filter((p) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.address || '').toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    )
  })

  const dxfCount = rows.filter((r) => r.has_dxf).length
  const avgArea =
    rows.filter((r) => r.area_sqm).length > 0
      ? rows.reduce((s, r) => s + (r.area_sqm || 0), 0) /
        rows.filter((r) => r.area_sqm).length
      : null

  return (
    <>
      <AdminTopbar
        title="프로젝트 관리"
        description="업로드된 프로젝트와 지도 데이터 연동 상태를 관리합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="전체 프로젝트"
            value={rows.length.toString()}
            change="DB 기준"
          />
          <StatCard
            label="DXF 업로드"
            value={dxfCount.toString()}
            change="AI 분석 대기"
            changeType="neutral"
          />
          <StatCard
            label="활성"
            value={rows.length.toString()}
            change="진행 중"
            changeType="up"
          />
          <StatCard
            label="평균 대지면적"
            value={avgArea ? `${Math.round(avgArea).toLocaleString()}㎡` : '—'}
            change="DXF 업로드 기준"
            changeType="neutral"
          />
        </div>

        <div className="card p-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트명 / 주소 / ID 검색"
            className="input-field flex-1 min-w-[240px]"
          />
          <button className="btn-secondary" onClick={load}>
            새로고침
          </button>
        </div>

        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        <AdminTable
          headers={[
            'ID',
            '프로젝트명',
            '주소',
            '용도지역',
            '생성일',
            '대지면적',
            'CAD',
            '관리',
          ]}
        >
          {filtered.map((p) => (
            <Tr key={p.id}>
              <Td className="font-mono text-white/60">{p.id.slice(0, 8)}</Td>
              <Td className="font-medium">{p.name}</Td>
              <Td className="text-white/60">{p.address || '—'}</Td>
              <Td className="text-white/60">{p.zone_type || '—'}</Td>
              <Td className="text-white/50">{formatDate(p.created_at)}</Td>
              <Td className="font-mono text-white/70">
                {formatArea(p.area_sqm)}
              </Td>
              <Td>
                {p.has_dxf ? (
                  <Badge variant="success">업로드됨</Badge>
                ) : (
                  <Badge variant="neutral">미업로드</Badge>
                )}
              </Td>
              <Td>
                <div className="flex gap-1.5">
                  <SmallBtn onClick={() => setDetail(p)}>상세</SmallBtn>
                  <SmallBtn variant="danger" onClick={() => handleDelete(p)}>
                    삭제
                  </SmallBtn>
                </div>
              </Td>
            </Tr>
          ))}
          {!loading && filtered.length === 0 && (
            <Tr>
              <Td colSpan={8} className="text-center text-white/40">
                표시할 프로젝트가 없습니다.
              </Td>
            </Tr>
          )}
          {loading && (
            <Tr>
              <Td colSpan={8} className="text-center text-white/40">
                불러오는 중…
              </Td>
            </Tr>
          )}
        </AdminTable>

        {/* 백엔드 API 연결 상태 */}
        <section>
          <h3 className="text-base font-semibold mb-4">백엔드 API 연결 상태</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {endpoints.length === 0 && (
              <div className="card p-4 text-sm text-white/40">
                상태 정보를 가져오는 중…
              </div>
            )}
            {endpoints.map((svc) => {
              const dot =
                svc.status === 'ok'
                  ? 'bg-emerald-400'
                  : svc.status === 'degraded'
                  ? 'bg-amber-400'
                  : 'bg-red-400'
              return (
                <div
                  key={svc.name}
                  className="card p-4 flex items-center gap-3"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{svc.name}</div>
                    <div className="text-xs text-white/50">{svc.url}</div>
                  </div>
                  <span className="text-xs font-mono text-white/60">
                    {svc.latency_ms != null
                      ? `${svc.latency_ms}ms`
                      : svc.status}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      </main>

      {detail && (
        <ProjectDetailModal
          projectId={detail.id}
          projectName={detail.name}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  )
}
