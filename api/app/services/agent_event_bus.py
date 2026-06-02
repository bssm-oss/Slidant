import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger("slidant.agent")

BroadcastFn = Callable[[str, dict], Awaitable[None]]


class AgentEventBus:
    """
    에이전트 노드 이벤트를 SSE로 전달하는 단일 채널.
    on_token / on_event 콜백 분산 대신 단일 객체로 주입 (DIP, ISP).
    """

    def __init__(self, broadcast: BroadcastFn, project_id: str, agent_run_id: str) -> None:
        self._broadcast = broadcast
        self._project_id = project_id
        self._agent_run_id = agent_run_id
        self._token_buf: list[str] = []

    def _fire(self, payload: dict) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._broadcast(self._project_id, payload))
        except RuntimeError:
            pass

    def emit_token(self, token: str) -> None:
        self._token_buf.append(token)
        self._fire({
            "type": "agent_token",
            "agent_run_id": self._agent_run_id,
            "token": token,
            "accumulated": "".join(self._token_buf),
        })

    def emit_node(self, event_type: str, message: str) -> None:
        """event_type: 'node_start' | 'node_done'"""
        self._fire({
            "type": "agent_node_event",
            "agent_run_id": self._agent_run_id,
            "event_type": event_type,
            "message": message,
        })

    def reset_token_buf(self) -> None:
        self._token_buf.clear()
