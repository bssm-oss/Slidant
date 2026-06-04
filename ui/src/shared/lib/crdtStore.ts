/**
 * CRDT 클라이언트 — 사용자 간 실시간 슬라이드 동기화.
 *
 * 역할 분리:
 *   - crdtStore: 사용자 타이핑/편집 → Y.Doc 동기화 (자동 병합)
 *   - ConflictResolver: 에이전트 간 충돌 → Git-style 수동 선택
 */
import * as Y from 'yjs'
import { wsClient } from './wsClient'
import { useSlideStore } from '@/features/editor/store/slideStore'

class CrdtStore {
  doc = new Y.Doc()
  slides: Y.Map<Y.Map<any>>

  constructor() {
    this.slides = this.doc.getMap('slides')
    this._observe()
  }

  private _observe() {
    this.slides.observe(() => {
      this._syncToSlideStore()
    })

    this.slides.observeDeep((events: Y.YEvent<any>[]) => {
      for (const event of events) {
        if (event instanceof Y.YMapEvent && event.target !== this.slides) {
          // 슬라이드 내부 변경 (html_content, title)
          const slideId = this._findSlideId(event.target)
          if (slideId) {
            this._syncSlide(slideId)
          }
        }
      }
    })
  }

  private _findSlideId(target: Y.Map<any>): string | null {
    for (const [id, map] of this.slides.entries()) {
      if (map === target) return id
    }
    return null
  }

  private _syncToSlideStore() {
    const store = useSlideStore.getState()
    if (!store.presentation) return

    const updatedSlides = store.presentation.slides.map((slide) => {
      const ySlide = this.slides.get(slide.id)
      if (!ySlide) return slide
      const html = ySlide.get('html_content')?.toString() ?? slide.html_content
      const title = ySlide.get('title')?.toString() ?? slide.title
      if (html === slide.html_content && title === slide.title) return slide
      return { ...slide, html_content: html, title }
    })

    const changed = updatedSlides.some((s, i) => s !== store.presentation!.slides[i])
    if (changed) {
      useSlideStore.setState({
        presentation: { ...store.presentation, slides: updatedSlides },
      })
    }
  }

  private _syncSlide(slideId: string) {
    const store = useSlideStore.getState()
    if (!store.presentation) return

    const ySlide = this.slides.get(slideId)
    if (!ySlide) return

    const html = ySlide.get('html_content')?.toString()
    const title = ySlide.get('title')?.toString()

    useSlideStore.setState({
      presentation: {
        ...store.presentation,
        slides: store.presentation.slides.map((s) =>
          s.id === slideId
            ? { ...s, html_content: html ?? s.html_content, title: title ?? s.title }
            : s
        ),
      },
    })
  }

  /**
   * WebSocket binary → Y.Doc 적용.
   * wsClient에서 호출.
   */
  handleBinary(data: ArrayBuffer) {
    const bytes = new Uint8Array(data)
    if (bytes.length < 2) return

    const msgType = bytes[0]  // YMessageType.SYNC = 0
    if (msgType !== 0) return  // SYNC 메시지만 처리

    const innerType = bytes[1]  // YSyncMessageType

    if (innerType === 0) {
      // SYNC_STEP1: 서버 state vector → 내 상태로 reply
      const step2Content = Y.encodeStateAsUpdate(this.doc, bytes.slice(2))
      // SYNC_STEP2 메시지 구성: [0(SYNC)][1(STEP2)][length][data]
      const reply = this._buildSyncStep2(step2Content)
      wsClient.sendBinary(reply)
    } else if (innerType === 1 || innerType === 2) {
      // SYNC_STEP2 or UPDATE: Y.Doc에 적용
      try {
        Y.applyUpdate(this.doc, bytes.slice(2))
      } catch (e) {
        console.warn('[crdt] applyUpdate failed', e)
      }
    }
  }

  private _buildSyncStep2(update: Uint8Array): Uint8Array {
    // [SYNC=0][STEP2=1][varint_length][update_bytes]
    const lenBytes = this._encodeVarUint(update.length)
    const msg = new Uint8Array(2 + lenBytes.length + update.length)
    msg[0] = 0  // SYNC
    msg[1] = 1  // STEP2
    msg.set(lenBytes, 2)
    msg.set(update, 2 + lenBytes.length)
    return msg
  }

  private _encodeVarUint(num: number): Uint8Array {
    const res: number[] = []
    while (num > 127) {
      res.push(128 | (127 & num))
      num >>= 7
    }
    res.push(num)
    return new Uint8Array(res)
  }

  /**
   * 사용자가 슬라이드 HTML 직접 편집 시 Y.Doc 업데이트.
   * (향후 인라인 편집 기능 구현 시 사용)
   */
  setSlideHtml(slideId: string, html: string) {
    const ySlide = this.slides.get(slideId)
    if (!ySlide) return
    const text = ySlide.get('html_content') as Y.Text | undefined
    if (!text) return
    this.doc.transact(() => {
      text.delete(0, text.length)
      text.insert(0, html)
    })
  }

  /**
   * Presence: 현재 슬라이드 인덱스 전송.
   */
  updatePresence(currentSlide: number) {
    wsClient.sendPresence(currentSlide)
  }
}

export const crdtStore = new CrdtStore()

// wsClient binary 메시지 → crdtStore 연결
wsClient.onBinaryMessage((data) => {
  crdtStore.handleBinary(data)
})
