import { cn } from '@/shared/lib/utils'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }

export default function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div
      className={cn(
        'rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin',
        sizeStyles[size],
        className,
      )}
    />
  )
}
