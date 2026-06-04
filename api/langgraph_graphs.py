"""
LangGraph Studio 시각화용 그래프 모듈.
langgraph dev 명령으로 http://localhost:8123 에서 확인 가능.
"""
import os
os.environ.setdefault("OPENROUTER_API_KEY", "placeholder")
os.environ.setdefault("ANTHROPIC_API_KEY", "placeholder")

from langchain_openai import ChatOpenAI
from app.services.agent_runner import build_agent_graph

_dummy_llm = ChatOpenAI(
    model="gpt-4o",
    base_url="https://openrouter.ai/api/v1",
    api_key="placeholder",
)

# HTML 파이프라인 그래프 (기본 생성 플로우)
html_pipeline = build_agent_graph(
    role="content",
    llm=_dummy_llm,
    llm_plain=_dummy_llm,
    html_mode=True,
)

# Legacy JSON 파이프라인 그래프
legacy_pipeline = build_agent_graph(
    role="content",
    llm=_dummy_llm,
    llm_plain=_dummy_llm,
    html_mode=False,
)
