"""html_aggregator, html_validator, formatter, validator(legacy), patch_serializer 노드."""
from __future__ import annotations

import logging

from bs4 import BeautifulSoup, Tag

from app.agent.context import NodeContext
from app.agent.state import AgentState, _RESET_SENTINEL

logger = logging.getLogger("slidant.agent")


def make_html_aggregator(_ctx: NodeContext):
    def html_aggregator_node(state: AgentState) -> AgentState:
        # html_slides는 Annotated[list, operator.add] — 이전 ops 결과가 누적될 수 있음
        # 인덱스 기준 dedup: 같은 index는 마지막 값만 유지
        all_slides = state.get("html_slides", [])
        deduped: dict[int, dict] = {}
        for s in all_slides:
            idx = s.get("index", 0)
            if s.get("html"):
                deduped[idx] = s
        valid = sorted(deduped.values(), key=lambda s: s.get("index", 0))

        # head-sentinel replace: 누적 없이 dedup된 valid로 교체
        result: dict = {"html_slides": [_RESET_SENTINEL, *valid]}

        if state.get("mode") == "edit" and valid:
            result["html_output"] = valid[0]["html"]
            result["result_summary"] = "슬라이드 수정 완료"
            return result

        # create 결과를 ops_results에 추가 (formatter의 summary 생성에 사용)
        ops_results = list(state.get("ops_results", []))
        ops_results.append({
            "type": "create",
            "count": len(valid),
            "titles": [s.get("title", f"슬라이드 {s.get('index',0)+1}") for s in valid],
        })
        result["ops_results"] = ops_results
        return result
    return html_aggregator_node


def _check_slide_html(html: str, label: str) -> list[str]:
    """BS4 정적 검사 — Playwright 없이 컴포넌트 style만으로 검증.

    렌더 실측(overflow, 가독성)은 Playwright가 정확하지만 api/에는 미설치(브라우저 바이너리
    필요). HtmlSlide가 이미 BeautifulSoup으로 컴포넌트를 파싱하므로 그 결과를 재사용해
    경계 초과 / 폰트 과소 / 빈 컴포넌트만 정적으로 잡아낸다.
    """
    from app.core.domain.html_slide import HtmlSlide, _CANVAS_H, _CANVAS_W, _parse_inline_style, _px

    issues: list[str] = []
    slide = HtmlSlide(html=html)
    components = slide.components
    if not components:
        return [f"{label}: data-component-id 요소 없음"]

    for cid, comp in components.items():
        soup = BeautifulSoup(comp["html"], "html.parser")
        el = next((c for c in soup.children if isinstance(c, Tag)), None)
        if el is None:
            continue
        props = _parse_inline_style(el.get("style", "") or "")
        if "absolute" not in props.get("position", ""):
            continue

        left, top = _px(props.get("left")), _px(props.get("top"))
        width, height = _px(props.get("width")), _px(props.get("height"))
        if left is not None and width is not None and (left + width) > _CANVAS_W + 1:
            issues.append(f"{label}/{cid}: 우측 경계 초과 (left {left:.0f} + width {width:.0f} = {left+width:.0f} > {_CANVAS_W})")
        if top is not None and height is not None and (top + height) > _CANVAS_H + 1:
            issues.append(f"{label}/{cid}: 하단 경계 초과 (top {top:.0f} + height {height:.0f} = {top+height:.0f} > {_CANVAS_H})")

        fs = _px(props.get("font-size"))
        if fs is not None and fs < 14:
            issues.append(f"{label}/{cid}: font-size {fs:.0f}px — 가독성 위해 14px 이상 권장")

        if el.name in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li") and not el.get_text(strip=True):
            issues.append(f"{label}/{cid}: 빈 텍스트 태그 (<{el.name}> 내용 없음)")

    return issues


def make_html_validator(_ctx: NodeContext):
    def html_validator_node(state: AgentState) -> AgentState:
        slides = state.get("html_slides", [])
        html_out = state.get("html_output", "")

        targets: list[tuple[str, str]] = []
        if html_out and "<div" in html_out:
            targets.append(("슬라이드", html_out))
        for s in slides:
            if isinstance(s, dict) and s.get("html"):
                targets.append((f"슬라이드 {s.get('index', 0) + 1}", s["html"]))

        if not targets:
            logger.warning("  [html_validator] 결과 없음")
            return {**state, "validation_errors": []}

        issues: list[str] = []
        for label, html in targets:
            issues.extend(_check_slide_html(html, label))

        if issues:
            logger.warning("  [html_validator] %d개 정적 검사 이슈: %s", len(issues), issues[:5])
        return {**state, "validation_errors": issues}
    return html_validator_node


def make_should_retry_html(_ctx: NodeContext):
    def should_retry_html(state: AgentState) -> str:
        from app.core.config import settings
        retry = state.get("retry_count", 0)
        slides = state.get("html_slides", [])
        html_out = state.get("html_output", "")
        has_output = bool(slides) or bool(html_out)
        # ops_queue 비어있으면 retry해도 ops_dispatcher가 "review"로 가므로 무한루프
        # → 출력 없어도 ops_queue 없으면 즉시 done
        if not state.get("ops_queue") and not has_output:
            return "done"
        if not has_output and retry < settings.AGENT_MAX_RETRIES:
            return "retry"
        return "done"
    return should_retry_html


