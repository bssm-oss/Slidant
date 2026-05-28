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
        glow && 'shadow-[0_4px_24px_rgba(124,58,237,0.10)] hover:shadow-[0_8px_32px_rgba(124,58,237,0.16)]',
        !glow && 'hover:shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:border-[var(--border-strong)]',
        className,
      )}
      {...props}
    />
  )
}
