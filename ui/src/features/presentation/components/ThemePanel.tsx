import { useState } from 'react'
import { api } from '@/shared/lib/apiClient'
import { useSlideStore } from '@/features/editor/store/slideStore'
import type { PresentationTheme } from '@/shared/types'

const PRESETS: { name: string; theme: PresentationTheme }[] = [
  { name: 'DARK', theme: { palette: 'DARK', bg: '#0A0F1E', accent: '#3B82F6', text: '#F9FAFB', text2: '#9CA3AF', font: 'Pretendard' } },
  { name: 'WARM', theme: { palette: 'WARM', bg: '#1C0F0A', accent: '#F59E0B', text: '#FEF3C7', text2: '#D97706', font: 'Pretendard' } },
  { name: 'LIGHT', theme: { palette: 'LIGHT', bg: '#F8FAFC', accent: '#7C3AED', text: '#0F172A', text2: '#475569', font: 'Pretendard' } },
  { name: 'NATURE', theme: { palette: 'NATURE', bg: '#0D1F1A', accent: '#34D399', text: '#ECFDF5', text2: '#6EE7B7', font: 'Pretendard' } },
  { name: 'SLATE', theme: { palette: 'SLATE', bg: '#1E293B', accent: '#F1F5F9', text: '#F8FAFC', text2: '#94A3B8', font: 'Pretendard' } },
]

export default function ThemePanel({ onClose }: { onClose: () => void }) {
  const { presentation, loadPresentation } = useSlideStore()
  const [saving, setSaving] = useState(false)
  const current = presentation?.theme

  const applyTheme = async (theme: PresentationTheme) => {
    if (!presentation) return
    setSaving(true)
    try {
      await api.patch(`/projects/${presentation.id}/theme`, { theme })
      await loadPresentation(presentation.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
        디자인 테마
      </p>
      <p className="text-[11px] text-[var(--text-disabled)]">
        테마 선택 시 이후 모든 Agent 슬라이드에 이 색상이 강제 적용됩니다.
      </p>
      <div className="flex flex-col gap-2">
        {PRESETS.map(({ name, theme }) => (
          <button
            key={name}
            onClick={() => applyTheme(theme)}
            disabled={saving}
            className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] border transition-all hover:scale-[1.01] disabled:opacity-50"
            style={{
              borderColor: current?.palette === name ? theme.accent : '#e5e7eb',
              background: theme.bg,
            }}
          >
            <div className="flex gap-1">
              <div className="w-4 h-4 rounded-full border-2" style={{ background: theme.bg, borderColor: theme.accent }} />
              <div className="w-4 h-4 rounded-full" style={{ background: theme.accent }} />
              <div className="w-4 h-4 rounded-full" style={{ background: theme.text }} />
            </div>
            <span className="text-[12px] font-medium" style={{ color: theme.text }}>{name}</span>
            {current?.palette === name && (
              <span className="ml-auto text-[10px]" style={{ color: theme.accent }}>&#10003; 적용 중</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
