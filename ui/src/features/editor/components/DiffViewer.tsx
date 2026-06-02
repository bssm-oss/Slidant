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

// Mini slide preview renderer
function MiniSlidePreview({ components }: { components: Record<string, unknown>[] }) {
  const SLIDE_W = 960
  const SCALE = 0.22

  return (
    <div style={{
      width: SLIDE_W * SCALE,
      height: 540 * SCALE,
      position: 'relative',
      overflow: 'hidden',
      background: '#f8fafc',
      borderRadius: 4,
      border: '1px solid #e2e8f0',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: SLIDE_W, height: 540,
        transform: `scale(${SCALE})`, transformOrigin: 'top left',
        pointerEvents: 'none',
      }}>
        {(components as Record<string, unknown>[])
          .slice()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((comp: any, i: number) => {
            const props = comp.properties ?? {}
            const pos = props.position ?? { x: 0, y: 0 }
            const size = props.size ?? { w: 400, h: 60 }
            return (
              <div key={comp.id ?? i} style={{
                position: 'absolute',
                left: pos.x, top: pos.y, width: size.w, height: size.h,
                overflow: 'hidden', zIndex: comp.order ?? i,
              }}>
                {comp.type === 'shape' && (
                  <div style={{ width: '100%', height: '100%', background: props.bgColor ?? '#e5e7eb', opacity: props.opacity ?? 1, borderRadius: props.borderRadius ?? 0 }} />
                )}
                {comp.type === 'text' && (
                  <p style={{
                    fontSize: props.fontSize ?? 16, fontWeight: props.fontWeight ?? 400,
                    color: props.color ?? '#1A1523', margin: 0, padding: 0,
                    whiteSpace: 'pre-wrap', width: '100%', height: '100%', overflow: 'hidden',
                  }}>{props.content ?? ''}</p>
                )}
                {comp.type === 'image' && !props.placeholder && props.src && (
                  <img src={props.src as string} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                )}
                {comp.type === 'image' && (props.placeholder || !props.src) && (
                  <div style={{ width: '100%', height: '100%', background: 'rgba(124,58,237,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 24, opacity: 0.3 }}>🖼</span>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

// Apply patches to produce a preview of the result
function applyPatchPreview(
  current: Record<string, unknown>[],
  patches: JsonPatchOp[]
): Record<string, unknown>[] {
  const comps = current.map((c) => ({ ...c, properties: { ...(c.properties as object) } }))
  const compMap: Record<string, Record<string, unknown>> = {}
  comps.forEach((c) => { compMap[c.id as string] = c })
  let orderCounter = Math.max(...comps.map((c) => (c.order as number) ?? 0), -1) + 1

  for (const op of patches) {
    const parts = op.path.replace(/^\//, '').split('/')
    if (op.op === 'add' && (parts[0] === '-' || parts[0] === '')) {
      const val = op.value as Record<string, unknown>
      const id = `preview-${Math.random().toString(36).slice(2)}`
      compMap[id] = { id, type: val.type ?? 'text', order: orderCounter++, properties: val.properties ?? {} }
    } else if (op.op === 'replace' && parts.length >= 3 && parts[1] === 'properties') {
      const comp = compMap[parts[0]]
      if (comp) {
        const props = { ...(comp.properties as Record<string, unknown>), [parts[2]]: op.value }
        compMap[parts[0]] = { ...comp, properties: props }
      }
    } else if (op.op === 'remove' && parts.length === 1) {
      delete compMap[parts[0]]
    }
  }
  return Object.values(compMap)
}

export default function DiffViewer({ currentContent, patches }: DiffViewerProps) {
  const items = parseDiff(currentContent, patches)
  const afterContent = applyPatchPreview(currentContent, patches)

  if (items.length === 0) {
    return <p className='text-[12px] text-[var(--text-disabled)] text-center py-4'>변경사항 없음</p>
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* Before/After mini slide render */}
      <div className='flex gap-3 items-start'>
        <div className='flex flex-col gap-1'>
          <p className='text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide'>현재</p>
          <MiniSlidePreview components={currentContent} />
        </div>
        <div className='flex items-center self-center text-[var(--text-disabled)]'>→</div>
        <div className='flex flex-col gap-1'>
          <p className='text-[10px] font-semibold text-[var(--accent)] uppercase tracking-wide'>적용 후</p>
          <MiniSlidePreview components={afterContent} />
        </div>
      </div>

      {/* Text change list */}
      <div className='flex flex-col gap-1.5'>
        {items.map((item, i) => (
          <div key={i} className={cn(
            'px-3 py-2 rounded-[8px] text-[12px]',
            item.type === 'add' && 'bg-green-50 border border-green-200',
            item.type === 'remove' && 'bg-red-50 border border-red-200',
            item.type === 'replace' && 'bg-amber-50 border border-amber-200',
          )}>
            {item.type === 'add' && (
              <p className='text-green-700'>
                <span className='font-bold'>+ 추가</span> {item.compType}
                {item.newComp && (() => {
                  const props = (item.newComp as Record<string, unknown>).properties as Record<string, unknown> | undefined ?? {}
                  return props.content ? ` — "${String(props.content).slice(0, 30)}"` : ''
                })()}
              </p>
            )}
            {item.type === 'remove' && (
              <p className='text-red-700'><span className='font-bold'>− 삭제</span> {item.compType}</p>
            )}
            {item.type === 'replace' && (
              <p className='text-amber-700'>
                <span className='font-bold'>~ 변경</span> {item.field}:
                <span className='line-through ml-1 opacity-60'>{formatValue(item.oldValue)}</span>
                <span className='ml-1'>→ {formatValue(item.newValue)}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
