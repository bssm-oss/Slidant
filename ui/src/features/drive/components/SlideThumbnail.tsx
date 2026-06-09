import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/apiClient'
import type { SlideComponent } from '@/shared/types'
import { buildSlideSrc } from '@/shared/lib/slideHtml'

const SLIDE_W = 960
const SLIDE_H = 540

type RawSlideComponent = {
  id: string
  type: SlideComponent['type']
  properties?: {
    position?: SlideComponent['position']
    size?: SlideComponent['size']
    [key: string]: unknown
  }
  order?: number
}

type RawSlide = {
  components?: RawSlideComponent[]
  html_content?: string | null
}

function ThumbnailComp({ comp }: { comp: SlideComponent }) {
  const props = comp.props as Record<string, unknown>

  if (comp.type === 'text') {
    return (
      <p style={{
        fontSize: (props.fontSize as number) ?? 16,
        fontWeight: (props.fontWeight as number) ?? 400,
        color: (props.color as string) ?? '#1A1523',
        textAlign: (props.align as CSSProperties['textAlign']) ?? 'left',
        lineHeight: (props.lineHeight as number) ?? 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        width: '100%', height: '100%',
        margin: 0, padding: 0,
        overflow: 'hidden',
        userSelect: 'none',
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
        opacity: (props.opacity as number) ?? 1,
      }} />
    )
  }

  if (comp.type === 'image') {
    const src = (props.src ?? props.url) as string | undefined
    if (!src || props.placeholder) {
      return (
        <div style={{
          width: '100%', height: '100%',
          background: '#EAF2FF',
          borderRadius: (props.borderRadius as number) ?? 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
            stroke="#93B4F6" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
        </div>
      )
    }
    return (
      <img src={src} alt="" style={{
        width: '100%', height: '100%',
        objectFit: (props.objectFit as CSSProperties['objectFit']) ?? 'cover',
        borderRadius: (props.borderRadius as number) ?? 0,
        opacity: (props.opacity as number) ?? 1,
        display: 'block',
        pointerEvents: 'none',
      }} />
    )
  }

  return null
}

function parseComponents(rawComponents: RawSlideComponent[]): SlideComponent[] {
  return rawComponents.map((c) => ({
    id: c.id,
    type: c.type,
    position: c.properties?.position ?? { x: 0, y: 0 },
    size: c.properties?.size ?? { w: 400, h: 100 },
    props: c.properties ?? {},
    zIndex: c.order ?? 0,
  }))
}

interface Props {
  projectId: string
}

export default function SlideThumbnail({ projectId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.34)
  const [components, setComponents] = useState<SlideComponent[] | null>(null)
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'empty' | 'ready'>('loading')
  const fetchedRef = useRef(false)

  // 컨테이너 너비 → 슬라이드 스케일 계산
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / SLIDE_W)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // IntersectionObserver — 뷰포트 진입 시에만 fetch
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || fetchedRef.current) return
      fetchedRef.current = true

      api.get<RawSlide[]>(`/projects/${projectId}/slides`).then((slides) => {
        const first = slides?.[0]
        if (!first) { setStatus('empty'); return }
        if (first.html_content) {
          setHtmlContent(first.html_content)
          setStatus('ready')
        } else if (first.components?.length) {
          setComponents(parseComponents(first.components))
          setStatus('ready')
        } else {
          setStatus('empty')
        }
      }).catch(() => setStatus('empty'))
    }, { threshold: 0 })

    io.observe(el)
    return () => io.disconnect()
  }, [projectId])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', aspectRatio: '16/9', position: 'relative', overflow: 'hidden', background: '#f8fafc' }}
    >
      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 0 }}
          className="animate-pulse bg-gradient-to-br from-slate-100 to-slate-200" />
      )}

      {status === 'empty' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc',
        }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>빈 슬라이드</span>
        </div>
      )}

      {status === 'ready' && htmlContent && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <iframe
            key={htmlContent}
            srcDoc={buildSlideSrc(htmlContent)}
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'block',
              pointerEvents: 'none',
            }}
            sandbox="allow-scripts"
            title="슬라이드 미리보기"
          />
        </div>
      )}

      {status === 'ready' && !htmlContent && components && (
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: SLIDE_W, height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}>
          {components
            .slice()
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((comp) => (
              <div key={comp.id} style={{
                position: 'absolute',
                left: comp.position.x, top: comp.position.y,
                width: comp.size.w, height: comp.size.h,
                zIndex: comp.zIndex,
                overflow: 'hidden',
              }}>
                <ThumbnailComp comp={comp} />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
