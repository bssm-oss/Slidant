import { cn } from '@/shared/lib/utils'
import { type HTMLAttributes } from 'react'

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'pink' | 'sky'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border)]',
  accent: 'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-[var(--accent)]/20',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  pink: 'bg-[#2B1020] text-pink-400 border-pink-500/20',
  sky: 'bg-[#0C1F2B] text-sky-400 border-sky-500/20',
}

export default function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border',
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  )
}
