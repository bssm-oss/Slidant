import { useState, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { X, Plus, Pencil, Trash2, Copy, ChevronDown, ChevronUp } from 'lucide-react'
import type { AgentDefinition } from '@/shared/lib/agentApi'
import {
  fetchAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  cloneAgentToProject,
} from '@/shared/lib/agentApi'

const ROLE_OPTIONS = [
  { value: 'content', label: '콘텐츠' },
  { value: 'design', label: '디자인' },
  { value: 'layout', label: '레이아웃' },
  { value: 'custom', label: '커스텀' },
]

const ROLE_COLOR: Record<string, string> = {
  content: 'bg-blue-100 text-blue-700',
  design: 'bg-purple-100 text-purple-700',
  layout: 'bg-green-100 text-green-700',
  custom: 'bg-orange-100 text-orange-700',
}

interface AgentFormState {
  name: string
  role: string
  description: string
  scope: 'project' | 'library'
}

const EMPTY_FORM: AgentFormState = { name: '', role: 'custom', description: '', scope: 'project' }

interface Props {
  onClose: () => void
}

export default function AgentManagerPanel({ onClose }: Props) {
  const { presentation, loadAgents } = useEditorStore()
  const projectId = presentation?.id

  const [systemAgents, setSystemAgents] = useState<AgentDefinition[]>([])
  const [libraryAgents, setLibraryAgents] = useState<AgentDefinition[]>([])
  const [projectAgents, setProjectAgents] = useState<AgentDefinition[]>([])

  const [form, setForm] = useState<AgentFormState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedSection, setExpandedSection] = useState<'project' | 'library' | null>('project')

  const load = async () => {
    if (!projectId) return
    const data = await fetchAgents(projectId)
    setSystemAgents(data.system)
    setLibraryAgents(data.library)
    setProjectAgents(data.project)
  }

  useEffect(() => { load() }, [projectId])

  const openCreate = (scope: 'project' | 'library') => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, scope })
  }

  const openEdit = (agent: AgentDefinition) => {
    setEditingId(agent.id)
    setForm({
      name: agent.name,
      role: agent.role,
      description: (agent.config.description as string) ?? (agent.config.system_prompt as string) ?? '',
      scope: agent.project_id ? 'project' : 'library',
    })
  }

  const handleSave = async () => {
    if (!form || !projectId) return
    setLoading(true)
    try {
      if (editingId) {
        await updateAgent(editingId, { name: form.name, description: form.description })
      } else {
        await createAgent({
          name: form.name,
          role: form.role,
          description: form.description,
          project_id: form.scope === 'project' ? projectId : null,
        })
      }
      setForm(null)
      setEditingId(null)
      await load()
      await loadAgents(projectId)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!projectId) return
    setLoading(true)
    try {
      await deleteAgent(id)
      await load()
      await loadAgents(projectId)
    } finally {
      setLoading(false)
    }
  }

  const handleClone = async (id: string) => {
    if (!projectId) return
    setLoading(true)
    try {
      await cloneAgentToProject(id, projectId)
      await load()
      await loadAgents(projectId)
    } finally {
      setLoading(false)
    }
  }

  const roleBadge = (role: string) => (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', ROLE_COLOR[role] ?? ROLE_COLOR.custom)}>
      {ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role}
    </span>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-[var(--bg-base)] rounded-[12px] border border-[var(--border)] shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <span className="text-[14px] font-semibold text-[var(--text)]">에이전트 관리</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-muted)] transition-colors">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Form */}
          {form && (
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-muted)]">
              <p className="text-[12px] font-semibold text-[var(--text)] mb-3">
                {editingId ? '에이전트 수정' : '새 에이전트'}
              </p>
              <div className="flex flex-col gap-2.5">
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] mb-1 block">이름</label>
                  <input
                    className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    value={form.name}
                    onChange={(e) => setForm((f) => f && ({ ...f, name: e.target.value }))}
                    placeholder="에이전트 이름"
                    autoFocus
                  />
                </div>
                {!editingId && (
                  <div>
                    <label className="text-[11px] text-[var(--text-muted)] mb-1 block">역할</label>
                    <select
                      className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      value={form.role}
                      onChange={(e) => setForm((f) => f && ({ ...f, role: e.target.value }))}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] mb-1 block">역할 프롬프트 (System Prompt)</label>
                  <textarea
                    className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] resize-none"
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm((f) => f && ({ ...f, description: e.target.value }))}
                    placeholder="이 에이전트의 역할과 행동 방식을 설명하세요"
                  />
                </div>
                {!editingId && (
                  <div>
                    <label className="text-[11px] text-[var(--text-muted)] mb-1 block">저장 위치</label>
                    <div className="flex gap-2">
                      {(['project', 'library'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setForm((f) => f && ({ ...f, scope: s }))}
                          className={cn(
                            'flex-1 py-1.5 rounded-[6px] text-[11px] font-medium border transition-colors',
                            form.scope === s
                              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                              : 'bg-[var(--bg-base)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)]',
                          )}
                        >
                          {s === 'project' ? '이 PPT 전용' : '내 라이브러리'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => { setForm(null); setEditingId(null) }}
                  className="px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.name.trim() || loading}
                  className="px-3 py-1.5 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[6px] disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          )}

          {/* System agents */}
          <Section title="기본 에이전트" subtitle="수정 불가">
            {systemAgents.map((a) => (
              <AgentRow key={a.id} agent={a} badge={roleBadge(a.role)} />
            ))}
            {systemAgents.length === 0 && <Empty />}
          </Section>

          {/* Project agents */}
          <Section
            title="이 PPT 전용"
            expanded={expandedSection === 'project'}
            onToggle={() => setExpandedSection((s) => s === 'project' ? null : 'project')}
            action={
              <button
                onClick={(e) => { e.stopPropagation(); openCreate('project') }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-subtle)] rounded transition-colors"
              >
                <Plus size={11} /> 새로 만들기
              </button>
            }
          >
            {projectAgents.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                badge={roleBadge(a.role)}
                onEdit={() => openEdit(a)}
                onDelete={() => handleDelete(a.id)}
              />
            ))}
            {projectAgents.length === 0 && <Empty text="이 PPT 전용 에이전트 없음" />}
          </Section>

          {/* Library agents */}
          <Section
            title="내 라이브러리"
            expanded={expandedSection === 'library'}
            onToggle={() => setExpandedSection((s) => s === 'library' ? null : 'library')}
            action={
              <button
                onClick={(e) => { e.stopPropagation(); openCreate('library') }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-subtle)] rounded transition-colors"
              >
                <Plus size={11} /> 새로 만들기
              </button>
            }
          >
            {libraryAgents.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                badge={roleBadge(a.role)}
                onEdit={() => openEdit(a)}
                onDelete={() => handleDelete(a.id)}
                extraAction={
                  projectId ? (
                    <button
                      onClick={() => handleClone(a.id)}
                      className="p-1.5 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                      title="이 PPT에 복사"
                    >
                      <Copy size={12} />
                    </button>
                  ) : null
                }
              />
            ))}
            {libraryAgents.length === 0 && <Empty text="라이브러리 에이전트 없음" />}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({
  title, subtitle, children, expanded, onToggle, action,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  expanded?: boolean
  onToggle?: () => void
  action?: React.ReactNode
}) {
  const collapsible = onToggle !== undefined
  const isExpanded = collapsible ? expanded : true

  return (
    <div className="border-b border-[var(--border)] last:border-0">
      <div
        className={cn('flex items-center justify-between px-5 py-3', collapsible && 'cursor-pointer hover:bg-[var(--bg-muted)]')}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{title}</span>
          {subtitle && <span className="text-[10px] text-[var(--text-disabled)]">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {collapsible && (
            isExpanded
              ? <ChevronUp size={13} className="text-[var(--text-disabled)]" />
              : <ChevronDown size={13} className="text-[var(--text-disabled)]" />
          )}
        </div>
      </div>
      {isExpanded && <div className="px-5 pb-3 flex flex-col gap-1.5">{children}</div>}
    </div>
  )
}

function AgentRow({
  agent, badge, onEdit, onDelete, extraAction,
}: {
  agent: AgentDefinition
  badge: React.ReactNode
  onEdit?: () => void
  onDelete?: () => void
  extraAction?: React.ReactNode
}) {
  const description = (agent.config.description as string) ?? (agent.config.system_prompt as string) ?? ''
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-[8px] bg-[var(--bg-muted)] group">
      <div className="flex-1 min-w-0 mr-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-[var(--text)] truncate">{agent.name}</span>
          {badge}
        </div>
        {description && (
          <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {extraAction}
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-[var(--bg-base)] text-[var(--text-disabled)] hover:text-[var(--text-muted)] transition-colors"
            title="수정"
          >
            <Pencil size={12} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-[var(--bg-base)] text-[var(--text-disabled)] hover:text-red-500 transition-colors"
            title="삭제"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

function Empty({ text = '에이전트 없음' }: { text?: string }) {
  return (
    <p className="text-[11px] text-[var(--text-disabled)] py-2 text-center">{text}</p>
  )
}
