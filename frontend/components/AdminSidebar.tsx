'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Brand from './Brand'

interface NavItem {
  label: string
  href: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const GROUPS: NavGroup[] = [
  {
    label: '메인',
    items: [{ label: '대시보드', href: '/admin/dashboard' }],
  },
  {
    label: '관리',
    items: [
      { label: '사용자 관리', href: '/admin/users' },
      { label: '프로젝트 관리', href: '/admin/projects' },
      { label: '결과 관리', href: '/admin/results' },
    ],
  },
  {
    label: '데이터 & AI',
    items: [
      { label: '규정 관리', href: '/admin/regulations' },
      { label: 'AI 모델', href: '/admin/ai' },
    ],
  },
  {
    label: '시스템',
    items: [
      { label: '로그', href: '/admin/logs' },
      { label: '인증 관리', href: '/admin/auth' },
      { label: '서비스 설정', href: '/admin/service' },
    ],
  },
]

export default function AdminSidebar() {
  const pathname = usePathname() || ''

  return (
    <aside className="fixed inset-y-0 left-0 w-60 flex-shrink-0 border-r border-white/5 bg-navy-950/80 backdrop-blur-xl flex flex-col z-30">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5">
        <Brand size="sm" href="/admin/dashboard" />
      </div>
      <div className="px-5 py-3 border-b border-white/5">
        <div className="text-xs font-semibold text-white/40 uppercase tracking-wider">
          건축물 배치
        </div>
        <div className="text-[11px] text-white/30">관리 콘솔</div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-white/30">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={
                        active
                          ? 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-semibold text-white bg-brand-500/20 border border-brand-400/30'
                          : 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 border border-transparent transition-colors'
                      }
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          active ? 'bg-brand-300' : 'bg-white/20'
                        }`}
                      />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/5">
        <Link
          href="/"
          className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
          로그아웃
        </Link>
      </div>
    </aside>
  )
}
