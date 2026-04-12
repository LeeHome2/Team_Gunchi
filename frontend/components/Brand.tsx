'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface BrandProps {
  size?: 'sm' | 'md' | 'lg'
  /**
   * Optional explicit destination. If omitted, Brand routes to `/projects`
   * when the user is logged in (session marker present) and to `/` otherwise.
   */
  href?: string
  className?: string
}

/**
 * Geonchi brand wordmark.
 * Small icon + gradient text, clickable back to the appropriate "home":
 * - logged-in users go to `/projects` (app main)
 * - visitors go to `/` (landing)
 */
export default function Brand({ size = 'md', href, className = '' }: BrandProps) {
  const sizes = {
    sm: { box: 'h-6 w-6', text: 'text-base' },
    md: { box: 'h-8 w-8', text: 'text-xl' },
    lg: { box: 'h-10 w-10', text: 'text-2xl' },
  }[size]

  // Decide target after mount so we can read sessionStorage without SSR issues.
  const [autoHref, setAutoHref] = useState<string>('/')
  useEffect(() => {
    if (href) return
    try {
      const raw = sessionStorage.getItem('geonchi_user')
      setAutoHref(raw ? '/projects' : '/')
    } catch {
      setAutoHref('/')
    }
  }, [href])

  const destination = href ?? autoHref

  const content = (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className={`${sizes.box} rounded-lg bg-brand-gradient shadow-glow-sm flex items-center justify-center`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-2/3 w-2/3 text-white"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 21h18" />
          <path d="M5 21V8l7-4 7 4v13" />
          <path d="M9 21v-6h6v6" />
        </svg>
      </div>
      <span className={`${sizes.text} font-bold tracking-tight text-white`}>
        Geonchi
      </span>
    </div>
  )

  if (destination) {
    return <Link href={destination}>{content}</Link>
  }
  return content
}
