import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser

logger = logging.getLogger(__name__)

_pw_instance = None
_browser: Browser | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pw_instance, _browser
    _pw_instance = await async_playwright().start()
    _browser = await _pw_instance.chromium.launch(
        args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    )
    yield
    if _browser:
        await _browser.close()
    if _pw_instance:
        await _pw_instance.stop()


app = FastAPI(lifespan=lifespan)


class CheckRequest(BaseModel):
    html: str


class Issue(BaseModel):
    component_id: str
    type: str
    message: str
    severity: str


class CheckResponse(BaseModel):
    issues: list[Issue]


@app.get("/health")
async def health():
    return {"status": "ok", "browser_ready": _browser is not None}


_CHECK_SCRIPT = """
() => {
    function getLuminance(r, g, b) {
        const c = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    function contrastRatio(l1, l2) {
        const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }

    function parseRgb(str) {
        const m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    }

    function isTransparent(colorStr) {
        return colorStr === 'transparent' ||
               colorStr === 'rgba(0, 0, 0, 0)' ||
               /rgba\\(\\d+,\\s*\\d+,\\s*\\d+,\\s*0\\)/.test(colorStr);
    }

    function effectiveBg(el) {
        let node = el;
        while (node && node.tagName !== 'HTML') {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && !isTransparent(bg)) return parseRgb(bg);
            node = node.parentElement;
        }
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const prev = el.style.visibility;
        el.style.visibility = 'hidden';
        const bgEl = document.elementFromPoint(cx, cy);
        el.style.visibility = prev;
        if (bgEl && bgEl !== el) {
            const bg = getComputedStyle(bgEl).backgroundColor;
            if (bg && !isTransparent(bg)) return parseRgb(bg);
        }
        return { r: 255, g: 255, b: 255 };
    }

    const TEXT_TAGS = new Set(['P','H1','H2','H3','H4','H5','H6','LI','SPAN']);
    const issues = [];

    const components = [...document.querySelectorAll('[data-component-id]')];

    components.forEach(el => {
        const cid = el.getAttribute('data-component-id');
        const tag = el.tagName;
        const text = el.innerText?.trim() || '';
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const isText = (TEXT_TAGS.has(tag) || (tag === 'DIV' && text.length > 0)) && text.length > 0;

        if (!isText) return;

        const fontSize = parseFloat(style.fontSize);

        // 1. 텍스트 대비
        const fg = parseRgb(style.color);
        const bg = effectiveBg(el);
        if (fg && bg) {
            const ratio = contrastRatio(
                getLuminance(fg.r, fg.g, fg.b),
                getLuminance(bg.r, bg.g, bg.b)
            );
            const bold = parseInt(style.fontWeight) >= 700;
            const large = fontSize >= 18 || (bold && fontSize >= 14);
            const threshold = large ? 3.0 : 4.5;
            if (ratio < threshold) {
                issues.push({
                    component_id: cid,
                    type: 'contrast',
                    message: `대비 ${ratio.toFixed(1)}:1 (WCAG AA ${threshold}:1 미달)`,
                    severity: 'error'
                });
            }
        }

        // 2. 텍스트 오버플로우
        const overH = el.scrollHeight - el.clientHeight;
        const overW = el.scrollWidth - el.clientWidth;
        if (overH > 5 || overW > 5) {
            const msg = overH >= overW
                ? `텍스트 하단 오버플로우 ${overH}px`
                : `텍스트 우측 오버플로우 ${overW}px`;
            issues.push({ component_id: cid, type: 'overflow', message: msg, severity: 'error' });
        }

        // 3. 줄 간격
        const lhStr = style.lineHeight;
        const lh = lhStr === 'normal' ? fontSize * 1.2 : parseFloat(lhStr);
        if (fontSize > 0 && lh / fontSize < 1.4) {
            issues.push({
                component_id: cid,
                type: 'line_height',
                message: `line-height ${(lh / fontSize).toFixed(2)} (1.4 미만)`,
                severity: 'warning'
            });
        }

        // 4. 겹침
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const prev = el.style.visibility;
        el.style.visibility = 'hidden';
        const top = document.elementFromPoint(cx, cy);
        el.style.visibility = prev;
        if (top && top !== el && !el.contains(top)) {
            const coverCid = top.closest('[data-component-id]')?.getAttribute('data-component-id');
            if (coverCid && coverCid !== cid) {
                issues.push({
                    component_id: cid,
                    type: 'overlap',
                    message: `중심점이 '${coverCid}' 컴포넌트에 가려짐`,
                    severity: 'error'
                });
            }
        }
    });

    return issues;
}
"""


@app.post("/check", response_model=CheckResponse)
async def check_slide(req: CheckRequest):
    if _browser is None:
        return CheckResponse(issues=[])
    context = await _browser.new_context(viewport={"width": 960, "height": 540})
    try:
        page = await context.new_page()
        await page.set_content(req.html, wait_until="domcontentloaded", timeout=10_000)
        raw = await page.evaluate(_CHECK_SCRIPT)
        issues = [Issue(**item) for item in (raw or [])]
        return CheckResponse(issues=issues)
    except Exception as e:
        logger.warning("check_slide error: %s", e)
        return CheckResponse(issues=[])
    finally:
        await context.close()
