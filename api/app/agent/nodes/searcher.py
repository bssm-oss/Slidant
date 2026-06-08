"""web_searcher, content_planner, design_resolver_html 노드."""
from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import (
    CONTENT_PLANNER_PROMPT, DESIGN_RESOLVER_PROMPT,
    SEARCH_CACHE_CHECK_PROMPT, SEARCH_MERGER_PROMPT,
)
from app.agent.utils import extract_json as _extract_json

logger = logging.getLogger("slidant.agent")


async def _check_cache_sufficiency(ctx: NodeContext, cached_summary: str, queries: list[str], command: str) -> dict:
    """캐시된 factsheet가 새 search_queries의 데이터를 이미 포함하는지 LLM 판정.

    반환: {"sufficient": bool, "missing_queries": [...]}.
    판정 실패 시 안전하게 "불충분"으로 처리 (전체 재검색).
    """
    messages = [
        SystemMessage(content=SEARCH_CACHE_CHECK_PROMPT),
        HumanMessage(content=(
            f"Command: {command}\n\n"
            "NEW search queries:\n" + "\n".join(f"- {q}" for q in queries) + "\n\n"
            f"CACHED fact sheet:\n{cached_summary}"
        )),
    ]
    raw = ""
    try:
        async for chunk in ctx.llm_plain.astream(messages):
            raw_c = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw_c, list):
                raw += "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
            else:
                raw += str(raw_c) if raw_c else ""
    except Exception as e:
        logger.warning("search_cache_check failed: %s", e)
        return {"sufficient": False, "missing_queries": queries}

    parsed = _extract_json(raw)
    if isinstance(parsed, dict) and "sufficient" in parsed:
        missing = [q for q in parsed.get("missing_queries", []) if isinstance(q, str) and q.strip()]
        return {"sufficient": bool(parsed["sufficient"]), "missing_queries": missing}
    return {"sufficient": False, "missing_queries": queries}


def make_web_searcher(ctx: NodeContext):
    async def web_searcher_node(state: AgentState) -> AgentState:
        queries = [q for q in state.get("search_queries", []) if isinstance(q, str) and q.strip()]
        cached_summary = state.get("search_summary", "")

        # 캐시 "존재 여부"가 아니라 "지금 필요한 데이터를 커버하는가"로 판단
        if cached_summary and queries:
            if ctx.on_event:
                ctx.on_event("node_start", "🔎 캐시 적합성 확인 중...")
            check = await _check_cache_sufficiency(ctx, cached_summary, queries, state.get("command", ""))
            if check["sufficient"]:
                if ctx.on_event:
                    ctx.on_event("step_done", "search")
                    ctx.on_event("node_done", "✅ 캐시로 충분 — 재검색 생략")
                return {}
            queries = check["missing_queries"] or queries
            logger.info("  [web_searcher] cache insufficient — re-searching %d/%d queries",
                        len(queries), len(state.get("search_queries", [])))

        from app.core.config import settings
        if ctx.on_event:
            ctx.on_event("node_start", f"🔍 웹 검색 중 ({len(queries)}개)...")
        results = []
        tavily_key = getattr(settings, "TAVILY_API_KEY", "")
        if tavily_key:
            try:
                from tavily import TavilyClient
                client = TavilyClient(api_key=tavily_key)
                for q in queries[:3]:
                    resp = client.search(q, max_results=7, search_depth="advanced",
                                         include_answer=True, include_raw_content=False)
                    tavily_answer = resp.get("answer", "")
                    q_tokens = set(q.replace("  ", " ").split())

                    def relevance_score(r: dict) -> float:
                        title = r.get("title", "").lower()
                        score = r.get("score", 0)
                        overlap = sum(1 for t in q_tokens if t in title)
                        return score + overlap * 0.1

                    sorted_results = sorted(resp.get("results", []), key=relevance_score, reverse=True)
                    results.append({
                        "query": q,
                        "answer": tavily_answer,
                        "results": [
                            {"title": r["title"], "url": r["url"],
                             "snippet": r.get("content", "")[:800], "score": r.get("score", 0)}
                            for r in sorted_results
                        ],
                    })
            except Exception as e:
                logger.warning("web_searcher failed: %s", e)
        if ctx.on_event:
            ctx.on_event("step_done", "search")
            ctx.on_event("node_done", f"✅ {len(results)}개 검색 완료")
        return {"search_results": results}
    return web_searcher_node


