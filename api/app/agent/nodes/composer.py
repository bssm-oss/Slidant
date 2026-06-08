"""slide_composer, html_editor 노드."""
from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import SLIDE_COMPOSER_PROMPT, HTML_EDITOR_PROMPT
from app.core.domain.layout_budget import compute_layout_budget
from app.core.domain.html_slide import HtmlSlide
from app.agent.utils import extract_json as _extract_json

logger = logging.getLogger("slidant.agent")


def make_slide_composer(ctx: NodeContext):
    async def slide_composer_node(state: AgentState) -> dict:
        from app.core.config import settings
        from app.agent.nodes.validator import _check_slide_html

        idx = state.get("slide_index", 0)
        spec = state.get("current_slide_spec") or (state.get("slide_specs") or [{}])[0]
        design_tokens = state.get("design_tokens", {})

        if ctx.on_event:
            ctx.on_event("node_start", f"✏️ 슬라이드 {idx+1} 생성 중...")

        search_ctx = ""
        if state.get("search_summary"):
            search_ctx = (
                "\n\n## 웹 검색 팩트시트 (모든 슬라이드 공통 — 수치/이름/날짜 그대로 사용, 변조 금지):\n"
                + state["search_summary"]
                + "\n"
            )

        all_specs = state.get("slide_specs", [])
        toc_ctx = ""
        if all_specs and len(all_specs) > 1:
            toc_lines = [f"{i+1}. {s.get('title','?')} [{s.get('layout','')}]"
                         for i, s in enumerate(all_specs)]
            toc_ctx = (
                f"\n\n## 전체 프레젠테이션 구성 ({len(all_specs)}장)\n"
                + "\n".join(toc_lines)
                + f"\n\n→ 현재 생성 중인 슬라이드: {idx+1}번 '{spec.get('title','')}'\n"
                "이 목차와 일치하는 내용으로 생성할 것."
            )

        layout_budget = compute_layout_budget(spec, all_specs)

        composer_system = SLIDE_COMPOSER_PROMPT
        if isinstance(ctx.gen_prompt, str):
            composer_system = ctx.gen_prompt

        html = ""
        title = spec.get("title", f"슬라이드 {idx+1}")
        local_issues: list[str] = []

        for attempt in range(2):  # layout 검증 retry는 1회만 (속도 우선)
            retry_ctx = ""
            if attempt > 0 and local_issues:
                retry_ctx = (
                    "\n\n## 이전 시도 검증 실패 — 아래 문제 반드시 수정:\n"
                    + "\n".join(f"- {e}" for e in local_issues[:8])
                )

            human_text = (
                f"Slide spec: {json.dumps(spec, ensure_ascii=False)}\n\n"
                f"Design tokens: {json.dumps(design_tokens, ensure_ascii=False)}\n\n"
                f"Slide index: {idx} (0-based)\n\n"
                f"Current slide HTML (for reference/edit):\n{state.get('slide_context', '(empty)')}"
                f"{toc_ctx}{search_ctx}"
                f"{layout_budget}"
                f"{retry_ctx}"
            )

            messages = [SystemMessage(content=composer_system), HumanMessage(content=human_text)]
            raw = ""
            try:
                async for chunk in ctx.llm.astream(messages):
                    raw_c = chunk.content if hasattr(chunk, "content") else ""
                    if isinstance(raw_c, list):
                        token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                    else:
                        token = str(raw_c) if raw_c else ""
                    raw += token
            except Exception as e:
                logger.warning("slide_composer[%d] attempt=%d failed: %s", idx, attempt, e)
                break

            parsed = _extract_json(raw)
            attempt_html = parsed.get("html", "") if isinstance(parsed, dict) else ""
            if not attempt_html:
                break  # LLM 빈 응답 — 이전 시도 HTML 보존

            html = HtmlSlide(html=attempt_html).clamp_positions().html
            local_issues = _check_slide_html(html, f"슬라이드{idx+1}")
            if not local_issues:
                break
            logger.warning(
                "  [slide_composer] idx=%d attempt=%d/%d issues=%d: %s",
                idx, attempt, settings.AGENT_MAX_RETRIES, len(local_issues), local_issues[:2],
            )

        if ctx.on_event:
            if html:
                ctx.on_event("slide_ready", json.dumps({"index": idx, "title": title, "html": html}, ensure_ascii=False))
                ctx.on_event("node_done", f"✅ {title[:15]} 완성")
                ctx.on_event("step_done", f"slide-{idx}")
            else:
                ctx.on_event("node_done", f"⚠️ {title[:15]} 생성 실패")
                ctx.on_event("step_failed", f"slide-{idx}")

        logger.info("  [slide_composer] idx=%d html=%d chars", idx, len(html))
        return {"html_slides": [{"index": idx, "title": title, "html": html}]}
    return slide_composer_node


