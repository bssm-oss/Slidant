import asyncio
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.deps import CurrentUser, UoW
from app.core.domain.slide_sanitizer import sanitize_slide_html
from app.models.chat import ChatMessage
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.services import agent_service
from app.services.agent_runner import build_slide_context_from_html, generate_presentation_title, run_agent

router = APIRouter(prefix="/agent", tags=["agent"])
logger = logging.getLogger("slidant.agent")

from app.api.v1.endpoints.ws import manager as ws_manager

# agent_run_id → asyncio.Task (취소용)
_running_tasks: dict[str, asyncio.Task] = {}


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
    agent_run = await agent_service.create_agent_run(
        uow.agent_runs,
        body.project_id,
        agent_def.id,
        task_description=body.command,
        agent_name=agent_def.name,
        affected_slide_id=body.slide_id,
        user_id=current_user.id,
    )


    # 사용자 채팅 메시지 즉시 저장
    user_msg = ChatMessage(
        project_id=body.project_id,
        slide_id=body.slide_id,
        role="user",
        content=body.command,
        agent_definition_id=agent_def.id,
        agent_name=agent_def.name,
        session_id=body.session_id,
        user_id=current_user.id,
    )
    uow.chat_messages.add(user_msg)
    await uow.commit()  # BackgroundTask 전에 커밋 필수 (bg에서 조회 가능하도록)

    # asyncio.Task로 실행 (취소 가능)
    task = asyncio.create_task(_run_agent_background(
        body=body,
        agent_def_id=agent_def.id,
        agent_def_name=agent_def.name,
        agent_def_role=agent_def.role,
        system_prompt=system_prompt,
        agent_run_id=agent_run.id,
        encrypted_api_key=api_key.encrypted_key if api_key else "",
        provider=provider,
        user_id=current_user.id,
    ))
    _running_tasks[str(agent_run.id)] = task
    task.add_done_callback(lambda _: _running_tasks.pop(str(agent_run.id), None))

    await _broadcast(str(body.project_id), {
        "type": "agent_started",
        "agent_run_id": str(agent_run.id),
        "agent_name": agent_def.name,
        "role": agent_def.role,
        "command": body.command,
        "user_id": str(current_user.id),
        "session_id": str(body.session_id) if body.session_id else None,
    })

    return agent_run


@router.delete("/run/{agent_run_id}", status_code=status.HTTP_200_OK)
async def cancel_agent_run(
    agent_run_id: UUID,
    current_user: CurrentUser,
    uow: UoW,
):
    run_id_str = str(agent_run_id)
    task = _running_tasks.pop(run_id_str, None)
    if task and not task.done():
        task.cancel()

    agent_run = await uow.agent_runs.get(agent_run_id)
    if agent_run:
        agent_run.status = "cancelled"
        await uow.commit()
        await _broadcast(str(agent_run.project_id), {
            "type": "agent_error",
            "agent_run_id": run_id_str,
            "error": "사용자가 작업을 취소했습니다.",
        })

    return {"status": "cancelled"}


