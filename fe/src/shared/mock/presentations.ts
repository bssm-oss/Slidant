import type { Presentation } from '@/shared/types'

export const mockPresentations: Presentation[] = [
  {
    id: 'ppt-1',
    title: 'Q4 사업 전략 발표',
    slides: [
      {
        id: 'slide-1',
        order: 0,
        components: [
          {
            id: 'comp-1',
            type: 'text',
            position: { x: 80, y: 120 },
            size: { w: 760, h: 80 },
            props: { content: 'Q4 사업 전략', fontSize: 48, fontWeight: 700, color: '#F1F5F9', align: 'center' },
            zIndex: 1,
          },
          {
            id: 'comp-2',
            type: 'text',
            position: { x: 200, y: 240 },
            size: { w: 520, h: 40 },
            props: { content: '2024년 4분기 성장 로드맵', fontSize: 20, color: '#94A3B8', align: 'center' },
            zIndex: 2,
          },
        ],
      },
      {
        id: 'slide-2',
        order: 1,
        components: [
          {
            id: 'comp-3',
            type: 'text',
            position: { x: 80, y: 60 },
            size: { w: 400, h: 60 },
            props: { content: '핵심 지표', fontSize: 32, fontWeight: 700, color: '#F1F5F9' },
            zIndex: 1,
          },
        ],
      },
    ],
    createdAt: '2024-10-01T09:00:00Z',
    updatedAt: '2024-10-15T14:30:00Z',
    ownerId: 'user-1',
  },
  {
    id: 'ppt-2',
    title: '신제품 런칭 발표',
    slides: [
      {
        id: 'slide-3',
        order: 0,
        components: [
          {
            id: 'comp-4',
            type: 'text',
            position: { x: 80, y: 160 },
            size: { w: 760, h: 80 },
            props: { content: '신제품 런칭', fontSize: 48, fontWeight: 700, color: '#F1F5F9', align: 'center' },
            zIndex: 1,
          },
        ],
      },
    ],
    createdAt: '2024-10-05T11:00:00Z',
    updatedAt: '2024-10-20T09:15:00Z',
    ownerId: 'user-1',
  },
  {
    id: 'ppt-3',
    title: '팀 온보딩 가이드',
    slides: [
      {
        id: 'slide-4',
        order: 0,
        components: [],
      },
    ],
    createdAt: '2024-09-20T08:00:00Z',
    updatedAt: '2024-10-10T16:00:00Z',
    ownerId: 'user-1',
  },
  {
    id: 'ppt-4',
    title: '투자자 데크',
    slides: [
      {
        id: 'slide-5',
        order: 0,
        components: [],
      },
    ],
    createdAt: '2024-10-12T13:00:00Z',
    updatedAt: '2024-10-22T11:00:00Z',
    ownerId: 'user-1',
  },
]

export const getMockPresentation = (id: string) =>
  mockPresentations.find((p) => p.id === id)
