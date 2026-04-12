'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Brand from './Brand'
import ThemeToggle from './ThemeToggle'

interface AppNavProps {
  userName?: string
}

// 설정은 계정 드롭다운 안으로 이동했기 때문에 메인 탭에서는 제거.
const tabs = [
  { label: '프로젝트', href: '/projects' },
  { label: '에디터', href: '/editor' },
  { label: '결과', href: '/results' },
]

interface StoredUser {
  email?: string
  name?: string
}

/**
 * In-app navigation — shown on authenticated user pages.
 * Slimmer than LandingNav, includes tabs and an account dropdown
 * (설정 / 로그아웃).
 */
export default function AppNav({ userName: userNameProp }: AppNavProps) {
  const pathname = usePathname()
  const router = useRouter()

  // sessionStorage.geonchi_user 에서 로그인 정보를 읽어 기본값 결정.
  // userNameProp 이 명시적으로 들어오면 그걸 우선 사용.
  const [resolvedName, setResolvedName] = useState<string>(userNameProp ?? '사용자')
  const [resolvedEmail, setResolvedEmail] = useState<string>('')

  useEffect(() => {
    if (userNameProp) {
      setResolvedName(userNameProp)
      return
    }
    try {
      const raw = sessionStorage.getItem('geonchi_user')
      if (raw) {
        const user = JSON.parse(raw) as StoredUser
        if (user.name) setResolvedName(user.name)
        if (user.email) setResolvedEmail(user.email)
      }
    } catch {
      /* ignore */
    }
  }, [userNameProp])

  // ─── 드롭다운 ────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // 바깥 클릭 / Esc 로 닫기
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  const handleOpenSettings = () => {
    setMenuOpen(false)
    router.push('/settings')
  }

  const handleLogout = () => {
    setMenuOpen(false)
    try {
      sessionStorage.removeItem('geonchi_user')
    } catch {
      /* ignore */
    }
    router.push('/login')
  }

  const avatarInitial = resolvedName.slice(0, 1) || '?'

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-navy-900/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Brand size="sm" />
          <nav className="hidden items-center gap-1 md:flex">
            {tabs.map((tab) => {
              const active = pathname?.startsWith(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={
                    active
                      ? 'px-3 py-1.5 text-sm font-semibold text-white bg-brand-500/20 border border-brand-400/30 rounded-md'
                      : 'px-3 py-1.5 text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 rounded-md transition-colors'
                  }
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            className="rounded-md p-2 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="알림"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </button>

          {/* Account dropdown */}
          <div className="relative" ref={wrapperRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-2 transition-colors hover:border-white/20 hover:bg-white/10"
            >
              <div className="h-7 w-7 rounded-full bg-brand-gradient flex items-center justify-center text-xs font-bold text-white">
                {avatarInitial}
              </div>
              <span className="text-sm text-white/80 max-w-[8rem] truncate">
                {resolvedName}
              </span>
              <svg
                className={`h-3.5 w-3.5 text-white/50 transition-transform ${
                  menuOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="계정 메뉴"
                className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-navy-850/95 shadow-xl backdrop-blur-xl"
              >
                {/* Identity block */}
                <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
                  <div className="h-9 w-9 rounded-full bg-brand-gradient flex items-center justify-center text-sm font-bold text-white">
                    {avatarInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {resolvedName}
                    </div>
                    {resolvedEmail && (
                      <div className="text-[11px] text-white/50 truncate">
                        {resolvedEmail}
                      </div>
                    )}
                  </div>
                </div>

                {/* Menu items */}
                <div className="py-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleOpenSettings}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    <svg className="h-4 w-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    설정
                  </button>

                  <div className="mx-3 my-1 border-t border-white/5" />

                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-red-300 hover:bg-red-500/10"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                    로그아웃
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
