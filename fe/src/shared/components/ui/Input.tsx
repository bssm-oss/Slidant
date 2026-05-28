import { cn } from '@/shared/lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full h-9 px-3 text-sm bg-white text-[var(--text)] border border-[var(--border)] rounded-[8px]',
        'placeholder:text-[var(--text-disabled)]',
        'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15',
        'transition-all duration-150 disabled:opacity-50 disabled:bg-[var(--bg-muted)]',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
export default Input
