import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useSlideStore } from '../store/slideStore'
import { useProposalStore } from '../store/proposalStore'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/lib/apiClient'
import type { SlideComponent } from '@/shared/types'
import ConflictResolver from './ConflictResolver'
import { buildSlideSrc } from '@/shared/lib/slideHtml'

// ── HTML 슬라이드 편집 훅 ───────────────────────────────────────────────────────

/**
 * iframe 내부 DOM에 인라인 텍스트 편집 + 이미지 업로드 이벤트를 주입하고,
 * 변경사항을 html_content string에 반영 → API 저장한다.
 */
function useHtmlSlideEdit(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  projectId: string,
  slideId: string,
  htmlContent: string,
  onHtmlChange: (newHtml: string) => void,
  onComponentSelect: (id: string | null, style: HtmlComponentStyle | null) => void,
  ignoreHtmlSyncRef: React.RefObject<boolean>,
) {
  // hidden file input (이미지 업로드용)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // html-component-style-update: Inspector → iframe DOM → debounced API save
  useEffect(() => {
    const handler = (e: Event) => {
      const { componentId, prop, value } = (e as CustomEvent<{ componentId: string; prop: string; value: string | number }>).detail
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      const el = doc.querySelector<HTMLElement>(`[data-component-id="${componentId}"]`)
      if (!el) return

      applyStyleProp(el, prop, value)

      const newHtml = rebuildFullHtml(doc.documentElement.innerHTML)

      // store 낙관적 업데이트 — iframe reload 없이 (ignoreHtmlSyncRef로 useEffect 차단)
      ignoreHtmlSyncRef.current = true
      const ppt = useSlideStore.getState().presentation
      if (ppt) {
        useSlideStore.setState({
          presentation: {
            ...ppt,
            slides: ppt.slides.map((s) => s.id === slideId ? { ...s, html_content: newHtml } : s),
          },
        })
      }

      // re-broadcast updated style so inspector stays in sync
      window.dispatchEvent(new CustomEvent('html-component-select', { detail: parseElementStyle(el) }))

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        try {
          await api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: newHtml })
        } catch { /* silent */ }
      }, 400)
    }
    window.addEventListener('html-component-style-update', handler)
    return () => window.removeEventListener('html-component-style-update', handler)
  }, [projectId, slideId, onHtmlChange])

  // iframe 로드 시 내부 DOM에 이벤트 등록
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc) return

    // 기존 이벤트 리스너를 교체하기 위해 body를 clone하지 않고 직접 등록
    // (srcdoc 변경마다 onLoad 재호출되므로 중복 등록 없음)

    doc.querySelectorAll<HTMLElement>('[data-component-id]').forEach((el) => {
      const id = el.getAttribute('data-component-id') ?? ''

      // ── 클릭: 컴포넌트 선택 → RightPanel 속성 패널 표시 ──
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const style = parseElementStyle(el)
        onComponentSelect(id, style)
      })

      // ── 더블클릭: 텍스트 요소 인라인 편집 ──
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const isTextEl = isTextElement(el)
        if (!isTextEl) return

        el.contentEditable = 'true'
        el.focus()

        // 커서 끝으로
        const range = doc.createRange()
        const sel = iframe!.contentWindow!.getSelection()
        range.selectNodeContents(el)
        range.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(range)

        const onBlur = async () => {
          el.removeEventListener('blur', onBlur)
          el.removeEventListener('keydown', onKeyDown)
          el.contentEditable = 'false'
          const newHtml = doc.documentElement.innerHTML
          const fullHtml = rebuildFullHtml(newHtml)
          onHtmlChange(fullHtml)
          try {
            await api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: fullHtml })
          } catch (err) {
            console.error('html slide text update failed', err)
          }
        }

        const onKeyDown = (ke: KeyboardEvent) => {
          if (ke.key === 'Enter' && !ke.shiftKey) {
            ke.preventDefault()
            ;(el as HTMLElement).blur()
          }
          if (ke.key === 'Escape') {
            el.removeEventListener('blur', onBlur)
            el.removeEventListener('keydown', onKeyDown)
            el.contentEditable = 'false'
            onComponentSelect(null, null)
          }
        }

        el.addEventListener('blur', onBlur)
        el.addEventListener('keydown', onKeyDown)
      })

      // ── 이미지 플레이스홀더 클릭 → 파일 picker ──
      if (isImagePlaceholder(el)) {
        el.style.cursor = 'pointer'
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          pendingImageIdRef.current = id
          fileInputRef.current?.click()
        })
      }
    })

    // 배경 클릭 → 선택 해제
    doc.body.addEventListener('click', () => onComponentSelect(null, null))
  }, [iframeRef, projectId, slideId, onHtmlChange, onComponentSelect])

  // 파일 input onChange
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const targetId = pendingImageIdRef.current
    if (!file || !targetId) return
    // reset so same file can be picked again
    e.target.value = ''

    const dataUrl = await readFileAsDataURL(file)

    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc) return

    const el = doc.querySelector<HTMLElement>(`[data-component-id="${targetId}"]`)
    if (!el) return

    // img 요소면 src 교체, 아니면 background-image 설정
    const imgTag = el.tagName === 'IMG' ? el as HTMLImageElement : el.querySelector<HTMLImageElement>('img')
    if (imgTag) {
      imgTag.src = dataUrl
      imgTag.classList.remove('img-placeholder')
    } else {
      el.style.backgroundImage = `url(${dataUrl})`
      el.style.backgroundSize = 'cover'
      el.style.backgroundPosition = 'center'
      el.classList.remove('img-placeholder')
    }

    const newHtml = doc.documentElement.innerHTML
    const fullHtml = rebuildFullHtml(newHtml)
    onHtmlChange(fullHtml)
    try {
      await api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: fullHtml })
    } catch (err) {
      console.error('html slide image update failed', err)
    }
    pendingImageIdRef.current = null
  }, [iframeRef, projectId, slideId, htmlContent, onHtmlChange])

  return { handleIframeLoad, handleFileChange, fileInputRef }
}

