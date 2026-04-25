'use client'

import { useEffect, useState } from 'react'
import { adminApi, AdminProjectDetail } from '@/lib/api'
import { Badge, SmallBtn } from '@/components/admin/AdminUI'

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR')
  } catch {
    return iso
  }
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

export default function ProjectDetailModal({
  projectId,
  projectName,
  onClose,
}: Props) {
  const [data, setData] = useState<AdminProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await adminApi.getProjectDetail(projectId)
        if (alive) setData(res)
      } catch (e: any) {
        if (alive) setError(e.message || '프로젝트 상세 로드 실패')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="space-y-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{projectName}</h2>
            <div className="text-xs font-mono text-white/50 break-all">
              {projectId}
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

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {loading && (
            <div className="text-center text-white/40 text-sm py-8">불러오는 중…</div>
          )}
          {error && (
            <div className="card p-3 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* 프로젝트 메타 */}
              <section>
                <h3 className="text-sm font-semibold text-white/70 mb-2">프로젝트 정보</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Field label="주소" value={data.project.address || '—'} />
                  <Field label="용도지역" value={data.project.zone_type || '—'} />
                  <Field label="좌표" value={data.project.longitude && data.project.latitude
                    ? `${data.project.longitude.toFixed(5)}, ${data.project.latitude.toFixed(5)}`
                    : '—'} />
                  <Field label="생성일" value={fmt(data.project.created_at)} />
                </div>
              </section>

              {/* CAD 파일 목록 */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white/70">
                    업로드된 CAD 데이터 ({data.dxf_files.length}개)
                  </h3>
                </div>
                {data.dxf_files.length === 0 ? (
                  <div className="card p-4 text-sm text-white/40 text-center">
                    업로드된 DXF 파일이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.dxf_files.map((f) => (
                      <DxfCard key={f.id} dxf={f} />
                    ))}
                  </div>
                )}
              </section>

              {/* 생성된 매스 모델 */}
              <section>
                <h3 className="text-sm font-semibold text-white/70 mb-2">
                  생성된 3D 모델 ({data.generated_models.length}개)
                </h3>
                {data.generated_models.length === 0 ? (
                  <div className="text-xs text-white/40">아직 매스가 생성되지 않았습니다.</div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-white/10">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 text-white/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">유형</th>
                          <th className="text-left px-3 py-2 font-medium">높이</th>
                          <th className="text-left px-3 py-2 font-medium">층수</th>
                          <th className="text-left px-3 py-2 font-medium">크기</th>
                          <th className="text-left px-3 py-2 font-medium">생성일</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {data.generated_models.map((m) => (
                          <tr key={m.id}>
                            <td className="px-3 py-2 font-mono">{m.model_type}</td>
                            <td className="px-3 py-2">{m.height.toFixed(1)} m</td>
                            <td className="px-3 py-2">{m.floors}</td>
                            <td className="px-3 py-2">{fmtBytes(m.file_size)}</td>
                            <td className="px-3 py-2 text-white/50">
                              {fmt(m.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* 검토 결과 카운트 */}
              <section>
                <h3 className="text-sm font-semibold text-white/70 mb-2">검토 이력</h3>
                <div className="text-sm text-white/60">
                  총 <span className="font-semibold text-white">{data.validation_count}</span>건의 규정 검토 결과가 저장되어 있습니다.
                </div>
              </section>
            </>
          )}
        </div>

        <div className="border-t border-white/10 p-4 flex justify-end">
          <SmallBtn onClick={onClose}>닫기</SmallBtn>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] text-white/40">{label}</div>
      <div className="text-sm mt-0.5 break-all">{value}</div>
    </div>
  )
}

function DxfCard({ dxf }: { dxf: AdminProjectDetail['dxf_files'][number] }) {
  const c = dxf.classification
  const layers = Array.isArray(dxf.available_layers) ? dxf.available_layers : []

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{dxf.original_filename}</div>
          <div className="text-[11px] text-white/40 mt-0.5">
            업로드: {fmt(dxf.uploaded_at)} · {fmtBytes(dxf.file_size)}
          </div>
        </div>
        {c ? (
          <Badge variant="success">분류 완료</Badge>
        ) : (
          <Badge variant="neutral">분류 대기</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Stat label="엔티티" value={dxf.total_entities?.toLocaleString() || '—'} />
        <Stat label="레이어" value={`${layers.length}개`} />
        <Stat
          label="대지면적"
          value={dxf.area_sqm ? `${Math.round(dxf.area_sqm).toLocaleString()} ㎡` : '—'}
        />
        <Stat label="모델" value={`${dxf.generated_model_count}개`} />
      </div>

      {layers.length > 0 && (
        <div>
          <div className="text-[11px] text-white/40 mb-1.5">레이어 목록</div>
          <div className="flex flex-wrap gap-1">
            {layers.slice(0, 20).map((l, i) => (
              <span
                key={i}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/70"
              >
                {l}
              </span>
            ))}
            {layers.length > 20 && (
              <span className="text-[10px] text-white/40 px-1.5 py-0.5">
                +{layers.length - 20}개
              </span>
            )}
          </div>
        </div>
      )}

      {c && (
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/50">AI 분류 결과</span>
            <span className="text-[11px] font-mono text-white/40">
              {c.model_version} · 신뢰도 {(c.average_confidence * 100).toFixed(1)}%
            </span>
          </div>
          <div className="space-y-1.5">
            {Object.entries(c.class_counts || {})
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 8)
              .map(([cls, n]) => {
                const ratio = c.total_entities > 0 ? (n as number) / c.total_entities : 0
                return (
                  <div key={cls}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-white/70">{cls}</span>
                      <span className="text-white/50">
                        {(n as number).toLocaleString()}개 · {(ratio * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1 mt-1 rounded bg-white/5 overflow-hidden">
                      <div
                        className="h-full bg-brand-400/70"
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[10px] text-white/40">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  )
}
