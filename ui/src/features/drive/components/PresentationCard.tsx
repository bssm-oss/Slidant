import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import type { Presentation } from '@/shared/types'

const cardColors = [
  'from-purple-400 to-violet-500',
  'from-pink-400 to-rose-500',
  'from-sky-400 to-blue-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-amber-500',
]

function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
}

export default function PresentationCard({ presentation, index = 0 }: { presentation: Presentation; index?: number }) {
  const navigate = useNavigate()
  const gradient = cardColors[index % cardColors.length]

  return (
    <button onClick={() => navigate(`/edit/${presentation.id}`)}
      className={cn(
        'group flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-white overflow-hidden text-left cursor-pointer w-full',
        'hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:border-[var(--border-strong)] hover:-translate-y-0.5',
        'transition-all duration-200',
      )}>
      {/* 컬러 프리뷰 */}
      <div className={cn('aspect-video bg-gradient-to-br flex items-center justify-center relative', gradient)}>
        <span className="text-white/80 text-6xl font-bold opacity-20 select-none">
          {presentation.title.charAt(0)}
        </span>
        <div className="absolute bottom-2.5 right-2.5 bg-white/20 backdrop-blur-sm rounded-[6px] px-2 py-1">
          <span className="text-white text-sm font-semibold">{presentation.slides.length}장</span>
        </div>
      </div>
      {/* 카드 정보 */}
      <div className="p-4">
        <p className="text-base font-semibold text-[var(--text)] truncate">{presentation.title}</p>
        <p className="text-sm text-[var(--text-disabled)] mt-1">{formatDate(presentation.updatedAt)}</p>
      </div>
    </button>
  )
}
