import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useSlideStore } from '../store/slideStore'
import { useProposalStore } from '../store/proposalStore'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/lib/apiClient'
import type { SlideComponent } from '@/shared/types'
import ConflictResolver from './ConflictResolver'

const SLIDE_W = 960
const SLIDE_H = 540

// ── 컴포넌트 렌더러 ──────────────────────────────────────────────────────────

function ImageComponent({ props }: { props: Record<string, unknown> }) {
  const [broken, setBroken] = useState(false)
  const src = (props.src ?? props.url) as string | undefined
  const isPlaceholder = !!props.placeholder || !src || broken
  const bg = (props.bgColor as string) ?? 'rgba(124,58,237,0.08)'
  const radius = (props.borderRadius as number) ?? 0

  if (isPlaceholder) {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: bg,
        borderRadius: radius,
        border: '2px dashed rgba(124,58,237,0.3)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 6, userSelect: 'none', cursor: 'pointer',
      }}>
        <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='rgba(124,58,237,0.5)' strokeWidth='1.5'>
          <rect x='3' y='3' width='18' height='18' rx='2'/>
          <circle cx='8.5' cy='8.5' r='1.5'/>
          <path d='M21 15l-5-5L5 21'/>
        </svg>
        <span style={{ fontSize: 11, color: 'rgba(124,58,237,0.6)', textAlign: 'center', padding: '0 8px' }}>
          {(props.alt as string) || '이미지'}
        </span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={(props.alt as string) ?? ''}
      onError={() => setBroken(true)}
      style={{
        width: '100%', height: '100%',
        objectFit: (props.objectFit as any) ?? 'cover',
        borderRadius: radius,
        opacity: (props.opacity as number) ?? 1,
        display: 'block',
      }}
      draggable={false}
    />
  )
}

function ComponentContent({ comp }: { comp: SlideComponent }) {
  const props = comp.props as Record<string, unknown>
  if (comp.type === 'text') {
    return (
      <p style={{
        fontSize: (props.fontSize as number) ?? 16,
        fontWeight: (props.fontWeight as number) ?? 400,
        color: (props.color as string) ?? '#1A1523',
        textAlign: (props.align as any) ?? 'left',
        lineHeight: (props.lineHeight as number) ?? 1.4,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        userSelect: 'none', width: '100%', height: '100%',
        margin: 0, padding: 0,
      }}>
        {(props.content as string) ?? ''}
      </p>
    )
  }
  if (comp.type === 'shape') {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: (props.bgColor as string) ?? (props.color as string) ?? '#e5e7eb',
        borderRadius: (props.borderRadius as number) ?? 0,
        border: props.borderColor ? `${props.borderWidth ?? 1}px solid ${props.borderColor}` : undefined,
        opacity: (props.opacity as number) ?? 1,
      }} />
    )
  }
  if (comp.type === 'image') return <ImageComponent props={props} />
  if (comp.type === 'chart') return (
    <div style={{ width: '100%', height: '100%', background: 'rgba(0,0,0,0.05)',
      border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 12, color: '#94a3b8' }}>📊 차트</div>
  )
  return null
}

// ── 리사이즈 핸들 ────────────────────────────────────────────────────────────