async def _update_presentation_title(
    *, project_id: UUID, command: str, encrypted_api_key: str, provider: str
) -> None:
    """프레젠테이션 제목 자동 생성 — agent_done 이후 백그라운드에서 실행."""
    from app.db.uow import UnitOfWork
    candidate = await generate_presentation_title(command, encrypted_api_key, provider)
    if not candidate:
        return

    DEFAULT_TITLES = (
        "제목 없는 프레젠테이션", "Untitled", "Untitled Presentation",
        "제목 없음", "새 프레젠테이션", "슬라이드",
    )
    try:
        async with UnitOfWork() as uow:
            project = await uow.projects.get(project_id)
            if project and (
                not project.title or 
                project.title.strip() in DEFAULT_TITLES or
                not project.title.strip()
            ):
                project.title = candidate
                await uow.commit()
                logger.info("   프레젠테이션 제목 자동 설정: %r (기존: %r)", candidate, project.title)
                
                # 실시간 동기화를 위해 브로드캐스트
                from app.api.v1.endpoints.ws import manager as ws_manager
                await ws_manager.broadcast_json(str(project_id), {
                    "type": "project_updated",
                    "project_id": str(project_id),
                    "title": candidate
                })
    except Exception as e:
        logger.warning("title_update failed: %s", e)


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
    user_id: UUID,
) -> None:
    """LLM 호출 + patch 적용 — HTTP 응답과 분리된 백그라운드 작업"""
    logger.info("bg_start  agent_run=%s  role=%s  command=%r",
                agent_run_id, agent_def_role, body.command[:60])
    try:
        await _run_agent_background_inner(
            body=body, agent_def_role=agent_def_role, agent_def_id=agent_def_id,
            agent_def_name=agent_def_name, system_prompt=system_prompt,
            agent_run_id=agent_run_id, encrypted_api_key=encrypted_api_key, provider=provider,
            user_id=user_id,
        )
    except Exception as e:
        logger.error("bg_fatal  agent_run=%s  %s", agent_run_id, str(e), exc_info=True)
        # 내부 error handler가 실패해도 DB status를 "running"에서 꺼냄
        # (그렇지 않으면 Redis TTL 만료 후 재연결 시 가짜 agent_started 전송 → 영구 "처리 중...")
        try:
            from app.db.uow import UnitOfWork as _FatalUoW
            async with _FatalUoW() as fatal_uow:
                fatal_run = await fatal_uow.agent_runs.get(agent_run_id)
                if fatal_run and fatal_run.status == "running":
                    fatal_run.status = "error"
                    await fatal_uow.commit()
        except Exception as _fe:
            logger.warning("bg_fatal_finalize_failed  agent_run=%s  %s", agent_run_id, _fe)
        await _broadcast(str(body.project_id), {
            "type": "agent_error",
            "agent_run_id": str(agent_run_id),
            "user_id": str(user_id),
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
    user_id: UUID,
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
        import re as _re
        slide = await uow.slides.get(body.slide_id)
        all_slides = await uow.slides.list_by_project(body.project_id)
        project = await uow.projects.get(body.project_id)
        project_theme = project.theme if project else None

        # @슬라이드N 멘션 → 타겟 슬라이드 early override (context/components/proposal 모두 반영)
        # UI는 1-indexed, DB order는 0-indexed → N-1 변환
        _mention_match = _re.search(r'@슬라이드(\d+)', body.command)
        if _mention_match:
            _target_order = int(_mention_match.group(1)) - 1
            _target_slide = next((s for s in all_slides if s.order == _target_order), None)
            if _target_slide:
                slide = _target_slide
                logger.info("   @슬라이드%d 멘션 → target slide override: %s (order=%d)", int(_mention_match.group(1)), _target_slide.id, _target_order)

        components = sc.list_components(slide) if slide else []

        # 에이전트별 최근 대화 10턴 조회 (세션 유지)
        recent_msgs = await uow.chat_messages.list_by_project(
            body.project_id, session_id=body.session_id, limit=20
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
                    "user_id": str(user_id),
                    "token": token,
                    "accumulated": "".join(token_buf),
                })

            # slide_ready 즉시 DB 저장용 인덱스 → slide_id 매핑 (생성 순서 기준)
            _slide_ready_slots: dict[int, str] = {}  # index → placeholder slide_id
            _interim_tasks: list = []  # is_full_replace DELETE 전 drain용

            def on_event(event_type: str, message: str) -> None:
                _fire({
                    "type": "agent_node_event",
                    "agent_run_id": str(agent_run_id),
                    "user_id": str(user_id),
                    "event_type": event_type,
                    "message": message,
                })

                # slide_ready: 생성 즉시 DB에 중간 저장 (새로고침 시 복원용)
                # 편집 모드(@슬라이드N)에서는 기존 슬라이드 직접 덮어쓰기 금지 — proposal 흐름 사용
                if event_type == "slide_ready" and not slide_scope_locked:
                    import json as _json
                    import asyncio as _asyncio
                    try:
                        data = _json.loads(message)
                        idx  = data.get("index", 0)
                        html = data.get("html", "")
                        title = data.get("title", "")
                        if html:
                            _t = _asyncio.get_running_loop().create_task(
                                _save_slide_ready(
                                    project_id=body.project_id,
                                    index=idx,
                                    title=title,
                                    html=html,
                                    slot_map=_slide_ready_slots,
                                )
                            )
                            _interim_tasks.append(_t)
                    except Exception as _e:
                        logger.debug("slide_ready interim save parse error: %s", _e)

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
                cached_search_summary=(project.search_summary or "") if project else "",
                slide_html_content=(slide.html_content or "") if slide else "",
            )
            patches, _, llm_summary, html_output, html_slides, delete_slide, search_cache, agent_mode, design_tokens = await run_agent(**run_kwargs)

            # 새 검색 결과 있으면 프로젝트에 캐시 저장
            if search_cache:
                await uow.projects.update_search_cache(
                    body.project_id,
                    search_cache["summary"],
                    search_cache["queries"],
                )

            # 전체 프레젠테이션 교체 판단
            is_edit_cmd = (agent_mode == "edit") or slide_scope_locked
            _creation_keywords = ("만들어", "생성", "제작", "PPT", "ppt", "프레젠테이션", "작성")
            _n_slides_creation = (
                _re.search(r'\d+\s*장', body.command)
                and any(k in body.command for k in _creation_keywords)
                and not is_edit_cmd
            )
            is_full_replace = (
                bool(html_slides)
                and not is_edit_cmd
                and (len(html_slides) >= 2 or _n_slides_creation)
            )

            # 새 테마가 있고, 전체 교체(신규 생성)이거나 명시적 테마 변경 의도가 있는 경우 프로젝트 테마 업데이트
            if design_tokens and project and (is_full_replace or any(k in body.command for k in ("테마", "색상", "디자인", "palette", "theme"))):
                project.theme = design_tokens
                logger.info("   프로젝트 테마 업데이트: %s", design_tokens.get("palette", "CUSTOM"))
                await ws_manager.broadcast_json(str(project.id), {
                    "type": "project_updated",
                    "project_id": str(project.id),
                    "theme": design_tokens
                })

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

            # 슬라이드 삭제 처리 (delete_slide=True)
            # delete만 있으면 즉시 반환; delete+create 혼합이면 삭제 후 계속 진행
            if delete_slide and slide:
                from app.repositories.slide import SlideRepository
                slide_repo = SlideRepository(uow.session)
                await slide_repo.delete(slide)
                logger.info("   슬라이드 삭제 완료: %s", body.slide_id)
                slide = None  # 이후 slide 참조 불가 — None으로 표시
                if not html_slides:
                    # 순수 삭제 — 새 슬라이드 없음 → 즉시 종료
                    await uow.commit()
                    await _broadcast(str(body.project_id), {
                        "type": "slide_deleted",
                        "slide_id": str(body.slide_id),
                        "summary": llm_summary or "슬라이드가 삭제되었습니다.",
                    })
                    return
                # delete+create 혼합: 삭제 완료, 아래에서 html_slides 전량 신규 생성 진행


            # HTML 모드: html_output → Proposal 저장 (사용자 승인 후 적용)
            # is_full_replace면 현재 슬라이드 자체가 삭제되므로 Proposal 생성 스킵
            # (LLM이 html과 slides를 동시에 반환하는 경우 모순 연산 방지)
            _proposal_obj = None
            if html_output and slide and not is_full_replace:
                from app.models.agent_proposal import AgentProposal as _AgentProposal
                html_sanitized = sanitize_slide_html(html_output)
                _proposal_obj = _AgentProposal(
                    slide_id=slide.id,
                    agent_run_id=agent_run.id,
                    agent_name=agent_def_name,
                    command=body.command,
                    patches=[],
                    summary=llm_summary,
                    html_content=html_sanitized,
                    base_html_content=slide.html_content or "",
                    status='pending',
                )
                uow.proposals.add(_proposal_obj)
                logger.info("   HTML 변경 제안 저장: proposal=%s  %d chars", _proposal_obj.id, len(html_sanitized))
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
                specs = html_slides

                if is_full_replace:
                    # 기존 슬라이드 전량 삭제 전 interim save 태스크 완료 대기
                    # (race: _save_slide_ready가 DELETE 이후에 INSERT하면 고아 슬라이드 생성됨)
                    if _interim_tasks:
                        import asyncio as _asyncio
                        await _asyncio.gather(*_interim_tasks, return_exceptions=True)

                    # 기존 슬라이드 전량 삭제 후 fresh 생성 (order 0부터 재배치)
                    # body.slide_id는 이미 삭제됐을 수 있음(delete_slide=True), 아니면 지금 삭제
                    existing_slides = await uow.slides.list_by_project(body.project_id)
                    existing_ids = [ex.id for ex in existing_slides]
                    if existing_ids:
                        from sqlalchemy import text as _sql_text
                        # 자식 rows 먼저 삭제 (relationship + CASCADE 미선언으로 ORM이 순서 보장 못 함)
                        for _tbl, _col in (
                            ("component_history", "slide_id"),
                            ("slide_history", "slide_id"),
                            ("agent_proposals", "slide_id"),
                            ("slides", "id"),
                        ):
                            await uow.session.execute(
                                _sql_text(f"DELETE FROM {_tbl} WHERE {_col} = ANY(:ids)"),
                                {"ids": existing_ids},
                            )
                        await uow.session.flush()
                    logger.info("   기존 슬라이드 %d장 전량 제거 (전체 교체)", len(existing_slides))
                    reason = f'{agent_def_name}: {body.command[:120]}'
                    created: list[tuple] = []
                    for i, spec in enumerate(specs):
                        new_slide = SlideModel(
                            project_id=body.project_id,
                            title=spec.get("title", ""),
                            html_content=sanitize_slide_html(spec.get("html", "")),
                            content=[],
                            order=i,
                        )
                        uow.slides.add(new_slide)
                        created.append((new_slide, spec))
                    # Slide INSERT를 먼저 flush — component_history.slide_id FK가
                    # 아직 존재하지 않는 슬라이드를 참조하지 않도록 보장
                    await uow.session.flush()
                    for i, (new_slide, spec) in enumerate(created):
                        slide_history_service.record_initial_slide(uow, new_slide, reason, agent_def_name)
                        new_slides.append(new_slide)
                        logger.info("   HTML 슬라이드 생성 (fresh %d/%d): title=%r",
                                    i + 1, len(specs), spec.get("title"))

                elif specs and slide and _proposal_obj is None:
                    first = specs[0]
                    first_html = sanitize_slide_html(first.get("html", ""))
                    if is_edit_cmd:
                        # planner mode="edit" 또는 @슬라이드N — LLM이 html 대신 slides
                        # 포맷으로 응답한 경우 — html_output과 동일하게 Proposal 경로로 보내야 함
                        # (여기서 즉시 적용하면 "Agent 편집은 승인 후 반영" 원칙 위반 + 사용자가
                        #  검토·거절할 수단이 사라짐)
                        from app.models.agent_proposal import AgentProposal as _AgentProposal
                        _proposal_obj = _AgentProposal(
                            slide_id=slide.id,
                            agent_run_id=agent_run.id,
                            agent_name=agent_def_name,
                            command=body.command,
                            patches=[],
                            summary=llm_summary,
                            html_content=first_html,
                            base_html_content=slide.html_content or "",
                            status='pending',
                        )
                        uow.proposals.add(_proposal_obj)
                        logger.info("   HTML[0]→Proposal 변환 저장 (slides 포맷 edit 응답): proposal=%s  %d chars",
                                    _proposal_obj.id, len(first_html))
                    else:
                        # 단일 슬라이드 생성: specs[0]→현재 슬라이드 덮어쓰기 (즉시 적용)
                        reason = f'{agent_def_name}: {body.command[:120]}'
                        await slide_history_service.archive_and_apply(
                            uow, body.slide_id, list(slide.content or []),
                            reason, agent_name=agent_def_name,
                            html_content=first_html,
                        )
                        if first.get("title") and not slide.title:
                            slide.title = first["title"]
                        logger.info("   HTML[0] → 현재 슬라이드 적용: title=%r  html=%d chars",
                                    first.get("title"), len(first_html))
                        base_order = await uow.slides.get_last_order(body.project_id)
                        for i, spec in enumerate(specs[1:]):
                            new_slide = SlideModel(
                                project_id=body.project_id,
                                title=spec.get("title", ""),
                                html_content=sanitize_slide_html(spec.get("html", "")),
                                content=[],
                                order=base_order + i,
                            )
                            uow.slides.add(new_slide)
                            slide_history_service.record_initial_slide(uow, new_slide, reason, agent_def_name)
                            new_slides.append(new_slide)
                            logger.info("   HTML 슬라이드 추가: title=%r", spec.get("title"))
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

            await agent_service.finalize_agent_run(
                uow.agent_runs, uow.llm_logs, agent_run, body.command, patches,
                result_summary=agent_content,
                provider=provider,
            )

            # is_full_replace: 원본 슬라이드 삭제됐으므로 chat_message.slide_id를
            # 첫 새 슬라이드 ID로 교체 (nullable이지만 새 슬라이드 연결이 더 올바름)
            effective_slide_id = new_slides[0].id if (is_full_replace and new_slides) else body.slide_id

            agent_msg = ChatMessage(
                project_id=body.project_id,
                slide_id=effective_slide_id,
                role="agent",
                content=agent_content,
                agent_run_id=agent_run.id,
                agent_definition_id=agent_def_id,
                agent_name=agent_def_name,
                affected_component_ids=affected_ids,
                session_id=body.session_id,
                user_id=user_id,
            )
            uow.chat_messages.add(agent_msg)

            # 제목 자동 생성 조건: 현재 제목이 없거나 기본 제목인 경우
            DEFAULT_TITLES = (
                "제목 없는 프레젠테이션", "Untitled", "Untitled Presentation",
                "제목 없음", "새 프레젠테이션", "슬라이드",
            )
            needs_title_update = project and (
                not project.title or 
                project.title.strip() in DEFAULT_TITLES or
                not project.title.strip()
            )

            broadcast_payload: dict = {
                "type": "agent_done",
                "agent_run_id": str(agent_run.id),
                "agent_name": agent_def_name,
                "summary": agent_content,
                "slide_id": str(body.slide_id),
                "user_id": str(user_id),
            }
            if _proposal_obj:
                # html_output edit → 제안 대기 (미적용), 슬라이드 즉시 반영 X
                broadcast_payload["proposal"] = {
                    "id": str(_proposal_obj.id),
                    "html_content": _proposal_obj.html_content,
                    "summary": llm_summary,
                    "slide_id": str(body.slide_id),
                    "agent_name": agent_def_name,
                }
            elif html_output:
                broadcast_payload["html_content"] = sanitize_slide_html(html_output)
            if new_slides:
                broadcast_payload["new_slides"] = [
                    {"id": str(s.id), "order": s.order, "title": s.title,
                     "components": s.content, "html_content": s.html_content}
                    for s in new_slides
                ]

            await uow.commit()  # broadcast 전에 먼저 커밋
            logger.info("━━ DONE  agent_run=%s  affected=%s", agent_run_id, affected_ids)

            # 다른 커넥션에 새 대화 메시지 알림 (크로스유저 실시간 동기화)
            if body.session_id:
                await ws_manager.broadcast_json(str(body.project_id), {
                    "type": "chat_message",
                    "session_id": str(body.session_id),
                    "user_id": str(user_id),
                    "messages": [
                        {"role": "agent", "content": agent_content,
                         "agent_name": agent_def_name, "agent_definition_id": str(agent_def_id)},
                    ],
                })

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

            # 제목 생성은 agent_done 이후 백그라운드에서 (SSE 지연 없음)
            if needs_title_update:
                asyncio.create_task(_update_presentation_title(
                    project_id=body.project_id,
                    command=body.command,
                    encrypted_api_key=encrypted_api_key,
                    provider=provider,
                ))

        except Exception as e:
            logger.error("━━ ERROR  agent_run=%s  %s", agent_run_id, str(e), exc_info=True)
            # 원본 uow는 flush 실패로 PendingRollbackError 상태일 수 있음 (예: FK 위반).
            # 같은 세션을 재사용하면 finalize도 함께 실패해 agent_run.status가
            # "running"에 영원히 묶여 새로고침마다 무한 "처리 중"이 재현됨 → 새 세션으로 종료 처리.
            from app.db.uow import UnitOfWork as _ErrUoW
            async with _ErrUoW() as err_uow:
                err_run = await err_uow.agent_runs.get(agent_run_id)
                if err_run:
                    await agent_service.finalize_agent_run(
                        err_uow.agent_runs, err_uow.llm_logs, err_run, body.command, [], status="error", error=str(e)
                    )
                err_uow.chat_messages.add(ChatMessage(
                    project_id=body.project_id,
                    slide_id=body.slide_id,
                    role="agent",
                    content=f"오류: {_sanitize_error(e)}",
                    agent_run_id=agent_run_id,
                    agent_definition_id=agent_def_id,
                    agent_name=agent_def_name,
                    session_id=body.session_id,
                    user_id=user_id,
                ))
                await err_uow.commit()
            await _broadcast(str(body.project_id), {
                "type": "agent_error",
                "agent_run_id": str(agent_run.id),
                "agent_name": agent_def_name,
                "user_id": str(user_id),
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
            "message_type": m.message_type,
            "metadata": m.extra_data,
        }
        for m in msgs
    ]


