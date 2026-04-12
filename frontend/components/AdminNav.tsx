'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Brand from './Brand'

const adminTabs = [
  { label: '대시보드', href: '/admin/dashboard' },
  { label: 'AI 모델', href: '/admin/ai' },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 w-full border-b border-amber-400/20 bg-navy-900/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Brand size="sm" href="/admin/dashboard" />
          <span className="tag-warn">Admin Console</span>
          <nav className="hidden items-center gap-1 md:flex">
            {adminTabs.map((tab) => {
              const active = pathname?.startsWith(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={
                    active
                      ? 'px-3 py-1.5 text-sm font-semibold text-white bg-amber-500/15 border border-amber-400/30 rounded-md'
                      : 'px-3 py-1.5 text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 rounded-md transition-colors'
                  }
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <Link href="/" className="btn-ghost">
          로그아웃
        </Link>
      </div>
    </header>
  )
}
