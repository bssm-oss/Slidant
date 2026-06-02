import asyncio
import json as json_lib
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.core.deps import CurrentUser, UoW
from app.models.chat import ChatMessage
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.services import agent_service
from app.services.agent_runner import run_agent

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger("slidant.agent")

# SSE: project_id → list of asyncio.Queue
_sse_queues: dict[str, list[asyncio.Queue]] = {}


@router.post("/run", response_model=AgentRunResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_agent_endpoint(
    body: AgentRunRequest,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    uow: UoW,
):
    # API Key 조회 (즉시 검증)
    api_key, provider = await agent_service.resolve_api_key(uow.api_keys, current_user.id)
    if not api_key and not settings.MOCK_AGENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API key not registered. Register OpenRouter or Anthropic key in Settings.",
        )

    # AgentDefinition 조회 + AgentRun 생성 (즉시)
    agent_def, system_prompt = await agent_service.resolve_agent_def(
        uow.agent_definitions, body.agent_definition_id, body.agent_role
    )
    agent_run = await agent_service.create_agent_run(uow.agent_runs, body.project_id, agent_def.id)

    # 사용자 채팅 메시지 즉시 저장
    user_msg = ChatMessage(
        project_id=body.project_id,
        slide_id=body.slide_id,
        role="user",
        content=body.command,
        agent_definition_id=agent_def.id,
        agent_name=agent_def.name,
    )
    uow.chat_messages.add(user_msg)
    await uow.commit()  # BackgroundTask 전에 커밋 필수 (bg에서 조회 가능하도록)

    # BackgroundTask: LLM 호출 (HTTP는 즉시 202 반환)
    background_tasks.add_task(
        _run_agent_background,
        body=body,
        agent_def_id=agent_def.id,
        agent_def_name=agent_def.name,
        agent_def_role=agent_def.role,
        system_prompt=system_prompt,
        agent_run_id=agent_run.id,
        encrypted_api_key=api_key.encrypted_key if api_key else "",
        provider=provider,
    )

    await _broadcast(str(body.project_id), {
        "type": "agent_started",
        "agent_run_id": str(agent_run.id),
        "agent_name": agent_def.name,
        "role": agent_def.role,
        "command": body.command,
    })

    return agent_run


async def _run_agent_background(
    *,
    body: AgentRunRequest,
    agent_def_id: UUID,
    agent_def_name: str,
    agent_def_role: str,
    system_prompt: str | None,
    agent_run_id: UUID,
    encrypted_api_key: str,
    provider: str,
) -> None:
    """LLM 호출 + patch 적용 — HTTP 응답과 분리된 백그라운드 작업"""
    logger.info("bg_start  agent_run=%s  role=%s  command=%r",
                agent_run_id, agent_def_role, body.command[:60])
    try:
        await _run_agent_background_inner(
            body=body, agent_def_role=agent_def_role, agent_def_id=agent_def_id,
            agent_def_name=agent_def_name, system_prompt=system_prompt,
            agent_run_id=agent_run_id, encrypted_api_key=encrypted_api_key, provider=provider,
        )
    except Exception as e:
        logger.error("bg_fatal  agent_run=%s  %s", agent_run_id, str(e), exc_info=True)
        await _broadcast(str(body.project_id), {
            "type": "agent_error",
            "agent_run_id": str(agent_run_id),
            "error": str(e),
        })


