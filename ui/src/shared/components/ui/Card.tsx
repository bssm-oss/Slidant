import { cn } from '@/shared/lib/utils'
import { type HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: boolean
  color?: 'violet' | 'pink' | 'sky' | 'mint' | 'orange'
}

const colorBorder: Record<string, string> = {
  violet: 'border-t-4 border-t-[var(--accent)]',
  pink:   'border-t-4 border-t-[var(--pink)]',
  sky:    'border-t-4 border-t-[var(--sky)]',
  mint:   'border-t-4 border-t-[var(--mint)]',
  orange: 'border-t-4 border-t-[var(--orange)]',
}

export default function Card({ className, glow = false, color, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white border border-[var(--border)] rounded-[var(--radius)] transition-all duration-200',
        color ? colorBorder[color] : '',
        glow && 'shadow-[0_8px_28px_rgba(37,99,235,0.10)] hover:shadow-[0_14px_34px_rgba(37,99,235,0.16)]',
        !glow && 'shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:border-[var(--border-strong)]',
        className,
      )}
      {...props}
    />
  )
}
