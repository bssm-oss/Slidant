import { cn } from '@/shared/lib/utils'
import { type HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: boolean
}

export default function Card({ className, glow = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-[var(--bg-subtle)] border border-[var(--border)] rounded-[var(--radius)] transition-all duration-200',
        glow && 'shadow-[0_2px_12px_rgba(0,0,0,0.4),0_0_0_1px_rgba(167,139,250,0.08)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.5),0_0_0_1px_rgba(167,139,250,0.15)]',
        !glow && 'hover:border-[var(--border-strong)]',
        className,
      )}
      {...props}
    />
  )
}
