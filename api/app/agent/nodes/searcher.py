"""web_searcher, content_planner, design_resolver_html 노드."""
from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import CONTENT_PLANNER_PROMPT, DESIGN_RESOLVER_PROMPT

logger = logging.getLogger("slidant.agent")


def _extract_json(text: str):
    import re
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


def make_web_searcher(ctx: NodeContext):
    async def web_searcher_node(state: AgentState) -> AgentState:
        from app.core.config import settings
        if ctx.on_event:
            ctx.on_event("node_start", f"🔍 웹 검색 중 ({len(state.get('search_queries', []))}개)...")
        results = []
        tavily_key = getattr(settings, "TAVILY_API_KEY", "")
        if tavily_key:
            try:
                from tavily import TavilyClient
                client = TavilyClient(api_key=tavily_key)
                for q in state.get("search_queries", [])[:3]:
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
        return {**state, "search_results": results}
    return web_searcher_node


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
        return {**state, "slide_specs": slide_specs}
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
        return {**state, "design_tokens": design_tokens}
    return design_resolver_node_html