class SaveStepsMessageRequest(BaseModel):
    agent_name: str
    steps: list[dict]
    agent_definition_id: UUID | None = None
    session_id: UUID | None = None
    created_at: datetime | None = None


@router.post("/chat/{project_id}/steps", status_code=201)
async def save_steps_message(
    project_id: UUID,
    body: SaveStepsMessageRequest,
    current_user: CurrentUser,
    uow: UoW,
):
    msg = ChatMessage(
        project_id=project_id,
        role="agent",
        content="",
        agent_name=body.agent_name,
        agent_definition_id=body.agent_definition_id,
        session_id=body.session_id,
        user_id=current_user.id,
        message_type="steps",
        extra_data={"steps": body.steps},
    )
    if body.created_at:
        msg.created_at = body.created_at.replace(tzinfo=None)
    uow.chat_messages.add(msg)
    await uow.commit()
    return {"id": str(msg.id)}


@router.get("/logs/{project_id}", response_model=list[dict])
async def get_agent_logs(project_id: UUID, current_user: CurrentUser, uow: UoW):
    runs_with_user = await uow.agent_runs.list_by_project(project_id)
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "agent_name": r.agent_name,
            "task_description": r.task_description,
            "result_summary": r.result_summary,
            "affected_slide_id": str(r.affected_slide_id) if r.affected_slide_id else None,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "user_id": str(r.user_id) if r.user_id else None,
            "user_email": email,
        }
        for r, email in runs_with_user
    ]


