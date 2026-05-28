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
    <div className="h-16 flex items-center justify-between px-10 border-b border-[var(--border)] bg-white shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm">
          <span className="text-white text-base font-bold">S</span>
        </div>
        <span className="text-base font-bold text-[var(--text)]">내 드라이브</span>
      </div>
      <div className="flex items-center gap-3 flex-1 max-w-md mx-10">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <Input placeholder="검색..." className="pl-9 h-10 text-sm" onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Button variant="primary" size="md" onClick={handleCreate}>
        <Plus size={16} />새 프레젠테이션
      </Button>
    </div>
  )
}
