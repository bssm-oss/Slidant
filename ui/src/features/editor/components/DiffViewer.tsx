import { cn } from '@/shared/lib/utils'
import type { JsonPatchOp } from '@/shared/types'

interface DiffViewerProps {
  currentContent: Record<string, unknown>[]
  patches: JsonPatchOp[]
}

interface DiffItem {
  type: 'add' | 'remove' | 'replace'
  compId?: string
  compType?: string
  field?: string
  oldValue?: unknown
  newValue?: unknown
  newComp?: Record<string, unknown>
}

function parseDiff(currentContent: Record<string, unknown>[], patches: JsonPatchOp[]): DiffItem[] {
  const compMap = Object.fromEntries(currentContent.map((c) => [c.id as string, c]))
  return patches.map((op): DiffItem | null => {
    const pathParts = op.path.replace(/^\//, '').split('/')
    if (op.op === 'add' && (pathParts[0] === '-' || pathParts[0] === '')) {
      const val = op.value as Record<string, unknown>
      return { type: 'add', compType: val?.type as string, newComp: val }
    }
    if (op.op === 'remove' && pathParts.length === 1) {
      const comp = compMap[pathParts[0]]
      return { type: 'remove', compId: pathParts[0], compType: comp?.type as string }
    }
    if (op.op === 'replace' && pathParts.length >= 3 && pathParts[1] === 'properties') {
      const comp = compMap[pathParts[0]]
      const field = pathParts[2]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldVal = (comp?.properties as any)?.[field]
      return { type: 'replace', compId: pathParts[0], compType: comp?.type as string, field, oldValue: oldVal, newValue: op.value }
    }
    return null
  }).filter(Boolean) as DiffItem[]
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '없음'
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 40) + '...' : v
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60)
  return String(v)
}

export default function DiffViewer({ currentContent, patches }: DiffViewerProps) {
  const items = parseDiff(currentContent, patches)
  if (items.length === 0) {
    return <p className='text-[12px] text-[var(--text-disabled)] text-center py-4'>변경사항 없음</p>
  }
  return (
    <div className='flex flex-col gap-1.5'>
      {items.map((item, i) => (
        <div key={i} className={cn(
          'px-3 py-2 rounded-[8px] text-[12px]',
          item.type === 'add' && 'bg-green-50 border border-green-200',
          item.type === 'remove' && 'bg-red-50 border border-red-200',
          item.type === 'replace' && 'bg-[var(--bg-muted)] border border-[var(--border)]',
        )}>
          <div className='flex items-center gap-2 mb-0.5'>
            <span className={cn(
              'text-[10px] font-bold px-1.5 py-0.5 rounded',
              item.type === 'add' && 'bg-green-100 text-green-700',
              item.type === 'remove' && 'bg-red-100 text-red-700',
              item.type === 'replace' && 'bg-[var(--accent-subtle)] text-[var(--accent-text)]',
            )}>
              {item.type === 'add' ? '+ 추가' : item.type === 'remove' ? '− 삭제' : '수정'}
            </span>
            <span className='text-[var(--text-muted)] font-medium'>{item.compType ?? '컴포넌트'}</span>
            {item.compId && <span className='text-[var(--text-disabled)] text-[10px]'>#{item.compId.slice(0, 6)}</span>}
          </div>
          {item.type === 'replace' && item.field && (
            <p className='text-[var(--text)] ml-1'>
              <span className='text-[var(--text-muted)]'>{item.field}: </span>
              <span className='line-through text-red-500'>{formatValue(item.oldValue)}</span>
              <span className='mx-1 text-[var(--text-disabled)]'>→</span>
              <span className='text-green-600'>{formatValue(item.newValue)}</span>
            </p>
          )}
          {item.type === 'add' && item.newComp?.properties && (
            <p className='text-[var(--text-muted)] ml-1 text-[11px]'>
              {Object.entries(item.newComp.properties as object).slice(0, 2).map(([k, v]) =>
                `${k}: ${formatValue(v)}`
              ).join(' · ')}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
