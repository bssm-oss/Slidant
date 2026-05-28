import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useEditorStore } from '@/features/editor/store/editorStore'
import { AppShell } from '@/shared/components/layout'
import EditorTopbar from '@/features/editor/components/EditorTopbar'
import LayerSidebar from '@/features/editor/components/LayerSidebar'
import SlideCanvas from '@/features/editor/components/SlideCanvas'
import ThumbnailBar from '@/features/editor/components/ThumbnailBar'
import RightPanel from '@/features/editor/components/RightPanel'
import CommandPalette from '@/features/editor/components/CommandPalette'

export default function EditPage() {
  const { id } = useParams<{ id: string }>()
  const loadPresentation = useEditorStore((s) => s.loadPresentation)

  useEffect(() => {
    loadPresentation(id ?? 'ppt-1')
  }, [id, loadPresentation])

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden">
        <EditorTopbar />

        <div className="flex flex-1 overflow-hidden">
          <LayerSidebar />

          <div className="flex flex-col flex-1 overflow-hidden">
            <SlideCanvas />
            <ThumbnailBar />
          </div>

          <RightPanel />
        </div>
      </div>

      <CommandPalette />
    </AppShell>
  )
}
