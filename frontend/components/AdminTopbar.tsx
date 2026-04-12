'use client'

import ThemeToggle from './ThemeToggle'

interface AdminTopbarProps {
  title: string
  description?: string
  adminEmail?: string
}

/**
 * Top strip shown inside the admin console — shows page title + admin avatar.
 */
export default function AdminTopbar({
  title,
  description,
  adminEmail = 'admin@geonchi.com',
}: AdminTopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/5 bg-navy-900/80 backdrop-blur-xl px-8 py-4">
      <div className="flex-1">
        <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-xs text-white/50">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <span className="text-xs text-white/50 font-mono">{adminEmail}</span>
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-xs font-bold text-navy-950">
          A
        </div>
      </div>
    </header>
  )
}
