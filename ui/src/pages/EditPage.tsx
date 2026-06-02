import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useEditorStore } from '@/features/editor/store/editorStore'
import { useSlideStore } from '@/features/editor/store/slideStore'
import { sseClient } from '@/shared/lib/sseClient'
import { AppShell } from '@/shared/components/layout'
import EditorTopbar from '@/features/editor/components/EditorTopbar'
import SlideListPanel from '@/features/editor/components/SlideListPanel'
import SlideCanvas from '@/features/editor/components/SlideCanvas'
import RightPanel from '@/features/editor/components/RightPanel'

export default function EditPage() {
  const { id } = useParams<{ id: string }>()
  const { loadPresentation, loadAgentLogs, loadAgents, loadChatHistory, connectWs } = useEditorStore()

  useEffect(() => {
    if (!id) return
    loadPresentation(id)
    loadAgentLogs(id)
    loadAgents(id)
    loadChatHistory(id)
    const unsubscribe = connectWs(id)
    return () => {
      unsubscribe()
      sseClient.disconnect()
    }
  }, [id])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      const { selectedComponentId, presentation, currentSlideIndex, deleteSlide, deleteComponent, setCurrentSlide } =
        useSlideStore.getState()
      const slideCount = presentation?.slides.length ?? 0

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedComponentId) {
          deleteComponent()
        } else {
          deleteSlide()
        }
      }

      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          if (currentSlideIndex < slideCount - 1) {
            e.preventDefault()
            setCurrentSlide(currentSlideIndex + 1)
          }
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          if (currentSlideIndex > 0) {
            e.preventDefault()
            setCurrentSlide(currentSlideIndex - 1)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden">
        <EditorTopbar />
        <div className="flex flex-1 overflow-hidden">
          <SlideListPanel />
          <SlideCanvas />
          <RightPanel />
        </div>
      </div>
    </AppShell>
  )
}
