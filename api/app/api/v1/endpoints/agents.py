import json as json_lib
from uuid import UUID

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

from app.core.config import settings
from app.core.deps import CurrentUser, UoW
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.services import agent_service
from app.services.agent_runner import run_agent

router = APIRouter(prefix="/agent", tags=["agent"])

_ws_connections: dict[str, list[WebSocket]] = {}


@router.post("/run", response_model=AgentRunResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_agent_endpoint(body: AgentRunRequest, current_user: CurrentUser, uow: UoW):
    # API Key 조회
    api_key, provider = await agent_service.resolve_api_key(uow.api_keys, current_user.id)
    if not api_key and not settings.MOCK_AGENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API key not registered. Register OpenRouter or Anthropic key in Settings.",
        )

    # AgentDefinition + AgentRun 생성
    agent_def = await agent_service.get_or_create_agent_def(uow.agent_definitions, body.agent_role)
    agent_run = await agent_service.create_agent_run(uow.agent_runs, body.project_id, agent_def.id)

    await _broadcast(str(body.project_id), {
        "type": "agent_started",
        "agent_run_id": str(agent_run.id),
        "role": body.agent_role,
        "command": body.command,
    })

    # 컴포넌트 조회
    components_orm = await uow.components.list_by_slide(body.slide_id)
    components = [
        {"id": str(c.id), "type": c.type, "properties": c.properties, "order": c.order}
        for c in components_orm
    ]

    try:
        patches, _ = await run_agent(
            role=body.agent_role,
            command=body.command,
            components=components,
            encrypted_api_key=api_key.encrypted_key if api_key else "",
            provider=provider,
        )
        await agent_service.apply_patches(uow.components, body.slide_id, patches)
        await agent_service.finalize_agent_run(
            uow.agent_runs, uow.llm_logs, agent_run, body.command, patches
        )
        await _broadcast(str(body.project_id), {
            "type": "agent_done",
            "agent_run_id": str(agent_run.id),
            "patches": patches,
        })

    except Exception as e:
        await agent_service.finalize_agent_run(
            uow.agent_runs, uow.llm_logs, agent_run, body.command, [], status="error", error=str(e)
        )
        await _broadcast(str(body.project_id), {
            "type": "agent_error",
            "agent_run_id": str(agent_run.id),
            "error": str(e),
        })
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    return agent_run


@router.get("/logs/{project_id}", response_model=list[dict])
async def get_agent_logs(project_id: UUID, current_user: CurrentUser, uow: UoW):
    runs = await uow.agent_runs.list_by_project(project_id)
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in runs
    ]


@router.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await websocket.accept()
    if project_id not in _ws_connections:
        _ws_connections[project_id] = []
    _ws_connections[project_id].append(websocket)
    try:
        while True:
            await websocket.receive_text()
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
