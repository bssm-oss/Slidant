import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AppShell } from '@/shared/components/layout'
import { Button, Input } from '@/shared/components/ui'
import AuthCard from '@/features/auth/components/AuthCard'
import GoogleButton from '@/features/auth/components/GoogleButton'
import Divider from '@/features/auth/components/Divider'

export default function SignupPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <AppShell>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-8 bg-gradient-to-br from-purple-50 via-[var(--bg)] to-pink-50">
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-[16px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-[0_4px_16px_rgba(124,58,237,0.3)]">
            <span className="text-white text-2xl font-bold">S</span>
          </div>
          <p className="text-base font-bold text-[var(--text)]">Slidant</p>
        </div>

        <AuthCard title="회원가입" subtitle="새 계정을 만들어 시작하세요">
          <form onSubmit={(e) => { e.preventDefault(); navigate('/drive') }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--text-muted)]">이름</label>
              <Input type="text" placeholder="홍길동" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--text-muted)]">이메일</label>
              <Input type="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--text-muted)]">비밀번호</label>
              <Input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" variant="primary" className="w-full mt-1">가입하기</Button>
          </form>
          <Divider />
          <GoogleButton label="Google로 가입" onClick={() => navigate('/drive')} />
          <div className="rounded-[8px] border border-purple-200 bg-[var(--accent-subtle)] px-3 py-2.5">
            <p className="text-xs text-[var(--accent-text)] leading-relaxed">
              가입 후 Anthropic API Key를 등록하면 AI Agent 기능을 사용할 수 있어요.{' '}
              <span className="underline cursor-pointer font-semibold">한도 설정 방법 보기 →</span>
            </p>
          </div>
          <p className="text-xs text-center text-[var(--text-muted)]">
            이미 계정이 있으신가요?{' '}
            <Link to="/login" className="text-[var(--accent)] hover:text-[var(--accent-hover)] font-semibold transition-colors">로그인</Link>
          </p>
        </AuthCard>
      </div>
    </AppShell>
  )
}
