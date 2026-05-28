import { Search, Plus } from 'lucide-react'
import { Button, Input } from '@/shared/components/ui'
import { useNavigate } from 'react-router-dom'

export default function DriveTopbar() {
  const navigate = useNavigate()

  return (
    <div className="h-14 flex items-center justify-between px-6 border-b border-[var(--border)] bg-[var(--bg-subtle)] shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-[8px] bg-[var(--accent-subtle)] flex items-center justify-center">
          <span className="text-[var(--accent)] text-sm font-bold">S</span>
        </div>
        <span className="text-sm font-semibold text-[var(--text)]">내 드라이브</span>
      </div>

      <div className="flex items-center gap-3 flex-1 max-w-sm mx-8">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <Input placeholder="검색..." className="pl-8 h-8 text-xs" />
        </div>
      </div>

      <Button
        variant="primary"
        size="sm"
        onClick={() => navigate('/edit/ppt-1')}
      >
        <Plus size={14} />
        새 프레젠테이션
      </Button>
    </div>
  )
}
