import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useSlideStore } from '../store/slideStore'
import { useProposalStore } from '../store/proposalStore'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/lib/apiClient'
import type { SlideComponent } from '@/shared/types'
import ConflictResolver from './ConflictResolver'
import SlideProposalBanner from './SlideProposalBanner'
import CropModal from './CropModal'
import { buildSlideSrc } from '@/shared/lib/slideHtml'
import { crdtStore } from '@/shared/lib/crdtStore'
import SelectionOverlay from './SelectionOverlay'

// ── HTML 슬라이드 편집 훅 ───────────────────────────────────────────────────────

const PROP_CHANGE_LABEL: Record<string, string> = {
  left: '위치', top: '위치',
  width: '크기', height: '크기',
  color: '글자색',
  backgroundColor: '배경색',
  fontSize: '글자 크기',
  opacity: '투명도',
  fontWeight: '글자 굵기',
  textAlign: '텍스트 정렬',
  lineHeight: '줄 간격',
  letterSpacing: '자간',
  borderRadius: '모서리 반경',
  zIndex: '레이어 순서',
  objectFit: '이미지 맞춤',
  objectPosition: '이미지 위치',
  backgroundSize: '배경 크기',
  backgroundPosition: '배경 위치',
}

function buildStyleReason(componentId: string, props: Set<string>): string {
  const labels = [...new Set([...props].map((p) => PROP_CHANGE_LABEL[p] ?? p))].join('·')
  return `사용자: [${componentId}] ${labels} 변경`
}

/**
 * iframe 내부 DOM에 인라인 텍스트 편집 + 이미지 업로드 이벤트를 주입하고,
 * 변경사항을 html_content string에 반영 → API 저장한다.
 */
