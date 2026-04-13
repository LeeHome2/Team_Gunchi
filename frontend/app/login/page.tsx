'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/AuthShell'
import { login } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email || !password) {
      setError('아이디와 비밀번호를 입력하세요.')
      return
    }

    setLoading(true)

    // 개발용 하드코딩 로그인: test / test
    if (email === 'test' && password === 'test') {
      sessionStorage.setItem('geonchi_user', JSON.stringify({
        user_id: 'dev-test-user',
        email: 'test@geonchi.ai',
        name: '테스트 사용자',
        role: 'user',
      }))
      window.location.href = '/projects'
      return
    }

    // 백엔드 API 로그인 시도
    try {
      const result = await login(email, password)

      if (result.success && result.user_id) {
        sessionStorage.setItem('geonchi_user', JSON.stringify({
          user_id: result.user_id,
          email: result.email,
          name: result.name,
          role: 'user',
        }))
        window.location.href = '/projects'
        return
      }

      setError(result.message || '아이디 또는 비밀번호가 올바르지 않습니다.')
    } catch (err) {
      // API 서버 연결 실패 시 이메일 형식이면 개발 모드로 허용
      if (email.includes('@')) {
        sessionStorage.setItem('geonchi_user', JSON.stringify({
          user_id: `dev-${email}`,
          email,
          name: email.split('@')[0],
          role: 'user',
        }))
        window.location.href = '/projects'
        return
      }
      setError('서버에 연결할 수 없습니다.')
    }

    setLoading(false)
  }

  return (
    <AuthShell
      title="다시 오신 것을 환영합니다"
      subtitle="프로젝트에 접속하려면 로그인하세요."
      footer={
        <>
          계정이 없으신가요?{' '}
          <Link href="/signup" className="font-semibold text-brand-300 hover:text-brand-200">
            회원가입
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-white/80">
            아이디
          </label>
          <input
            id="email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="test"
            className="input-field"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-white/80">
              비밀번호
            </label>
            <Link href="#" className="text-xs text-brand-300 hover:text-brand-200">
              비밀번호 찾기
            </Link>
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="test"
            className="input-field"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full py-3 text-base"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            '로그인'
          )}
        </button>

        <div className="relative py-2">
          <div className="divider" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-navy-850 px-3 text-xs text-white/40">
            또는
          </span>
        </div>

        <Link href="/admin/login" className="btn-secondary w-full py-2.5 text-sm">
          관리자 로그인
        </Link>
      </form>
    </AuthShell>
  )
}