const HANDLES = [
  { id: 'nw', cursor: 'nw-resize', style: { top: -4, left: -4 } },
  { id: 'n',  cursor: 'n-resize',  style: { top: -4, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'ne', cursor: 'ne-resize', style: { top: -4, right: -4 } },
  { id: 'e',  cursor: 'e-resize',  style: { top: '50%', right: -4, transform: 'translateY(-50%)' } },
  { id: 'se', cursor: 'se-resize', style: { bottom: -4, right: -4 } },
  { id: 's',  cursor: 's-resize',  style: { bottom: -4, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'sw', cursor: 'sw-resize', style: { bottom: -4, left: -4 } },
  { id: 'w',  cursor: 'w-resize',  style: { top: '50%', left: -4, transform: 'translateY(-50%)' } },
] as const

// ── 드래그 상태 타입 ─────────────────────────────────────────────────────────

type DragMode = 'move' | `resize-${'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'}`

type DragState = {
  compId: string
  mode: DragMode
  startMX: number   // 마우스 시작 (화면 좌표)
  startMY: number
  startX: number    // 컴포넌트 시작 (슬라이드 좌표)
  startY: number
  startW: number
  startH: number
}

// ── 메인 캔버스 ──────────────────────────────────────────────────────────────

export default function SlideCanvas() {
  const { presentation, currentSlideIndex, selectedComponentId, selectComponent, loadPresentation } = useEditorStore()
  const currentSlide = presentation?.slides[currentSlideIndex]
  const { conflicts } = useProposalStore()
  const conflictedIds = new Set(conflicts.map((c) => c.componentId))
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.75)
  const drag = useRef<DragState | null>(null)
  const [liveGeom, setLiveGeom] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({})
  const [conflictTarget, setConflictTarget] = useState<string | null>(null)

  // 동적 스케일
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const s = Math.min((width - 64) / SLIDE_W, (height - 64) / SLIDE_H)
      setScale(Math.max(0.3, Math.min(s, 1.2)))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // 전역 mousemove / mouseup
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return
      const { compId, mode, startMX, startMY, startX, startY, startW, startH } = drag.current
      const dx = (e.clientX - startMX) / scale
      const dy = (e.clientY - startMY) / scale

      let x = startX, y = startY, w = startW, h = startH
      const MIN = 20

      if (mode === 'move') {
        x = Math.max(0, Math.min(SLIDE_W - w, startX + dx))
        y = Math.max(0, Math.min(SLIDE_H - h, startY + dy))
      } else {
        const dir = mode.replace('resize-', '')
        if (dir.includes('e')) w = Math.max(MIN, startW + dx)
        if (dir.includes('s')) h = Math.max(MIN, startH + dy)
        if (dir.includes('w')) { w = Math.max(MIN, startW - dx); x = startX + startW - w }
        if (dir.includes('n')) { h = Math.max(MIN, startH - dy); y = startY + startH - h }
      }

      setLiveGeom((prev) => ({ ...prev, [compId]: { x, y, w, h } }))
    }

    const onUp = async (_e: MouseEvent) => {
      if (!drag.current) return
      const { compId } = drag.current
      drag.current = null

      const geom = liveGeomRef.current[compId]
      if (!geom) return

      setLiveGeom((prev) => { const next = { ...prev }; delete next[compId]; return next })

      // API에 저장
      const ppt = useSlideStore.getState().presentation
      const slide = ppt?.slides[useSlideStore.getState().currentSlideIndex]
      const comp = slide?.components.find((c) => c.id === compId)
      if (!ppt || !slide || !comp) return

      const newProps = {
        ...comp.props,
        position: { x: Math.round(geom.x), y: Math.round(geom.y) },
        size: { w: Math.round(geom.w), h: Math.round(geom.h) },
      }
      try {
        await api.patch(`/projects/${ppt.id}/slides/${slide.id}/components/${compId}`, {
          properties: newProps,
        })
        await loadPresentation(ppt.id)
      } catch (err) {
        console.error('update component failed', err)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [scale, loadPresentation])

  // liveGeom ref (onUp 클로저에서 최신값 접근)
  const liveGeomRef = useRef(liveGeom)
  useEffect(() => { liveGeomRef.current = liveGeom }, [liveGeom])

  const startDrag = (e: React.MouseEvent, comp: SlideComponent, mode: DragMode) => {
    e.stopPropagation()
    e.preventDefault()
    selectComponent(comp.id)
    drag.current = {
      compId: comp.id,
      mode,
      startMX: e.clientX,
      startMY: e.clientY,
      startX: comp.position.x,
      startY: comp.position.y,
      startW: comp.size.w,
      startH: comp.size.h,
    }
  }

  const getGeom = (comp: SlideComponent) => liveGeom[comp.id] ?? {
    x: comp.position.x, y: comp.position.y, w: comp.size.w, h: comp.size.h,
  }

  // HTML 모드 렌더링 (html_content 있으면 iframe 사용)
  if (currentSlide?.html_content) {
    const iframeSrc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:960px;height:540px;overflow:hidden;}</style></head><body>${currentSlide.html_content}</body></html>`
    return (
      <div ref={containerRef}
        className="flex-1 flex items-center justify-center bg-[var(--bg-muted)] overflow-hidden">
        <div
          className="relative rounded-[8px] shadow-[0_8px_40px_rgba(0,0,0,0.18)] overflow-hidden shrink-0"
          style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
          <iframe
            srcDoc={iframeSrc}
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'block',
            }}
            sandbox="allow-same-origin"
            title="slide"
          />
        </div>
      </div>
    )
  }

  return (
    <>
    <div ref={containerRef}
      className="flex-1 flex items-center justify-center bg-[var(--bg-muted)] overflow-hidden"
      onClick={() => selectComponent(null)}>
      <div
        className="relative bg-white rounded-[8px] shadow-[0_8px_40px_rgba(0,0,0,0.18)] overflow-hidden shrink-0"
        style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left',
                      width: SLIDE_W, height: SLIDE_H, position: 'absolute', top: 0, left: 0 }}>

          {currentSlide?.components.map((comp) => {
            const isSelected = selectedComponentId === comp.id
            const isConflicted = conflictedIds.has(comp.id)
            const { x, y, w, h } = getGeom(comp)
            const isDragging = !!liveGeom[comp.id]

            return (
              <div key={comp.id}
                style={{ position: 'absolute', left: x, top: y, width: w, height: h, zIndex: comp.zIndex,
                         cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={(e) => { if (!isConflicted) startDrag(e, comp, 'move') }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isConflicted) {
                    setConflictTarget(comp.id)
                  } else {
                    selectComponent(comp.id)
                  }
                }}>

                {/* 컴포넌트 내용 */}
                <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}
                     className={cn(
                       isSelected && !isConflicted && 'outline outline-2 outline-[var(--accent)] outline-offset-1 rounded-[2px]',
                       isConflicted && 'outline outline-2 outline-red-500 outline-offset-1 rounded-[2px]',
                     )}>
                  <ComponentContent comp={{ ...comp, position: { x, y }, size: { w, h } }} />
                </div>

                {/* 충돌 뱃지 */}
                {isConflicted && (
                  <div style={{ position: 'absolute', top: -8, right: -8, zIndex: 10000 }}
                       className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md animate-pulse">
                    <span className="text-white text-[9px] font-bold">!</span>
                  </div>
                )}

                {/* 리사이즈 핸들 (선택된 경우만, 충돌 아닌 경우만) */}
                {isSelected && !isConflicted && HANDLES.map((handle) => (
                  <div key={handle.id}
                    style={{ position: 'absolute', width: 8, height: 8, background: 'white',
                             border: '2px solid var(--accent)', borderRadius: 2,
                             cursor: handle.cursor, zIndex: 9999, ...handle.style }}
                    onMouseDown={(e) => startDrag(e, comp, `resize-${handle.id}` as DragMode)} />
                ))}
              </div>
            )
          })}

          {(!currentSlide || currentSlide.components.length === 0) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <p className="text-gray-200 text-xl font-light">빈 슬라이드</p>
              <p className="text-gray-300 text-sm">오른쪽 Agent에게 요청하세요</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* 충돌 해결 모달 */}
    {conflictTarget && (
      <ConflictResolver
        componentId={conflictTarget}
        onClose={() => setConflictTarget(null)}
      />
    )}
    </>
  )
}