function useHtmlSlideEdit(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  projectId: string,
  slideId: string,
  _htmlContent: string,
  onHtmlChange: (newHtml: string) => void,
  onComponentSelect: (id: string | null, style: HtmlComponentStyle | null) => void,
  ignoreHtmlSyncRef: React.RefObject<boolean>,
  onStyleUpdate: (style: HtmlComponentStyle) => void,
) {
  // hidden file input (이미지 업로드용)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageIdRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingCrop, setPendingCrop] = useState<{ dataUrl: string; targetId: string; elW: number; elH: number } | null>(null)

  // html-component-style-update: Inspector → iframe DOM → debounced API save
  const pendingChangeRef = useRef<{ componentId: string; props: Set<string> } | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const { componentId, prop, value } = (e as CustomEvent<{ componentId: string; prop: string; value: string | number }>).detail
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      const el = doc.querySelector<HTMLElement>(`[data-component-id="${componentId}"]`)
      if (!el) return

      applyStyleProp(el, prop, value)

      const newHtml = rebuildFullHtml(doc.documentElement.innerHTML)

      // inspector + overlay 동기화
      onStyleUpdate(parseElementStyle(el))

      // 변경된 prop 누적 (debounce 창 내에서 여러 prop 변경 시 reason 합산)
      if (!pendingChangeRef.current || pendingChangeRef.current.componentId !== componentId) {
        pendingChangeRef.current = { componentId, props: new Set() }
      }
      pendingChangeRef.current.props.add(prop)

      // DOM 직접 업데이트 → API 저장 후 store/CRDT 반영 (즉시 store 업데이트 시 iframe reload 유발)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        const pending = pendingChangeRef.current
        pendingChangeRef.current = null
        const reason = pending ? buildStyleReason(pending.componentId, pending.props) : '사용자: 직접 편집'
        try {
          await api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: newHtml, reason })
          const ppt = useSlideStore.getState().presentation
          if (ppt) {
            ignoreHtmlSyncRef.current = true
            useSlideStore.setState({
              presentation: {
                ...ppt,
                slides: ppt.slides.map((s) => s.id === slideId ? { ...s, html_content: newHtml } : s),
              },
            })
            // CRDT 브로드캐스트 — 다른 사용자 실시간 반영
            crdtStore.setSlideHtml(slideId, newHtml)
          }
        } catch { /* silent */ }
      }, 400)
    }
    window.addEventListener('html-component-style-update', handler)
    return () => window.removeEventListener('html-component-style-update', handler)
  }, [projectId, slideId])

  // html-image-upload-request: Inspector → file picker
  useEffect(() => {
    const handler = (e: Event) => {
      const { componentId } = (e as CustomEvent<{ componentId: string }>).detail
      pendingImageIdRef.current = componentId
      fileInputRef.current?.click()
    }
    window.addEventListener('html-image-upload-request', handler)
    return () => window.removeEventListener('html-image-upload-request', handler)
  }, [])

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

        window.dispatchEvent(new CustomEvent('html-text-editing', { detail: true }))
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
          window.dispatchEvent(new CustomEvent('html-text-editing', { detail: false }))
          const newHtml = doc.documentElement.innerHTML
          const fullHtml = rebuildFullHtml(newHtml)
          onHtmlChange(fullHtml)
          try {
            const textId = el.getAttribute('data-component-id') ?? ''
            await api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: fullHtml, reason: `사용자: [${textId}] 텍스트 수정` })
            crdtStore.setSlideHtml(slideId, fullHtml)
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
            window.dispatchEvent(new CustomEvent('html-text-editing', { detail: false }))
            onComponentSelect(null, null)
          }
        }

        el.addEventListener('blur', onBlur)
        el.addEventListener('keydown', onKeyDown)
      })

      // 이미지 컴포넌트 커서
      if (isImagePlaceholder(el)) {
        el.style.cursor = 'pointer'
      }
    })

    // 배경 클릭 → 선택 해제
    doc.body.addEventListener('click', () => onComponentSelect(null, null))
  }, [iframeRef, projectId, slideId, onHtmlChange, onComponentSelect])

  // 파일 선택 → 크롭 모달 오픈 (직접 적용 X)
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const targetId = pendingImageIdRef.current
    if (!file || !targetId) return
    e.target.value = ''

    const doc = iframeRef.current?.contentDocument
    const el = doc?.querySelector<HTMLElement>(`[data-component-id="${targetId}"]`)
    const elW = el ? (parseFloat(el.style.width) || el.offsetWidth || 200) : 200
    const elH = el ? (parseFloat(el.style.height) || el.offsetHeight || 200) : 200

    const dataUrl = await readFileAsDataURL(file)
    pendingImageIdRef.current = null
    setPendingCrop({ dataUrl, targetId, elW, elH })
  }, [iframeRef])

  // 크롭 완료 → iframe DOM 업데이트 + 저장
  const applyImage = useCallback(async (dataUrl: string) => {
    const targetId = pendingCrop?.targetId
    if (!targetId) return
    setPendingCrop(null)

    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc) return

    const el = doc.querySelector<HTMLElement>(`[data-component-id="${targetId}"]`)
    if (!el) return

    const imgTag = el.tagName === 'IMG' ? el as HTMLImageElement : el.querySelector<HTMLImageElement>('img')
    if (imgTag) {
      imgTag.src = dataUrl
      imgTag.classList.remove('img-placeholder')
      // 플레이스홀더 형제 요소(SVG, 텍스트) 숨김
      Array.from(el.children).forEach((child) => {
        if (child !== imgTag) (child as HTMLElement).style.display = 'none'
      })
    } else {
      el.innerHTML = ''  // 플레이스홀더 텍스트/아이콘 제거
      el.style.backgroundImage = `url(${dataUrl})`
      el.style.backgroundSize = 'cover'
      el.style.backgroundPosition = 'center'
      el.classList.remove('img-placeholder')
    }
    el.setAttribute('data-image-component', 'true')

    const newHtml = doc.documentElement.innerHTML
    const fullHtml = rebuildFullHtml(newHtml)
    onHtmlChange(fullHtml)

    // inspector 동기화
    window.dispatchEvent(new CustomEvent('html-component-select', { detail: parseElementStyle(el) }))

    try {
      const targetId = pendingCrop?.targetId ?? ''
      await api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: fullHtml, reason: `사용자: [${targetId}] 이미지 변경` })
    } catch (err) {
      console.error('html slide image update failed', err)
    }
  }, [pendingCrop, iframeRef, projectId, slideId, onHtmlChange])

  const cancelCrop = useCallback(() => setPendingCrop(null), [])

  const deleteHtmlComponent = useCallback((componentId: string) => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const el = doc.querySelector(`[data-component-id="${componentId}"]`)
    if (!el) return
    el.remove()
    const newHtml = rebuildFullHtml(doc.documentElement.innerHTML)
    onHtmlChange(newHtml)
    onComponentSelect(null, null)
    api.patch(`/projects/${projectId}/slides/${slideId}`, { html_content: newHtml, reason: `사용자: [${componentId}] 컴포넌트 삭제` })
      .then(() => { crdtStore.setSlideHtml(slideId, newHtml) })
      .catch(console.error)
  }, [iframeRef, projectId, slideId, onHtmlChange, onComponentSelect])

  // Inspector 패널의 삭제 버튼 이벤트
  useEffect(() => {
    const handler = (e: Event) => {
      const { componentId } = (e as CustomEvent<{ componentId: string }>).detail
      deleteHtmlComponent(componentId)
    }
    window.addEventListener('html-component-delete-request', handler)
    return () => window.removeEventListener('html-component-delete-request', handler)
  }, [deleteHtmlComponent])

  return { handleIframeLoad, handleFileChange, fileInputRef, pendingCrop, applyImage, cancelCrop, deleteHtmlComponent }
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
    el.hasAttribute('data-image-component') ||
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

