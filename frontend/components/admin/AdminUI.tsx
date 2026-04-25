/**
 * Small shared primitives used across the admin console.
 */

interface StatCardProps {
  label: string
  value: string
  change?: string
  changeType?: 'up' | 'down' | 'neutral'
  valueColor?: string
}

export function StatCard({
  label,
  value,
  change,
  changeType = 'neutral',
  valueColor,
}: StatCardProps) {
  const changeColor =
    changeType === 'up'
      ? 'text-emerald-300'
      : changeType === 'down'
      ? 'text-red-300'
      : 'text-white/40'
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold ${valueColor || 'text-white'}`}>
        {value}
      </div>
      {change && <div className={`mt-1 text-xs ${changeColor}`}>{change}</div>}
    </div>
  )
}

interface BadgeProps {
  variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  children: React.ReactNode
}

export function Badge({ variant, children }: BadgeProps) {
  const styles = {
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
    danger: 'bg-red-500/15 text-red-300 border-red-400/30',
    warning: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    info: 'bg-brand-500/15 text-brand-300 border-brand-400/30',
    neutral: 'bg-white/5 text-white/60 border-white/10',
  }[variant]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${styles}`}
    >
      {children}
    </span>
  )
}

interface AdminTableProps {
  headers: string[]
  children: React.ReactNode
}

export function AdminTable({ headers, children }: AdminTableProps) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/40"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({
  children,
  className = '',
  colSpan,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={`px-4 py-3 text-white/80 ${className}`}>
      {children}
    </td>
  )
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>
}

export function SmallBtn({
  children,
  variant = 'secondary',
  onClick,
  disabled,
}: {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  onClick?: () => void
  disabled?: boolean
}) {
  const classes = {
    primary:
      'px-2.5 py-1 rounded text-[11px] font-semibold bg-brand-500/20 text-brand-300 border border-brand-400/30 hover:bg-brand-500/30',
    secondary:
      'px-2.5 py-1 rounded text-[11px] font-semibold bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white',
    danger:
      'px-2.5 py-1 rounded text-[11px] font-semibold bg-red-500/15 text-red-300 border border-red-400/30 hover:bg-red-500/25',
  }[variant]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${classes} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}

export function SectionHeading({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {action}
    </div>
  )
}
