# Slidant BE

## 기술 스택

| 역할 | 라이브러리 |
|------|-----------|
| 프레임워크 | FastAPI + Python 3.12 |
| Agent 오케스트레이션 | LangGraph |
| LLM | anthropic SDK (Claude, streaming) |
| ORM | SQLModel + SQLAlchemy (async) |
| DB 마이그레이션 | Alembic |
| DB | PostgreSQL |
| 캐시 / LangGraph checkpointer | Redis |
| API Key 암호화 | cryptography (Fernet) |

## 핵심 구조

### Agent 오케스트레이션 (LangGraph)

파이프라인: `planner → html_composer → html_validator → formatter → END`

- `planner`: 자연어 계획 수립 (스트리밍, `PLANNER_PROMPT`)
- `html_composer`: LLM이 HTML 슬라이드 직접 생성 (`HTML_COMPOSER_PROMPT`)
  - 출력: `{"summary":"...","html":"..."}` 또는 `{"summary":"...","slides":[...]}`
- `html_validator`: HTML 유효성 체크, 실패 시 retry (최대 `AGENT_MAX_RETRIES`)
- `html_mode=True` 전달 시 위 파이프라인 사용, `False`이면 기존 JSON Patch 파이프라인
- 기본 제공 Agent: `ContentAgent` | `DesignAgent` | `LayoutAgent`
- 유저 정의 커스텀 Agent 지원
- 다중 Agent 동시 작업 → 충돌 감지 (ConflictResolver)

### DB 패턴 (Unit of Work)
```python
class UnitOfWork:
    session: AsyncSession
    slides: SlideRepository
    components: ComponentRepository
    versions: VersionRepository

    async def __aenter__(self): ...
    async def __aexit__(self): ...
    async def commit(self): ...
    async def rollback(self): ...
```
- Agent가 컴포넌트 여러 개 수정 시 트랜잭션 단위 보장
- FastAPI 의존성 주입으로 UoW 주입

### 슬라이드 저장 방식
- `slides.html_content TEXT NULL` — HTML 문자열 직접 저장
- `slides.content JSONB` — 레거시 JSON 컴포넌트 배열 (html_content 없는 슬라이드용)
- Agent 적용: `archive_and_apply(uow, slide_id, content, reason, html_content=html_output)`
  - `html_content` 있으면 `slide.html_content` 업데이트
  - 없으면 `slide.content` 업데이트 (JSON fallback)

### 버전 관리
- `slide_history`: 슬라이드 전체 JSON 스냅샷 (롤백용)
- `component_history`: 컴포넌트 단위 변경 기록
- LLM Prompt / 응답 로그 함께 저장

### 유저 API Key 관리
- 저장: AES-256 암호화 (Fernet), 복호화 키는 KMS 관리
- 요청 처리 중에만 메모리에 plaintext 존재
- 로그 / 에러 스택트레이스에 key 절대 기록 안 함 — sanitization 미들웨어 필수
- 유저가 본인 key 사용 내역 조회 가능
- 계정 삭제 시 key 즉시 파기

### 실시간 통신
- SSE (Server-Sent Events) — `/agent/events/{project_id}`
- 이벤트 타입: `agent_started` | `agent_token` | `agent_node_event` | `agent_done` | `agent_error`
- `agent_done` payload에 `html_content` 포함 → 프론트엔드 즉시 반영

## 레이어 아키텍처 컨벤션

```
api/endpoints/  →  services/  →  repositories/  →  db
                      ↑
               core/domain/  (순수 비즈니스 로직)
               core/         (인프라: config, security, deps)
```

### 레이어별 책임

| 레이어 | 위치 | 책임 | 금지 |
|--------|------|------|------|
| **endpoints** | `api/v1/endpoints/` | HTTP 요청/응답, 인증, UoW 주입 | 비즈니스 로직, DB 직접 접근 |
| **services** | `services/` | 흐름 조율: repo 호출 + core 호출 + 이벤트 발행, 트랜잭션 경계 | 순수 계산 로직, DB 스키마 의존 없는 연산 |
| **core/domain** | `core/domain/` | 순수 비즈니스 로직: 계산, 변환, diff, 검증 | DB I/O, HTTP, 외부 상태 |
| **core** | `core/` | 인프라 유틸: 암호화, 설정, 의존성 주입 | 비즈니스 로직 |
| **repositories** | `repositories/` | DB CRUD | 비즈니스 로직 |

### 현재 `core/domain/` 파일

| 파일 | 내용 |
|------|------|
| `slide_content.py` | 슬라이드 JSON 컴포넌트 CRUD (순수 함수) |
| `slide_parser.py` | HTML ↔ 컴포넌트 파싱/렌더 (BeautifulSoup, 순수 함수) |
| `history_diff.py` | 슬라이드/컴포넌트 변경 diff → 이력 레코드 생성 |

### 도메인 엔티티 (@dataclass)

`core/domain/`의 순수 로직은 `@dataclass`로 캡슐화. 데이터 + 동작을 함께 표현.

| 엔티티 | 파일 | 주요 메서드 |
|--------|------|------------|
| `HtmlSlide` | `html_slide.py` | `.components`, `.update_component()`, `.delete_component()`, `.update_style()` |
| `SlideContent` | `slide_content.py` | `.add()`, `.update()`, `.remove()`, `.apply_patches()` |
| `HtmlSlideDiff` | `history_diff.py` | `.to_component_history()` |
| `JsonSlideDiff` | `history_diff.py` | `.to_component_history()` |
| `SlideSnapshot` | `history_diff.py` | `.to_slide_history()` |

```python
# 사용 예시
slide = HtmlSlide(html=slide.html_content)
updated = slide.update_component("title", new_html)  # 새 인스턴스 반환 (immutable)
slide.html_content = updated.html

sc = SlideContent.from_slide(slide)
sc.apply_patches(ops)       # in-place 변경
slide.content = sc.to_list()
```

### 판단 기준

> "이 함수가 DB 없이 단독으로 테스트 가능한가?"
> - Yes → `core/domain/`
> - No (repo 필요) → `services/`

### 하위 호환 re-export

`services/slide_parser.py`, `services/slide_content.py`는 기존 import 경로 호환을 위한 re-export shim.
신규 코드는 `core/domain/` 직접 import 권장.

```python
# 권장 (신규 코드)
from app.core.domain.slide_parser import parse_slide_html

# 구 경로 (동작하지만 비권장)
from app.services.slide_parser import parse_slide_html
```

## 개발 원칙

- Agent는 HTML 직접 생성 — JSON 스키마 중간 변환 없음
- Agent HTML 편집 → `AgentProposal(html_content)` 저장, 즉시 반영 X — 사용자 승인 후 `archive_and_apply`
- `approved_ids: null` → 전체, `approved_ids: [...]` → `merge_component_changes(old, new, ids)`로 선택 적용
- Agent 슬라이드 신규 생성(`html_slides`)은 즉시 적용 (편집과 구분)
- `data-component-id` 불변 규칙 — `HTML_EDITOR_PROMPT`에 ABSOLUTE RULE 명시
- Agent 로그 항상 저장 (디버깅 + 롤백 근거)
- key sanitization 미들웨어 — API key plaintext 절대 로그 기록 안 함
