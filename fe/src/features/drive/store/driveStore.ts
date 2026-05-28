import { create } from 'zustand'
import type { Presentation } from '@/shared/types'
import { mockPresentations } from '@/shared/mock/presentations'

interface DriveState {
  presentations: Presentation[]
  search: string
  filteredPresentations: () => Presentation[]
  setSearch: (s: string) => void
  createPresentation: () => string
  deletePresentation: (id: string) => void
  renamePresentation: (id: string, title: string) => void
}

export const useDriveStore = create<DriveState>((set, get) => ({
  presentations: [...mockPresentations],
  search: '',

  filteredPresentations: () => {
    const { presentations, search } = get()
    if (!search.trim()) return presentations
    return presentations.filter((p) =>
      p.title.toLowerCase().includes(search.toLowerCase()),
    )
  },

  setSearch: (search) => set({ search }),

  createPresentation: () => {
    const id = `ppt-${Date.now()}`
    const newPpt: Presentation = {
      id,
      title: '제목 없는 프레젠테이션',
      slides: [{ id: `slide-${Date.now()}`, order: 0, components: [] }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: 'user-1',
    }
    set((s) => ({ presentations: [newPpt, ...s.presentations] }))
    return id
  },

  deletePresentation: (id) =>
    set((s) => ({ presentations: s.presentations.filter((p) => p.id !== id) })),

  renamePresentation: (id, title) =>
    set((s) => ({
      presentations: s.presentations.map((p) => p.id === id ? { ...p, title } : p),
    })),
}))
