const SLIDE_SAFE_CSS = `<style id="s-safe">*{box-sizing:border-box!important}html,body{margin:0!important;padding:0!important;width:960px!important;height:540px!important;overflow:hidden!important}.slide{overflow:hidden!important;width:960px!important;height:540px!important;position:relative!important}[data-component-id]{cursor:pointer!important}[data-component-id]:hover{outline:2px solid rgba(99,102,241,0.5)!important;outline-offset:2px!important}</style>`
const SLIDE_VIEWER_CSS = `<style id="s-safe">*{box-sizing:border-box!important}html,body{margin:0!important;padding:0!important;width:960px!important;height:540px!important;overflow:hidden!important}.slide{overflow:hidden!important;width:960px!important;height:540px!important;position:relative!important}</style>`

export function getComponentIds(html: string): Set<string> {
  if (!html || typeof document === 'undefined') return new Set()
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const ids = new Set<string>()
    doc.querySelectorAll('[data-component-id]').forEach((el) => {
      const id = el.getAttribute('data-component-id')
      if (id) ids.add(id)
    })
    return ids
  } catch { return new Set() }
}

function canonicalizeEl(el: Element): string {
  const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ')
  const tag = el.tagName.toLowerCase()
  const children = [...el.childNodes].map((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) return canonicalizeEl(node as Element)
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    return ''
  }).join('')
  return `<${tag} ${attrs}>${children}</${tag}>`
}

export function extractComponentHtml(html: string, id: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const el = doc.querySelector(`[data-component-id="${id}"]`)
    return el ? canonicalizeEl(el) : null
  } catch { return null }
}

/** 두 HTML 사이에서 추가/삭제/수정된 모든 component-id 반환 */
export function computeChangedComponentIds(baseHtml: string, proposalHtml: string): Set<string> {
  const baseIds = getComponentIds(baseHtml)
  const proposalIds = getComponentIds(proposalHtml)
  const changed = new Set<string>()
  proposalIds.forEach((id) => { if (!baseIds.has(id)) changed.add(id) })
  baseIds.forEach((id) => {
    if (!proposalIds.has(id)) {
      changed.add(id)
    } else if (extractComponentHtml(baseHtml, id) !== extractComponentHtml(proposalHtml, id)) {
      changed.add(id)
    }
  })
  return changed
}

export function buildSlideSrc(html: string, isViewer = false): string {
  const safeStyle = isViewer ? SLIDE_VIEWER_CSS : SLIDE_SAFE_CSS
  const trimmed = html.trimStart()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    const headClose = html.indexOf('</head>')
    if (headClose !== -1) {
      return html.slice(0, headClose) + safeStyle + html.slice(headClose)
    }
    return safeStyle + html
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${safeStyle}</head><body>${html}</body></html>`
}
