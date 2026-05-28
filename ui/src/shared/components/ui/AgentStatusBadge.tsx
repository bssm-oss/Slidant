import Badge from './Badge'
import type { AgentStatus } from '@/shared/types'

const statusConfig: Record<AgentStatus, { label: string; variant: 'default' | 'sky' | 'mint' | 'error' | 'orange' }> = {
  idle:     { label: '대기',    variant: 'default' },
  running:  { label: '작업 중', variant: 'sky' },
  done:     { label: '완료',    variant: 'mint' },
  error:    { label: '오류',    variant: 'error' },
  conflict: { label: '충돌',    variant: 'orange' },
}

export default function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const { label, variant } = statusConfig[status]
  return (
    <Badge variant={variant}>
      {status === 'running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse mr-1" />}
      {label}
    </Badge>
  )
}
