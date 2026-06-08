import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PresentationMode from '@/features/editor/components/PresentationMode'
import type { Slide } from '@/shared/types'

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

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PresentationData | null>(null)
  const [error, setError] = useState(false)

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

  const slides: Slide[] = data.slides.map((s, i) => ({
    id: s.id,
    order: i,
    title: s.title ?? undefined,
    components: [],
    html_content: s.html_content,
  }))

  return (
    <PresentationMode
      slides={slides}
      startIndex={0}
      onClose={() => window.history.back()}
    />
  )
}