// ── 헬퍼 함수들 ───────────────────────────────────────────────────────────────

function isTextElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'li', 'td', 'th'].includes(tag)) return true
  // div인데 이미지 없고 텍스트만 있으면 텍스트 요소로 간주
  if (tag === 'div' && !el.querySelector('img') && el.textContent?.trim()) return true
  return false
}

function isImagePlaceholder(el: HTMLElement): boolean {
  return (
    el.tagName === 'IMG' ||
    el.classList.contains('img-placeholder') ||
    el.querySelector('img') !== null
  )
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * iframe 내부 doc.documentElement.innerHTML을 받아
 * 완전한 HTML 문서 string으로 복원한다.
 */
function rebuildFullHtml(innerHtml: string): string {
  // innerHTML에서 <head>...</head> <body>...</body> 추출
  const headMatch = innerHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  const bodyMatch = innerHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const head = headMatch ? headMatch[1] : ''
  const body = bodyMatch ? bodyMatch[1] : innerHtml
  return `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`
}

// ── 속성 패널용 스타일 파싱 ───────────────────────────────────────────────────

export interface HtmlComponentStyle {
  componentId: string
  left: number
  top: number
  width: number
  height: number
  color: string
  backgroundColor: string
  fontSize: number
  opacity: number
  tagName: string
  textContent: string
  isText: boolean
}

function parseElementStyle(el: HTMLElement): HtmlComponentStyle {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el) ?? el.style as CSSStyleDeclaration
  const num = (inline: string, computed: string) => parseFloat(inline) || parseFloat(computed) || 0
  return {
    componentId: el.getAttribute('data-component-id') ?? '',
    left: num(el.style.left, (cs as CSSStyleDeclaration).left ?? ''),
    top: num(el.style.top, (cs as CSSStyleDeclaration).top ?? ''),
    width: num(el.style.width, (cs as CSSStyleDeclaration).width ?? ''),
    height: num(el.style.height, (cs as CSSStyleDeclaration).height ?? ''),
    color: (cs as CSSStyleDeclaration).color ?? el.style.color ?? '',
    backgroundColor: (cs as CSSStyleDeclaration).backgroundColor ?? el.style.backgroundColor ?? '',
    fontSize: num(el.style.fontSize, (cs as CSSStyleDeclaration).fontSize ?? ''),
    opacity: parseFloat((cs as CSSStyleDeclaration).opacity ?? el.style.opacity ?? '1') || 1,
    tagName: el.tagName.toLowerCase(),
    textContent: el.textContent?.trim().slice(0, 80) ?? '',
    isText: isTextElement(el),
  }
}

