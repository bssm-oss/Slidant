import { NavLink, useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { FolderOpen, Bot, Settings, LogOut, Plus } from 'lucide-react'
import { logout } from '@/shared/lib/auth'
import { useDriveStore } from '@/features/drive/store/driveStore'

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
    <div className="w-56 h-full flex flex-col border-r border-[var(--border)] bg-white shrink-0">
      {/* 로고 */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-[var(--border)]">
        <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm">
          <span className="text-white text-sm font-bold">S</span>
        </div>
        <span className="text-base font-bold text-[var(--text)]">Slidant</span>
      </div>

      {/* 새 프레젠테이션 */}
      <div className="px-3 pt-4 pb-2">
        <button
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius)] bg-gradient-to-r from-[var(--accent)] to-[#A855F7] text-white text-sm font-medium shadow-[0_2px_8px_rgba(124,58,237,0.3)] hover:shadow-[0_4px_12px_rgba(124,58,237,0.4)] transition-all duration-150 cursor-pointer"
        >
          <Plus size={15} />
          새 프레젠테이션
        </button>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 py-2 flex flex-col gap-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)]',
            )}
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* 하단 */}
      <div className="px-3 py-4 border-t border-[var(--border)] flex flex-col gap-0.5">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium text-[var(--text-muted)] hover:bg-red-50 hover:text-red-500 transition-all duration-150 cursor-pointer w-full text-left"
        >
          <LogOut size={16} />
          로그아웃
        </button>
      </div>
    </div>
  )
}
