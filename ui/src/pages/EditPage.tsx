import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEditorStore } from '@/features/editor/store/editorStore'
import { useSlideStore } from '@/features/editor/store/slideStore'
import { useSessionStore } from '@/features/editor/store/sessionStore'
import { useAgentStore } from '@/features/editor/store/agentStore'
import { wsClient } from '@/shared/lib/wsClient'
import { crdtStore } from '@/shared/lib/crdtStore'
import { AppShell } from '@/shared/components/layout'
import EditorTopbar from '@/features/editor/components/EditorTopbar'
import SlideListPanel from '@/features/editor/components/SlideListPanel'
import SlideCanvas from '@/features/editor/components/SlideCanvas'
import RightPanel from '@/features/editor/components/RightPanel'
import PresentationMode from '@/features/editor/components/PresentationMode'
import ShareModal from '@/features/editor/components/ShareModal'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { fetchSlideHistory, restoreFromHistory } from '@/shared/lib/projectApi'

export default function EditPage() {
  const { id } = useParams<{ id: string }>()
  const { loadPresentation, loadAgentLogs, loadAgents, loadChatHistory, connectWs } = useEditorStore()
  const { presentation, presentationError, currentSlideIndex } = useSlideStore()

  useEffect(() => {
    if (!id) return

    const initialPrompt = localStorage.getItem(`slidant_initial_prompt_${id}`)
    if (initialPrompt) localStorage.removeItem(`slidant_initial_prompt_${id}`)

    ;(async () => {
      // 병렬 로드 후 순서 보장
      await Promise.all([
        loadPresentation(id),
        loadAgents(id),
        loadAgentLogs(id),
        (async () => {
          const { loadSessions, createSession } = useSessionStore.getState()
          await loadSessions(id)
          const state = useSessionStore.getState()
          const mySessionCount = state.sessions.filter(s => s.user_id === state.currentUserId).length
          if (mySessionCount === 0) {
            await createSession(id, '기본 세션')
          }
        })(),
      ])
      await loadChatHistory(id)

      // 모든 초기 데이터 로드 완료 후 초기 프롬프트 전송
      if (initialPrompt) {
        const { sendMessage, agents } = useAgentStore.getState()
        const { presentation } = useSlideStore.getState()
        if (agents.length && presentation?.slides.length) {
          sendMessage(initialPrompt).catch(() => {})
        }
      }
    })()

    const unsubscribe = connectWs(id)
    return () => {
      unsubscribe()
      wsClient.disconnect()
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

  // presence: 슬라이드 이동 시 전송
  useEffect(() => {
    crdtStore.updatePresence(currentSlideIndex)
  }, [currentSlideIndex])

  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(320)
  const [presenting, setPresenting] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  // historyOffset: 0 = 현재, 1 = 1단계 전, ... (undo 할수록 증가)
  const [historyOffset, setHistoryOffset] = useState(0)

  const handlePresent = () => setPresenting(true)

  const handleUndo = async () => {
    const slide = presentation?.slides[currentSlideIndex]
    if (!id || !slide) return
    try {
      const histories = await fetchSlideHistory(id, slide.id)
      const target = histories[historyOffset]
      if (!target) return
      await restoreFromHistory(id, slide.id, target.id)
      setHistoryOffset((o) => o + 1)
      await useSlideStore.getState().loadPresentation(id)
    } catch {
      // silent fail — history might be empty
    }
  }

  const handleRedo = async () => {
    if (historyOffset <= 0) return
    const slide = presentation?.slides[currentSlideIndex]
    if (!id || !slide) return
    try {
      const histories = await fetchSlideHistory(id, slide.id)
      const newOffset = historyOffset - 2
      const target = newOffset >= 0 ? histories[newOffset] : undefined
      if (target) {
        await restoreFromHistory(id, slide.id, target.id)
      }
      setHistoryOffset((o) => Math.max(0, o - 1))
      await useSlideStore.getState().loadPresentation(id)
    } catch {
      // silent fail
    }
  }

  const handleShare = () => setShowShareModal(true)

  const handleExport = () => {
    const exportSlides = presentation?.slides ?? []
    const printHtml = `<!DOCTYPE html><html><head>
<style>
  @page { size: 960px 540px; margin: 0; }
  body { margin: 0; padding: 0; }
  .slide-page { width: 960px; height: 540px; overflow: hidden; page-break-after: always; }
</style></head><body>
${exportSlides.map(s => s.html_content ? `<div class="slide-page">${s.html_content}</div>` : '').filter(Boolean).join('')}
</body></html>`
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(printHtml)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 500)
  }

  const slides = presentation?.slides ?? []

  if (presentationError) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-screen gap-4 text-center px-6">
          <p className="text-[var(--text-muted)] text-sm">{presentationError}</p>
          <a href="/drive" className="text-[var(--accent)] text-sm hover:underline">드라이브로 돌아가기</a>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      {presenting && (
        <PresentationMode
          slides={slides}
          startIndex={currentSlideIndex}
          onClose={() => setPresenting(false)}
        />
      )}
      {showShareModal && id && (
        <ShareModal projectId={id} initialShareToken={presentation?.shareToken} onClose={() => setShowShareModal(false)} />
      )}
      <div className="flex flex-col h-screen overflow-hidden">
        <EditorTopbar
          onPresent={handlePresent}
          onExport={handleExport}
          onShare={handleShare}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={true}
          canRedo={historyOffset > 0}
        />
        <div className="flex flex-1 overflow-hidden relative">
          {/* 좌측 슬라이드 패널 */}
          <div className={`transition-all duration-200 shrink-0 ${leftOpen ? 'w-52' : 'w-0'} overflow-hidden`}>
            <SlideListPanel />
          </div>

          {/* 좌측 토글 버튼 */}
          <button
            onClick={() => setLeftOpen((v) => !v)}
            className="absolute left-0 bottom-4 z-20 flex items-center justify-center w-5 h-10 bg-white border border-[var(--border)] border-l-0 rounded-r-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-all shadow-sm"
            style={{ left: leftOpen ? '208px' : '0px' }}
            title={leftOpen ? '슬라이드 패널 닫기' : '슬라이드 패널 열기'}
          >
            {leftOpen ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
          </button>

          <SlideCanvas />

          {/* 우측 토글 버튼 */}
          <button
            onClick={() => setRightOpen((v) => !v)}
            className="absolute right-0 bottom-4 z-20 flex items-center justify-center w-5 h-10 bg-white border border-[var(--border)] border-r-0 rounded-l-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-all shadow-sm"
            style={{ right: rightOpen ? `${rightPanelWidth}px` : '0px' }}
            title={rightOpen ? '채팅 패널 닫기' : '채팅 패널 열기'}
          >
            {rightOpen ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
          </button>

          {/* 우측 채팅 패널 */}
          <div
            className="transition-[width] duration-200 shrink-0 overflow-hidden"
            style={{ width: rightOpen ? rightPanelWidth : 0 }}
          >
            <RightPanel onWidthChange={setRightPanelWidth} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
