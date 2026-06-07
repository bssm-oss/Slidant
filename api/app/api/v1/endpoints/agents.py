import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.core.deps import CurrentUser, UoW
from app.core.domain.slide_sanitizer import sanitize_slide_html
from app.models.chat import ChatMessage
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.services import agent_service
from app.services.agent_runner import build_slide_context_from_html, run_agent

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
    ))
    _running_tasks[str(agent_run.id)] = task
    task.add_done_callback(lambda _: _running_tasks.pop(str(agent_run.id), None))

    await _broadcast(str(body.project_id), {
        "type": "agent_started",
        "agent_run_id": str(agent_run.id),
        "agent_name": agent_def.name,
        "role": agent_def.role,
        "command": body.command,
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

            # slide_ready 즉시 DB 저장용 인덱스 → slide_id 매핑 (생성 순서 기준)
            _slide_ready_slots: dict[int, str] = {}  # index → placeholder slide_id

            def on_event(event_type: str, message: str) -> None:
                _fire({
                    "type": "agent_node_event",
                    "agent_run_id": str(agent_run_id),
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
                            _asyncio.get_running_loop().create_task(
                                _save_slide_ready(
                                    project_id=body.project_id,
                                    index=idx,
                                    title=title,
                                    html=html,
                                    slot_map=_slide_ready_slots,
                                )
                            )
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
            )
            patches, _, llm_summary, html_output, html_slides, delete_slide, search_cache = await run_agent(**run_kwargs)

            # 새 검색 결과 있으면 프로젝트에 캐시 저장
            if search_cache:
                await uow.projects.update_search_cache(
                    body.project_id,
                    search_cache["summary"],
                    search_cache["queries"],
                )
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
            _proposal_obj = None
            if html_output and slide:
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
                edit_keywords = ("수정", "변경", "바꿔", "적용", "고쳐", "다시")
                is_edit_cmd = any(k in body.command for k in edit_keywords)

                # 전체 프레젠테이션 교체 판단:
                # - delete+create 혼합: 명시적 전체 교체 의도
                # - create-only(2장+, not edit): 새 PPT 생성 의도 → 기존도 정리
                is_full_replace = (len(specs) >= 2 and not is_edit_cmd)

                if is_full_replace:
                    # 기존 슬라이드 전량 삭제 후 fresh 생성 (order 0부터 재배치)
                    # body.slide_id는 이미 삭제됐을 수 있음(delete_slide=True), 아니면 지금 삭제
                    existing_slides = await uow.slides.list_by_project(body.project_id)
                    for ex in existing_slides:
                        await uow.session.delete(ex)
                    logger.info("   기존 슬라이드 %d장 전량 제거 (전체 교체)", len(existing_slides))
                    reason = f'{agent_def_name}: {body.command[:120]}'
                    for i, spec in enumerate(specs):
                        new_slide = SlideModel(
                            project_id=body.project_id,
                            title=spec.get("title", ""),
                            html_content=sanitize_slide_html(spec.get("html", "")),
                            content=[],
                            order=i,
                        )
                        uow.slides.add(new_slide)
                        slide_history_service.record_initial_slide(uow, new_slide, reason, agent_def_name)
                        new_slides.append(new_slide)
                        logger.info("   HTML 슬라이드 생성 (fresh %d/%d): title=%r",
                                    i + 1, len(specs), spec.get("title"))

                elif specs and slide:
                    # 단일 슬라이드 생성 또는 edit: specs[0]→현재 슬라이드 덮어쓰기
                    first = specs[0]
                    reason = f'{agent_def_name}: {body.command[:120]}'
                    await slide_history_service.archive_and_apply(
                        uow, body.slide_id, list(slide.content or []),
                        reason, agent_name=agent_def_name,
                        html_content=sanitize_slide_html(first.get("html", ""))
                    )
                    if first.get("title") and not slide.title:
                        slide.title = first["title"]
                    logger.info("   HTML[0] → 현재 슬라이드 적용: title=%r  html=%d chars",
                                first.get("title"), len(first.get("html", "")))
                    specs_to_create = [] if is_edit_cmd else specs[1:]
                    base_order = await uow.slides.get_last_order(body.project_id)
                    for i, spec in enumerate(specs_to_create):
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


@router.get("/events/{project_id}")
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
        # agent_done / agent_error → 이벤트 히스토리 정리 (완료 후 복구 불필요)
        if event_type in ("agent_done", "agent_error"):
            await redis.delete(key)
    except Exception as _e:
        logger.debug("redis_cache_fail: %s", _e)
