import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/shared/components/layout/DashboardLayout'
import { Button, Badge, Spinner } from '@/shared/components/ui'
import { useToastStore } from '@/shared/components/ui/Toast'
import { isLoggedIn } from '@/shared/lib/auth'
import { api } from '@/shared/lib/apiClient'
import { Key, Trash2, ExternalLink, ShieldCheck } from 'lucide-react'

interface ApiKeyInfo {
  id: string
  provider: string
  created_at: string
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const toast = useToastStore((s) => s.push)
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [inputKey, setInputKey] = useState('')
  const [registering, setRegistering] = useState(false)

  const load = async () => {
    try {
      const keys = await api.get<ApiKeyInfo[]>('/user/api-keys')
      setApiKeys(keys)
    } catch (e: any) {
      toast(e.message ?? '불러오기 실패', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isLoggedIn()) { navigate('/login'); return }
    load()
  }, [])

  const handleRegister = async () => {
    if (!inputKey.trim()) return
    setRegistering(true)
    try {
      await api.post('/user/api-keys', { api_key: inputKey.trim(), provider: 'anthropic' })
      setInputKey('')
      toast('API Key 등록 완료', 'success')
      load()
    } catch (e: any) {
      toast(e.message ?? '등록 실패', 'error')
    } finally {
      setRegistering(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/user/api-keys/${id}`)
      toast('API Key 삭제됨', 'success')
      load()
    } catch (e: any) {
      toast(e.message ?? '삭제 실패', 'error')
    }
  }

  const formatDate = (d: string) => {
    const dt = new Date(d)
    return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
  }

  return (
    <DashboardLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="px-10 py-8 flex flex-col gap-8 max-w-2xl">
          <div>
            <h1 className="text-xl font-bold text-[var(--text)]">설정</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">API Key 및 계정 설정</p>
          </div>

          {/* API Key 섹션 */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Key size={16} className="text-[var(--accent)]" />
              <h2 className="text-base font-bold text-[var(--text)]">Anthropic API Key</h2>
            </div>

            {/* 보안 안내 */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--accent-subtle)] border border-purple-200">
              <ShieldCheck size={16} className="text-[var(--accent)] mt-0.5 shrink-0" />
              <div className="text-xs text-[var(--accent-text)] leading-relaxed">
                <p className="font-semibold mb-0.5">보안 안내</p>
                <p>API Key는 AES-256으로 암호화 저장됩니다. 요청 처리 중에만 메모리에 존재하며 로그에 기록되지 않습니다.</p>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 mt-1.5 text-[var(--accent)] hover:underline w-fit"
                >
                  Anthropic 콘솔에서 Key 발급 <ExternalLink size={11} />
                </a>
              </div>
            </div>

            {/* 등록된 Key 목록 */}
            {loading ? (
              <div className="flex items-center justify-center h-20"><Spinner /></div>
            ) : apiKeys.length > 0 ? (
              <div className="flex flex-col gap-2">
                {apiKeys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between px-4 py-3 rounded-[var(--radius)] border border-[var(--border)] bg-white">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-[8px] bg-[var(--mint-subtle)] flex items-center justify-center">
                        <Key size={14} className="text-[var(--mint)]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text)] capitalize">{k.provider}</span>
                          <Badge variant="mint">활성</Badge>
                        </div>
                        <p className="text-xs text-[var(--text-disabled)] mt-0.5">등록일: {formatDate(k.created_at)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[var(--text-disabled)] hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)]">
                <p className="text-sm text-[var(--text-muted)]">등록된 API Key가 없습니다</p>
              </div>
            )}

            {/* 새 Key 등록 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]">API Key 등록</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                  placeholder="sk-ant-api03-..."
                  className="flex-1 h-10 px-3 text-sm border border-[var(--border)] rounded-[var(--radius)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 bg-white font-mono"
                />
                <Button variant="primary" size="md" onClick={handleRegister} disabled={registering || !inputKey.trim()}>
                  {registering ? '등록 중...' : '등록'}
                </Button>
              </div>
              <p className="text-xs text-[var(--text-disabled)]">기존 Key가 있으면 자동으로 교체됩니다</p>
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  )
}
