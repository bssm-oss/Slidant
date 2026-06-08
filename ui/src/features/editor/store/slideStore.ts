import { create } from 'zustand'
import type { Presentation, Slide } from '@/shared/types'
import { api } from '@/shared/lib/apiClient'
import { fetchProjectWithSlides, deleteSlide as apiDeleteSlide, reorderSlides as apiReorderSlides } from '@/shared/lib/projectApi'

interface SlideState {
  presentation: Presentation | null
  presentationError: string | null
  currentSlideIndex: number
  selectedComponentId: string | null
  isTitleEditing: boolean

  loadPresentation: (id: string) => Promise<void>
  setCurrentSlide: (index: number) => void
  selectComponent: (id: string | null) => void
  setTitleEditing: (v: boolean) => void
  updateTitle: (title: string) => void
  saveTitle: (title: string) => Promise<void>
  addSlide: () => Promise<void>
  deleteSlide: (index?: number) => Promise<void>
  duplicateSlide: (index?: number) => Promise<void>
  reorderSlides: (oldIndex: number, newIndex: number) => Promise<void>
  deleteComponent: (componentId?: string) => Promise<void>
}

export const useSlideStore = create<SlideState>((set, get) => ({
  presentation: null,
  presentationError: null,
  currentSlideIndex: 0,
  selectedComponentId: null,
  isTitleEditing: false,

  loadPresentation: async (id) => {
    set({ presentationError: null })
    try {
      const ppt = await fetchProjectWithSlides(id)
      set({ presentation: ppt })
    } catch (e: any) {
      console.error('loadPresentation failed', e)
      set({ presentationError: e?.message ?? '프로젝트를 불러올 수 없습니다.' })
    }
  },

  setCurrentSlide: (index) => set({ currentSlideIndex: index, selectedComponentId: null }),
  selectComponent: (id) => set({ selectedComponentId: id }),
  setTitleEditing: (v) => set({ isTitleEditing: v }),

  updateTitle: (title) => set((s) => ({
    presentation: s.presentation ? { ...s.presentation, title } : null,
  })),

  saveTitle: async (title) => {
    const ppt = get().presentation
    if (!ppt) return
    try {
      const { updateProject } = await import('@/shared/lib/projectApi')
      await updateProject(ppt.id, title)
      set((s) => ({ presentation: s.presentation ? { ...s.presentation, title } : null }))
    } catch (e) {
      console.error('saveTitle failed', e)
      throw e
    }
  },

  addSlide: async () => {
    const ppt = get().presentation
    if (!ppt) return
    try {
      const res = await api.post<{ id: string; order: number; title: string | null }>(`/projects/${ppt.id}/slides`, {})
      const newSlide: Slide = { id: res.id, order: res.order, components: [] }
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: [...s.presentation.slides, newSlide] } : null,
        currentSlideIndex: (s.presentation?.slides.length ?? 0),
      }))
    } catch (e) {
      console.error('addSlide failed', e)
    }
  },

  deleteSlide: async (index) => {
    const ppt = get().presentation
    if (!ppt || ppt.slides.length <= 1) return
    const idx = index ?? get().currentSlideIndex
    const slide = ppt.slides[idx]
    const newSlides = ppt.slides.filter((_, i) => i !== idx)
    const newIndex = Math.min(idx, newSlides.length - 1)
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides: newSlides } : null,
      currentSlideIndex: newIndex,
      selectedComponentId: null,
    }))
    try {
      await apiDeleteSlide(ppt.id, slide.id)
    } catch (e) {
      console.error('deleteSlide failed', e)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: ppt.slides } : null,
        currentSlideIndex: idx,
      }))
    }
  },

  duplicateSlide: async (index) => {
    const ppt = get().presentation
    if (!ppt) return
    const idx = index ?? get().currentSlideIndex
    const sourceSlide = ppt.slides[idx]
    try {
      const newSlideRes = await api.post<{ id: string; order: number }>(`/projects/${ppt.id}/slides`, {})
      const copiedComps = await Promise.all(
        sourceSlide.components.map((comp) =>
          api.post<any>(`/projects/${ppt.id}/slides/${newSlideRes.id}/components`, {
            type: comp.type,
            properties: comp.props,
            order: comp.zIndex,
          })
        )
      )
      const newSlide: Slide = {
        id: newSlideRes.id,
        order: newSlideRes.order,
        components: copiedComps.map((c: any) => ({
          id: c.id,
          type: c.type,
          position: c.properties?.position ?? { x: 0, y: 0 },
          size: c.properties?.size ?? { w: 400, h: 100 },
          props: c.properties,
          zIndex: c.order ?? 0,
        })),
      }
      const slides = [...ppt.slides]
      slides.splice(idx + 1, 0, newSlide)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides } : null,
        currentSlideIndex: idx + 1,
      }))
      await apiReorderSlides(ppt.id, slides.map((s) => s.id))
    } catch (e) {
      console.error('duplicateSlide failed', e)
    }
  },

  reorderSlides: async (oldIndex, newIndex) => {
    const ppt = get().presentation
    if (!ppt || oldIndex === newIndex) return
    const slides = [...ppt.slides]
    const [moved] = slides.splice(oldIndex, 1)
    slides.splice(newIndex, 0, moved)
    const currentIdx = get().currentSlideIndex
    const newCurrentIdx =
      currentIdx === oldIndex ? newIndex
      : currentIdx > oldIndex && currentIdx <= newIndex ? currentIdx - 1
      : currentIdx < oldIndex && currentIdx >= newIndex ? currentIdx + 1
      : currentIdx
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides } : null,
      currentSlideIndex: newCurrentIdx,
    }))
    try {
      await apiReorderSlides(ppt.id, slides.map((s) => s.id))
    } catch (e) {
      console.error('reorderSlides failed', e)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: ppt.slides } : null,
        currentSlideIndex: currentIdx,
      }))
    }
  },

  deleteComponent: async (componentId) => {
    const { presentation, currentSlideIndex, selectedComponentId } = get()
    const targetId = componentId ?? selectedComponentId
    if (!targetId || !presentation) return
    const slide = presentation.slides[currentSlideIndex]
    if (!slide) return

    set((s) => ({
      selectedComponentId: null,
      presentation: s.presentation ? {
        ...s.presentation,
        slides: s.presentation.slides.map((sl, i) =>
          i === currentSlideIndex
            ? { ...sl, components: sl.components.filter((c) => c.id !== targetId) }
            : sl
        ),
      } : null,
    }))

    try {
      await api.delete(`/projects/${presentation.id}/slides/${slide.id}/components/${targetId}`)
    } catch (e) {
      console.error('deleteComponent failed', e)
      get().loadPresentation(presentation.id)
    }
  },
}))
