import { create } from 'zustand'
import type { Presentation } from '@/shared/types'
import { fetchProjects, createProject, deleteProject, updateProject } from '@/shared/lib/projectApi'

interface DriveState {
  presentations: Presentation[]
  search: string
  loading: boolean
  filteredPresentations: () => Presentation[]
  setSearch: (s: string) => void
  loadProjects: () => Promise<void>
  createPresentation: () => Promise<string>
  deletePresentation: (id: string) => Promise<void>
  renamePresentation: (id: string, title: string) => Promise<void>
}

export const useDriveStore = create<DriveState>((set, get) => ({
  presentations: [],
  search: '',
  loading: false,

  filteredPresentations: () => {
    const { presentations, search } = get()
    if (!search.trim()) return presentations
    return presentations.filter((p) =>
      p.title.toLowerCase().includes(search.toLowerCase()),
    )
  },

  setSearch: (search) => set({ search }),

  loadProjects: async () => {
    set({ loading: true })
    try {
      const projects = await fetchProjects()
      set({ presentations: projects })
    } finally {
      set({ loading: false })
    }
  },

  createPresentation: async () => {
    const ppt = await createProject('제목 없는 프레젠테이션')
    set((s) => ({ presentations: [ppt, ...s.presentations] }))
    return ppt.id
  },

  deletePresentation: async (id) => {
    await deleteProject(id)
    set((s) => ({ presentations: s.presentations.filter((p) => p.id !== id) }))
  },

  renamePresentation: async (id, title) => {
    await updateProject(id, title)
    set((s) => ({
      presentations: s.presentations.map((p) => p.id === id ? { ...p, title } : p),
    }))
  },
}))
