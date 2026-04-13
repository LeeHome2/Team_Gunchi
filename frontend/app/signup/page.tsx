'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/AuthShell'
import { signup } from '@/lib/api'

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirm: '',
    org: '',
  })
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!agree) {
      setError('이용약관에 동의해 주세요.')
      return
    }
    if (form.password !== form.confirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    if (form.password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.')
      return
    }

    setLoading(true)
    try {
      const result = await signup(form.name, form.email, form.password)

      if (result.success && result.user_id) {
        sessionStorage.setItem('geonchi_user', JSON.stringify({
          user_id: result.user_id,
          email: result.email,
          name: result.name,
          role: 'user',
        }))
        router.push('/projects')
        return
      }

      setError(result.message || '회원가입에 실패했습니다.')
    } catch (err: any) {
      setError(err?.message || '서버에 연결할 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="무료 계정 생성"
      subtitle="Geonchi 에디터의 모든 기능을 즉시 사용할 수 있습니다."
      footer={
        <>
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="font-semibold text-brand-300 hover:text-brand-200">
            로그인
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-white/80">이름</label>
            <input
              type="text"
              value={form.name}
              onChange={update('name')}
              placeholder="홍길동"
              className="input-field"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-white/80">
              소속 (선택)
            </label>
            <input
              type="text"
              value={form.org}
              onChange={update('org')}
              placeholder="예: 가천대"
              className="input-field"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/80">이메일</label>
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
            placeholder="you@example.com"
            className="input-field"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/80">비밀번호</label>
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            placeholder="최소 6자"
            className="input-field"
            autoComplete="new-password"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white/80">
            비밀번호 확인
          </label>
          <input
            type="password"
            value={form.confirm}
            onChange={update('confirm')}
            placeholder="••••••••"
            className="input-field"
            autoComplete="new-password"
            required
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-white/60">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-navy-800 text-brand-500 focus:ring-brand-400"
          />
          <span>
            <Link href="#" className="underline hover:text-white">
              이용약관
            </Link>{' '}
            및{' '}
            <Link href="#" className="underline hover:text-white">
              개인정보 처리방침
            </Link>
            에 동의합니다.
          </span>
        </label>

        {error && (
          <div className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            '계정 만들기'
          )}
        </button>
      </form>
    </AuthShell>
  )
}
