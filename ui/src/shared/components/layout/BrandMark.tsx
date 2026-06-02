import { cn } from '@/shared/lib/utils'

interface BrandMarkProps {
  size?: 'sm' | 'md'
  className?: string
}

const sizes = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-8 w-8 text-sm',
}

export default function BrandMark({ size = 'md', className }: BrandMarkProps) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-[8px]',
        'bg-[linear-gradient(135deg,#2563EB_0%,#0EA5E9_52%,#14B8A6_100%)] shadow-[0_8px_18px_rgba(37,99,235,0.24)]',
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-x-1 top-1 h-px bg-white/45" />
      <span className="relative font-semibold text-white">S</span>
    </div>
  )
}
