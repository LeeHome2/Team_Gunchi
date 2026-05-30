'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/AuthShell'
import { adminApi } from '@/lib/api'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await adminApi.adminLogin({
        email: email.trim().toLowerCase(),
        password,
      })
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('geonchi_admin', '1')
        sessionStorage.setItem('geonchi_admin_id', res.admin_id)
        sessionStorage.setItem('geonchi_admin_email', res.email)
        sessionStorage.setItem('geonchi_admin_role', res.role)
      }
      router.push('/admin/dashboard')
    } catch (err: any) {
      setError(err?.message || '로그인 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="관리자 로그인"
      subtitle="운영자 전용 콘솔입니다."
      footer={
        <Link href="/login" className="font-semibold text-brand-300 hover:text-brand-200">
          ← 일반 로그인으로
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="tag-warn">Restricted</div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/80">관리자 이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="root@gunchi.ai"
            className="input-field"
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/80">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="input-field"
            required
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3">
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            '관리자 로그인'
          )}
        </button>
      </form>
    </AuthShell>
  )
}
