import { cn } from '@/shared/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

const variantStyles = {
  primary: 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-[0_0_16px_rgba(167,139,250,0.25)]',
  secondary: 'bg-[var(--bg-muted)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)]',
  ghost: 'hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text)]',
  destructive: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20',
}

const sizeStyles = {
  sm: 'h-7 px-3 text-xs rounded-[8px]',
  md: 'h-9 px-4 text-sm rounded-[var(--radius)]',
  lg: 'h-11 px-6 text-base rounded-[14px]',
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
