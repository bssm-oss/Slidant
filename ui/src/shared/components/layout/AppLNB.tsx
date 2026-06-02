import { NavLink, useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { FolderOpen, Bot, Settings, LogOut, Plus, PanelLeft } from 'lucide-react'
import { logout } from '@/shared/lib/auth'
import { useDriveStore } from '@/features/drive/store/driveStore'
import BrandMark from './BrandMark'

const navItems = [
  { to: '/drive',    icon: FolderOpen, label: '내 드라이브' },
  { to: '/agents',   icon: Bot,        label: '에이전트 관리' },
  { to: '/settings', icon: Settings,   label: '설정' },
]

export default function AppLNB() {
  const navigate = useNavigate()
  const createPresentation = useDriveStore((s) => s.createPresentation)

  const handleCreate = async () => {
    const id = await createPresentation()
    navigate(`/edit/${id}`)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-60 h-full flex flex-col border-r border-[var(--border)] bg-white shrink-0">
      {/* 로고 */}
      <NavLink to="/drive" className="flex h-[60px] items-center gap-2.5 border-b border-[var(--border)] px-4 transition-colors hover:bg-[var(--bg-raised)]">
        <BrandMark />
        <div className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight text-[var(--text)]">Slidant</span>
        </div>
      </NavLink>

      {/* 새 프레젠테이션 */}
      <div className="px-3 pt-4 pb-3">
        <button
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius)] bg-[linear-gradient(135deg,#2563EB_0%,#0EA5E9_100%)] text-white text-sm font-medium shadow-[0_8px_18px_rgba(37,99,235,0.20)] hover:shadow-[0_10px_22px_rgba(37,99,235,0.28)] transition-all duration-150 cursor-pointer"
        >
          <Plus size={15} />
          새 프레젠테이션
        </button>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-2 flex flex-col gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-[8px] px-4 py-3 text-[15px] font-medium transition-all duration-150',
              isActive
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]',
            )}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* 하단 */}
      <div className="px-3 py-4 border-t border-[var(--border)] flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 px-2 text-[12px] text-[var(--text-disabled)]">
          <PanelLeft size={14} />
          <span className="truncate">Workspace</span>
        </div>
        <button
          onClick={handleLogout}
          title="로그아웃"
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:bg-red-50 hover:text-red-500 transition-all duration-150 cursor-pointer"
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  )
}
