import { cn } from '@/shared/lib/utils'
import { type TextareaHTMLAttributes, forwardRef } from 'react'

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full px-3 py-2 text-[13px] bg-white text-[var(--text)] border border-[var(--border)] rounded-[8px]',
        'placeholder:text-[var(--text-disabled)]',
        'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-subtle)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none transition-colors',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea }
export default Textarea
