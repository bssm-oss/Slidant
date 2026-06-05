"""unified_planner, ops_dispatcher, self_reviewer, legacy planner 노드."""
from __future__ import annotations

import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import UNIFIED_PLANNER_PROMPT, PLANNER_PROMPT, DESIGN_RESOLVER_PROMPT

logger = logging.getLogger("slidant.agent")


def _extract_json(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    for pattern in (r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"):
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                continue
    return None


def make_unified_planner(ctx: NodeContext):
    async def unified_planner_node(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "🧠 계획 수립 중...")
        history = state.get("conversation_history", "")
        history_section = f"\n\nPrevious conversation:\n{history}" if history else ""

        messages = [
            SystemMessage(content=UNIFIED_PLANNER_PROMPT),
            HumanMessage(content=f"Command: {state['command']}{history_section}\n\nCurrent slide:\n{state['slide_context']}"),
        ]
        raw = ""
        try:
            async for chunk in ctx.llm_plain.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as e:
            logger.warning("  [unified_planner] failed: %s", e)

        parsed = _extract_json(raw)

        if not isinstance(parsed, dict):
            if ctx.on_event:
                ctx.on_event("node_done", "✅ 계획 완료")
            return {**state, "plan": raw, "mode": "create", "design_tokens": {},
                    "slide_specs": [], "search_queries": [], "result_summary": ""}

        design_tokens = parsed.get("design_tokens", {})
        if not design_tokens or "bg" not in design_tokens:
            design_tokens = {
                "palette": "DARK", "bg": "#0A0F1E", "accent": "#3B82F6",
                "text": "#F9FAFB", "text2": "#9CA3AF",
                "cover_title_size": 68, "slide_title_size": 44, "subtitle_size": 28, "body_size": 21,
            }
        search_queries = [q for q in parsed.get("search_queries", []) if isinstance(q, str) and q.strip()]
        summary = parsed.get("summary", "")

        operations = parsed.get("operations", [])
        slide_specs = []
        mode = "create"

        if operations:
            ops_queue = list(operations)
            mode = operations[0].get("type", "create") if operations else "create"
        else:
            ops_queue = []
            slide_specs = parsed.get("slides", [])
            mode = parsed.get("mode", "create")

        if ctx.on_event:
            steps = [{"id": "plan", "label": "계획 수립"}]
            # 검색: 단일 step id "search" (web_searcher_node의 step_done("search")와 매칭)
            if search_queries:
                # 대표 쿼리 1개만 레이블에 표시
                label = f"🔍 {search_queries[0][:28]}"
                if len(search_queries) > 1:
                    label += f" 외 {len(search_queries)-1}개"
                steps.append({"id": "search", "label": label})

            if ops_queue:
                slide_counter = 0  # create op용 slide-N 카운터
                non_create_counter = 0  # edit/delete op용 카운터 (step_id 생성에 사용)
                for i, op in enumerate(ops_queue):
                    t = op.get("type", "")
                    idx = op.get("slide_index", 0)
                    spec = op.get("spec", {})

                    if t == "create":
                        title = (spec.get("title") or f"슬라이드 {slide_counter+1}")[:18]
                        label = f"📄 {title}"
                        steps.append({"id": f"slide-{slide_counter}", "label": label})
                        slide_counter += 1
                        continue
                    elif t == "edit":
                        label = f"✏️ 슬라이드 {idx+1} 수정"
                    elif t == "component_edit":
                        label = f"🔧 컴포넌트 수정"
                    elif t == "component_delete":
                        label = f"🗑️ 컴포넌트 삭제"
                    elif t == "delete":
                        label = f"🗑️ 슬라이드 {idx+1} 삭제"
                    else:
                        label = f"작업 {i+1}"
                    # step_id = ops_dispatcher의 step_id 계산 로직과 동일
                    step_id = f"{t}-{idx}-{non_create_counter}"
                    steps.append({"id": step_id, "label": label})
                    non_create_counter += 1
            else:
                for i, s in enumerate(slide_specs[:6]):
                    title = (s.get("title") or f"슬라이드 {i+1}")[:18]
                    steps.append({"id": f"slide-{i}", "label": f"📄 {title}"})
                if not any(step["id"].startswith("slide") for step in steps):
                    steps.append({"id": "slide-0", "label": "📄 슬라이드 생성"})
            ctx.on_event("steps_init", json.dumps(steps, ensure_ascii=False))
            ctx.on_event("step_done", "plan")
            ctx.on_event("node_done", "✅ 계획 완료")

        logger.info("  [unified_planner] mode=%s slides=%d search=%d palette=%s",
                    mode, len(slide_specs), len(search_queries), design_tokens.get("palette", "?"))

        return {
            **state,
            "plan": raw,
            "mode": mode,
            "design_tokens": design_tokens,
            "slide_specs": slide_specs,
            "ops_queue": ops_queue,
            "search_queries": search_queries,
            "result_summary": summary,
            "messages": [],
        }
    return unified_planner_node


def make_ops_dispatcher(ctx: NodeContext):
    def ops_dispatcher_node(state: AgentState) -> AgentState:
        queue = list(state.get("ops_queue", []))
        if not queue:
            # html_slides 보존 — 생성된 슬라이드를 formatter까지 전달해야 함
            return {**state, "current_op": {}}

        op = queue.pop(0)
        op_type = op.get("type", "create")
        slide_idx = op.get("slide_index", 0)

        # create: 연속된 create op 전부 꺼내서 slide_specs로 묶어 병렬 Send
        if op_type == "create":
            create_ops = [op]
            while queue and queue[0].get("type") == "create":
                create_ops.append(queue.pop(0))
            slide_specs = [
                co.get("spec", {"title": f"슬라이드 {i+1}", "layout": "CONTENT", "key_points": []})
                for i, co in enumerate(create_ops)
            ]
            logger.info("[ops_dispatcher] create batch=%d queue_left=%d", len(create_ops), len(queue))
            return {
                **state,
                "ops_queue": queue,
                "current_op": {**op, "step_id": "create-batch"},
                "slide_specs": slide_specs,
                "mode": "create",
                "html_slides": "__RESET__",  # create 배치 시작 시에만 리셋
            }

        # edit/delete/component: html_slides 보존 (이전 create 배치 결과 유지)
        queue_pos = len(state.get("ops_results", []))  # 몇 번째 op인지
        step_id = f"{op_type}-{slide_idx}-{queue_pos}"
        op_with_step = {**op, "step_id": step_id}

        all_slides = state.get("all_slides_context", [])
        target = next(
            (s for s in all_slides if s.get("order") == slide_idx),
            all_slides[0] if all_slides else {},
        )
        slide_ctx = target.get("html_content", "") or state.get("slide_context", "")

        if ctx.on_event:
            ctx.on_event("node_start", f"📌 슬라이드 {slide_idx+1} 타겟팅...")

        logger.info("[ops_dispatcher] op=%s slide_idx=%d queue_left=%d", op_type, slide_idx, len(queue))
        return {
            **state,
            "ops_queue": queue,
            "current_op": op_with_step,
            "slide_context": slide_ctx,
            "mode": op_type,
            # html_slides 리셋 없음 — 이전 create 결과 보존
        }
    return ops_dispatcher_node


def route_from_dispatcher(state: AgentState) -> str:
    op = state.get("current_op", {})
    if not op:
        return "review"
    return op.get("type", "create")


def make_self_reviewer(ctx: NodeContext):
    async def self_reviewer_node(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "🔍 결과 검토 중...")

        # 무한 루프 방지: 최대 1회 검토
        review_count = state.get("review_count", 0)
        if review_count >= 1:
            logger.info("[self_reviewer] max review count reached, forcing done")
            if ctx.on_event:
                ctx.on_event("node_done", "✅ 검토 완료")
            return {**state, "review_ok": True, "review_count": review_count + 1}

        ops_results = state.get("ops_results", [])
        if not ops_results:
            if ctx.on_event:
                ctx.on_event("node_done", "✅ 검토 완료")
            return {**state, "review_ok": True, "review_count": review_count + 1}

        human_text = (
            f"원래 명령: {state.get('command', '')}\n\n실행된 작업:\n"
            + "\n".join(f"- {r.get('type','?')}: {r.get('summary', r.get('component_id', ''))}"
                        for r in ops_results)
            + "\n\n명령이 완전히 수행됐는지 평가하라. "
            "문제 없으면 {\"ok\":true,\"summary\":\"완료 요약\"}. "
            "문제 있으면 {\"ok\":false,\"corrections\":[{\"type\":\"edit\",\"slide_index\":0,\"instruction\":\"...\"}],\"summary\":\"문제 설명\"}."
        )

        messages = [
            SystemMessage(content="You are a self-critic for slide editing. Output JSON only."),
            HumanMessage(content=human_text),
        ]
        raw = ""
        try:
            async for chunk in ctx.llm_plain.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as e:
            logger.warning("self_reviewer failed: %s", e)
            if ctx.on_event:
                ctx.on_event("node_done", "✅ 검토 완료")
            return {**state, "review_ok": True}

        parsed = _extract_json(raw)
        ok = True
        corrections = []
        summary = state.get("result_summary", "")
        if isinstance(parsed, dict):
            ok = parsed.get("ok", True)
            corrections = parsed.get("corrections", [])
            summary = parsed.get("summary", summary)

        if ctx.on_event:
            ctx.on_event("node_done", "✅ 검토 완료" if ok else f"⚠️ 보정 필요: {summary[:30]}")

        logger.info("[self_reviewer] ok=%s corrections=%d", ok, len(corrections))
        new_queue = list(state.get("ops_queue", []))
        if not ok and corrections:
            new_queue = corrections + new_queue

        return {**state, "ops_queue": new_queue, "review_ok": ok,
                "result_summary": summary, "review_count": review_count + 1}
    return self_reviewer_node


def route_from_reviewer(state: AgentState) -> str:
    if state.get("review_ok", True) or not state.get("ops_queue"):
        return "done"
    return "dispatch"


# ── legacy planner 노드들 ─────────────────────────────────────────────────────

def make_legacy_planner(ctx: NodeContext):
    async def planner_node(state: AgentState) -> AgentState:
        logger.info("  [planner] 계획 수립 중...")
        if ctx.on_event:
            ctx.on_event("node_start", "🧠 계획 수립 중...")
        history = state.get("conversation_history", "")
        history_section = f"\n\nPrevious conversation (for context):\n{history}" if history else ""
        messages = [
            SystemMessage(content=PLANNER_PROMPT),
            HumanMessage(content=f"Command: {state['command']}{history_section}\n\nSlide context:\n{state['slide_context']}"),
        ]
        plan = ""
        async for chunk in ctx.llm_plain.astream(messages):
            raw = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw, list):
                token = "".join(b.get("text", "") for b in raw if isinstance(b, dict) and b.get("type") == "text")
            else:
                token = str(raw) if raw else ""
            if token:
                plan += token
        logger.info("  [planner] 계획: %r", plan[:200])
        if ctx.on_event:
            ctx.on_event("node_done", "✅ 계획 완료")
        return {**state, "plan": plan, "messages": []}
    return planner_node
