"""
WebSocket 단일 채널 — CRDT(Yjs) sync + 에이전트 이벤트 + Presence
Binary frames → Yjs sync protocol
Text frames   → JSON (agent events, presence)
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

import pycrdt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

logger = logging.getLogger("slidant.ws")

router = APIRouter(tags=["ws"])

# ── 연결 관리 ─────────────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        # project_id → set of WebSocket
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        # project_id → {client_id: presence_data}
        self._presence: dict[str, dict[str, Any]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, project_id: str, user_id: str, user_name: str) -> None:
        await ws.accept()
        async with self._lock:
            self._connections[project_id].add(ws)
        logger.info("ws_connect  project=%s  user=%s  peers=%d",
                    project_id, user_id, len(self._connections[project_id]))
        # 입장 알림
        await self.broadcast_json(project_id, {
            "type": "user_joined",
            "userId": user_id,
            "name": user_name,
        }, exclude=ws)
        # 현재 presence 상태 전송
        if self._presence.get(project_id):
            await self._safe_send_json(ws, {
                "type": "presence_state",
                "users": list(self._presence[project_id].values()),
            })

    async def disconnect(self, ws: WebSocket, project_id: str, user_id: str) -> None:
        async with self._lock:
            self._connections[project_id].discard(ws)
            self._presence[project_id].pop(user_id, None)
            if not self._connections[project_id]:
                del self._connections[project_id]
        logger.info("ws_disconnect  project=%s  user=%s", project_id, user_id)
        await self.broadcast_json(project_id, {
            "type": "user_left",
            "userId": user_id,
        })

    async def broadcast_json(
        self, project_id: str, msg: dict, exclude: WebSocket | None = None
    ) -> None:
        data = json.dumps(msg, default=str)
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(project_id, [])):
            if ws is exclude:
                continue
            if not await self._safe_send_text(ws, data):
                dead.append(ws)
        for ws in dead:
            self._connections[project_id].discard(ws)

    async def broadcast_bytes(
        self, project_id: str, data: bytes, exclude: WebSocket | None = None
    ) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(project_id, [])):
            if ws is exclude:
                continue
            if not await self._safe_send_bytes(ws, data):
                dead.append(ws)
        for ws in dead:
            self._connections[project_id].discard(ws)

    async def send_json(self, ws: WebSocket, msg: dict) -> None:
        await self._safe_send_json(ws, msg)

    def update_presence(self, project_id: str, user_id: str, data: dict) -> None:
        self._presence[project_id][user_id] = {"userId": user_id, **data}

    def peer_count(self, project_id: str) -> int:
        return len(self._connections.get(project_id, set()))

    async def _safe_send_text(self, ws: WebSocket, data: str) -> bool:
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_text(data)
                return True
        except Exception:
            pass
        return False

    async def _safe_send_bytes(self, ws: WebSocket, data: bytes) -> bool:
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_bytes(data)
                return True
        except Exception:
            pass
        return False

    async def _safe_send_json(self, ws: WebSocket, msg: dict) -> None:
        await self._safe_send_text(ws, json.dumps(msg, default=str))


# 전역 싱글톤 — agents.py 등에서 import해서 사용
manager = ConnectionManager()


# ── WebSocket 엔드포인트 ──────────────────────────────────────────────────────

@router.websocket("/ws/{project_id}")
async def ws_endpoint(
    websocket: WebSocket,
    project_id: str,
) -> None:
    """
    단일 WebSocket 채널.
    Binary → Yjs sync (Phase 2에서 처리 추가)
    Text   → JSON 메시지 (presence 업데이트 등)
    """
    from app.core.deps import get_current_user_ws
    from app.db.base import AsyncSessionLocal

    # 인증
    try:
        async with AsyncSessionLocal() as session:
            user = await get_current_user_ws(websocket, session)
            if user is None:
                await websocket.close(code=4001)
                return
    except Exception:
        await websocket.close(code=4001)
        return

    user_id = str(user.id)
    user_name = getattr(user, "email", user_id).split("@")[0]

    await manager.connect(websocket, project_id, user_id, user_name)

    from app.services import crdt as crdt_svc
    from app.db.base import AsyncSessionLocal

    # Y.Doc 초기화 + 초기 sync 메시지 전송
    async with AsyncSessionLocal() as session:
        await crdt_svc.get_or_create_doc(project_id, session)

    # SYNC_STEP1 (서버 state vector) → 클라이언트에게 전송
    step1 = crdt_svc.make_initial_sync(project_id)
    await manager._safe_send_bytes(websocket, step1)

    # 전체 update도 이어서 전송 (클라이언트가 없는 데이터 채움)
    full_upd = crdt_svc.make_full_update(project_id)
    await manager._safe_send_bytes(websocket, full_upd)

    # 새로고침 복구: Redis 이벤트 히스토리 replay + 실행 중인 agent run 상태 복구
    try:
        from app.core.redis import get_redis
        import json as _json
        redis = get_redis()
        key = f"slidant:events:{project_id}"
        cached = await redis.lrange(key, 0, -1)
        if cached:
            # 캐시된 이벤트 순서대로 replay
            # agent_started에 resumed:True 추가 → 프론트엔드 step 복원 타이머 트리거
            has_steps_init = any(
                _json.loads(r).get("event_type") == "steps_init"
                for r in cached
                if isinstance(r, str)
            )
            for raw in cached:
                try:
                    evt = _json.loads(raw)
                    extra: dict = {"replayed": True}
                    if evt.get("type") == "agent_started":
                        extra["resumed"] = True
                    await manager.send_json(websocket, {**evt, **extra})
                except Exception:
                    pass
            # steps_init 없이 running만 있는 경우 (refresh가 planning 이전에 발생)
            # → 아무것도 추가 안 함, 실행 중인 agent가 곧 steps_init 전송
        else:
            # 캐시 없을 때: DB에서 running 상태 확인 후 agent_started만 전송
            async with AsyncSessionLocal() as session:
                from app.repositories.agent import AgentRunRepository, AgentDefinitionRepository
                run_repo = AgentRunRepository(session)
                def_repo = AgentDefinitionRepository(session)
                running_runs = await run_repo.list_running_by_project(project_id)
                for run in running_runs:
                    agent_def = await def_repo.get(run.agent_definition_id)
                    agent_name = agent_def.name if agent_def else "Agent"
                    await manager.send_json(websocket, {
                        "type": "agent_started",
                        "agent_run_id": str(run.id),
                        "agent_name": agent_name,
                        "role": agent_def.role if agent_def else "content",
                        "command": "",
                        "resumed": True,
                    })
    except Exception as e:
        logger.warning("ws_resume_check failed: %s", e)

    try:
        while True:
            msg = await websocket.receive()

            # 클라이언트가 연결 종료 프레임 전송 시 graceful exit
            if msg.get("type") == "websocket.disconnect":
                break

            # Binary: Yjs sync 프로토콜
            if "bytes" in msg and msg["bytes"] is not None:
                data: bytes = msg["bytes"]
                result = crdt_svc.handle_client_message(project_id, data)
                if result is None:
                    continue

                msg_type = data[1] if len(data) > 1 else -1
                if msg_type == int(pycrdt.YSyncMessageType.SYNC_STEP1):
                    # STEP1: reply(STEP2)는 요청자에게만
                    await manager._safe_send_bytes(websocket, result)
                else:
                    # UPDATE: 나머지 peers에게 relay
                    await manager.broadcast_bytes(project_id, result, exclude=websocket)

            # Text: JSON 메시지
            elif "text" in msg and msg["text"] is not None:
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue

                msg_type = payload.get("type", "")

                if msg_type == "presence_update":
                    manager.update_presence(project_id, user_id, payload.get("data", {}))
                    await manager.broadcast_json(project_id, {
                        "type": "presence_update",
                        "userId": user_id,
                        "data": payload.get("data", {}),
                    }, exclude=websocket)

                elif msg_type == "ping":
                    await manager.send_json(websocket, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("ws_error  project=%s  user=%s  err=%s", project_id, user_id, e)
    finally:
        # 마지막 사용자 퇴장 시 DB flush
        if manager.peer_count(project_id) <= 1:
            async with AsyncSessionLocal() as session:
                await crdt_svc.evict(project_id, session)
        await manager.disconnect(websocket, project_id, user_id)
