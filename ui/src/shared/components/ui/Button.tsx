import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/shared/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 cursor-pointer disabled:pointer-events-none disabled:opacity-50 shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-sm hover:shadow',
        secondary:
          'bg-white hover:bg-[var(--bg-muted)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--border-strong)]',
        ghost:
          'hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text)]',
        destructive:
          'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
        outline:
          'border border-[var(--border)] bg-transparent hover:bg-[var(--bg-muted)] text-[var(--text)]',
      },
      size: {
        sm: 'h-8 px-3 text-[12px] leading-normal rounded-[8px]',
        md: 'h-9 px-4 text-[13px] leading-normal rounded-[10px]',
        lg: 'h-10 px-5 text-[14px] leading-normal rounded-[12px]',
        icon: 'h-8 w-8 rounded-[8px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button }
export default Button
