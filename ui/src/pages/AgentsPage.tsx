import { useEffect, useState } from 'react'
import DashboardLayout from '@/shared/components/layout/DashboardLayout'
import { Badge, Button, Card, Spinner } from '@/shared/components/ui'
import { useToastStore } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'
import { Bot, Plus, Settings2, Trash2, Zap } from 'lucide-react'
import { fetchAgents, createAgent, deleteAgent, type AgentDefinition } from '@/shared/lib/agentApi'

type AgentRole = 'content' | 'design' | 'layout' | 'custom'

const roleConfig: Record<string, { label: string; color: 'violet' | 'sky' | 'mint' | 'pink' | 'orange' }> = {
  content: { label: '콘텐츠', color: 'violet' },
  design:  { label: '디자인',  color: 'pink' },
  layout:  { label: '레이아웃', color: 'sky' },
  custom:  { label: '커스텀',  color: 'mint' },
}

const colorStyles = {
  violet: { bg: 'bg-[var(--accent-subtle)]', icon: 'text-[var(--accent)]' },
  pink:   { bg: 'bg-[var(--pink-subtle)]',   icon: 'text-[var(--pink)]' },
  sky:    { bg: 'bg-[var(--sky-subtle)]',    icon: 'text-[var(--sky)]' },
  mint:   { bg: 'bg-[var(--mint-subtle)]',   icon: 'text-[var(--mint)]' },
  orange: { bg: 'bg-[var(--orange-subtle)]', icon: 'text-[var(--orange)]' },
}

function AgentCard({ agent, onDelete }: { agent: AgentDefinition; onDelete?: () => void }) {
  const role = agent.role as AgentRole
  const { label, color } = roleConfig[role] ?? { label: agent.role, color: 'mint' as const }
  const { bg, icon } = colorStyles[color]
  const description = (agent.config?.description as string) ?? ''

  return (
    <Card glow={agent.is_system} className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-9 h-9 rounded-[10px] flex items-center justify-center', bg)}>
            <Bot size={16} className={icon} />
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--text)]">{agent.name}</p>
            <Badge variant={color} className="mt-0.5">{label}</Badge>
          </div>
        </div>
        {!agent.is_system && onDelete && (
          <button
            onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[var(--text-disabled)] hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {description && (
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">{description}</p>
      )}
    </Card>
  )
}

export default function AgentsPage() {
  const toast = useToastStore((s) => s.push)
  const [systemAgents, setSystemAgents] = useState<AgentDefinition[]>([])
  const [customAgents, setCustomAgents] = useState<AgentDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newRole, setNewRole] = useState<AgentRole>('custom')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    try {
      const data = await fetchAgents()
      setSystemAgents(data.system)
      setCustomAgents(data.custom)
    } catch (e: any) {
      toast(e.message ?? '불러오기 실패', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const agent = await createAgent({ name: newName.trim(), role: newRole, description: newDesc.trim() })
      setCustomAgents((prev) => [...prev, agent])
      setNewName(''); setNewDesc(''); setNewRole('custom')
      setShowCreate(false)
      toast(`${agent.name} 생성됨`, 'success')
    } catch (e: any) {
      toast(e.message ?? '생성 실패', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteAgent(id)
      setCustomAgents((prev) => prev.filter((a) => a.id !== id))
      toast(`${name} 삭제됨`, 'success')
    } catch (e: any) {
      toast(e.message ?? '삭제 실패', 'error')
    }
  }

  return (
    <DashboardLayout>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>
        ) : (
          <div className="px-10 py-8 flex flex-col gap-10">

            {/* 시스템 Agent */}
            <section>
              <div className="flex items-center gap-2 mb-5">
                <Zap size={16} className="text-[var(--accent)]" />
                <h2 className="text-base font-bold text-[var(--text)]">기본 제공 Agent</h2>
                <Badge variant="violet" className="ml-1">시스템</Badge>
              </div>
              {systemAgents.length === 0 ? (
                <p className="text-sm text-[var(--text-disabled)]">시스템 Agent 없음 (서버에서 초기화 필요)</p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {systemAgents.map((a) => <AgentCard key={a.id} agent={a} />)}
                </div>
              )}
            </section>

            {/* 커스텀 Agent */}
            <section>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Settings2 size={16} className="text-[var(--text-muted)]" />
                  <h2 className="text-base font-bold text-[var(--text)]">커스텀 Agent</h2>
                  <span className="text-sm font-normal text-[var(--text-disabled)] ml-1">{customAgents.length}개</span>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
                  <Plus size={14} />Agent 추가
                </Button>
              </div>

              {showCreate && (
                <Card className="p-5 mb-4 border-[var(--accent)]/30">
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                      <div className="flex-1 flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-[var(--text-muted)]">Agent 이름</label>
                        <input
                          value={newName} onChange={(e) => setNewName(e.target.value)}
                          placeholder="MyAgent"
                          className="h-9 px-3 text-sm border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] bg-white"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-[var(--text-muted)]">역할</label>
                        <select
                          value={newRole} onChange={(e) => setNewRole(e.target.value as AgentRole)}
                          className="h-9 px-3 text-sm border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] bg-white cursor-pointer"
                        >
                          <option value="content">콘텐츠</option>
                          <option value="design">디자인</option>
                          <option value="layout">레이아웃</option>
                          <option value="custom">커스텀</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-[var(--text-muted)]">설명</label>
                      <input
                        value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                        placeholder="이 Agent가 하는 일을 설명하세요"
                        className="h-9 px-3 text-sm border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] bg-white"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>취소</Button>
                      <Button variant="primary" size="sm" onClick={handleCreate} disabled={creating}>
                        {creating ? '생성 중...' : '생성'}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}

              {customAgents.length === 0 && !showCreate ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)]">
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-muted)] flex items-center justify-center">
                    <Bot size={20} className="text-[var(--text-disabled)]" />
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">커스텀 Agent가 없습니다</p>
                  <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
                    <Plus size={14} />첫 Agent 만들기
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {customAgents.map((a) => (
                    <AgentCard key={a.id} agent={a} onDelete={() => handleDelete(a.id, a.name)} />
                  ))}
                </div>
              )}
            </section>

          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
