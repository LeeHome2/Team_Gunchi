'use client'

import { usePathname } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'

/**
 * Admin layout — wraps all /admin/* routes with a fixed sidebar + main content area.
 * The /admin/login page has its own full-screen AuthShell, so we skip the sidebar there.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname() || ''

  // Login page uses its own full-screen shell
  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <AdminSidebar />
      <div className="pl-60 min-h-screen flex flex-col">
        {children}
      </div>
    </div>
  )
}
