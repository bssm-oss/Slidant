"""web_searcher, content_planner, design_resolver_html 노드."""
from __future__ import annotations

import asyncio
import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import (
    CONTENT_PLANNER_PROMPT, DESIGN_RESOLVER_PROMPT,
    SEARCH_MERGER_PROMPT,
)
from app.agent.utils import extract_json as _extract_json

logger = logging.getLogger("slidant.agent")


def _is_cache_sufficient(cached_summary: str, queries: list[str]) -> bool:
    """캐시가 모든 쿼리 키워드를 60% 이상 커버하는지 휴리스틱 판단 (LLM 호출 없음)."""
    if not cached_summary:
        return False
    summary_lower = cached_summary.lower()
    for query in queries:
        tokens = [t for t in query.lower().split() if len(t) > 1]
        if not tokens:
            continue
        hit = sum(1 for t in tokens if t in summary_lower)
        if hit / len(tokens) < 0.6:
            return False
    return True


def make_web_searcher(ctx: NodeContext):
    async def web_searcher_node(state: AgentState) -> AgentState:
        queries = [q for q in state.get("search_queries", []) if isinstance(q, str) and q.strip()]
        cached_summary = state.get("search_summary", "")
        logger.info("━━ [web_searcher] START queries=%d cached=%s", len(queries), bool(cached_summary))

        # 캐시가 현재 쿼리를 커버하는지 키워드 휴리스틱으로 판단 (LLM 호출 없음)
        if cached_summary and queries:
            if _is_cache_sufficient(cached_summary, queries):
                logger.info("  [web_searcher] cache sufficient — skipping search")
                if ctx.on_event:
                    ctx.on_event("step_done", "search")
                    ctx.on_event("node_done", "✅ 캐시로 충분 — 재검색 생략")
                return {}

        from app.core.config import settings
        if ctx.on_event:
            ctx.on_event("node_start", f"웹 검색 중 ({len(queries)}개)...")
        results = []
        tavily_key = getattr(settings, "TAVILY_API_KEY", "")
        if tavily_key:
            try:
                from tavily import TavilyClient
                client = TavilyClient(api_key=tavily_key)

                async def _search_one(q: str) -> dict:
                    resp = await asyncio.to_thread(
                        client.search, q,
                        max_results=7, search_depth="advanced",
                        include_answer=True, include_raw_content=False,
                    )
                    q_tokens = set(q.replace("  ", " ").split())

                    def relevance_score(r: dict) -> float:
                        title = r.get("title", "").lower()
                        overlap = sum(1 for t in q_tokens if t in title)
                        return r.get("score", 0) + overlap * 0.1

                    sorted_results = sorted(resp.get("results", []), key=relevance_score, reverse=True)
                    return {
                        "query": q,
                        "answer": resp.get("answer", ""),
                        "results": [
                            {"title": r["title"], "url": r["url"],
                             "snippet": r.get("content", "")[:800], "score": r.get("score", 0)}
                            for r in sorted_results
                        ],
                    }

                _t0 = __import__('time').monotonic()
                raw_results = await asyncio.gather(
                    *[_search_one(q) for q in queries[:3]],
                    return_exceptions=True,
                )
                logger.info("  [web_searcher] parallel fetch done %.1fs", __import__('time').monotonic()-_t0)
                results = [r for r in raw_results if isinstance(r, dict)]
            except Exception as e:
                logger.warning("web_searcher failed: %s", e, exc_info=True)
        if ctx.on_event:
            ctx.on_event("step_done", "search")
            ctx.on_event("node_done", f"✅ {len(results)}개 검색 완료")
        return {"search_results": results}
    return web_searcher_node


def make_search_merger(ctx: NodeContext):
    """검색 결과 → 단일 팩트시트. 모든 slide_composer가 동일 데이터를 참조."""
    async def search_merger_node(state: AgentState) -> AgentState:
        logger.info("━━ [search_merger] START results=%d", len(state.get("search_results", [])))
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
            logger.warning("search_merger failed: %s", e, exc_info=True)
            summary = raw_dump  # fallback: raw dump as-is

        if ctx.on_event:
            ctx.on_event("node_done", "✅ 검색 데이터 병합 완료")
        return {"search_summary": summary}
    return search_merger_node


def make_content_planner(ctx: NodeContext):
    async def content_planner_node(state: AgentState) -> AgentState:
        logger.info("━━ [content_planner] START")
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
        logger.info("━━ [design_resolver] START")
        if ctx.on_event:
            ctx.on_event("node_start", "디자인 확정 중...")
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
