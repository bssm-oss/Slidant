import { Search, Plus } from 'lucide-react'
import { Button, Input } from '@/shared/components/ui'
import { useNavigate } from 'react-router-dom'
import { useDriveStore } from '../store/driveStore'

export default function DriveTopbar() {
  const navigate = useNavigate()
  const { setSearch, createPresentation } = useDriveStore()

  const handleCreate = () => {
    const id = createPresentation()
    navigate(`/edit/${id}`)
  }

  return (
    <div className="h-14 flex items-center justify-between px-6 border-b border-[var(--border)] bg-white shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm">
          <span className="text-white text-sm font-bold">S</span>
        </div>
        <span className="text-sm font-semibold text-[var(--text)]">내 드라이브</span>
      </div>
      <div className="flex items-center gap-3 flex-1 max-w-sm mx-8">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <Input placeholder="검색..." className="pl-8 h-8 text-xs" onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={handleCreate}>
        <Plus size={14} />새 프레젠테이션
      </Button>
    </div>
  )
}
