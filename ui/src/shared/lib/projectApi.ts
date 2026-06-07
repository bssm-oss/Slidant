import { api } from './apiClient'
import type { Presentation, Slide } from '@/shared/types'

// API 응답 타입 (BE)
interface ProjectResponse {
  id: string
  owner_id: string
  title: string
  created_at: string
  updated_at: string
}

// BE Project → FE Presentation 변환
function toPresentation(p: ProjectResponse, slides: Slide[] = []): Presentation {
  return {
    id: p.id,
    title: p.title,
    slides,
    slideCount: (p as any).slide_count ?? slides.length,
    theme: (p as any).theme ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    ownerId: p.owner_id,
  }
}

export async function fetchProjects(): Promise<Presentation[]> {
  const projects = await api.get<ProjectResponse[]>('/projects')
  return projects.map((p) => toPresentation(p))
}

export async function createProject(title: string): Promise<Presentation> {
  const p = await api.post<ProjectResponse>('/projects', { title })
  return toPresentation(p)
}

export async function updateProject(id: string, title: string): Promise<Presentation> {
  const p = await api.patch<ProjectResponse>(`/projects/${id}`, { title })
  return toPresentation(p)
}

export async function deleteProject(id: string): Promise<void> {
  return api.delete(`/projects/${id}`)
}

export async function deleteSlide(projectId: string, slideId: string): Promise<void> {
  await api.delete<void>(`/projects/${projectId}/slides/${slideId}`)
}

export async function reorderSlides(projectId: string, slideIds: string[]): Promise<void> {
  await api.patch<void>(`/projects/${projectId}/slides/reorder`, { slide_ids: slideIds })
}

export interface SlideHistoryEntry {
  id: string
  slide_id: string
  version: number
  reason: string
  html_content?: string | null
  created_at: string
}

export async function fetchSlideHistory(projectId: string, slideId: string): Promise<SlideHistoryEntry[]> {
  return api.get(`/projects/${projectId}/slides/${slideId}/history`)
}

export async function restoreFromHistory(projectId: string, slideId: string, historyId: string): Promise<void> {
  await api.post<void>(`/projects/${projectId}/slides/${slideId}/history/${historyId}/restore`, {})
}

export async function fetchProjectWithSlides(id: string): Promise<Presentation> {
  const [project, slidesRaw] = await Promise.all([
    api.get<ProjectResponse>(`/projects/${id}`),
    api.get<any[]>(`/projects/${id}/slides`),
  ])

  const slides: Slide[] = slidesRaw.map((s) => ({
    id: s.id,
    order: s.order,
    html_content: s.html_content ?? null,
    components: (s.components ?? []).map((c: any) => ({
      id: c.id,
      type: c.type,
      position: c.properties?.position ?? { x: 0, y: 0 },
      size: c.properties?.size ?? { w: 400, h: 100 },
      props: c.properties,
      zIndex: c.order,
    })),
  }))

  return toPresentation(project, slides)
}
