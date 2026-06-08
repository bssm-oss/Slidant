import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Users, Eye } from 'lucide-react'
import { api } from '@/shared/lib/apiClient'

interface InviteInfo {
  token: string
  role: string
  project_id: string
  project_title: string
  is_valid: boolean
  reason?: string | null
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLoggedIn = !!localStorage.getItem('access_token')

  useEffect(() => {
    if (!token) return
    // 인증 없이 초대 정보 조회
    fetch(`/api/v1/invites/${token}/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.detail) throw new Error(data.detail)
        setInfo(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async () => {
    if (!token) return
    if (!isLoggedIn) {
      navigate(`/login?redirect=/invite/${token}`)
      return
    }
    setAccepting(true)
    try {
      const data = await api.post<{ project_id: string; role: string }>(
        `/invites/${token}/accept`,
        {},
      )
      navigate(`/edit/${data.project_id}`)
    } catch (e: any) {
      setError(e.message ?? '초대 수락에 실패했습니다.')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)] text-[14px]">초대 정보를 불러오는 중…</p>
      </div>
    )
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <p className="text-[16px] font-semibold text-[var(--text)]">초대 링크를 찾을 수 없습니다</p>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">{error}</p>
          <button onClick={() => navigate('/drive')} className="mt-4 text-[var(--accent)] text-[13px]">
            드라이브로 이동
          </button>
        </div>
      </div>
    )
  }

  if (!info.is_valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <p className="text-[16px] font-semibold text-[var(--text)]">유효하지 않은 초대 링크</p>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">{info.reason}</p>
          <button onClick={() => navigate('/drive')} className="mt-4 text-[var(--accent)] text-[13px]">
            드라이브로 이동
          </button>
        </div>
      </div>
    )
  }

  const roleLabel = info.role === 'editor' ? '편집자' : '뷰어'

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-[400px] text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center mx-auto mb-4">
          {info.role === 'editor'
            ? <Users size={22} className="text-[var(--accent)]" />
            : <Eye size={22} className="text-[var(--accent)]" />}
        </div>

        <h1 className="text-[18px] font-bold text-[var(--text)] mb-1">협업 초대</h1>
        <p className="text-[13px] text-[var(--text-muted)] mb-6">
          <span className="font-semibold text-[var(--text)]">{info.project_title}</span>에{' '}
          <span className="text-[var(--accent)] font-semibold">{roleLabel}</span>로 초대되었습니다.
        </p>

        <button
          onClick={handleAccept}
          disabled={accepting}
          className="w-full py-3 rounded-xl bg-[var(--accent)] text-white font-semibold text-[14px] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          {accepting ? '수락 중…' : isLoggedIn ? `${roleLabel}로 참여하기` : '로그인 후 참여하기'}
        </button>

        <button onClick={() => navigate('/drive')} className="mt-3 text-[12px] text-[var(--text-disabled)] hover:text-[var(--text-muted)]">
          취소
        </button>
      </div>
    </div>
  )
}
