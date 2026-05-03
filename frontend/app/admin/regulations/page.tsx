'use client'

import { useEffect, useState } from 'react'
import AdminTopbar from '@/components/AdminTopbar'
import {
  AdminTable,
  Tr,
  Td,
  Badge,
  SmallBtn,
} from '@/components/admin/AdminUI'
import { adminApi, AdminBaseRule, AdminZoneRule } from '@/lib/api'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

export default function AdminRegulationsPage() {
  const [baseRules, setBaseRules] = useState<AdminBaseRule[]>([])
  const [zoneRules, setZoneRules] = useState<AdminZoneRule[]>([])
  const [draftBase, setDraftBase] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [baseRes, zoneRes] = await Promise.all([
        adminApi.listBaseRules(),
        adminApi.listZoneRules(),
      ])
      setBaseRules(baseRes.rules)
      setZoneRules(zoneRes.rules)
      const drafts: Record<string, number> = {}
      for (const r of baseRes.rules) drafts[r.key] = r.value
      setDraftBase(drafts)
    } catch (e: any) {
      setError(e.message || '규정 로드 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const updateDraft = (key: string, next: number) => {
    setDraftBase((prev) => ({ ...prev, [key]: next }))
  }

  const handleSaveBase = async () => {
    setSaving(true)
    try {
      for (const r of baseRules) {
        const v = draftBase[r.key]
        if (v !== r.value) {
          await adminApi.upsertBaseRule({
            key: r.key,
            label: r.label,
            unit: r.unit,
            value: v,
            description: r.description,
          })
        }
      }
      await load()
      // 사용자 측 캐시 무효화 안내 (페이지 새로고침 후 반영)
      // 사용자가 이미 editor/result 를 열어두고 있으면 새로고침 또는 재진입 시 GET /api/regulations 호출
      alert('✅ 저장 완료. 사용자 측은 페이지 진입(또는 새로고침) 시 즉시 반영됩니다.')
    } catch (e: any) {
      alert(e.message || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleAddZone = async () => {
    const zone = prompt('용도지역')
    if (!zone) return
    const region = prompt('적용지역') || '전역'
    try {
      await adminApi.createZoneRule({
        zone,
        region,
        coverage: 60,
        far: 200,
        height_max: 20,
        setback: 1.5,
      })
      await load()
    } catch (e: any) {
      alert(e.message || '추가 실패')
    }
  }

  const handleDeleteZone = async (r: AdminZoneRule) => {
    if (!confirm(`'${r.zone} / ${r.region}' 규정을 삭제하시겠습니까?`)) return
    try {
      await adminApi.deleteZoneRule(r.id)
      await load()
    } catch (e: any) {
      alert(e.message || '삭제 실패')
    }
  }

  const handleEditZone = async (r: AdminZoneRule) => {
    const coverageStr = prompt(`건폐율 (현재: ${r.coverage}%)`, String(r.coverage))
    if (coverageStr === null) return
    const farStr = prompt(`용적률 (현재: ${r.far}%)`, String(r.far))
    if (farStr === null) return
    const heightStr = prompt(`최고높이 (현재: ${r.height_max}m)`, String(r.height_max))
    if (heightStr === null) return
    const setbackStr = prompt(`이격거리 (현재: ${r.setback}m)`, String(r.setback))
    if (setbackStr === null) return

    try {
      await adminApi.updateZoneRule(r.id, {
        coverage: Number(coverageStr),
        far: Number(farStr),
        height_max: Number(heightStr),
        setback: Number(setbackStr),
      })
      await load()
      alert('✅ 저장 완료. 사용자 측은 페이지 진입(또는 새로고침) 시 즉시 반영됩니다.')
    } catch (e: any) {
      alert(e.message || '수정 실패')
    }
  }

  return (
    <>
      <AdminTopbar
        title="규정 관리"
        description="건축 규정 기본값과 지역별 세부 규정을 설정합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* 기본 규정 기준값 */}
        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">기본 규정 기준값</h3>
              <p className="text-xs text-white/50 mt-0.5">
                지역별 규정이 없을 때 적용되는 기본값입니다.
              </p>
            </div>
            <button
              className="btn-primary"
              onClick={handleSaveBase}
              disabled={saving || loading}
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
          {loading && (
            <p className="text-sm text-white/40">불러오는 중…</p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {baseRules.map((r) => (
              <div
                key={r.key}
                className="rounded-lg border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {r.label}
                    </div>
                    <div className="text-xs text-white/50 mt-0.5">
                      {r.description || '—'}
                    </div>
                  </div>
                  <Badge variant="info">{r.unit}</Badge>
                </div>
                <input
                  type="number"
                  value={draftBase[r.key] ?? r.value}
                  onChange={(e) => updateDraft(r.key, Number(e.target.value))}
                  className="input-field font-mono text-sm"
                  step={r.unit === 'm' ? 0.1 : 1}
                />
              </div>
            ))}
          </div>
        </section>

        {/* 지역별 규정 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">지역별 규정</h3>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={load}>
                새로고침
              </button>
              <button className="btn-primary" onClick={handleAddZone}>
                + 규정 추가
              </button>
            </div>
          </div>
          <AdminTable
            headers={[
              '용도지역',
              '적용지역',
              '건폐율',
              '용적률',
              '높이',
              '이격',
              '최종 수정',
              '관리',
            ]}
          >
            {zoneRules.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium">{r.zone}</Td>
                <Td className="text-white/60">{r.region}</Td>
                <Td className="font-mono">{r.coverage}%</Td>
                <Td className="font-mono">{r.far}%</Td>
                <Td className="font-mono">{r.height_max}m</Td>
                <Td className="font-mono">{r.setback}m</Td>
                <Td className="text-white/50">{formatDate(r.updated_at)}</Td>
                <Td>
                  <div className="flex gap-1.5">
                    <SmallBtn onClick={() => handleEditZone(r)}>편집</SmallBtn>
                    <SmallBtn
                      variant="danger"
                      onClick={() => handleDeleteZone(r)}
                    >
                      삭제
                    </SmallBtn>
                  </div>
                </Td>
              </Tr>
            ))}
            {!loading && zoneRules.length === 0 && (
              <Tr>
                <Td colSpan={8} className="text-center text-white/40">
                  등록된 지역별 규정이 없습니다.
                </Td>
              </Tr>
            )}
          </AdminTable>
        </section>
      </main>
    </>
  )
}
