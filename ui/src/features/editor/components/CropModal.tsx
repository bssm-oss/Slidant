import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Check, RotateCcw } from 'lucide-react'

type CropRect = { x: number; y: number; w: number; h: number }
type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

const MIN_CROP = 0.04
const p = (v: number) => `${(v * 100).toFixed(3)}%`

const HANDLES: { id: DragHandle; cursor: string; pos: (c: CropRect) => [number, number] }[] = [
  { id: 'nw', cursor: 'nw-resize', pos: c => [c.x,           c.y          ] },
  { id: 'ne', cursor: 'ne-resize', pos: c => [c.x + c.w,     c.y          ] },
  { id: 'sw', cursor: 'sw-resize', pos: c => [c.x,           c.y + c.h    ] },
  { id: 'se', cursor: 'se-resize', pos: c => [c.x + c.w,     c.y + c.h    ] },
  { id: 'n',  cursor: 'n-resize',  pos: c => [c.x + c.w/2,   c.y          ] },
  { id: 's',  cursor: 's-resize',  pos: c => [c.x + c.w/2,   c.y + c.h    ] },
  { id: 'w',  cursor: 'w-resize',  pos: c => [c.x,           c.y + c.h/2  ] },
  { id: 'e',  cursor: 'e-resize',  pos: c => [c.x + c.w,     c.y + c.h/2  ] },
]

interface Props {
  imageUrl: string
  elementW: number
  elementH: number
  onApply: (croppedDataUrl: string) => void
  onCancel: () => void
}

function computeInitialCrop(imgW: number, imgH: number, elW: number, elH: number): CropRect {
  if (elW <= 0 || elH <= 0 || imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: 1, h: 1 }
  const imgAR = imgW / imgH
  const elAR = elW / elH
  if (Math.abs(imgAR - elAR) < 0.01) return { x: 0, y: 0, w: 1, h: 1 }
  if (imgAR > elAR) {
    const cw = elAR / imgAR
    return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 }
  }
  const ch = imgAR / elAR
  return { x: 0, y: (1 - ch) / 2, w: 1, h: ch }
}

export default function CropModal({ imageUrl, elementW, elementH, onApply, onCancel }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 })

  const dragRef = useRef<{
    handle: DragHandle
    startMX: number; startMY: number
    startCrop: CropRect
    cW: number; cH: number
  } | null>(null)

  const resetCrop = useCallback(() => {
    const img = imgRef.current
    if (!img?.naturalWidth) return
    setCrop(computeInitialCrop(img.naturalWidth, img.naturalHeight, elementW, elementH))
  }, [elementW, elementH])

  const handleImgLoad = useCallback(() => {
    setImgLoaded(true)
    resetCrop()
  }, [resetCrop])

  const startDrag = useCallback((e: React.MouseEvent, handle: DragHandle) => {
    e.preventDefault()
    e.stopPropagation()
    const c = containerRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    dragRef.current = { handle, startMX: e.clientX, startMY: e.clientY, startCrop: { ...crop }, cW: r.width, cH: r.height }
  }, [crop])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.startMX) / d.cW
      const dy = (e.clientY - d.startMY) / d.cH
      let { x, y, w, h } = d.startCrop
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

      if (d.handle === 'move') {
        x = clamp(x + dx, 0, 1 - w)
        y = clamp(y + dy, 0, 1 - h)
      } else {
        if (d.handle.includes('e')) w = clamp(d.startCrop.w + dx, MIN_CROP, 1 - x)
        if (d.handle.includes('w')) {
          const nx = clamp(d.startCrop.x + dx, 0, d.startCrop.x + d.startCrop.w - MIN_CROP)
          w = d.startCrop.x + d.startCrop.w - nx; x = nx
        }
        if (d.handle.includes('s')) h = clamp(d.startCrop.h + dy, MIN_CROP, 1 - y)
        if (d.handle.includes('n')) {
          const ny = clamp(d.startCrop.y + dy, 0, d.startCrop.y + d.startCrop.h - MIN_CROP)
          h = d.startCrop.y + d.startCrop.h - ny; y = ny
        }
      }
      setCrop({ x, y, w, h })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleApply = useCallback(() => {
    const img = imgRef.current
    if (!img?.naturalWidth) return
    const sw = Math.max(1, Math.round(crop.w * img.naturalWidth))
    const sh = Math.max(1, Math.round(crop.h * img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = sw; canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, crop.x * img.naturalWidth, crop.y * img.naturalHeight, sw, sh, 0, 0, sw, sh)
    onApply(canvas.toDataURL('image/jpeg', 0.92))
  }, [crop, onApply])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onCancel}>
      <div
        className="bg-[var(--bg)] rounded-[14px] shadow-2xl flex flex-col overflow-hidden"
        style={{ maxWidth: '92vw', maxHeight: '92vh', minWidth: 320 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-[13px] font-semibold text-[var(--text)]">이미지 자르기</span>
          <button onClick={onCancel} className="p-1 rounded-[6px] hover:bg-[var(--bg-muted)] text-[var(--text-muted)]">
            <X size={15} />
          </button>
        </div>

        {/* Crop Area */}
        <div className="flex items-center justify-center bg-[#0a0a0a] p-6 flex-1 min-h-0">
          <div ref={containerRef} className="relative overflow-hidden select-none" style={{ maxWidth: '80vw', maxHeight: '65vh' }}>
            <img
              ref={imgRef}
              src={imageUrl}
              onLoad={handleImgLoad}
              draggable={false}
              className="block"
              style={{ maxWidth: '80vw', maxHeight: '65vh' }}
            />
            {imgLoaded && (
              <>
                {/* Dark mask via box-shadow, clipped by parent overflow:hidden */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: p(crop.x), top: p(crop.y),
                    width: p(crop.w), height: p(crop.h),
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                    border: '2px solid rgba(255,255,255,0.9)',
                  }}
                />
                {/* Move area */}
                <div
                  className="absolute"
                  style={{ left: p(crop.x), top: p(crop.y), width: p(crop.w), height: p(crop.h), cursor: 'move' }}
                  onMouseDown={(e) => startDrag(e, 'move')}
                />
                {/* Resize handles */}
                {HANDLES.map((h) => {
                  const [lx, ty] = h.pos(crop)
                  return (
                    <div
                      key={h.id}
                      className="absolute z-10 w-[10px] h-[10px] bg-white rounded-[2px] border border-gray-400 shadow"
                      style={{ left: p(lx), top: p(ty), transform: 'translate(-50%,-50%)', cursor: h.cursor }}
                      onMouseDown={(e) => { e.stopPropagation(); startDrag(e, h.id) }}
                    />
                  )
                })}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] shrink-0">
          <button
            onClick={resetCrop}
            className="flex items-center gap-1.5 px-3 h-8 rounded-[8px] text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
          >
            <RotateCcw size={12} />
            초기화
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 h-8 rounded-[8px] text-[12px] text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-muted)] transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 h-8 rounded-[8px] text-[12px] font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              <Check size={13} />
              적용
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
