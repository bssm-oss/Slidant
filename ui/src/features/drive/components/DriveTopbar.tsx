import { Search, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/shared/components/ui'
import { useDriveStore } from '../store/driveStore'

export default function DriveTopbar() {
  const { setSearch } = useDriveStore()

  return (
    <div className="flex min-h-[60px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-white px-4 sm:px-6">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold leading-tight text-[var(--text)]">내 드라이브</h1>
        <p className="mt-0.5 text-[12px] text-[var(--text-disabled)]">프레젠테이션 작업과 최근 편집물을 관리합니다</p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative w-[min(360px,42vw)] min-w-[180px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <Input placeholder="검색..." className="h-9 rounded-[8px] border-[var(--border)] bg-[var(--bg-raised)] pl-9 text-sm" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button
          type="button"
          title="필터"
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--border)] bg-white text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)]"
        >
          <SlidersHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}
