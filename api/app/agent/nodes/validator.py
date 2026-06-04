"""html_aggregator, html_validator, formatter, validator(legacy), patch_serializer 노드."""
from __future__ import annotations

import logging

from app.agent.context import NodeContext
from app.agent.state import AgentState

logger = logging.getLogger("slidant.agent")


def make_html_aggregator(_ctx: NodeContext):
    def html_aggregator_node(state: AgentState) -> AgentState:
        # html_slides는 Annotated[list, operator.add] — 이전 ops 결과가 누적될 수 있음
        # 인덱스 기준 dedup: 같은 index는 마지막 값만 유지
        all_slides = state.get("html_slides", [])
        deduped: dict[int, dict] = {}
        for s in all_slides:
            idx = s.get("index", 0)
            if s.get("html"):  # html 있는 것만
                deduped[idx] = s
        valid = sorted(deduped.values(), key=lambda s: s.get("index", 0))

        if state.get("mode") == "edit" and valid:
            return {**state, "html_slides": valid, "html_output": valid[0]["html"],
                    "result_summary": "슬라이드 수정 완료"}
        summary = f"{len(valid)}장 슬라이드 생성 완료"
        return {**state, "html_slides": valid, "result_summary": summary}
    return html_aggregator_node


def make_html_validator(_ctx: NodeContext):
    def html_validator_node(state: AgentState) -> AgentState:
        slides = state.get("html_slides", [])
        html_out = state.get("html_output", "")
        valid = bool(slides) or (bool(html_out) and "<div" in html_out)
        if not valid:
            logger.warning("  [html_validator] 결과 없음")
        return state
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

        # HTML 모드: ops_results 행위 리니지 → LLM 자연어 변환
        if ops_results:
            summary = await _lineage_to_summary(ctx, state.get("command", ""), ops_results, state)
            return {**state, "result_summary": summary}

        # 레거시 JSON patch 모드
        if not patches:
            html_slides = state.get("html_slides", [])
            html_out = state.get("html_output", "")
            if html_slides or html_out:
                cnt = len(html_slides) if html_slides else 1
                return {**state, "result_summary": f"{cnt}장 슬라이드 생성 완료"}
            return state

        llm_summary = state.get("result_summary", "")
        if llm_summary:
            return {**state, "result_summary": llm_summary.strip()}

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
        return {**state, "result_summary": "、".join(stats_parts) or "변경 없음"}
    return formatter_node


async def _lineage_to_summary(ctx: NodeContext, command: str, ops_results: list, state: dict) -> str:
    """ops_results 행위 리니지 → LLM 자연어 요약."""
    import json
    from langchain_core.messages import HumanMessage, SystemMessage

    # ops_results를 사람이 읽기 쉬운 형태로 직렬화
    lines = []
    for r in ops_results:
        t = r.get("type", "")
        idx = r.get("slide_index", "?")
        if t == "edit":
            colors = r.get("colors_added", [])
            instr = r.get("instruction", "")
            lines.append(f"- 슬라이드 {int(idx)+1} 수정: {instr}"
                         + (f" | 적용 색상: {', '.join(colors[:4])}" if colors else ""))
        elif t == "component_edit":
            lines.append(f"- 슬라이드 {int(idx)+1} 컴포넌트 [{r.get('component_id','')}] 수정")
        elif t == "component_delete":
            lines.append(f"- 슬라이드 {int(idx)+1} 컴포넌트 [{r.get('component_id','')}] 삭제")
        elif t == "delete":
            lines.append(f"- 슬라이드 {int(idx)+1} 삭제")
        elif t == "create":
            lines.append(f"- 슬라이드 생성: {r.get('summary','')}")

    if not lines:
        return state.get("result_summary", "작업 완료")

    human_text = (
        f"사용자 요청: {command}\n\n"
        f"실행된 작업 목록:\n" + "\n".join(lines) +
        "\n\n위 작업을 1-2문장 한국어로 자연스럽게 요약해라. "
        "예: '슬라이드 5장 전체에 WARM 팔레트(배경 #1C0F0A, 액센트 #F59E0B) 적용 완료'"
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
