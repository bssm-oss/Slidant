"""html_aggregator, html_validator, formatter, validator(legacy), patch_serializer 노드."""
from __future__ import annotations

import logging

from app.agent.context import NodeContext
from app.agent.state import AgentState

logger = logging.getLogger("slidant.agent")


def make_html_aggregator(_ctx: NodeContext):
    def html_aggregator_node(state: AgentState) -> AgentState:
        slides = sorted(state.get("html_slides", []), key=lambda s: s.get("index", 0))
        valid = [s for s in slides if s.get("html")]
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
        if not has_output and retry < settings.AGENT_MAX_RETRIES:
            return "retry"
        return "done"
    return should_retry_html


def make_formatter(_ctx: NodeContext):
    def formatter_node(state: AgentState) -> AgentState:
        patches = state.get("result_patches", [])
        llm_summary = state.get("result_summary", "")

        if not patches:
            html_slides = state.get("html_slides", [])
            html_out = state.get("html_output", "")
            if html_slides or html_out:
                if llm_summary:
                    return {**state, "result_summary": llm_summary.strip()}
                cnt = len(html_slides) if html_slides else 1
                return {**state, "result_summary": f"{cnt}장 슬라이드 생성 완료"}
            return state

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
        stats = "、".join(stats_parts) if stats_parts else "변경 없음"

        if llm_summary:
            formatted = llm_summary.strip()
        else:
            formatted = stats
        return {**state, "result_summary": formatted}
    return formatter_node


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
