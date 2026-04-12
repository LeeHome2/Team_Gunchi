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
import {
  adminApi,
  AdminAccount as AccountRow,
  AdminApiKey,
} from '@/lib/api'

const ROLE_LABEL: Record<
  string,
  { label: string; variant: 'danger' | 'info' | 'neutral' }
> = {
  superadmin: { label: '슈퍼관리자', variant: 'danger' },
  ops: { label: '운영자', variant: 'info' },
  viewer: { label: '조회자', variant: 'neutral' },
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR')
  } catch {
    return iso
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR')
  } catch {
    return iso
  }
}

export default function AdminAuthPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [keys, setKeys] = useState<AdminApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auth policy (persisted in service_settings)
  const [twoFactor, setTwoFactor] = useState(true)
  const [sessionTimeout, setSessionTimeout] = useState(60)
  const [ipAllowlist, setIpAllowlist] = useState('10.0.0.0/8\n192.168.0.0/16')
  const [policySaving, setPolicySaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [accRes, keyRes, settingsRes] = await Promise.all([
        adminApi.listAdminAccounts(),
        adminApi.listApiKeys(),
        adminApi.getServiceSettings().catch(() => null),
      ])
      setAccounts(accRes.accounts)
      setKeys(keyRes.keys)
      if (settingsRes) {
        const s = settingsRes.settings
        if (s.two_factor != null) setTwoFactor(s.two_factor === 'true')
        if (s.session_timeout) setSessionTimeout(Number(s.session_timeout))
        if (s.ip_allowlist != null) setIpAllowlist(s.ip_allowlist)
      }
    } catch (e: any) {
      setError(e.message || '인증 정보 로드 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleAddAdmin = async () => {
    const email = prompt('이메일')
    if (!email) return
    const name = prompt('이름') || email
    const role = prompt('권한 (superadmin | ops | viewer)') || 'viewer'
    try {
      await adminApi.createAdminAccount({ email, name, role })
      await load()
    } catch (e: any) {
      alert(e.message || '추가 실패')
    }
  }

  const handleToggleAdmin = async (a: AccountRow) => {
    try {
      await adminApi.updateAdminAccount(a.id, { is_active: !a.is_active })
      await load()
    } catch (e: any) {
      alert(e.message || '변경 실패')
    }
  }

  const handleDeleteAdmin = async (a: AccountRow) => {
    if (!confirm(`${a.email} 계정을 삭제하시겠습니까?`)) return
    try {
      await adminApi.deleteAdminAccount(a.id)
      await load()
    } catch (e: any) {
      alert(e.message || '삭제 실패')
    }
  }

  const handleCreateKey = async () => {
    const name = prompt('API 키 이름')
    if (!name) return
    const env = prompt('환경 (live | test)', 'live') || 'live'
    try {
      const res = await adminApi.createApiKey({ name, environment: env })
      if (res.raw_key) {
        alert(
          `발급된 키 (한 번만 표시):\n\n${res.raw_key}\n\n안전한 곳에 저장하세요.`
        )
      }
      await load()
    } catch (e: any) {
      alert(e.message || '키 발급 실패')
    }
  }

  const handleRevokeKey = async (k: AdminApiKey) => {
    if (!confirm(`'${k.name}' 키를 폐기하시겠습니까?`)) return
    try {
      await adminApi.revokeApiKey(k.id)
      await load()
    } catch (e: any) {
      alert(e.message || '폐기 실패')
    }
  }

  const savePolicy = async () => {
    setPolicySaving(true)
    try {
      await adminApi.putServiceSetting('two_factor', twoFactor ? 'true' : 'false')
      await adminApi.putServiceSetting('session_timeout', String(sessionTimeout))
      await adminApi.putServiceSetting('ip_allowlist', ipAllowlist)
      alert('정책이 저장되었습니다.')
    } catch (e: any) {
      alert(e.message || '저장 실패')
    } finally {
      setPolicySaving(false)
    }
  }

  return (
    <>
      <AdminTopbar
        title="인증 관리"
        description="관리자 계정, 인증 정책, API 키를 관리합니다."
      />
      <main className="flex-1 p-8 space-y-6">
        {error && (
          <div className="card p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* 관리자 계정 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">관리자 계정</h3>
            <button className="btn-primary" onClick={handleAddAdmin}>
              + 관리자 추가
            </button>
          </div>
          <AdminTable
            headers={['이메일', '이름', '권한', '최근 로그인', '상태', '관리']}
          >
            {accounts.map((a) => {
              const r = ROLE_LABEL[a.role] || ROLE_LABEL.viewer
              return (
                <Tr key={a.id}>
                  <Td className="font-mono text-white/70">{a.email}</Td>
                  <Td className="font-medium">{a.name}</Td>
                  <Td>
                    <Badge variant={r.variant}>{r.label}</Badge>
                  </Td>
                  <Td className="text-white/50 font-mono">
                    {formatDateTime(a.last_login_at)}
                  </Td>
                  <Td>
                    {a.is_active ? (
                      <Badge variant="success">활성</Badge>
                    ) : (
                      <Badge variant="neutral">비활성</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1.5">
                      <SmallBtn onClick={() => handleToggleAdmin(a)}>
                        {a.is_active ? '비활성화' : '활성화'}
                      </SmallBtn>
                      <SmallBtn
                        variant="danger"
                        onClick={() => handleDeleteAdmin(a)}
                      >
                        삭제
                      </SmallBtn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
            {!loading && accounts.length === 0 && (
              <Tr>
                <Td colSpan={6} className="text-center text-white/40">
                  등록된 관리자 계정이 없습니다.
                </Td>
              </Tr>
            )}
          </AdminTable>
        </section>

        {/* 인증 정책 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-4">인증 정책</h3>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">2단계 인증 (2FA)</div>
                  <div className="text-xs text-white/50 mt-0.5">
                    관리자 로그인 시 OTP 확인
                  </div>
                </div>
                <button
                  onClick={() => setTwoFactor((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    twoFactor ? 'bg-brand-500' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      twoFactor ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold mb-1">세션 타임아웃</div>
              <div className="text-xs text-white/50 mb-3">
                분 단위로 설정 (기본 60분)
              </div>
              <input
                type="number"
                value={sessionTimeout}
                onChange={(e) => setSessionTimeout(Number(e.target.value))}
                className="input-field font-mono text-sm"
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:col-span-2">
              <div className="text-sm font-semibold mb-1">IP 허용 목록</div>
              <div className="text-xs text-white/50 mb-3">
                관리자 로그인을 허용할 IP CIDR (줄바꿈으로 구분)
              </div>
              <textarea
                value={ipAllowlist}
                onChange={(e) => setIpAllowlist(e.target.value)}
                rows={4}
                className="input-field font-mono text-sm"
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              className="btn-primary"
              onClick={savePolicy}
              disabled={policySaving}
            >
              {policySaving ? '저장 중…' : '정책 저장'}
            </button>
          </div>
        </section>

        {/* API 키 관리 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">API 키 관리</h3>
            <button className="btn-primary" onClick={handleCreateKey}>
              + API 키 발급
            </button>
          </div>
          <AdminTable
            headers={[
              '이름',
              'Prefix',
              '환경',
              '발급일',
              '최근 사용',
              '상태',
              '관리',
            ]}
          >
            {keys.map((k) => (
              <Tr key={k.id}>
                <Td className="font-medium">{k.name}</Td>
                <Td className="font-mono text-white/70">{k.prefix}</Td>
                <Td className="font-mono text-white/60">{k.environment}</Td>
                <Td className="text-white/50">{formatDate(k.created_at)}</Td>
                <Td className="text-white/50 font-mono">
                  {formatDateTime(k.last_used_at)}
                </Td>
                <Td>
                  {k.is_active ? (
                    <Badge variant="success">활성</Badge>
                  ) : (
                    <Badge variant="neutral">폐기</Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex gap-1.5">
                    {k.is_active && (
                      <SmallBtn
                        variant="danger"
                        onClick={() => handleRevokeKey(k)}
                      >
                        폐기
                      </SmallBtn>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
            {!loading && keys.length === 0 && (
              <Tr>
                <Td colSpan={7} className="text-center text-white/40">
                  발급된 API 키가 없습니다.
                </Td>
              </Tr>
            )}
          </AdminTable>
        </section>
      </main>
    </>
  )
}
