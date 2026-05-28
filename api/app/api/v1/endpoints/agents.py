import json as json_lib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.agent import AgentDefinition, AgentRun, LlmLog
from app.models.api_key import ApiKey
from app.models.component import Component
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.services.agent_runner import run_agent

router = APIRouter(prefix="/agent", tags=["agent"])

# 인메모리 WebSocket 연결 관리 (프로덕션에서는 Redis pub/sub 사용)
_ws_connections: dict[str, list[WebSocket]] = {}


@router.post("/run", response_model=AgentRunResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_agent_endpoint(body: AgentRunRequest, current_user: CurrentUser, db: DB):
    # API Key 조회
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.user_id == current_user.id,
            ApiKey.provider == "anthropic",
            ApiKey.deleted_at.is_(None),
        )
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anthropic API key not registered",
        )

    # AgentDefinition 조회 or 시스템 기본 사용
    agent_def_result = await db.execute(
        select(AgentDefinition).where(
            AgentDefinition.role == body.agent_role,
            AgentDefinition.is_system == True,  # noqa
        )
    )
    agent_def = agent_def_result.scalar_one_or_none()
    if not agent_def:
        # 없으면 즉석 생성
        agent_def = AgentDefinition(
            name=f"{body.agent_role.capitalize()}Agent",
            role=body.agent_role,
            is_system=True,
        )
        db.add(agent_def)
        await db.flush()

    # AgentRun 생성
    agent_run = AgentRun(
        project_id=body.project_id,
        agent_definition_id=agent_def.id,
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(agent_run)
    await db.flush()

    # WebSocket 구독자에게 시작 알림
    await _broadcast(str(body.project_id), {
        "type": "agent_started",
        "agent_run_id": str(agent_run.id),
        "role": body.agent_role,
        "command": body.command,
    })

    # 컴포넌트 조회 — 리스트로 변환하여 scalars() 소진 방지
    comp_result = await db.execute(
        select(Component).where(Component.slide_id == body.slide_id).order_by(Component.order)
    )
    components_orm = list(comp_result.scalars().all())
    components = [
        {"id": str(c.id), "type": c.type, "properties": c.properties, "order": c.order}
        for c in components_orm
    ]

    try:
        patches, _ = await run_agent(
            role=body.agent_role,
            command=body.command,
            components=components,
            encrypted_api_key=api_key.encrypted_key,
        )

        # 패치 적용
        for op in patches:
            path_parts = op.get("path", "").strip("/").split("/")
            if len(path_parts) < 2:
                continue
            comp_id_str, field = path_parts[0], path_parts[1]
            try:
                comp_uuid = UUID(comp_id_str)
                comp_obj = await db.get(Component, comp_uuid)
                if comp_obj and comp_obj.slide_id == body.slide_id:
                    if field == "properties" and len(path_parts) > 2:
                        prop_key = path_parts[2]
                        comp_obj.properties = {**comp_obj.properties, prop_key: op.get("value")}
                    comp_obj.updated_at = datetime.utcnow()
            except (ValueError, Exception):
                continue

        agent_run.status = "done"
        agent_run.finished_at = datetime.utcnow()

        # LlmLog 기록 (토큰 정보는 실제 응답에서 추출 — 지금은 placeholder)
        llm_log = LlmLog(
            agent_run_id=agent_run.id,
            model="claude-sonnet-4-6",
            prompt=body.command,
            response=str(patches),
            tokens_input=0,
            tokens_output=0,
            cache_hit=False,
        )
        db.add(llm_log)
        await db.commit()

        await _broadcast(str(body.project_id), {
            "type": "agent_done",
            "agent_run_id": str(agent_run.id),
            "patches": patches,
        })

    except Exception as e:
        agent_run.status = "error"
        agent_run.finished_at = datetime.utcnow()
        await db.commit()
        await _broadcast(str(body.project_id), {
            "type": "agent_error",
            "agent_run_id": str(agent_run.id),
            "error": str(e),
        })
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    await db.refresh(agent_run)
    return agent_run


@router.get("/logs/{project_id}", response_model=list[dict])
async def get_agent_logs(project_id: UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.project_id == project_id)
        .order_by(AgentRun.started_at.desc())
        .limit(50)
    )
    runs = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in runs
    ]


# ── WebSocket ─────────────────────────────────────────────


@router.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await websocket.accept()
    if project_id not in _ws_connections:
        _ws_connections[project_id] = []
    _ws_connections[project_id].append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive ping 수신
    except WebSocketDisconnect:
        _ws_connections[project_id].remove(websocket)


async def _broadcast(project_id: str, message: dict) -> None:
    conns = _ws_connections.get(project_id, [])
    dead = []
    for ws in conns:
        try:
            await ws.send_text(json_lib.dumps(message))
        except Exception:
            dead.append(ws)
    for ws in dead:
        conns.remove(ws)
