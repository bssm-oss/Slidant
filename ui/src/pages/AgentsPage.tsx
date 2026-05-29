import { useState } from 'react'
import DashboardLayout from '@/shared/components/layout/DashboardLayout'
import { Badge, Button, Card } from '@/shared/components/ui'
import { cn } from '@/shared/lib/utils'
import { Bot, Plus, Settings2, Trash2, Zap } from 'lucide-react'

type AgentRole = 'content' | 'design' | 'layout' | 'custom'

interface AgentDef {
  id: string
  name: string
  role: AgentRole
  description: string
  isSystem: boolean
}

const roleConfig: Record<AgentRole, { label: string; color: 'violet' | 'sky' | 'mint' | 'pink' }> = {
  content: { label: '콘텐츠', color: 'violet' },
  design:  { label: '디자인',  color: 'pink' },
  layout:  { label: '레이아웃', color: 'sky' },
  custom:  { label: '커스텀',  color: 'mint' },
}

const systemAgents: AgentDef[] = [
  { id: 'sys-1', name: 'ContentAgent',  role: 'content', description: '텍스트 콘텐츠 생성 및 편집. 슬라이드 주제에 맞는 내용을 작성합니다.', isSystem: true },
  { id: 'sys-2', name: 'DesignAgent',   role: 'design',  description: '시각 디자인 및 스타일 적용. 색상, 타이포그래피, 강조 요소를 담당합니다.', isSystem: true },
  { id: 'sys-3', name: 'LayoutAgent',   role: 'layout',  description: '컴포넌트 배치 및 레이아웃 구성. 슬라이드 구조를 최적화합니다.', isSystem: true },
]

export default function AgentsPage() {
  const [userAgents, setUserAgents] = useState<AgentDef[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newRole, setNewRole] = useState<AgentRole>('custom')

  const handleCreate = () => {
    if (!newName.trim()) return
    const agent: AgentDef = {
      id: `user-${Date.now()}`,
      name: newName.trim(),
      role: newRole,
      description: newDesc.trim(),
      isSystem: false,
    }
    setUserAgents((prev) => [...prev, agent])
    setNewName('')
    setNewDesc('')
    setNewRole('custom')
    setShowCreate(false)
  }

  const handleDelete = (id: string) => {
    setUserAgents((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <DashboardLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="px-10 py-8 flex flex-col gap-10">

          {/* 시스템 Agent */}
          <section>
            <div className="flex items-center gap-2 mb-5">
              <Zap size={16} className="text-[var(--accent)]" />
              <h2 className="text-base font-bold text-[var(--text)]">기본 제공 Agent</h2>
              <Badge variant="violet" className="ml-1">시스템</Badge>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {systemAgents.map((agent) => {
                const { label, color } = roleConfig[agent.role]
                return (
                  <Card key={agent.id} glow className="p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          'w-9 h-9 rounded-[10px] flex items-center justify-center',
                          color === 'violet' && 'bg-[var(--accent-subtle)]',
                          color === 'pink'   && 'bg-[var(--pink-subtle)]',
                          color === 'sky'    && 'bg-[var(--sky-subtle)]',
                          color === 'mint'   && 'bg-[var(--mint-subtle)]',
                        )}>
                          <Bot size={16} className={cn(
                            color === 'violet' && 'text-[var(--accent)]',
                            color === 'pink'   && 'text-[var(--pink)]',
                            color === 'sky'    && 'text-[var(--sky)]',
                            color === 'mint'   && 'text-[var(--mint)]',
                          )} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[var(--text)]">{agent.name}</p>
                          <Badge variant={color} className="mt-0.5">{label}</Badge>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] leading-relaxed">{agent.description}</p>
                  </Card>
                )
              })}
            </div>
          </section>

          {/* 커스텀 Agent */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-[var(--text-muted)]" />
                <h2 className="text-base font-bold text-[var(--text)]">커스텀 Agent</h2>
                <span className="text-sm font-normal text-[var(--text-disabled)] ml-1">{userAgents.length}개</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={14} />
                Agent 추가
              </Button>
            </div>

            {/* 생성 폼 */}
            {showCreate && (
              <Card className="p-5 mb-4 border-[var(--accent)]/30">
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-[var(--text-muted)]">Agent 이름</label>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="MyAgent"
                        className="h-9 px-3 text-sm border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] bg-white"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-[var(--text-muted)]">역할</label>
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value as AgentRole)}
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
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="이 Agent가 하는 일을 설명하세요"
                      className="h-9 px-3 text-sm border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] bg-white"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>취소</Button>
                    <Button variant="primary" size="sm" onClick={handleCreate}>생성</Button>
                  </div>
                </div>
              </Card>
            )}

            {userAgents.length === 0 && !showCreate ? (
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
                {userAgents.map((agent) => {
                  const { label, color } = roleConfig[agent.role]
                  return (
                    <Card key={agent.id} className="p-5 flex flex-col gap-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-[10px] bg-[var(--mint-subtle)] flex items-center justify-center">
                            <Bot size={16} className="text-[var(--mint)]" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-[var(--text)]">{agent.name}</p>
                            <Badge variant={color} className="mt-0.5">{label}</Badge>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(agent.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[var(--text-disabled)] hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {agent.description && (
                        <p className="text-sm text-[var(--text-muted)] leading-relaxed">{agent.description}</p>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </section>

        </div>
      </div>
    </DashboardLayout>
  )
}
