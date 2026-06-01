import { cn } from '@/shared/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

const variantStyles = {
  primary:
    'bg-gradient-to-r from-[var(--accent)] to-[#A855F7] hover:from-[var(--accent-hover)] hover:to-[#9333EA] text-white shadow-[0_2px_8px_rgba(124,58,237,0.35)] hover:shadow-[0_4px_12px_rgba(124,58,237,0.45)]',
  secondary:
    'bg-white hover:bg-[var(--bg-muted)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--border-strong)]',
  ghost:
    'hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text)]',
  destructive:
    'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
}

const sizeStyles = {
  sm: 'h-8 px-3.5 text-xs gap-1.5 rounded-[8px]',
  md: 'h-10 px-4 text-sm rounded-[var(--radius)]',
  lg: 'h-12 px-6 text-base rounded-[14px]',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
export default Button
