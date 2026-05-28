import { cn } from '@/shared/lib/utils'
import { type HTMLAttributes } from 'react'

type BadgeVariant = 'default' | 'violet' | 'pink' | 'sky' | 'mint' | 'orange' | 'yellow' | 'error'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border)]',
  violet:  'bg-[var(--accent-subtle)] text-[var(--accent-text)] border-purple-200',
  pink:    'bg-[var(--pink-subtle)] text-[var(--pink-text)] border-pink-200',
  sky:     'bg-[var(--sky-subtle)] text-[var(--sky-text)] border-sky-200',
  mint:    'bg-[var(--mint-subtle)] text-[var(--mint-text)] border-emerald-200',
  orange:  'bg-[var(--orange-subtle)] text-[var(--orange-text)] border-orange-200',
  yellow:  'bg-[var(--yellow-subtle)] text-[var(--yellow-text)] border-yellow-200',
  error:   'bg-red-50 text-red-600 border-red-200',
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
