import { cn } from '@/shared/lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex w-full h-9 px-3 text-[13px] bg-white text-[var(--text)] border border-[var(--border)] rounded-[8px]',
        'placeholder:text-[var(--text-disabled)]',
        'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-subtle)]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--bg-muted)]',
        'transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
export default Input