@router.get("/logs/{project_id}/run/{run_id}/slide-changes", response_model=list[dict])
async def get_run_slide_changes(
    project_id: UUID, run_id: UUID,
    current_user: CurrentUser, uow: UoW,
):
    from collections import defaultdict
    from datetime import timedelta
    from app.core.domain.history_diff import _parse_html_components

    run = await uow.agent_runs.get(run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    slides = await uow.slides.list_by_project(project_id)
    slide_map = {s.id: s for s in slides}

    def _make_result(slide_id, before_html, after_html):
        slide = slide_map.get(slide_id)
        old_map = _parse_html_components(before_html or "")
        new_map = _parse_html_components(after_html or "")
        all_ids = set(old_map) | set(new_map)
        added, removed, modified = [], [], []
        for comp_id in all_ids:
            old = old_map.get(comp_id)
            new = new_map.get(comp_id)
            if old is None and new is not None:
                added.append(comp_id)
            elif old is not None and new is None:
                removed.append(comp_id)
            elif old != new:
                modified.append(comp_id)
        return {
            "slide_id": str(slide_id),
            "slide_order": slide.order if slide else 0,
            "slide_title": slide.title if slide else "",
            "before_html": before_html or None,
            "after_html": after_html,
            "added": sorted(added),
            "removed": sorted(removed),
            "modified": sorted(modified),
        }

    # 1) 에이전트가 제안(Proposal)을 남긴 경우 — 승인 여부/타이밍 무관
    proposals = await uow.proposals.list_by_run(run_id)
    html_proposals = [p for p in proposals if p.html_content]
    proposal_slide_ids: set = set()
    results = []

    if html_proposals:
        by_slide: dict = defaultdict(list)
        for p in html_proposals:
            by_slide[p.slide_id].append(p)
        for slide_id, slide_proposals in by_slide.items():
            first_p = slide_proposals[0]
            last_p = slide_proposals[-1]
            results.append(_make_result(
                slide_id,
                first_p.base_html_content or "",
                last_p.html_content,
            ))
            proposal_slide_ids.add(slide_id)

    # 2) Proposal 없는 슬라이드(신규 생성 등) — 시간 범위 기반 SlideHistory 조회
    if run.started_at and run.finished_at:
        slide_ids = [s.id for s in slides if s.id not in proposal_slide_ids]
        if slide_ids:
            end_dt = run.finished_at + timedelta(seconds=5)
            entries = await uow.slide_history.list_by_slides_in_timerange(slide_ids, run.started_at, end_dt)
            by_slide_hist: dict = defaultdict(list)
            for e in entries:
                by_slide_hist[e.slide_id].append(e)
            for slide_id, slide_entries in by_slide_hist.items():
                slide_entries.sort(key=lambda e: e.created_at)
                first_entry = slide_entries[0]
                last_entry = slide_entries[-1]
                before_html = first_entry.html_content
                next_entry = await uow.slide_history.get_next_entry(slide_id, last_entry.created_at)
                slide = slide_map.get(slide_id)
                after_html = next_entry.html_content if next_entry else (slide.html_content if slide else None)
                results.append(_make_result(slide_id, before_html, after_html))

    results.sort(key=lambda r: r["slide_order"])
    return results


async def _save_slide_ready(
    *,
    project_id,
    index: int,
    title: str,
    html: str,
    slot_map: dict,
) -> None:
    """slide_ready 이벤트 수신 즉시 DB에 중간 저장.

    새로고침/SSE 단절 시 이미 생성된 슬라이드를 복원하기 위한 즉시 커밋.
    - 같은 index의 슬라이드가 이미 DB에 있으면 html_content 업데이트
    - 없으면 임시 슬라이드 생성 (agent_done의 is_full_replace가 나중에 정리)
    """
    from app.db.uow import UnitOfWork
    from app.models.slide import Slide as SlideModel
    from app.core.domain.slide_sanitizer import sanitize_slide_html

    try:
        async with UnitOfWork() as uow:
            existing = await uow.slides.list_by_project(project_id)
            # order=index 슬라이드 찾기
            target = next((s for s in existing if s.order == index), None)
            html_safe = sanitize_slide_html(html)
            if target:
                target.html_content = html_safe
                if title:
                    target.title = title
                logger.debug("slide_ready interim update: project=%s idx=%d", project_id, index)
            else:
                new_s = SlideModel(
                    project_id=project_id,
                    title=title or f"슬라이드 {index + 1}",
                    html_content=html_safe,
                    content=[],
                    order=index,
                )
                uow.slides.add(new_s)
                slot_map[index] = str(new_s.id) if hasattr(new_s, "id") else ""
                logger.debug("slide_ready interim insert: project=%s idx=%d", project_id, index)
            await uow.commit()
    except Exception as exc:
        logger.warning("slide_ready interim save failed (non-fatal): %s", exc)


async def _broadcast(project_id: str, message: dict) -> None:
    logger.debug("ws_broadcast  project=%s  peers=%d  type=%s",
                 project_id, ws_manager.peer_count(project_id), message.get("type"))
    await ws_manager.broadcast_json(project_id, message)
    # Redis에 이벤트 히스토리 캐싱 (새로고침 복구용)
    try:
        from app.core.redis import get_redis
        import json as _json
        redis = get_redis()
        key = f"slidant:events:{project_id}"
        event_type = message.get("type", "")
        # agent_token은 누적이 크므로 제외, slide_ready는 포함
        if event_type not in ("agent_token",):
            await redis.rpush(key, _json.dumps(message, default=str))
            await redis.expire(key, 1800)  # 30분 TTL
        # agent_done / agent_error → 완료 직후 끊겼다 재연결하는 클라이언트도
        # replay로 종료 신호를 받을 수 있도록 즉시 삭제 대신 짧은 유예 TTL만 부여.
        # (바로 delete 하면, 브로드캐스트 시점에 일시적으로 연결이 끊긴 클라이언트는
        #  agent_done을 영영 못 받아 "처리 중..."에서 멈춰버림 — DB 작업 자체는 끝났는데도)
        if event_type in ("agent_done", "agent_error"):
            await redis.expire(key, 60)
    except Exception as _e:
        logger.debug("redis_cache_fail: %s", _e)
