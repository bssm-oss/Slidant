import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AppShell } from '@/shared/components/layout'
import { Button, Input } from '@/shared/components/ui'
import AuthCard from '@/features/auth/components/AuthCard'
import GoogleButton from '@/features/auth/components/GoogleButton'
import Divider from '@/features/auth/components/Divider'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Mock: 바로 드라이브로 이동
    navigate('/drive')
  }

  return (
    <AppShell>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">

        {/* 로고 */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-[14px] bg-[var(--accent-subtle)] border border-[var(--accent)]/30 flex items-center justify-center shadow-[0_0_20px_rgba(167,139,250,0.2)]">
            <span className="text-[var(--accent)] text-xl font-bold">S</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Slidant</p>
        </div>

        <AuthCard title="로그인" subtitle="계속하려면 로그인하세요">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)]">이메일</label>
              <Input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-muted)]">비밀번호</label>
                <button type="button" className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors cursor-pointer">
                  비밀번호 찾기
                </button>
              </div>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="primary" className="w-full mt-1">
              로그인
            </Button>
          </form>

          <Divider />

          <GoogleButton label="Google로 계속" onClick={() => navigate('/drive')} />

          <p className="text-xs text-center text-[var(--text-muted)]">
            계정이 없으신가요?{' '}
            <Link to="/signup" className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors">
              회원가입
            </Link>
          </p>
        </AuthCard>
      </div>
    </AppShell>
  )
}