function applyStyleProp(el: HTMLElement, prop: string, value: string | number): void {
  const px = (v: string | number) => `${v}px`
  switch (prop) {
    case 'left': el.style.left = px(value); break
    case 'top': el.style.top = px(value); break
    case 'width': el.style.width = px(value); break
    case 'height': el.style.height = px(value); break
    case 'color': el.style.color = String(value); break
    case 'backgroundColor': el.style.backgroundColor = String(value); break
    case 'fontSize': el.style.fontSize = px(value); break
    case 'opacity': el.style.opacity = String(value); break
  }
}

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

  // HTML 모드 상태
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [htmlContent, setHtmlContent] = useState<string>(currentSlide?.html_content ?? '')
  const [selectedHtmlStyle, setSelectedHtmlStyle] = useState<HtmlComponentStyle | null>(null)
  // inspector edit 중 html_content 변경으로 인한 iframe reload 차단 플래그
  const ignoreHtmlSyncRef = useRef(false)

  // 슬라이드 ID 변경(슬라이드 전환) 시 리셋
  useEffect(() => {
    setHtmlContent(currentSlide?.html_content ?? '')
    setSelectedHtmlStyle(null)
  }, [currentSlide?.id])

  // agent 업데이트 등 외부 html_content 변경 시 반영 (inspector edit은 제외)
  useEffect(() => {
    if (ignoreHtmlSyncRef.current) {
      ignoreHtmlSyncRef.current = false
      return
    }
    setHtmlContent(currentSlide?.html_content ?? '')
  }, [currentSlide?.html_content])

  const handleHtmlChange = useCallback((newHtml: string) => {
    setHtmlContent(newHtml)
    // store 내 presentation도 낙관적 업데이트
    const ppt = useSlideStore.getState().presentation
    if (!ppt || !currentSlide) return
    const updatedSlides = ppt.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, html_content: newHtml } : s
    )
    useSlideStore.setState({ presentation: { ...ppt, slides: updatedSlides } })
  }, [currentSlide])

  const handleComponentSelect = useCallback((id: string | null, style: HtmlComponentStyle | null) => {
    setSelectedHtmlStyle(style)
    selectComponent(id)
  }, [selectComponent])

  const { handleIframeLoad, handleFileChange, fileInputRef } = useHtmlSlideEdit(
    iframeRef,
    presentation?.id ?? '',
    currentSlide?.id ?? '',
    htmlContent,
    handleHtmlChange,
    handleComponentSelect,
    ignoreHtmlSyncRef,
  )

  // Proposal hover 미리보기: 컴포넌트 HTML 임시 교체 → mouse leave 시 복원
  useEffect(() => {
    const originals = new Map<string, string>()

    const onPreview = (e: Event) => {
      const { componentId, newHtml } = (e as CustomEvent<{ componentId: string; newHtml: string }>).detail
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      const el = doc.querySelector<HTMLElement>(`[data-component-id="${componentId}"]`)
      if (!el) return
      if (!originals.has(componentId)) originals.set(componentId, el.outerHTML)
      const tmp = doc.createElement('div')
      tmp.innerHTML = newHtml
      const newEl = tmp.firstElementChild
      if (newEl) el.replaceWith(newEl)
    }

    const onClear = (e: Event) => {
      const { componentId } = (e as CustomEvent<{ componentId: string }>).detail
      const original = originals.get(componentId)
      if (!original) return
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      const el = doc.querySelector<HTMLElement>(`[data-component-id="${componentId}"]`)
      if (!el) return
      const tmp = doc.createElement('div')
      tmp.innerHTML = original
      const origEl = tmp.firstElementChild
      if (origEl) el.replaceWith(origEl)
      originals.delete(componentId)
    }

    window.addEventListener('html-component-preview', onPreview)
    window.addEventListener('html-component-preview-clear', onClear)
    return () => {
      window.removeEventListener('html-component-preview', onPreview)
      window.removeEventListener('html-component-preview-clear', onClear)
    }
  }, [])

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
    // html_content가 완전한 HTML 문서면 그대로 사용, 아니면 감싸기
    const rawHtml = htmlContent || currentSlide.html_content
    const iframeSrc = buildSlideSrc(rawHtml)

    return (
      <div ref={containerRef}
        className="flex-1 flex items-center justify-center bg-[var(--bg-muted)] overflow-hidden"
        onClick={() => { setSelectedHtmlStyle(null); selectComponent(null) }}>
        {/* hidden file input for image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <div
          className="relative rounded-[8px] shadow-[0_8px_40px_rgba(0,0,0,0.18)] overflow-hidden shrink-0"
          style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}
          onClick={(e) => e.stopPropagation()}>
          <iframe
            ref={iframeRef}
            srcDoc={iframeSrc}
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'block',
            }}
            sandbox="allow-scripts allow-same-origin"
            title="slide"
            onLoad={() => handleIframeLoad()}
          />
          {/* 선택된 요소 툴팁 힌트 */}
          {selectedHtmlStyle && (
            <div
              className="absolute bottom-2 left-2 z-10 bg-black/70 text-white text-[10px] rounded-[6px] px-2 py-1 pointer-events-none max-w-[200px] truncate"
            >
              {selectedHtmlStyle.tagName} · 더블클릭으로 편집
            </div>
          )}
        </div>
        {/* 우측 속성 패널과 상태 공유 */}
        <HtmlStyleBroadcaster style={selectedHtmlStyle} />
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

// ── HTML 스타일 브로드캐스터 ──────────────────────────────────────────────────
// RightPanel과 상태 공유를 위해 전역 이벤트 방식으로 선택된 HTML 요소 스타일 전파
function HtmlStyleBroadcaster({ style }: { style: HtmlComponentStyle | null }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('html-component-select', { detail: style }))
  }, [style])
  return null
}
