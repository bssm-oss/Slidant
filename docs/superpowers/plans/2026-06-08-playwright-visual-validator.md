# Playwright Visual Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HTML 슬라이드 생성 후 텍스트 대비·오버플로우·줄간격·겹침을 실제 렌더링 기반으로 검출해 에이전트 retry를 강제한다.

**Architecture:** Playwright를 독립 사이드카 컨테이너(`playwright/`)로 분리. api는 httpx로 `POST /check` 호출. 결과를 기존 `validation_errors`에 append → `should_retry_html` 기존 로직 재사용. 편집 경로(`html_editor` → `html_validator` → **`visual_validator`** → `should_retry_html`)에만 적용. 생성 경로는 retry 메커니즘 없으므로 스코프 외.

**Tech Stack:** Playwright Python, FastAPI (playwright 서비스), httpx (api → playwright HTTP), LangGraph (노드 추가)

---

## File Map

| 상태 | 경로 | 역할 |
|------|------|------|
| NEW | `playwright/Dockerfile` | 공식 playwright 이미지 기반 컨테이너 |
| NEW | `playwright/requirements.txt` | playwright, fastapi, uvicorn |
| NEW | `playwright/main.py` | `/health` + `/check` 엔드포인트, 브라우저 풀 관리 |
| MODIFY | `api/app/core/config.py` | `PLAYWRIGHT_SERVICE_URL`, `VISUAL_VALIDATION_ENABLED` 추가 |
| MODIFY | `api/app/agent/nodes/validator.py` | `make_visual_validator()` 노드 추가 |
| MODIFY | `api/app/agent/graph.py` | `html_validator` → `visual_validator` → `should_retry_html` 배선 |
| MODIFY | `docker-compose.yml` | `playwright` 서비스 추가, api 환경변수 추가 |

---

## Task 1: Playwright 서비스 — 컨테이너 파일

**Files:**
- Create: `playwright/Dockerfile`
- Create: `playwright/requirements.txt`

- [ ] **Step 1: `playwright/requirements.txt` 작성**

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
playwright>=1.44.0
```

- [ ] **Step 2: `playwright/Dockerfile` 작성**

```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 3001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001"]
```

- [ ] **Step 3: 빌드 확인**

```bash
cd playwright && docker build -t slidant-playwright-test .
```

Expected: 빌드 성공, 오류 없음

- [ ] **Step 4: Commit**

```bash
git add playwright/
git commit -m "chore(playwright): add sidecar container files"
```

---

## Task 2: Playwright 서비스 — `/check` 엔드포인트

**Files:**
- Create: `playwright/main.py`

- [ ] **Step 1: FastAPI 앱 + 브라우저 lifespan 작성**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser

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
```

- [ ] **Step 2: 4가지 검사 JS 스크립트 상수 추가 (앱 파일 이어서 작성)**

```python
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
               /rgba\\(.*,\\s*0\\)/.test(colorStr);
    }

    function effectiveBg(el) {
        // DOM 탐색 먼저
        let node = el;
        while (node && node.tagName !== 'HTML') {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && !isTransparent(bg)) return parseRgb(bg);
            node = node.parentElement;
        }
        // position:absolute 겹침 — 일시적으로 숨기고 elementFromPoint 샘플링
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

        // 공통: font-size (forEach 스코프에서 한 번만 선언)
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

        // 4. 겹침 — 텍스트 중심점을 다른 요소가 덮고 있는지
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
```

- [ ] **Step 3: `/check` 엔드포인트 추가 (앱 파일 이어서 작성)**

```python
@app.post("/check", response_model=CheckResponse)
async def check_slide(req: CheckRequest):
    if _browser is None:
        return CheckResponse(issues=[])
    context = await _browser.new_context(viewport={"width": 960, "height": 540})
    page = await context.new_page()
    try:
        await page.set_content(req.html, wait_until="domcontentloaded", timeout=10_000)
        raw = await page.evaluate(_CHECK_SCRIPT)
        issues = [Issue(**item) for item in (raw or [])]
        return CheckResponse(issues=issues)
    except Exception:
        return CheckResponse(issues=[])
    finally:
        await context.close()
```

- [ ] **Step 4: 로컬에서 서비스 직접 테스트**

```bash
cd playwright && pip install -r requirements.txt && playwright install chromium
uvicorn main:app --port 3001 &
curl -s http://localhost:3001/health
# Expected: {"status":"ok","browser_ready":true}

curl -s -X POST http://localhost:3001/check \
  -H "Content-Type: application/json" \
  -d '{"html":"<style>.slide{width:960px;height:540px;position:relative}</style><div class=\"slide\"><div data-component-id=\"title\" style=\"position:absolute;left:80px;top:80px;color:#ffffff;background:transparent;font-size:48px\">제목</div></div>"}' | python3 -m json.tool
# Expected: {"issues":[{"component_id":"title","type":"contrast",...}]} 또는 [] (bg에 따라)
```

- [ ] **Step 5: Commit**

```bash
git add playwright/main.py
git commit -m "feat(playwright): add /check endpoint with 4 visual checks"
```

---

## Task 3: api — config + visual_validator 노드

**Files:**
- Modify: `api/app/core/config.py`
- Modify: `api/app/agent/nodes/validator.py`

- [ ] **Step 1: config.py에 두 필드 추가**

`api/app/core/config.py`의 `TAVILY_API_KEY` 줄 아래에 추가:

```python
    PLAYWRIGHT_SERVICE_URL: str = "http://playwright:3001"
    VISUAL_VALIDATION_ENABLED: bool = True
```

- [ ] **Step 2: validator.py에 `make_visual_validator` 추가**

