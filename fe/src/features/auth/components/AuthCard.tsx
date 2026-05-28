import { cn } from '@/shared/lib/utils'
import type { ReactNode } from 'react'

interface AuthCardProps {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
}

export default function AuthCard({ title, subtitle, children, className }: AuthCardProps) {
  return (
    <div className={cn(
      'w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)]',
      'shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(167,139,250,0.06)]',
      'p-6 flex flex-col gap-5',
      className,
    )}>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-[var(--text)]">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
