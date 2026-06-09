import { useState } from 'react'
import { api } from '@/shared/lib/apiClient'
import { useSlideStore } from '@/features/editor/store/slideStore'
import type { PresentationTheme } from '@/shared/types'

const PRESETS: { name: string; label: string; theme: PresentationTheme }[] = [
  { name: 'DARK', label: '다크', theme: { palette: 'DARK', bg: '#0A0F1E', accent: '#3B82F6', text: '#F9FAFB', text2: '#9CA3AF', font: 'Pretendard' } },
  { name: 'WARM', label: '웜', theme: { palette: 'WARM', bg: '#1C0F0A', accent: '#F59E0B', text: '#FEF3C7', text2: '#D97706', font: 'Pretendard' } },
  { name: 'LIGHT', label: '라이트', theme: { palette: 'LIGHT', bg: '#F8FAFC', accent: '#7C3AED', text: '#0F172A', text2: '#475569', font: 'Pretendard' } },
  { name: 'NATURE', label: '자연', theme: { palette: 'NATURE', bg: '#0D1F1A', accent: '#34D399', text: '#ECFDF5', text2: '#6EE7B7', font: 'Pretendard' } },
  { name: 'SLATE', label: '슬레이트', theme: { palette: 'SLATE', bg: '#1E293B', accent: '#F1F5F9', text: '#F8FAFC', text2: '#94A3B8', font: 'Pretendard' } },
  { name: 'VIVID', label: '비비드', theme: { palette: 'VIVID', bg: '#0F172A', accent: '#F43F5E', text: '#FFFFFF', text2: '#FDA4AF', font: 'Syne' } },
  { name: 'OCEAN', label: '오션', theme: { palette: 'OCEAN', bg: '#082F49', accent: '#0EA5E9', text: '#F0F9FF', text2: '#7DD3FC', font: 'Gmarket Sans' } },
  { name: 'GOLD', label: '골드', theme: { palette: 'GOLD', bg: '#18181B', accent: '#EAB308', text: '#FAFAF9', text2: '#D4D4D8', font: 'Montserrat' } },
  { name: 'SOFT', label: '소프트', theme: { palette: 'SOFT', bg: '#FAF5FF', accent: '#D946EF', text: '#4A044E', text2: '#701A75', font: 'Pretendard' } },
  { name: 'ROSE', label: '로즈', theme: { palette: 'ROSE', bg: '#FFF1F2', accent: '#E11D48', text: '#4C0519', text2: '#881337', font: 'Pretendard' } },
  { name: 'MIDNIGHT', label: '미드나이트', theme: { palette: 'MIDNIGHT', bg: '#020617', accent: '#6366F1', text: '#F8FAFC', text2: '#CBD5E1', font: 'Inter' } },
  { name: 'FOREST', label: '포레스트', theme: { palette: 'FOREST', bg: '#052e16', accent: '#22c55e', text: '#f0fdf4', text2: '#86efac', font: 'Pretendard' } },
  { name: 'ROBOTIC', label: '로보틱', theme: { palette: 'ROBOTIC', bg: '#0f172a', accent: '#38bdf8', text: '#f8fafc', text2: '#94a3b8', font: 'Inter' } },
  { name: 'CANDY', label: '캔디', theme: { palette: 'CANDY', bg: '#fdf2f8', accent: '#ec4899', text: '#500724', text2: '#9d174d', font: 'Syne' } },
  { name: 'EARTH', label: '어스', theme: { palette: 'EARTH', bg: '#451a03', accent: '#f97316', text: '#fff7ed', text2: '#fdba74', font: 'Black Han Sans' } },
]

export default function ThemePanel({ onClose: _onClose }: { onClose: () => void }) {
  const { presentation, loadPresentation } = useSlideStore()
  const [saving, setSaving] = useState(false)
  const current = presentation?.theme
  const activePalette = current?.palette ?? 'DARK'

  const applyTheme = async (theme: any) => {
    if (!presentation) return
    setSaving(true)
    try {
      await api.patch('/projects/' + presentation.id + '/theme', { theme })
      await loadPresentation(presentation.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='p-4 flex flex-col gap-3'>
      <p className='text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide'>
        디자인 테마
      </p>
      <p className='text-[11px] text-[var(--text-disabled)]'>
        테마 선택 시 이후 모든 Agent 슬라이드에 이 색상이 강제 적용됩니다.
      </p>
      <div className='flex flex-col gap-2 overflow-y-auto pr-1 max-h-[calc(100vh-200px)] custom-scrollbar'>
        {PRESETS.map(({ name, label, theme }) => (
          <button
            key={name}
            onClick={() => applyTheme(theme)}
            disabled={saving}
            className='flex items-center gap-3 px-3 py-2.5 rounded-[8px] border transition-all hover:scale-[1.01] disabled:opacity-50'
            style={{
              borderColor: activePalette === name ? theme.accent : '#e5e7eb',
              background: theme.bg,
            }}
          >
            <div className='flex gap-1'>
              <div className='w-4 h-4 rounded-full border-2' style={{ background: theme.bg, borderColor: theme.accent }} />
              <div className='w-4 h-4 rounded-full' style={{ background: theme.accent }} />
              <div className='w-4 h-4 rounded-full' style={{ background: theme.text }} />
            </div>
            <span className='text-[12px] font-medium' style={{ color: theme.text }}>{label}</span>
            {activePalette === name && (
              <span className='ml-auto text-[10px]' style={{ color: theme.accent }}>적용 중</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}