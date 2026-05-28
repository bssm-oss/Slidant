import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Sparkles } from 'lucide-react'

const suggestions = [
  { id: 'design', label: '슬라이드 디자인 개선', icon: '✦' },
  { id: 'content', label: '텍스트 내용 보완', icon: '✦' },
  { id: 'layout', label: '레이아웃 변경', icon: '✦' },
  { id: 'custom', label: '커스텀 Agent 실행', icon: '✦' },
]

export default function CommandPalette() {
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useEditorStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(!isCommandPaletteOpen)
      }
      if (e.key === 'Escape') setCommandPaletteOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isCommandPaletteOpen, setCommandPaletteOpen])

  useEffect(() => {
    if (isCommandPaletteOpen) inputRef.current?.focus()
  }, [isCommandPaletteOpen])

  if (!isCommandPaletteOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={() => setCommandPaletteOpen(false)}
      />

      {/* Palette */}
      <div
        className={cn(
          'fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-[480px] rounded-[16px] border border-[var(--border-strong)]',
          'bg-[var(--bg-subtle)] shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_0_1px_rgba(167,139,250,0.1)]',
          'overflow-hidden',
        )}
      >
        {/* 입력 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <Sparkles size={16} className="text-[var(--accent)] shrink-0" />
          <input
            ref={inputRef}
            placeholder="Agent에게 요청..."
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-disabled)] outline-none"
          />
          <kbd className="text-xs text-[var(--text-disabled)] bg-[var(--bg-muted)] px-1.5 py-0.5 rounded-[4px]">
            ESC
          </kbd>
        </div>

        {/* 제안 목록 */}
        <div className="py-1.5">
          {suggestions.map((s) => (
            <button
              key={s.id}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)] transition-colors cursor-pointer text-left"
              onClick={() => setCommandPaletteOpen(false)}
            >
              <span className="text-[var(--accent)] text-xs">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