async def _run_agent_background_inner(
    *,
    body: AgentRunRequest,
    agent_def_role: str,
    agent_def_id: UUID,
    agent_def_name: str,
    system_prompt: str | None,
    agent_run_id: UUID,
    encrypted_api_key: str,
    provider: str,
) -> None:
    import time as _time
    logger.info("━━ agent_run=%s  agent=%s  role=%s", agent_run_id, agent_def_name, agent_def_role)
    logger.info("   command: %r", body.command)
    logger.info("   provider=%s  slide=%s  project=%s", provider, body.slide_id, body.project_id)
    from app.db.uow import UnitOfWork

    async with UnitOfWork() as uow:
        agent_run = await uow.agent_runs.get(agent_run_id)
        if not agent_run:
            logger.warning("   agent_run not found: %s", agent_run_id)
            return

        from app.services import slide_content as sc
        slide = await uow.slides.get(body.slide_id)
        components = sc.list_components(slide) if slide else []
        all_slides = await uow.slides.list_by_project(body.project_id)

        # 에이전트별 최근 대화 10턴 조회 (세션 유지)
        recent_msgs = await uow.chat_messages.list_by_project(
            body.project_id, agent_definition_id=agent_def_id, limit=20
        )
        conversation_history = ""
        if recent_msgs:
            lines = []
            for m in recent_msgs[-10:]:  # 마지막 10개
                role_label = "User" if m.role == "user" else "Agent"
                lines.append(f"{role_label}: {m.content}")
            conversation_history = "\n".join(lines)
            logger.info("   history: %d turns", len(lines))

        logger.info("   context: components=%d  slides=%d", len(components), len(all_slides))
        logger.info("   → LLM 호출 시작 (%s)", provider)
        t0 = _time.perf_counter()

        try:
            # 스트리밍 토큰 → SSE agent_token 이벤트
            token_buf: list[str] = []

            def _fire(payload: dict) -> None:
                import asyncio as _asyncio
                try:
                    loop = _asyncio.get_running_loop()
                    loop.create_task(_broadcast(str(body.project_id), payload))
                except RuntimeError:
                    pass

            def on_token(token: str) -> None:
                token_buf.append(token)
                _fire({
                    "type": "agent_token",
                    "agent_run_id": str(agent_run_id),
                    "token": token,
                    "accumulated": "".join(token_buf),
                })

            def on_event(event_type: str, message: str) -> None:
                _fire({
                    "type": "agent_node_event",
                    "agent_run_id": str(agent_run_id),
                    "event_type": event_type,   # node_start | node_done
                    "message": message,
                })

            patches, _, llm_summary = await run_agent(
                role=agent_def_role,
                command=body.command,
                components=components,
                encrypted_api_key=encrypted_api_key,
                provider=provider,
                system_prompt=system_prompt,
                all_slides=[{"id": str(s.id), "order": s.order, "title": s.title} for s in all_slides],
                on_token=on_token,
                on_event=on_event,
                conversation_history=conversation_history,
            )
            elapsed = (_time.perf_counter() - t0) * 1000

            logger.info("   ← LLM 완료  %.0fms  patches=%d", elapsed, len(patches))
            if llm_summary:
                logger.info("   summary: %s", llm_summary)
            for i, op in enumerate(patches[:5]):
                logger.info("   patch[%d]: op=%s  path=%s", i, op.get("op"), op.get("path"))
            if len(patches) > 5:
                logger.info("   patch[...]: +%d 더", len(patches) - 5)

            # 슬라이드 추가 op와 컴포넌트 op 분리
            slide_ops = [op for op in patches if op.get("path", "").startswith("/slides/")]
            comp_ops  = [op for op in patches if not op.get("path", "").startswith("/slides/")]
            logger.info("   comp_ops=%d  slide_ops=%d", len(comp_ops), len(slide_ops))

            # comp_ops → AgentProposal로 저장 (즉시 적용 안 함, 사용자 승인 대기)
            proposal_id = None
            if comp_ops:
                from app.models.agent_proposal import AgentProposal
                proposal = AgentProposal(
                    slide_id=body.slide_id,
                    agent_run_id=agent_run.id,
                    agent_name=agent_def_name,
                    command=body.command[:500],
                    patches=comp_ops,
                    summary=llm_summary or '',
                    status='pending',
                )
                uow.proposals.add(proposal)
                proposal_id = str(proposal.id)

            # 새 슬라이드 생성 op 처리
            new_slides = []
            if slide_ops:
                from app.services.project_service import create_slide_with_components
                for op in slide_ops[:5]:  # 한 번에 최대 5장
                    if op.get("op") == "add":
                        value = op.get("value", {})
                        components = value.get("components") or []
                        if not components:
                            logger.warning("   슬라이드 op에 components 없음 — 건너뜀: title=%r", value.get("title"))
                            continue
                        new_slide = await create_slide_with_components(
                            uow.slides,
                            project_id=body.project_id,
                            title=value.get("title"),
                            components=components,
                        )
                        new_slides.append(new_slide)
                        logger.info("   슬라이드 추가: id=%s  title=%r  components=%d",
                                    new_slide.id, value.get("title"), len(components))

            await agent_service.finalize_agent_run(
                uow.agent_runs, uow.llm_logs, agent_run, body.command, patches
            )

            affected_ids = list({
                op.get("path", "").strip("/").split("/")[0]
                for op in comp_ops if op.get("path", "").strip("/")
            })

            # summary 우선, 없으면 변경 수 표시
            stats = []
            if comp_ops: stats.append(f"컴포넌트 {len(comp_ops)}개 수정")
            if new_slides: stats.append(f"슬라이드 {len(new_slides)}장 추가")
            fallback_content = "、".join(stats) if stats else "변경 없음"
            agent_content = llm_summary if llm_summary else fallback_content

            agent_msg = ChatMessage(
                project_id=body.project_id,
                slide_id=body.slide_id,
                role="agent",
                content=agent_content,
                agent_run_id=agent_run.id,
                agent_definition_id=agent_def_id,
                agent_name=agent_def_name,
                affected_component_ids=affected_ids,
            )
            uow.chat_messages.add(agent_msg)

            broadcast_payload: dict = {
                "type": "agent_proposal" if proposal_id else "agent_done",
                "agent_run_id": str(agent_run.id),
                "agent_name": agent_def_name,
                "summary": agent_content,
                "slide_id": str(body.slide_id),
            }
            if proposal_id:
                broadcast_payload["proposal_id"] = proposal_id
                broadcast_payload["patches"] = comp_ops  # diff 미리보기용
            if new_slides:
                broadcast_payload["new_slides"] = [
                    {"id": str(s.id), "order": s.order, "title": s.title, "components": s.content}
                    for s in new_slides
                ]

            await uow.commit()  # broadcast 전에 먼저 커밋 — 클라이언트가 즉시 조회할 수 있도록
            logger.info("━━ DONE  agent_run=%s  affected=%s", agent_run_id, affected_ids)
            await _broadcast(str(body.project_id), broadcast_payload)

        except Exception as e:
            logger.error("━━ ERROR  agent_run=%s  %s", agent_run_id, str(e), exc_info=True)
            await agent_service.finalize_agent_run(
                uow.agent_runs, uow.llm_logs, agent_run, body.command, [], status="error", error=str(e)
            )
            error_msg = ChatMessage(
                project_id=body.project_id,
                slide_id=body.slide_id,
                role="agent",
                content=f"오류: {str(e)}",
                agent_run_id=agent_run.id,
                agent_definition_id=agent_def_id,
                agent_name=agent_def_name,
            )
            uow.chat_messages.add(error_msg)
            await uow.commit()
            await _broadcast(str(body.project_id), {
                "type": "agent_error",
                "agent_run_id": str(agent_run.id),
                "agent_name": agent_def_name,
                "error": str(e),
            })


