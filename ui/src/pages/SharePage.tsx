import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { buildSlideSrc } from '@/shared/lib/slideHtml'

interface SlideData {
  id: string
  html_content: string | null
  title: string | null
}

interface PresentationData {
  id: string
  title: string
  slides: SlideData[]
}

const SLIDE_W = 960
const SLIDE_H = 540
const DISPLAY_W = 800
const SCALE = DISPLAY_W / SLIDE_W
const DISPLAY_H = SLIDE_H * SCALE

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PresentationData | null>(null)
  const [error, setError] = useState(false)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (!token) return
    fetch(`/api/v1/share/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then(setData)
      .catch(() => setError(true))
  }, [token])

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
        공유 링크가 만료되었거나 존재하지 않습니다.
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
        로딩 중...
      </div>
    )
  }

  const slide = data.slides?.[idx]
  const total = data.slides?.length ?? 0

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 gap-5 px-4 py-8">
      <h1 className="text-white text-xl font-semibold">{data.title}</h1>

      <div
        className="rounded-lg overflow-hidden shadow-2xl bg-gray-800"
        style={{ width: DISPLAY_W, height: DISPLAY_H }}
      >
        {slide?.html_content ? (
          <iframe
            srcDoc={buildSlideSrc(slide.html_content)}
            style={{
              width: SLIDE_W,
              height: SLIDE_H,
              border: 'none',
              transform: `scale(${SCALE})`,
              transformOrigin: 'top left',
              display: 'block',
            }}
            sandbox="allow-same-origin"
            title={`슬라이드 ${idx + 1}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
            빈 슬라이드
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-white text-sm">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="px-4 py-2 bg-white/10 rounded-lg disabled:opacity-30 hover:bg-white/20 transition-colors"
        >
          ◀
        </button>
        <span className="text-gray-300">
          {idx + 1} / {total}
        </span>
        <button
          onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
          disabled={idx >= total - 1}
          className="px-4 py-2 bg-white/10 rounded-lg disabled:opacity-30 hover:bg-white/20 transition-colors"
        >
          ▶
        </button>
      </div>
    </div>
  )
}
