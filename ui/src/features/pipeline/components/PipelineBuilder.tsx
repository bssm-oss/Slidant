import { useState } from 'react'
import { Plus, Trash2, Play, Save } from 'lucide-react'
import type { AgentDefinition } from '@/shared/lib/agentApi'
import type { PipelineStepData } from '@/shared/lib/pipelineApi'

interface Props {
  agents: AgentDefinition[]
  onRun: (name: string, steps: PipelineStepData[], variables: Record<string, string>) => Promise<void>
  onSave: (name: string, steps: PipelineStepData[]) => Promise<void>
}

const STEP_PRESETS = [
  { label: '전체 구성', role: 'content', template: '{topic} 주제로 {slide_count}장 PPT 전체 구성을 설계하고 목차를 작성해줘' },
  { label: '디자인 적용', role: 'design', template: '현재 슬라이드에 전문적인 디자인을 적용해줘. 배경, 색상, 레이아웃을 개선해' },
  { label: '내용 채우기', role: 'content', template: '{topic}에 관한 구체적인 내용으로 빈 슬라이드들을 채워줘' },
  { label: '레이아웃 최적화', role: 'layout', template: '모든 슬라이드의 레이아웃과 컴포넌트 위치를 최적화해줘' },
]

export default function PipelineBuilder({ agents, onRun, onSave }: Props) {
  const [name, setName] = useState('새 파이프라인')
  const [steps, setSteps] = useState<PipelineStepData[]>([])
  const [variables, setVariables] = useState({ topic: '', slide_count: '10' })
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)

  const addStep = (preset?: (typeof STEP_PRESETS)[0]) => {
    const agent = agents.find((a) => a.role === (preset?.role ?? 'content')) ?? agents[0]
    if (!agent) return
    setSteps((s) => [
      ...s,
      {
        step_order: s.length,
        agent_definition_id: agent.id,
        command_template: preset?.template ?? '',
      },
    ])
  }

  const removeStep = (index: number) => {
    setSteps((s) =>
      s.filter((_, i) => i !== index).map((step, i) => ({ ...step, step_order: i })),
    )
  }

  const updateStep = (index: number, field: keyof PipelineStepData, value: string | number) => {
    setSteps((s) => s.map((step, i) => (i === index ? { ...step, [field]: value } : step)))
  }

  const handleRun = async () => {
    if (steps.length === 0 || !variables.topic) return
    setRunning(true)
    try {
      await onRun(name, steps, variables)
    } finally {
      setRunning(false)
    }
  }

  const handleSave = async () => {
    if (steps.length === 0) return
    setSaving(true)
    try {
      await onSave(name, steps)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          파이프라인 이름
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 px-3 text-[13px] border border-[var(--border)] rounded-[6px] outline-none focus:border-[var(--accent)] bg-white"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          변수
        </label>
        <div className="flex gap-2">
          <input
            placeholder="주제 (예: 돼지국밥)"
            value={variables.topic}
            onChange={(e) => setVariables((v) => ({ ...v, topic: e.target.value }))}
            className="flex-1 h-8 px-3 text-[12px] border border-[var(--border)] rounded-[6px] outline-none focus:border-[var(--accent)] bg-white"
          />
          <input
            placeholder="슬라이드 수"
            value={variables.slide_count}
            onChange={(e) => setVariables((v) => ({ ...v, slide_count: e.target.value }))}
            className="w-20 h-8 px-3 text-[12px] border border-[var(--border)] rounded-[6px] outline-none focus:border-[var(--accent)] bg-white"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          단계 ({steps.length})
        </label>
        {steps.length === 0 && (
          <p className="text-[12px] text-[var(--text-disabled)] py-2">아래에서 단계를 추가하세요</p>
        )}
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex gap-2 items-start p-3 rounded-[8px] border border-[var(--border)] bg-white"
          >
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-[10px] font-bold shrink-0">
                  {i + 1}
                </span>
                <select
                  value={step.agent_definition_id}
                  onChange={(e) => updateStep(i, 'agent_definition_id', e.target.value)}
                  className="text-[12px] border border-[var(--border)] rounded-[4px] px-1.5 py-1 outline-none bg-white"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={step.command_template}
                onChange={(e) => updateStep(i, 'command_template', e.target.value)}
                placeholder="명령 입력... {topic}, {slide_count} 변수 사용 가능"
                rows={2}
                className="w-full text-[12px] border border-[var(--border)] rounded-[6px] px-2 py-1.5 outline-none focus:border-[var(--accent)] resize-none bg-white"
              />
            </div>
            <button
              onClick={() => removeStep(i)}
              className="text-[var(--text-disabled)] hover:text-red-500 transition-colors shrink-0 mt-1"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STEP_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addStep(preset)}
            className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            + {preset.label}
          </button>
        ))}
        <button
          onClick={() => addStep()}
          className="text-[11px] px-2.5 py-1 rounded-full border border-dashed border-[var(--border)] text-[var(--text-disabled)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          <Plus size={10} className="inline" /> 빈 단계
        </button>
      </div>

      <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
        <button
          onClick={handleSave}
          disabled={saving || steps.length === 0}
          className="flex-1 h-9 flex items-center justify-center gap-1.5 text-[13px] font-medium border border-[var(--border)] rounded-[8px] hover:bg-[var(--bg-muted)] disabled:opacity-40 transition-colors"
        >
          <Save size={13} />
          {saving ? '저장 중...' : '저장'}
        </button>
        <button
          onClick={handleRun}
          disabled={running || steps.length === 0 || !variables.topic}
          className="flex-1 h-9 flex items-center justify-center gap-1.5 text-[13px] font-medium bg-[var(--accent)] text-white rounded-[8px] hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Play size={13} />
          {running ? '실행 중...' : '실행'}
        </button>
      </div>
    </div>
  )
}