def make_formatter(ctx: NodeContext):
    async def formatter_node(state: AgentState) -> AgentState:
        ops_results = state.get("ops_results", [])
        patches = state.get("result_patches", [])

        # HTML 모드: ops_results 또는 html_slides → LLM 자연어 변환
        html_slides_present = bool(state.get("html_slides"))
        if ops_results or html_slides_present:
            summary = await _lineage_to_summary(ctx, state.get("command", ""), ops_results, state)
            return {"result_summary": summary}

        # 레거시 JSON patch 모드
        if not patches:
            html_slides = state.get("html_slides", [])
            html_out = state.get("html_output", "")
            if html_slides or html_out:
                cnt = len(html_slides) if html_slides else 1
                return {"result_summary": f"{cnt}장 슬라이드 생성 완료"}
            return {}

        llm_summary = state.get("result_summary", "")
        if llm_summary:
            return {"result_summary": llm_summary.strip()}

        adds = sum(1 for op in patches if op.get("op") == "add" and op.get("path") == "/-")
        replaces = sum(1 for op in patches if op.get("op") == "replace")
        removes = sum(1 for op in patches if op.get("op") == "remove")
        slide_adds = sum(1 for op in patches if op.get("op") == "add"
                         and op.get("path", "").startswith("/slides/"))
        stats_parts = []
        if adds:       stats_parts.append(f"컴포넌트 {adds}개 추가")
        if replaces:   stats_parts.append(f"{replaces}개 수정")
        if removes:    stats_parts.append(f"{removes}개 삭제")
        if slide_adds: stats_parts.append(f"슬라이드 {slide_adds}장 추가")
        return {"result_summary": "、".join(stats_parts) or "변경 없음"}
    return formatter_node


async def _lineage_to_summary(ctx: NodeContext, command: str, ops_results: list, state: dict) -> str:
    """ops_results 행위 리니지 → LLM 자연어 요약."""
    import json
    from langchain_core.messages import HumanMessage, SystemMessage

    # ops_results를 사람이 읽기 쉬운 형태로 직렬화
    lines = []
    for r in ops_results:
        t = r.get("type", "")
        raw_idx = r.get("slide_index", 0)
        try:
            idx_label = str(int(raw_idx) + 1)
        except (TypeError, ValueError):
            idx_label = str(raw_idx)
        if t == "edit":
            colors = r.get("colors_added", [])
            instr = r.get("instruction", "")
            lines.append(f"- 슬라이드 {idx_label} 수정: {instr}"
                         + (f" | 적용 색상: {', '.join(colors[:4])}" if colors else ""))
        elif t == "component_edit":
            lines.append(f"- 슬라이드 {idx_label} 컴포넌트 [{r.get('component_id','')}] 수정")
        elif t == "component_delete":
            lines.append(f"- 슬라이드 {idx_label} 컴포넌트 [{r.get('component_id','')}] 삭제")
        elif t == "delete":
            lines.append(f"- 슬라이드 {idx_label} 삭제")
        elif t == "create":
            count = r.get("count", 0)
            titles = r.get("titles", [])
            titles_str = ", ".join(f"'{t}'" for t in titles[:5])
            if len(titles) > 5:
                titles_str += f" 외 {len(titles)-5}장"
            lines.append(f"- {count}장 슬라이드 생성: {titles_str}")

    if not lines:
        return state.get("result_summary", "작업 완료")

    human_text = (
        f"사용자 요청: {command}\n\n"
        f"실행된 작업 목록:\n" + "\n".join(lines) +
        "\n\n위 작업을 1-2문장 한국어로 자연스럽게 요약해라."
        " 생성된 슬라이드 수와 주요 내용을 포함할 것."
        " 예: '영도구청장 선거 관련 10장 PPT 생성 완료 (선거개요, 후보자프로필, 개표현황 등)'"
        "\n요약만 출력. 다른 말 없이."
    )

    raw = ""
    try:
        async for chunk in ctx.llm_plain.astream([
            SystemMessage(content="You are a concise Korean summarizer for slide editing actions."),
            HumanMessage(content=human_text),
        ]):
            raw_c = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw_c, list):
                token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
            else:
                token = str(raw_c) if raw_c else ""
            raw += token
    except Exception as e:
        logger.warning("lineage_to_summary failed: %s", e)
        return "\n".join(lines)

    return raw.strip() or "\n".join(lines)


# ── legacy (JSON patch) 노드 ──────────────────────────────────────────────────

def make_patch_serializer(_ctx: NodeContext):
    def patch_serializer_node(state: AgentState) -> AgentState:
        ops = state.get("component_specs", [])
        logger.info("  [patch_serializer] ops=%d", len(ops))
        return {**state, "result_patches": ops}
    return patch_serializer_node


def make_validator(ctx: NodeContext):
    def validator_node(state: AgentState) -> AgentState:
        patches = state.get("result_patches", [])
        valid = [
            op for op in patches
            if isinstance(op, dict) and op.get("op") in ("add", "replace", "remove") and "path" in op
        ]
        invalid = len(patches) - len(valid)
        if invalid:
            logger.warning("  [validator] %d개 무효 op 제거", invalid)

        if ctx.slide_scope_locked:
            before = len(valid)
            valid = [op for op in valid if not op.get("path", "").startswith("/slides/")]
            removed = before - len(valid)
            if removed:
                logger.info("  [validator] slide_scope_locked: /slides/ op %d개 제거", removed)

        logger.info("  [validator] valid ops=%d  retry=%d", len(valid), state.get("retry_count", 0))
        return {**state, "result_patches": valid}
    return validator_node


def make_should_retry_legacy(_ctx: NodeContext):
    def should_retry(state: AgentState) -> str:
        from app.core.config import settings
        patches = state.get("result_patches", [])
        retry = state.get("retry_count", 0)
        if not patches and retry < settings.AGENT_MAX_RETRIES:
            return "retry"
        return "done"
    return should_retry
