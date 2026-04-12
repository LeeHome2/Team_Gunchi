import Link from 'next/link'
import Brand from './Brand'
import ThemeToggle from './ThemeToggle'

interface AuthShellProps {
  title: string
  subtitle?: string
  footer?: React.ReactNode
  children: React.ReactNode
}

/**
 * Shared shell for login and signup pages — dark, centered card.
 */
export default function AuthShell({ title, subtitle, footer, children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen text-white overflow-hidden flex flex-col">
      {/* Background glow (blueprint grid comes from body::before) */}
      <div className="absolute inset-0 bg-radial-glow pointer-events-none" />
      <div className="absolute left-1/2 top-0 h-[480px] w-[700px] -translate-x-1/2 rounded-full bg-brand-500/10 blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 mx-auto w-full max-w-7xl px-6 py-6 flex items-center justify-between">
        <Brand />
        <ThemeToggle />
      </header>

      {/* Form card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-md animate-slide-up">
          <div className="card p-8">
            <h1 className="text-2xl font-bold text-white">{title}</h1>
            {subtitle && (
              <p className="mt-2 text-sm text-white/60">{subtitle}</p>
            )}

            <div className="mt-6">{children}</div>

            {footer && (
              <>
                <div className="divider my-6" />
                <div className="text-center text-sm text-white/60">{footer}</div>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-white/30">
            <Link href="/" className="hover:text-white/60 transition-colors">
              ← 홈으로 돌아가기
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
