'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/AuthShell'

export default function AdminLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 400))
      if (username !== 'admin' || password !== 'admin') {
        setError('관리자 계정을 확인해 주세요. (데모: admin / admin)')
        return
      }
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('geonchi_admin', '1')
      }
      router.push('/admin/dashboard')
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
          <label className="mb-1.5 block text-sm font-medium text-white/80">관리자 ID</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="input-field"
            required
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
