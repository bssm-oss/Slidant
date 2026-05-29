import { Search } from 'lucide-react'
import { Input } from '@/shared/components/ui'
import { useDriveStore } from '../store/driveStore'

export default function DriveTopbar() {
  const { setSearch } = useDriveStore()

  return (
    <div className="h-14 flex items-center px-6 border-b border-[var(--border)] bg-white shrink-0">
      <div className="relative w-80">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
        <Input placeholder="검색..." className="pl-9 h-9 text-sm" onChange={(e) => setSearch(e.target.value)} />
      </div>
    </div>
  )
}
