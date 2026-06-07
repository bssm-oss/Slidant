import { useState } from 'react'
import { X, Copy, Check, Users, Eye } from 'lucide-react'
import { api } from '@/shared/lib/apiClient'
import { cn } from '@/shared/lib/utils'

interface ShareModalProps {
  projectId: string
  onClose: () => void
}

type Role = 'editor' | 'viewer'

export default function ShareModal({ projectId, onClose }: ShareModalProps) {
  const [role, setRole] = useState<Role>('editor')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const generateLink = async () => {
    setLoading(true)
    try {
      const data = await api.post<{ token: string; invite_url: string }>(
        `/invites/projects/${projectId}/invites`,
        { role },
      )
      const url = `${window.location.origin}/invite/${data.token}`
      setGeneratedLink(url)
    } catch {
      alert('링크 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async () => {
    if (!generatedLink) return
    await navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[440px] relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-[var(--bg-muted)] text-[var(--text-muted)]"
        >
          <X size={16} />
        </button>

        <h2 className="text-[16px] font-semibold text-[var(--text)] mb-1">협업 초대</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-5">
          링크를 통해 다른 사람을 이 프레젠테이션에 초대합니다.
        </p>

        {/* 역할 선택 */}
        <div className="flex gap-3 mb-5">
          <button
            onClick={() => { setRole('editor'); setGeneratedLink(null) }}
            className={cn(
              'flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
              role === 'editor'
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                : 'border-[var(--border)] hover:border-[var(--border-hover)]',
            )}
          >
            <Users size={20} className={role === 'editor' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
            <div>
              <div className={cn('text-[13px] font-semibold', role === 'editor' ? 'text-[var(--accent)]' : 'text-[var(--text)]')}>
                편집자
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Agent 실행, 슬라이드 편집</div>
            </div>
          </button>

          <button
            onClick={() => { setRole('viewer'); setGeneratedLink(null) }}
            className={cn(
              'flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
              role === 'viewer'
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                : 'border-[var(--border)] hover:border-[var(--border-hover)]',
            )}
          >
            <Eye size={20} className={role === 'viewer' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
            <div>
              <div className={cn('text-[13px] font-semibold', role === 'viewer' ? 'text-[var(--accent)]' : 'text-[var(--text)]')}>
                뷰어
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">열람 전용</div>
            </div>
          </button>
        </div>

        {/* 링크 생성 / 표시 */}
        {!generatedLink ? (
          <button
            onClick={generateLink}
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-white text-[13px] font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            {loading ? '링크 생성 중…' : `${role === 'editor' ? '편집자' : '뷰어'} 링크 생성`}
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-[var(--bg-muted)] rounded-xl px-3 py-2.5">
            <span className="flex-1 text-[12px] text-[var(--text-muted)] truncate">{generatedLink}</span>
            <button
              onClick={copyLink}
              className="shrink-0 p-1.5 rounded-lg hover:bg-[var(--border)] transition-colors"
              title="링크 복사"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-[var(--text-muted)]" />}
            </button>
          </div>
        )}

        {generatedLink && (
          <p className="mt-2 text-[11px] text-[var(--text-disabled)] text-center">
            링크를 받은 사람은 로그인 후 <strong>{role === 'editor' ? '편집자' : '뷰어'}</strong>로 합류합니다.
          </p>
        )}
      </div>
    </div>
  )
}