@router.get("/chat/{project_id}", response_model=list[dict])
async def get_chat_history(
    project_id: UUID,
    current_user: CurrentUser,
    uow: UoW,
    agent_id: UUID | None = None,
):
    msgs = await uow.chat_messages.list_by_project(project_id, agent_definition_id=agent_id)
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "agent_run_id": str(m.agent_run_id) if m.agent_run_id else None,
            "agent_definition_id": str(m.agent_definition_id) if m.agent_definition_id else None,
            "agent_name": m.agent_name,
            "affected_component_ids": m.affected_component_ids,
            "slide_id": str(m.slide_id) if m.slide_id else None,
            "created_at": m.created_at.isoformat(),
        }
        for m in msgs
    ]


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


@router.get("/events/{project_id}")
async def sse_endpoint(request: Request, project_id: str):
    """SSE: 에이전트 실시간 이벤트 스트림 (agent_started / agent_done / agent_error)"""
    queue: asyncio.Queue = asyncio.Queue()
    _sse_queues.setdefault(project_id, []).append(queue)
    logger.info("sse_connect  project=%s  subs=%d", project_id, len(_sse_queues[project_id]))

    async def generator():
        try:
            yield {"event": "connected", "data": json_lib.dumps({"project_id": project_id})}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield {"event": msg.get("type", "message"), "data": json_lib.dumps(msg, default=str)}
                except asyncio.TimeoutError:
                    # keepalive ping
                    yield {"event": "ping", "data": "{}"}
        finally:
            _sse_queues.get(project_id, []).remove(queue) if queue in _sse_queues.get(project_id, []) else None
            logger.info("sse_disconnect  project=%s  subs=%d", project_id, len(_sse_queues.get(project_id, [])))

    return EventSourceResponse(generator())


async def _broadcast(project_id: str, message: dict) -> None:
    queues = _sse_queues.get(project_id, [])
    logger.debug("sse_broadcast  project=%s  subs=%d  type=%s", project_id, len(queues), message.get("type"))
    for q in list(queues):
        await q.put(message)
