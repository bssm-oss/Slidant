import { useState } from 'react'
import { X, Copy, Check, Users, Eye, Presentation, Trash2 } from 'lucide-react'
import { api } from '@/shared/lib/apiClient'
import { cn } from '@/shared/lib/utils'

interface ShareModalProps {
  projectId: string
  initialShareToken?: string | null
  onClose: () => void
}

type Role = 'editor' | 'viewer'

function CopyRow({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div
      className="flex items-center gap-2 bg-[var(--bg-muted)] rounded-xl px-3 py-2.5 cursor-pointer hover:bg-[var(--border)] transition-colors"
      onClick={copy}
      title="클릭하여 복사"
    >
      <span className="flex-1 text-[12px] text-[var(--text-muted)] truncate select-all">{label ?? url}</span>
      <span className="shrink-0 p-1.5">
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-[var(--text-muted)]" />}
      </span>
    </div>
  )
}

export default function ShareModal({ projectId, initialShareToken, onClose }: ShareModalProps) {
  // ── 협업 초대 ──
  const [role, setRole] = useState<Role>('editor')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)

  // ── 발표 링크 ──
  const [shareToken, setShareToken] = useState<string | null>(initialShareToken ?? null)
  const [shareLoading, setShareLoading] = useState(false)

  const generateInvite = async () => {
    setInviteLoading(true)
    try {
      const data = await api.post<{ token: string }>(`/invites/projects/${projectId}/invites`, { role })
      setInviteLink(`${window.location.origin}/invite/${data.token}`)
    } catch {
      alert('링크 생성에 실패했습니다.')
    } finally {
      setInviteLoading(false)
    }
  }

  const generateShare = async () => {
    setShareLoading(true)
    try {
      const data = await api.post<{ share_token: string }>(`/projects/${projectId}/share`, {})
      setShareToken(data.share_token)
    } catch {
      alert('링크 생성에 실패했습니다.')
    } finally {
      setShareLoading(false)
    }
  }

  const revokeShare = async () => {
    setShareLoading(true)
    try {
      await api.delete(`/projects/${projectId}/share`)
      setShareToken(null)
    } catch {
      alert('링크 삭제에 실패했습니다.')
    } finally {
      setShareLoading(false)
    }
  }

  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : null

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

        {/* ── 협업 초대 ── */}
        <h2 className="text-[16px] font-semibold text-[var(--text)] mb-1">협업 초대</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          링크로 다른 사람을 이 프레젠테이션에 초대합니다.
        </p>

        <div className="flex gap-3 mb-4">
          <button
            onClick={() => { setRole('editor'); setInviteLink(null) }}
            className={cn(
              'flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
              role === 'editor'
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                : 'border-[var(--border)] hover:border-[var(--border-hover)]',
            )}
          >
            <Users size={20} className={role === 'editor' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
            <div>
              <div className={cn('text-[13px] font-semibold', role === 'editor' ? 'text-[var(--accent)]' : 'text-[var(--text)]')}>편집자</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Agent 실행, 슬라이드 편집</div>
            </div>
          </button>

          <button
            onClick={() => { setRole('viewer'); setInviteLink(null) }}
            className={cn(
              'flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors',
              role === 'viewer'
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                : 'border-[var(--border)] hover:border-[var(--border-hover)]',
            )}
          >
            <Eye size={20} className={role === 'viewer' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
            <div>
              <div className={cn('text-[13px] font-semibold', role === 'viewer' ? 'text-[var(--accent)]' : 'text-[var(--text)]')}>뷰어</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">열람 전용</div>
            </div>
          </button>
        </div>

        {!inviteLink ? (
          <button
            onClick={generateInvite}
            disabled={inviteLoading}
            className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-white text-[13px] font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            {inviteLoading ? '생성 중…' : `${role === 'editor' ? '편집자' : '뷰어'} 링크 생성`}
          </button>
        ) : (
          <>
            <CopyRow url={inviteLink} />
            <p className="mt-1.5 text-[11px] text-[var(--text-disabled)] text-center">
              로그인 후 <strong>{role === 'editor' ? '편집자' : '뷰어'}</strong>로 합류합니다.
            </p>
          </>
        )}

        {/* ── 구분선 ── */}
        <div className="border-t border-[var(--border)] my-5" />

        {/* ── 발표 링크 ── */}
        <div className="flex items-center gap-2 mb-1">
          <Presentation size={15} className="text-[var(--text-muted)]" />
          <h3 className="text-[14px] font-semibold text-[var(--text)]">발표 링크</h3>
        </div>
        <p className="text-[12px] text-[var(--text-muted)] mb-3">
          로그인 없이 슬라이드를 볼 수 있는 공개 링크입니다.
        </p>

        {shareUrl ? (
          <>
            <CopyRow url={shareUrl} />
            <button
              onClick={revokeShare}
              disabled={shareLoading}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-red-500 text-[12px] hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 size={12} />
              {shareLoading ? '삭제 중…' : '링크 삭제'}
            </button>
          </>
        ) : (
          <button
            onClick={generateShare}
            disabled={shareLoading}
            className="w-full py-2.5 rounded-xl border border-[var(--border)] text-[var(--text)] text-[13px] font-semibold hover:bg-[var(--bg-muted)] disabled:opacity-50 transition-colors"
          >
            {shareLoading ? '생성 중…' : '발표 링크 생성'}
          </button>
        )}
      </div>
    </div>
  )
}
