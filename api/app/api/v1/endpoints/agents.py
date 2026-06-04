import asyncio
import json as json_lib
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.core.config import settings
from app.core.deps import CurrentUser, UoW
from app.models.chat import ChatMessage
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.services import agent_service
from app.services.agent_runner import build_slide_context_from_html, run_agent

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger("slidant.agent")

from app.api.v1.endpoints.ws import manager as ws_manager


def _sanitize_error(e: Exception) -> str:
    """기술적 에러 상세를 사용자 친화적 메시지로 변환."""
    msg = str(e)
    if "credit balance" in msg or "insufficient" in msg.lower():
        return "크레딧이 부족합니다. 설정에서 API 키를 확인하세요."
    if "length limit" in msg or "completion_tokens" in msg or "token" in msg.lower():
        return "요청이 너무 깁니다. 더 짧은 명령으로 나눠서 시도하세요."
    if "rate limit" in msg or "429" in msg:
        return "요청이 너무 많습니다. 잠시 후 다시 시도하세요."
    if "api key" in msg.lower() or "authentication" in msg.lower():
        return "API 키가 유효하지 않습니다. 설정에서 확인하세요."
    if "timeout" in msg.lower():
        return "응답 시간이 초과되었습니다. 다시 시도하세요."
    if "can only concatenate" in msg or "NoneType" in msg or "AttributeError" in msg:
        return "처리 중 오류가 발생했습니다. 다시 시도하세요."
    return f"오류가 발생했습니다: {msg[:80]}" if len(msg) > 80 else f"오류가 발생했습니다: {msg}"


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
        session_id=body.session_id,
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
            "error": _sanitize_error(e),
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
        project = await uow.projects.get(body.project_id)
        project_theme = project.theme if project else None

        # 에이전트별 최근 대화 10턴 조회 (세션 유지)
        recent_msgs = await uow.chat_messages.list_by_project(
            body.project_id, agent_definition_id=agent_def_id, session_id=body.session_id, limit=20
        )
        conversation_history = ""
        if recent_msgs:
            lines = []
            for m in recent_msgs[-10:]:  # 마지막 10개
                role_label = "User" if m.role == "user" else "Agent"
                lines.append(f"{role_label}: {m.content}")
            conversation_history = "\n".join(lines)
            logger.info("   history: %d turns", len(lines))

        # html_content 있으면 HTML 컨텍스트 사용
        if slide and slide.html_content:
            slide_context_override = build_slide_context_from_html(slide.html_content)
        else:
            slide_context_override = None

        logger.info("   context: components=%d  slides=%d  html_ctx=%s",
                    len(components), len(all_slides), bool(slide_context_override))
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

            import re as _re
            slide_scope_locked = bool(_re.search(r'@슬라이드\d+', body.command))

            run_kwargs = dict(
                role=agent_def_role,
                command=body.command,
                components=components,
                encrypted_api_key=encrypted_api_key,
                provider=provider,
                system_prompt=system_prompt,
                all_slides=[{
                    "id": str(s.id),
                    "order": s.order,
                    "title": s.title,
                    "components": list(s.content or []),
                    "html_content": s.html_content or "",  # 멀티 슬라이드 타겟팅용
                } for s in all_slides],
                theme=project_theme,
                slide_scope_locked=slide_scope_locked,
                on_token=on_token,
                on_event=on_event,
                conversation_history=conversation_history,
                html_mode=True,
            )
            patches, _, llm_summary, html_output, html_slides, delete_slide = await run_agent(**run_kwargs)
            elapsed = (_time.perf_counter() - t0) * 1000

            logger.info("   ← LLM 완료  %.0fms  patches=%d  html=%d  html_slides=%d  delete=%s",
                        elapsed, len(patches), len(html_output), len(html_slides), delete_slide)
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

            # 슬라이드 삭제 모드
            if delete_slide and slide:
                from app.repositories.slide import SlideRepository
                slide_repo = SlideRepository(uow.session)
                await slide_repo.delete(slide)
                logger.info("   슬라이드 삭제 완료: %s", body.slide_id)
                await uow.commit()
                await _broadcast(str(body.project_id), {
                    "type": "slide_deleted",
                    "slide_id": str(body.slide_id),
                    "summary": llm_summary or "슬라이드가 삭제되었습니다.",
                })
                return

            # HTML 모드: html_output → 컴포넌트 레벨 CRDT 업데이트 + DB 저장
            if html_output and slide:
                from app.services import slide_history_service
                from app.services import crdt as crdt_svc

                reason = f'{agent_def_name}: {body.command[:120]}'
                await slide_history_service.archive_and_apply(
                    uow, body.slide_id, list(slide.content or []),
                    reason, agent_name=agent_def_name, html_content=html_output
                )
                logger.info("   HTML 즉시 적용: %d chars → slide %s", len(html_output), body.slide_id)

                # CRDT 컴포넌트 레벨 업데이트
                project_id_str = str(body.project_id)
                slide_id_str = str(body.slide_id)
                if crdt_svc.get_doc(project_id_str):
                    upd, conflicted = crdt_svc.apply_agent_html(
                        project_id_str, slide_id_str, html_output, agent_name=agent_def_name
                    )
                    if upd:
                        await ws_manager.broadcast_bytes(project_id_str, upd)
                    # 충돌 발생 시 conflict 이벤트 브로드캐스트
                    if conflicted:
                        logger.warning("   컴포넌트 충돌 감지: %s", conflicted)
                        await _broadcast(project_id_str, {
                            "type": "component_conflict",
                            "slide_id": slide_id_str,
                            "component_ids": conflicted,
                            "agent_name": agent_def_name,
                        })
                    # 작업 완료 후 컴포넌트 점유 해제
                    crdt_svc.release_agent_lock(project_id_str, slide_id_str, agent_def_name)
            elif comp_ops and slide:
                # 기존 JSON patch fallback
                from app.services.slide_content import apply_patches
                from app.services import slide_history_service
                class _Target:
                    def __init__(self, content): self.content = content
                target = _Target(list(slide.content or []))
                apply_patches(target, comp_ops)
                reason = f'{agent_def_name}: {body.command[:120]}'
                await slide_history_service.archive_and_apply(
                    uow, body.slide_id, target.content, reason, agent_name=agent_def_name
                )
                logger.info("   comp_ops 즉시 적용: %d ops → slide %s", len(comp_ops), body.slide_id)

            # 새 슬라이드 생성 처리
            new_slides = []
            if html_slides:
                from app.models.slide import Slide as SlideModel
                from app.services import slide_history_service
                specs = html_slides[:5]
                # 첫 번째 슬라이드 → 현재 슬라이드에 적용 (빈 슬라이드 덮어씀)
                if specs and slide:
                    first = specs[0]
                    reason = f'{agent_def_name}: {body.command[:120]}'
                    await slide_history_service.archive_and_apply(
                        uow, body.slide_id, list(slide.content or []),
                        reason, agent_name=agent_def_name, html_content=first.get("html", "")
                    )
                    if first.get("title") and not slide.title:
                        slide.title = first["title"]
                    logger.info("   HTML[0] → 현재 슬라이드 적용: title=%r  html=%d chars",
                                first.get("title"), len(first.get("html", "")))
                # 나머지 슬라이드 → 신규 생성 (edit 명령이면 건너뜀)
                edit_keywords = ("수정", "변경", "바꿔", "적용", "고쳐", "다시")
                is_edit_cmd = any(k in body.command for k in edit_keywords)
                if is_edit_cmd:
                    logger.info("   edit 명령 감지 → 추가 슬라이드 생성 건너뜀 (%d개)", len(specs) - 1)
                for slide_spec in ([] if is_edit_cmd else specs[1:]):
                    new_slide = SlideModel(
                        project_id=body.project_id,
                        title=slide_spec.get("title", ""),
                        html_content=slide_spec.get("html", ""),
                        content=[],
                    )
                    uow.slides.add(new_slide)
                    new_slides.append(new_slide)
                    logger.info("   HTML 슬라이드 추가: title=%r  html=%d chars",
                                slide_spec.get("title"), len(slide_spec.get("html", "")))
            elif slide_ops:
                from app.services.project_service import create_slide_with_components
                for op in slide_ops[:5]:  # 한 번에 최대 5장
                    if op.get("op") == "add":
                        value = op.get("value", {})
                        op_components = value.get("components") or []
                        if not op_components:
                            logger.warning("   슬라이드 op에 components 없음 — 건너뜀: title=%r", value.get("title"))
                            continue
                        new_slide = await create_slide_with_components(
                            uow.slides,
                            project_id=body.project_id,
                            title=value.get("title"),
                            components=op_components,
                        )
                        new_slides.append(new_slide)
                        logger.info("   슬라이드 추가: id=%s  title=%r  components=%d",
                                    new_slide.id, value.get("title"), len(op_components))

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
                session_id=body.session_id,
            )
            uow.chat_messages.add(agent_msg)

            # 프레젠테이션 제목 자동 설정 (기본값인 경우만)
            if project and (not project.title or project.title in ("제목 없는 프레젠테이션", "Untitled")):
                # llm_summary 첫 줄에서 제목 추출
                if llm_summary:
                    # "N장 PPT — WARM 팔레트" → "N장 PPT" 앞부분 또는 첫 슬라이드 제목 사용
                    candidate = llm_summary.split("—")[0].split("·")[0].strip()
                    candidate = candidate.split("\n")[0].strip()
                    if 3 <= len(candidate) <= 50:
                        project.title = candidate
                        logger.info("   프레젠테이션 제목 자동 설정: %r", candidate)

            broadcast_payload: dict = {
                "type": "agent_done",
                "agent_run_id": str(agent_run.id),
                "agent_name": agent_def_name,
                "summary": agent_content,
                "slide_id": str(body.slide_id),
            }
            if html_output:
                broadcast_payload["html_content"] = html_output
            if new_slides:
                broadcast_payload["new_slides"] = [
                    {"id": str(s.id), "order": s.order, "title": s.title,
                     "components": s.content, "html_content": s.html_content}
                    for s in new_slides
                ]

            await uow.commit()  # broadcast 전에 먼저 커밋
            logger.info("━━ DONE  agent_run=%s  affected=%s", agent_run_id, affected_ids)

            # 새 슬라이드 CRDT 등록
            from app.services import crdt as crdt_svc
            project_id_str = str(body.project_id)
            if crdt_svc.get_doc(project_id_str):
                for s in new_slides:
                    upd = crdt_svc.add_slide_to_doc(
                        project_id_str, str(s.id), s.html_content or "", s.title or ""
                    )
                    if upd:
                        await ws_manager.broadcast_bytes(project_id_str, upd)

            await _broadcast(project_id_str, broadcast_payload)

        except Exception as e:
            logger.error("━━ ERROR  agent_run=%s  %s", agent_run_id, str(e), exc_info=True)
            await agent_service.finalize_agent_run(
                uow.agent_runs, uow.llm_logs, agent_run, body.command, [], status="error", error=str(e)
            )
            error_msg = ChatMessage(
                project_id=body.project_id,
                slide_id=body.slide_id,
                role="agent",
                content=f"오류: {_sanitize_error(e)}",
                agent_run_id=agent_run.id,
                agent_definition_id=agent_def_id,
                agent_name=agent_def_name,
                session_id=body.session_id,
            )
            uow.chat_messages.add(error_msg)
            await uow.commit()
            await _broadcast(str(body.project_id), {
                "type": "agent_error",
                "agent_run_id": str(agent_run.id),
                "agent_name": agent_def_name,
                "error": _sanitize_error(e),
            })


@router.get("/chat/{project_id}", response_model=list[dict])
async def get_chat_history(
    project_id: UUID,
    current_user: CurrentUser,
    uow: UoW,
    agent_id: UUID | None = None,
    session_id: UUID | None = None,
):
    msgs = await uow.chat_messages.list_by_project(project_id, agent_definition_id=agent_id, session_id=session_id)
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
async def _broadcast(project_id: str, message: dict) -> None:
    logger.debug("ws_broadcast  project=%s  peers=%d  type=%s",
                 project_id, ws_manager.peer_count(project_id), message.get("type"))
    await ws_manager.broadcast_json(project_id, message)
