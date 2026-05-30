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

// 서비스에서 사용하는 외부 API 키 정의
interface ServiceApiKey {
  key: string
  label: string
  description: string
  placeholder: string
}

const SERVICE_API_KEYS: ServiceApiKey[] = [
  {
    key: 'cesium_token',
    label: 'Cesium Ion Token',
    description: '3D 지도 렌더링용 Cesium Ion 액세스 토큰',
    placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  },
  {
    key: 'vworld_api_key',
    label: 'VWorld API Key',
    description: '국토정보플랫폼 지도/주소 검색 API 키',
    placeholder: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
  },
  {
    key: 'openai_api_key',
    label: 'OpenAI API Key',
    description: 'OpenAI GPT / gpt-image-1 API 키',
    placeholder: 'sk-...',
  },
  {
    key: 'gemini_api_key',
    label: 'Gemini API Key (Nano Banana)',
    description: 'Google Gemini 2.5 Flash Image (나노바나나) API 키',
    placeholder: 'AIza...',
  },
  {
    key: 'llm_api_key',
    label: 'vLLM API Key',
    description: '학과 vLLM 서버 인증 키 (배치 스코어링용)',
    placeholder: 'sk-vllm-...',
  },
  {
    key: 'llm_base_url',
    label: 'vLLM Base URL',
    description: '학과 vLLM 서버 엔드포인트',
    placeholder: 'http://cellm.gachon.ac.kr:8000/v1',
  },
]

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  } catch {
    return iso
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
  } catch {
    return iso
  }
}

/** 키 값 마스킹 (앞 4자리 + *** + 뒤 4자리) */
function maskKey(value: string): string {
  if (!value || value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`
}

export default function AdminAuthPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [keys, setKeys] = useState<AdminApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auth policy (persisted in service_settings)
  const [sessionTimeout, setSessionTimeout] = useState(60)
  const [ipAllowlist, setIpAllowlist] = useState('10.0.0.0/8\n192.168.0.0/16')
  const [policySaving, setPolicySaving] = useState(false)

  // 서비스 API 키 상태
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({})
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

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
        if (s.session_timeout) setSessionTimeout(Number(s.session_timeout))
        if (s.ip_allowlist != null) setIpAllowlist(s.ip_allowlist)
        // 서비스 API 키 로드
        const loadedKeys: Record<string, string> = {}
        for (const sk of SERVICE_API_KEYS) {
          if (s[sk.key] != null) loadedKeys[sk.key] = s[sk.key]
        }
        setServiceKeys(loadedKeys)
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
    const password = prompt('비밀번호 (로그인용, 빈 값이면 잠금 상태로 생성)') || ''
    try {
      await adminApi.createAdminAccount({
        email: email.trim().toLowerCase(),
        name,
        role,
        password: password || undefined,
      })
      await load()
    } catch (e: any) {
      alert(e.message || '추가 실패')
    }
  }

  const handleResetAdminPassword = async (a: AccountRow) => {
    const password = prompt(`${a.email} 의 새 비밀번호 (빈 값이면 비번 잠금)`)
    if (password === null) return
    try {
      await adminApi.updateAdminAccount(a.id, { password })
      alert('비밀번호가 변경되었습니다.')
    } catch (e: any) {
      alert(e.message || '비밀번호 변경 실패')
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
      await adminApi.putServiceSetting('session_timeout', String(sessionTimeout))
      await adminApi.putServiceSetting('ip_allowlist', ipAllowlist)
      alert('정책이 저장되었습니다.')
    } catch (e: any) {
      alert(e.message || '저장 실패')
    } finally {
      setPolicySaving(false)
    }
  }

  // 서비스 API 키 토글
  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // 서비스 API 키 편집 시작
  const startEdit = (key: string) => {
    setEditingKey(key)
    setEditValue(serviceKeys[key] || '')
  }

  // 서비스 API 키 저장
  const saveServiceKey = async (key: string) => {
    setSavingKey(key)
    try {
      await adminApi.putServiceSetting(key, editValue)
      setServiceKeys((prev) => ({ ...prev, [key]: editValue }))
      setEditingKey(null)
      setEditValue('')
    } catch (e: any) {
      alert(e.message || '저장 실패')
    } finally {
      setSavingKey(null)
    }
  }

  // 서비스 API 키 삭제
  const deleteServiceKey = async (key: string) => {
    if (!confirm('이 키를 삭제하시겠습니까?')) return
    setSavingKey(key)
    try {
      await adminApi.putServiceSetting(key, '')
      setServiceKeys((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } catch (e: any) {
      alert(e.message || '삭제 실패')
    } finally {
      setSavingKey(null)
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
                      <SmallBtn onClick={() => handleResetAdminPassword(a)}>
                        비번 변경
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

        {/* 서비스 연동 API 키 */}
        <section className="card p-6">
          <h3 className="text-base font-semibold mb-2">서비스 연동 API 키</h3>
          <p className="text-xs text-white/50 mb-4">
            서비스에서 사용하는 외부 API 키를 관리합니다. 클릭하여 키를 확인할 수 있습니다.
          </p>
          <div className="space-y-3">
            {SERVICE_API_KEYS.map((sk) => {
              const value = serviceKeys[sk.key] || ''
              const isRevealed = revealedKeys.has(sk.key)
              const isEditing = editingKey === sk.key
              const isSaving = savingKey === sk.key

              return (
                <div
                  key={sk.key}
                  className="rounded-lg border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{sk.label}</div>
                      <div className="text-xs text-white/50 mt-0.5">
                        {sk.description}
                      </div>
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-2 shrink-0">
                        <SmallBtn onClick={() => startEdit(sk.key)}>
                          수정
                        </SmallBtn>
                        {value && (
                          <SmallBtn
                            variant="danger"
                            onClick={() => deleteServiceKey(sk.key)}
                            disabled={isSaving}
                          >
                            삭제
                          </SmallBtn>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder={sk.placeholder}
                        className="input-field font-mono text-sm"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <SmallBtn
                          onClick={() => {
                            setEditingKey(null)
                            setEditValue('')
                          }}
                        >
                          취소
                        </SmallBtn>
                        <SmallBtn
                          variant="primary"
                          onClick={() => saveServiceKey(sk.key)}
                          disabled={isSaving}
                        >
                          {isSaving ? '저장 중…' : '저장'}
                        </SmallBtn>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      {value ? (
                        <button
                          onClick={() => toggleReveal(sk.key)}
                          className="w-full text-left px-3 py-2 rounded-md bg-black/20 border border-white/10 font-mono text-sm text-white/70 hover:bg-black/30 transition-colors"
                        >
                          {isRevealed ? value : maskKey(value)}
                          <span className="ml-2 text-xs text-white/40">
                            {isRevealed ? '(클릭하여 숨김)' : '(클릭하여 표시)'}
                          </span>
                        </button>
                      ) : (
                        <div className="px-3 py-2 rounded-md bg-black/20 border border-white/10 text-sm text-white/40">
                          설정되지 않음
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* API 키 관리 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">발급된 API 키</h3>
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