def make_search_merger(ctx: NodeContext):
    """검색 결과 → 단일 팩트시트. 모든 slide_composer가 동일 데이터를 참조."""
    async def search_merger_node(state: AgentState) -> AgentState:
        results = state.get("search_results", [])
        if not results:
            # 캐시된 summary 있으면 그대로 통과
            return {}

        if ctx.on_event:
            ctx.on_event("node_start", "📊 검색 결과 병합 중...")

        raw_dump = ""
        for sr in results:
            raw_dump += f"\n### 검색어: {sr['query']}\n"
            if sr.get("answer"):
                raw_dump += f"요약: {sr['answer']}\n"
            for r in sr.get("results", [])[:5]:
                raw_dump += f"[{r['title']}] {r['snippet']}\n"

        # 캐시가 일부만 부족했던 경우 — 기존 factsheet도 함께 줘서 통합 병합
        cached_summary = state.get("search_summary", "")
        cache_ctx = f"\n\nCACHED FACT SHEET (merge with new results below):\n{cached_summary}\n" if cached_summary else ""

        messages = [
            SystemMessage(content=SEARCH_MERGER_PROMPT),
            HumanMessage(content=f"Command: {state.get('command', '')}\n\n{raw_dump}{cache_ctx}"),
        ]
        summary = ""
        try:
            async for chunk in ctx.llm_plain.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    summary += "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    summary += str(raw_c) if raw_c else ""
        except Exception as e:
            logger.warning("search_merger failed: %s", e)
            summary = raw_dump  # fallback: raw dump as-is

        if ctx.on_event:
            ctx.on_event("node_done", "✅ 검색 데이터 병합 완료")
        return {"search_summary": summary}
    return search_merger_node


def make_content_planner(ctx: NodeContext):
    async def content_planner_node(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "📋 콘텐츠 기획 중...")
        search_ctx = ""
        if state.get("search_results"):
            search_ctx = "\n\n## 웹 검색 결과 (주제와 관련된 내용만 슬라이드에 반영)\n"
            for sr in state["search_results"]:
                search_ctx += f"\n### 검색어: {sr['query']}\n"
                if sr.get("answer"):
                    search_ctx += f"**요약**: {sr['answer']}\n"
                for r in sr["results"][:5]:
                    search_ctx += f"\n**{r['title']}** ({r['url']})\n{r['snippet']}\n"
            search_ctx += "\n※ 검색어와 무관한 데이터를 혼용하지 말 것. 확실하지 않은 수치는 생략.\n"
        messages = [
            SystemMessage(content=CONTENT_PLANNER_PROMPT),
            HumanMessage(content=f"Command: {state['command']}\n\nPlan:\n{state.get('plan', '')}{search_ctx}"),
        ]
        raw = ""
        async for chunk in ctx.llm_plain.astream(messages):
            raw_c = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw_c, list):
                token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
            else:
                token = str(raw_c) if raw_c else ""
            raw += token
        parsed = _extract_json(raw)
        slide_specs = parsed["slides"] if isinstance(parsed, dict) and "slides" in parsed else []
        if ctx.on_event:
            ctx.on_event("step_done", "content")
            ctx.on_event("node_done", f"✅ {len(slide_specs)}장 콘텐츠 기획 완료")
        return {"slide_specs": slide_specs}
    return content_planner_node


def make_design_resolver_html(ctx: NodeContext):
    async def design_resolver_node_html(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "🎨 디자인 확정 중...")
        messages = [
            SystemMessage(content=DESIGN_RESOLVER_PROMPT),
            HumanMessage(content=f"Plan:\n{state.get('plan', '')}\nMode: {state.get('mode', 'create')}"),
        ]
        raw = ""
        async for chunk in ctx.llm_plain.astream(messages):
            raw_c = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw_c, list):
                token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
            else:
                token = str(raw_c) if raw_c else ""
            raw += token
        parsed = _extract_json(raw)
        design_tokens = parsed if isinstance(parsed, dict) and "bg" in parsed else {
            "palette": "DARK", "bg": "#0A0F1E", "accent": "#3B82F6", "text": "#F9FAFB", "text2": "#9CA3AF",
            "cover_title_size": 68, "slide_title_size": 44, "subtitle_size": 28, "body_size": 21,
        }
        if ctx.on_event:
            ctx.on_event("step_done", "design")
            ctx.on_event("node_done", f"✅ {design_tokens.get('palette', 'DARK')} 팔레트 확정")
        return {"design_tokens": design_tokens}
    return design_resolver_node_html