// outerHTML 그대로 비교하면 속성 순서만 다른 동일 마크업도 "변경"으로 오판함
// (LLM이 슬라이드 전체를 재생성하면서 장식용 SVG 속성 순서가 매번 바뀌는 경우가 흔함)
// → 속성을 이름순 정렬해 직렬화한 정규형으로 비교
function canonicalizeElement(el: Element): string {
  const attrs = [...el.attributes]
    .map((a) => `${a.name}="${a.value}"`)
    .sort()
    .join(' ')
  const tag = el.tagName.toLowerCase()
  const children = [...el.childNodes]
    .map((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) return canonicalizeElement(node as Element)
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
      return ''
    })
    .join('')
  return `<${tag} ${attrs}>${children}</${tag}>`
}

function getProposalDiff(currentHtml: string, proposalHtml: string): { changed: string[]; deleted: string[] } {
  try {
    const parseComponents = (html: string) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const map = new Map<string, string>()
      doc.querySelectorAll('[data-component-id]').forEach((el) => {
        map.set(el.getAttribute('data-component-id')!, canonicalizeElement(el))
      })
      return map
    }
    const cur = parseComponents(currentHtml)
    const prop = parseComponents(proposalHtml)
    const changed: string[] = []
    const deleted: string[] = []
    cur.forEach((html, id) => {
      if (!prop.has(id)) deleted.push(id)
      else if (prop.get(id) !== html) changed.push(id)
    })
    return { changed, deleted }
  } catch {
    return { changed: [], deleted: [] }
  }
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
  fontWeight: number
  textAlign: string
  lineHeight: number
  letterSpacing: number
  opacity: number
  borderRadius: number
  zIndex: number
  tagName: string
  textContent: string
  isText: boolean
  isImage: boolean
  objectFit: string
  objectPosition: string
  backgroundSize: string
  backgroundPosition: string
}