def make_html_editor(ctx: NodeContext):
    async def html_editor_node(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "✏️ 슬라이드 수정 중...")

        existing_html = state.get("slide_context", "")
        if not existing_html:
            return {"mode": "create"}

        spec = (state.get("slide_specs") or [{}])[0]
        design_tokens = state.get("design_tokens", {})
        command = state.get("command", "")
        op = state.get("current_op", {})
        instruction = op.get("instruction", command)
        # component_edit op인 경우 컴포넌트 ID 힌트를 instruction에 포함
        if op.get("type") == "component_edit" and op.get("component_id"):
            instruction = f"[대상 컴포넌트 ID 힌트: {op['component_id']}] {instruction}"

        search_ctx = ""
        if state.get("search_summary"):
            search_ctx = (
                "\n\n## 웹 검색 팩트시트 (수치/이름/날짜 그대로 사용, 변조 금지):\n"
                + state["search_summary"]
                + "\n"
            )

        layout_budget = compute_layout_budget(spec)

        retry_ctx = ""
        validation_errors = state.get("validation_errors") or []
        if state.get("retry_count", 0) > 0 and validation_errors:
            retry_ctx = (
                "\n## 이전 시도 검증 실패 — 아래 문제 반드시 수정:\n"
                + "\n".join(f"- {e}" for e in validation_errors[:8]) + "\n"
            )

        human_text = (
            f"EXISTING SLIDE HTML:\n{existing_html}\n\n"
            f"MODIFICATION INSTRUCTION: {instruction}\n"
            f"Edit spec: {json.dumps(spec, ensure_ascii=False)}\n"
            f"Design tokens (참고용): {json.dumps(design_tokens, ensure_ascii=False)}\n"
            f"{search_ctx}"
            f"{layout_budget}"
            f"{retry_ctx}"
            "위 지시에 따라 기존 HTML을 수정하라. 내용은 보존, 요청된 것만 변경."
        )

        messages = [SystemMessage(content=HTML_EDITOR_PROMPT), HumanMessage(content=human_text)]
        raw = ""
        try:
            async for chunk in ctx.llm.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as e:
            logger.warning("html_editor failed: %s", e)

        parsed = _extract_json(raw)
        html = ""
        summary = ""
        if isinstance(parsed, dict):
            html = parsed.get("html", "")
            summary = parsed.get("summary", "슬라이드 수정 완료")
        if html:
            html = HtmlSlide(html=html).clamp_positions().html

        if ctx.on_event and html:
            step_id = state.get("current_op", {}).get("step_id", "edit-0-0")
            ctx.on_event("step_done", step_id)
            ctx.on_event("node_done", f"✅ {summary[:30]}")

        logger.info("[html_editor] html=%d chars", len(html))

        # 행위 메타데이터: 변경된 색상/컴포넌트 추출
        op = state.get("current_op", {})
        slide_idx = op.get("slide_index", 0)
        meta = _extract_change_meta(existing_html, html, slide_idx, op.get("instruction", command))

        ops_results = list(state.get("ops_results", []))
        ops_results.append(meta)
        return {"html_output": html, "result_summary": summary, "ops_results": ops_results}
    return html_editor_node


def _extract_change_meta(old_html: str, new_html: str, slide_index: int, instruction: str) -> dict:
    """두 HTML을 비교해 변경된 색상·컴포넌트 메타데이터 반환."""
    import re

    def extract_colors(html: str) -> set[str]:
        return set(re.findall(r'#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b', html))

    def extract_comp_ids(html: str) -> set[str]:
        return set(re.findall(r'data-component-id="([^"]+)"', html))

    old_colors = extract_colors(old_html)
    new_colors = extract_colors(new_html)
    added_colors = new_colors - old_colors
    removed_colors = old_colors - new_colors

    old_comps = extract_comp_ids(old_html)
    new_comps = extract_comp_ids(new_html)
    added_comps = new_comps - old_comps
    removed_comps = old_comps - new_comps

    return {
        "type": "edit",
        "slide_index": slide_index,
        "instruction": instruction,
        "colors_added": sorted(f"#{c}" for c in added_colors)[:6],
        "colors_removed": sorted(f"#{c}" for c in removed_colors)[:6],
        "components_added": sorted(added_comps),
        "components_removed": sorted(removed_comps),
    }