`api/app/agent/nodes/validator.py` 파일 끝(`make_should_retry_legacy` 함수 바로 앞)에 추가:

```python
def make_visual_validator(_ctx: NodeContext):
    async def visual_validator_node(state: AgentState) -> AgentState:
        from app.core.config import settings
        import httpx

        if not settings.VISUAL_VALIDATION_ENABLED:
            return {}

        slides = state.get("html_slides", [])
        html_out = state.get("html_output", "")

        targets: list[tuple[str, str]] = []
        if html_out and "<div" in html_out:
            targets.append(("슬라이드", html_out))
        for s in slides:
            if isinstance(s, dict) and s.get("html"):
                targets.append((f"슬라이드 {s.get('index', 0) + 1}", s["html"]))

        if not targets:
            return {}

        new_issues: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                for label, html in targets:
                    resp = await client.post(
                        f"{settings.PLAYWRIGHT_SERVICE_URL}/check",
                        json={"html": html},
                    )
                    if resp.status_code == 200:
                        for item in resp.json().get("issues", []):
                            new_issues.append(
                                f"{label}/{item['component_id']}: [{item['type']}] {item['message']}"
                            )
        except Exception as e:
            logger.warning("  [visual_validator] playwright 서비스 오류 (스킵): %s", e)
            return {}

        if new_issues:
            logger.warning("  [visual_validator] %d개 시각 이슈: %s", len(new_issues), new_issues[:3])

        existing = state.get("validation_errors") or []
        return {"validation_errors": existing + new_issues}
    return visual_validator_node
```

- [ ] **Step 3: import 확인 — validator.py 상단 import 블록에 NodeContext 확인**

`from app.agent.context import NodeContext`가 이미 있는지 확인. 없으면 추가. (이미 있음 — `_ctx: NodeContext` 파라미터로 사용 중)

- [ ] **Step 4: Commit**

```bash
git add api/app/core/config.py api/app/agent/nodes/validator.py
git commit -m "feat(agent): add visual_validator node with playwright HTTP call"
```

---

## Task 4: graph.py — visual_validator 노드 배선

**Files:**
- Modify: `api/app/agent/graph.py`

현재 edit 경로:
```
html_editor → html_validator --should_retry_html--> {retry: retry_inc, done: ops_dispatcher}
```

변경 후:
```
html_editor → html_validator → visual_validator --should_retry_html--> {retry: retry_inc, done: ops_dispatcher}
```

- [ ] **Step 1: import 추가**

`api/app/agent/graph.py` 상단 import 블록에 `make_visual_validator` 추가:

```python
from app.agent.nodes.validator import (
    make_html_aggregator, make_html_validator, make_should_retry_html,
    make_formatter, make_patch_serializer, make_validator,
    make_visual_validator,  # 추가
)
```

- [ ] **Step 2: `_build_html_graph` 내 노드 등록 추가**

`graph.add_node("retry_inc", ...)` 줄 바로 아래에 추가:

```python
    graph.add_node("visual_validator", make_visual_validator(ctx))
```

- [ ] **Step 3: 엣지 변경**

기존:
```python
    graph.add_edge("html_editor",       "html_validator")
    graph.add_edge("component_deleter", "html_validator")
    graph.add_conditional_edges("html_validator", should_retry_html, {
        "retry": "retry_inc",
        "done":  "ops_dispatcher",
    })
```

변경:
```python
    graph.add_edge("html_editor",       "html_validator")
    graph.add_edge("component_deleter", "html_validator")
    graph.add_edge("html_validator",    "visual_validator")
    graph.add_conditional_edges("visual_validator", should_retry_html, {
        "retry": "retry_inc",
        "done":  "ops_dispatcher",
    })
```

- [ ] **Step 4: api 서버 기동 확인 (playwright 없이도 동작해야 함)**

```bash
cd api && VISUAL_VALIDATION_ENABLED=false uvicorn app.main:app --port 8000 &
curl -s http://localhost:8000/health || curl -s http://localhost:8000/api/v1/health
# Expected: 200 정상 응답
```

- [ ] **Step 5: Commit**

```bash
git add api/app/agent/graph.py
git commit -m "feat(agent): wire visual_validator into html graph pipeline"
```

---

## Task 5: docker-compose.yml 통합

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: playwright 서비스 추가**

`docker-compose.yml`의 `ui:` 서비스 블록 바로 위에 추가:

```yaml
  playwright:
    build: ./playwright
    container_name: slidant-playwright
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s
```

- [ ] **Step 2: api 서비스에 환경변수 추가**

`docker-compose.yml`의 `api:` → `environment:` 블록에 추가:

```yaml
      PLAYWRIGHT_SERVICE_URL: http://playwright:3001
      VISUAL_VALIDATION_ENABLED: "true"
```

- [ ] **Step 3: api가 playwright 뜬 후 시작하도록 depends_on 추가**

`api:` → `depends_on:` 블록에 추가:

```yaml
      playwright:
        condition: service_healthy
```

- [ ] **Step 4: 전체 스택 기동 테스트**

```bash
docker compose up --build -d
docker compose ps
# Expected: db, redis, api, playwright, ui 모두 Up
docker compose logs playwright --tail=20
# Expected: "Application startup complete" 포함
curl -s http://localhost:3001/health
# Expected: {"status":"ok","browser_ready":true}
```

- [ ] **Step 5: 에이전트 실제 동작 확인**

슬라이드 편집 요청 후 api 로그에서 visual_validator 동작 확인:

```bash
docker compose logs api --tail=50 | grep visual_validator
# 이슈 있으면: "[visual_validator] N개 시각 이슈: ..."
# 이슈 없으면: 로그 없음 (정상)
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(deploy): add playwright sidecar to docker-compose"
```
