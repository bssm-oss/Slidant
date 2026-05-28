import { cn } from '@/shared/lib/utils'
import type { ReactNode } from 'react'

export default function AuthCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-white',
      'shadow-[0_8px_32px_rgba(124,58,237,0.10),0_2px_8px_rgba(0,0,0,0.06)]',
      'p-6 flex flex-col gap-5',
      className,
    )}>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-[var(--text)]">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
