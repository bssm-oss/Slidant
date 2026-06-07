const SLIDE_SAFE_CSS = `<style id="s-safe">*{box-sizing:border-box!important}html,body{margin:0!important;padding:0!important;width:960px!important;height:540px!important;overflow:hidden!important}.slide{overflow:hidden!important;width:960px!important;height:540px!important;position:relative!important}[data-component-id]{cursor:pointer!important}[data-component-id]:hover{outline:2px solid rgba(99,102,241,0.5)!important;outline-offset:2px!important}</style>`
const SLIDE_VIEWER_CSS = `<style id="s-safe">*{box-sizing:border-box!important}html,body{margin:0!important;padding:0!important;width:960px!important;height:540px!important;overflow:hidden!important}.slide{overflow:hidden!important;width:960px!important;height:540px!important;position:relative!important}</style>`

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
