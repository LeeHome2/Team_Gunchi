'use client'

import { useEffect, useMemo, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import {
  AdminTable,
  Tr,
  Td,
  Badge,
  SmallBtn,
  StatCard,
} from '@/components/admin/AdminUI'
import { adminApi, AdminResult } from '@/lib/api'

type VerdictFilter = 'all' | 'pass' | 'fail'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

export default function AdminResultsPage() {
  const [rows, setRows] = useState<AdminResult[]>([])
  const [counts, setCounts] = useState({
    total: 0,
    valid: 0,
    invalid: 0,
    passRate: 0,
  })
  const [filter, setFilter] = useState<VerdictFilter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await adminApi.listResults()
        setRows(res.results)
        setCounts({
          total: res.total,
          valid: res.valid,
          invalid: res.invalid,
          passRate: res.pass_rate,
        })
      } catch (e: any) {
        setError(e.message || '검토 결과 로드 실패')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'pass' && !r.is_valid) return false
      if (filter === 'fail' && r.is_valid) return false
      if (!query) return true
      const q = query.toLowerCase()
      return (
        r.project_name.toLowerCase().includes(q) ||
        (r.zone_type || '').toLowerCase().includes(q)
      )
    })
  }, [rows, filter, query])

  return (
    <>
      <AdminTopbar
        title="결과 관리"
        description="규정 검토 결과를 조회하고 적합성 판정을 확인합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="전체 검토"
            value={counts.total.toString()}
            change="DB 기준"
            changeType="neutral"
          />
          <StatCard
            label="적합률"
            value={`${counts.passRate.toFixed(1)}%`}
            change={`${counts.valid}건 적합`}
            changeType="up"
          />
          <StatCard
            label="부적합"
            value={counts.invalid.toString()}
            change="재검토 필요"
            changeType="down"
          />
          <StatCard
            label="용도지역 수"
            value={new Set(rows.map((r) => r.zone_type).filter(Boolean)).size.toString()}
            change="고유 용도지역"
            changeType="neutral"
          />
        </div>

        <div className="card p-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트명 / 용도지역 검색"
            className="input-field flex-1 min-w-[240px]"
          />
          <div className="flex gap-1 rounded-md border border-white/10 bg-white/5 p-1">
            {(['all', 'pass', 'fail'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                  filter === f
                    ? 'bg-brand-500/25 text-brand-200'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                {f === 'all' ? '전체' : f === 'pass' ? '적합' : '부적합'}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        <AdminTable
          headers={[
            'ID',
            '프로젝트',
            '용도지역',
            '검토일',
            '건폐율',
            '용적률',
            '높이',
            '판정',
            '관리',
          ]}
        >
          {filtered.map((r) => (
            <Tr key={r.id}>
              <Td className="font-mono text-white/60">{r.id.slice(0, 8)}</Td>
              <Td className="font-medium">{r.project_name}</Td>
              <Td className="text-white/60">{r.zone_type || '—'}</Td>
              <Td className="text-white/50">{formatDate(r.created_at)}</Td>
              <Td className="font-mono">
                {r.coverage != null ? `${r.coverage.toFixed(1)}%` : '—'}
              </Td>
              <Td className="font-mono">
                {r.floor_area_ratio != null
                  ? `${r.floor_area_ratio.toFixed(0)}%`
                  : '—'}
              </Td>
              <Td className="font-mono">
                {r.height != null ? `${r.height.toFixed(1)}m` : '—'}
              </Td>
              <Td>
                {r.is_valid ? (
                  <Badge variant="success">적합</Badge>
                ) : (
                  <Badge variant="danger">부적합</Badge>
                )}
              </Td>
              <Td>
                <SmallBtn>리포트</SmallBtn>
              </Td>
            </Tr>
          ))}
          {!loading && filtered.length === 0 && (
            <Tr>
              <Td colSpan={9} className="text-center text-white/40">
                {error
                  ? '데이터를 불러올 수 없습니다.'
                  : '검색 조건에 해당하는 결과가 없습니다.'}
              </Td>
            </Tr>
          )}
          {loading && (
            <Tr>
              <Td colSpan={9} className="text-center text-white/40">
                불러오는 중…
              </Td>
            </Tr>
          )}
        </AdminTable>
      </main>
    </>
  )
}