function parseElementStyle(el: HTMLElement): HtmlComponentStyle {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el) ?? el.style as CSSStyleDeclaration
  const num = (inline: string, computed: string) => parseFloat(inline) || parseFloat(computed) || 0
  const opStr = el.style.opacity || (cs as CSSStyleDeclaration).opacity
  return {
    componentId: el.getAttribute('data-component-id') ?? '',
    left: num(el.style.left, (cs as CSSStyleDeclaration).left ?? ''),
    top: num(el.style.top, (cs as CSSStyleDeclaration).top ?? ''),
    width: num(el.style.width, (cs as CSSStyleDeclaration).width ?? ''),
    height: num(el.style.height, (cs as CSSStyleDeclaration).height ?? ''),
    color: (cs as CSSStyleDeclaration).color ?? el.style.color ?? '',
    backgroundColor: (cs as CSSStyleDeclaration).backgroundColor ?? el.style.backgroundColor ?? '',
    fontSize: num(el.style.fontSize, (cs as CSSStyleDeclaration).fontSize ?? ''),
    fontWeight: parseInt(el.style.fontWeight || (cs as CSSStyleDeclaration).fontWeight || '400') || 400,
    textAlign: el.style.textAlign || (cs as CSSStyleDeclaration).textAlign || 'left',
    lineHeight: parseFloat(el.style.lineHeight || (cs as CSSStyleDeclaration).lineHeight || '0') || 1.4,
    letterSpacing: parseFloat(el.style.letterSpacing || (cs as CSSStyleDeclaration).letterSpacing || '0') || 0,
    opacity: opStr ? parseFloat(opStr) : 1,
    borderRadius: parseFloat(el.style.borderRadius || (cs as CSSStyleDeclaration).borderRadius || '0') || 0,
    zIndex: parseInt(el.style.zIndex || (cs as CSSStyleDeclaration).zIndex || '0') || 0,
    tagName: el.tagName.toLowerCase(),
    textContent: el.textContent?.trim().slice(0, 80) ?? '',
    isText: isTextElement(el),
    isImage: isImagePlaceholder(el),
    objectFit: el.style.objectFit || (cs as CSSStyleDeclaration).objectFit || '',
    objectPosition: el.style.objectPosition || (cs as CSSStyleDeclaration).objectPosition || 'center center',
    backgroundSize: el.style.backgroundSize || (cs as CSSStyleDeclaration).backgroundSize || '',
    backgroundPosition: el.style.backgroundPosition || (cs as CSSStyleDeclaration).backgroundPosition || 'center center',
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
    case 'objectFit': el.style.objectFit = String(value); break
    case 'objectPosition': el.style.objectPosition = String(value); break
    case 'backgroundSize': el.style.backgroundSize = String(value); break
    case 'backgroundPosition': el.style.backgroundPosition = String(value); break
    case 'fontWeight': el.style.fontWeight = String(value); break
    case 'textAlign': el.style.textAlign = String(value); break
    case 'lineHeight': el.style.lineHeight = String(value); break
    case 'letterSpacing': el.style.letterSpacing = `${value}px`; break
    case 'borderRadius': el.style.borderRadius = `${value}px`; break
    case 'zIndex': el.style.zIndex = String(value); break
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
  const { conflicts, proposals } = useProposalStore()
  const conflictedIds = new Set(conflicts.map((c) => c.componentId))
  // 현재 슬라이드의 가장 최근 pending proposal (html_content 있는 것)
  const pendingProposal = proposals
    .filter((p) => p.status === 'pending' && p.slide_id === currentSlide?.id && !!p.html_content)
    .at(-1) ?? null
  // 현재 슬라이드의 모든 pending proposals (인디케이터용)
  const pendingProposalKey = useMemo(
    () => proposals
      .filter((p) => p.status === 'pending' && p.slide_id === currentSlide?.id && !!p.html_content)
      .map((p) => `${p.id}:${p.html_content!.length}`)
      .join(','),
    [proposals, currentSlide?.id]
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.75)
  const drag = useRef<DragState | null>(null)
  const [liveGeom, setLiveGeom] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({})
  const [conflictTarget, setConflictTarget] = useState<string | null>(null)

  // HTML 모드 상태
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [htmlContent, setHtmlContent] = useState<string>(currentSlide?.html_content ?? '')
  const [selectedHtmlStyle, setSelectedHtmlStyle] = useState<HtmlComponentStyle | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [iframeLoadKey, setIframeLoadKey] = useState(0)
  const [proposalIndicators, setProposalIndicators] = useState<Array<{ id: string; type: 'change' | 'delete'; x: number; y: number; w: number; h: number }>>([])

  // inspector edit 중 html_content 변경으로 인한 iframe reload 차단 플래그
  const ignoreHtmlSyncRef = useRef(false)
  // onPreview closure에서 최신 htmlContent 참조용
  const htmlContentRef = useRef(htmlContent)

  // 슬라이드 ID 변경(슬라이드 전환) 시 리셋 + pending proposals 로드
  useEffect(() => {
    setHtmlContent(currentSlide?.html_content ?? '')
    setSelectedHtmlStyle(null)
    setPreviewHtml(null)
    if (!currentSlide?.id) return
    import('@/shared/lib/proposalApi').then(({ fetchPendingProposals }) => {
      fetchPendingProposals('', currentSlide.id)
        .then((fetched) => useProposalStore.getState().mergeProposalsForSlide(currentSlide.id, fetched))
        .catch(() => {})
    })
  }, [currentSlide?.id])

  // agent 업데이트 등 외부 html_content 변경 시 반영 (inspector edit은 제외)
  useEffect(() => {
    if (ignoreHtmlSyncRef.current) {
      ignoreHtmlSyncRef.current = false
      return
    }
    setHtmlContent(currentSlide?.html_content ?? '')
  }, [currentSlide?.html_content])

  useEffect(() => { htmlContentRef.current = htmlContent }, [htmlContent])

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

  const [isTextEditing, setIsTextEditing] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => setIsTextEditing((e as CustomEvent<boolean>).detail)
    window.addEventListener('html-text-editing', handler)
    return () => window.removeEventListener('html-text-editing', handler)
  }, [])

  const handleComponentSelect = useCallback((id: string | null, style: HtmlComponentStyle | null) => {
    setSelectedHtmlStyle(style)
    selectComponent(id)
  }, [selectComponent])

  const handleStyleUpdate = useCallback((newStyle: HtmlComponentStyle) => {
    setSelectedHtmlStyle(newStyle)
  }, [])

  const { handleIframeLoad: _handleIframeLoad, handleFileChange, fileInputRef, pendingCrop, applyImage, cancelCrop, deleteHtmlComponent } = useHtmlSlideEdit(
    iframeRef,
    presentation?.id ?? '',
    currentSlide?.id ?? '',
    htmlContent,
    handleHtmlChange,
    handleComponentSelect,
    ignoreHtmlSyncRef,
    handleStyleUpdate,
  )

  const handleIframeLoad = useCallback(() => {
    _handleIframeLoad()
    setIframeLoadKey((k) => k + 1)
  }, [_handleIframeLoad])

  // 제안 인디케이터: pending proposals의 변경/삭제 컴포넌트를 iframe DOM에서 읽어 overlay 좌표 계산
  useEffect(() => {
    if (!iframeRef.current?.contentDocument || previewHtml || !pendingProposalKey) {
      setProposalIndicators([])
      return
    }
    const slideId = currentSlide?.id
    const allProposals = useProposalStore.getState().proposals
      .filter((p) => p.status === 'pending' && p.slide_id === slideId && !!p.html_content)
    if (!allProposals.length || !htmlContent) {
      setProposalIndicators([])
      return
    }

    const changedSet = new Set<string>()
    const deletedSet = new Set<string>()
    for (const p of allProposals) {
      const { changed, deleted } = getProposalDiff(htmlContent, p.html_content!)
      changed.forEach((id) => changedSet.add(id))
      deleted.forEach((id) => deletedSet.add(id))
    }

    const doc = iframeRef.current.contentDocument
    const indicators: typeof proposalIndicators = []
    const addIndicator = (id: string, type: 'change' | 'delete') => {
      const el = doc.querySelector(`[data-component-id="${id}"]`) as HTMLElement | null
      if (!el) return
      const x = parseFloat(el.style.left) || 0
      const y = parseFloat(el.style.top) || 0
      const w = parseFloat(el.style.width) || el.offsetWidth
      const h = parseFloat(el.style.height) || el.offsetHeight
      indicators.push({ id, type, x, y, w, h })
    }
    changedSet.forEach((id) => { if (!deletedSet.has(id)) addIndicator(id, 'change') })
    deletedSet.forEach((id) => addIndicator(id, 'delete'))
    setProposalIndicators(indicators)
  }, [iframeLoadKey, pendingProposalKey, htmlContent, previewHtml, currentSlide?.id])

  // hover 미리보기: fullProposalHtml → 전체 교체, newHtml → 해당 컴포넌트만 교체
  useEffect(() => {
    const onPreview = (e: Event) => {
      const { componentId, newHtml, fullProposalHtml } = (e as CustomEvent<{ componentId: string; newHtml: string; fullProposalHtml?: string }>).detail
      if (fullProposalHtml) {
        setPreviewHtml(fullProposalHtml)
      } else if (componentId && newHtml) {
        const base = htmlContentRef.current
        if (!base) return
        try {
          const doc = new DOMParser().parseFromString(base, 'text/html')
          const el = doc.querySelector(`[data-component-id="${componentId}"]`)
          if (el) {
            const tmp = new DOMParser().parseFromString(newHtml, 'text/html')
            const newEl = tmp.body.firstElementChild
            if (newEl) el.replaceWith(newEl)
            setPreviewHtml(rebuildFullHtml(doc.documentElement.innerHTML))
          }
        } catch { /* noop */ }
      }
    }

    const onClear = () => {
      setPreviewHtml(null)
    }

    window.addEventListener('html-component-preview', onPreview)
    window.addEventListener('html-component-preview-clear', onClear)
    return () => {
      window.removeEventListener('html-component-preview', onPreview)
      window.removeEventListener('html-component-preview-clear', onClear)
    }
  }, []) // htmlContentRef는 ref이므로 deps 불필요

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
    // previewHtml: proposal hover 중 전체 슬라이드 미리보기
    const rawHtml = previewHtml ?? (htmlContent || currentSlide.html_content)
    const iframeSrc = buildSlideSrc(rawHtml)

    return (
      <div ref={containerRef}
        className="flex-1 relative flex items-center justify-center bg-[var(--bg-muted)] overflow-hidden"
        onClick={() => { setSelectedHtmlStyle(null); selectComponent(null) }}>
        {/* hidden file input for image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Crop modal */}
        {pendingCrop && (
          <CropModal
            imageUrl={pendingCrop.dataUrl}
            elementW={pendingCrop.elW}
            elementH={pendingCrop.elH}
            onApply={applyImage}
            onCancel={cancelCrop}
          />
        )}
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
          {/* 제안 인디케이터 오버레이 */}
          {proposalIndicators.map(({ id, type, x, y, w, h }) => (
            <div
              key={`pi-${id}`}
              className="absolute pointer-events-none"
              style={{
                left: x * scale,
                top: y * scale,
                width: w * scale,
                height: h * scale,
                outline: `2px solid ${type === 'change' ? '#f59e0b' : '#ef4444'}`,
                outlineOffset: '1px',
                zIndex: 10,
              }}
            >
              <div
                className="absolute top-0 right-0 flex items-center px-1 text-white font-bold"
                style={{
                  background: type === 'change' ? '#f59e0b' : '#ef4444',
                  fontSize: Math.max(8, 9 * scale),
                  lineHeight: `${Math.max(14, 16 * scale)}px`,
                  borderRadius: '0 0 0 3px',
                }}
              >
                {type === 'change' ? '수정' : '삭제'}
              </div>
            </div>
          ))}
          {/* 선택 컴포넌트 오버레이 (드래그/리사이즈/키보드) */}
          {selectedHtmlStyle && !isTextEditing && !previewHtml && (
            <SelectionOverlay
              style={selectedHtmlStyle}
              scale={scale}
              iframeRef={iframeRef}
              onDelete={() => deleteHtmlComponent(selectedHtmlStyle.componentId)}
            />
          )}
        </div>
        {/* Proposal 전체 적용 배너 */}
        {pendingProposal && (
          <SlideProposalBanner proposal={pendingProposal} />
        )}
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
