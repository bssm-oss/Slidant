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
- 유저가 Agent 토폴로지를 런타임에 동적 구성 가능 (노드/엣지 정의)
- 기본 제공 Agent: `ContentAgent` | `DesignAgent` | `LayoutAgent`
- 유저 정의 커스텀 Agent 생성 지원
- LangGraph checkpointer → Redis 백엔드 → Agent 작업 이력 저장
- Parallel node execution으로 다중 Agent 동시 작업
- Human-in-the-loop: 충돌 발생 시 유저 개입 포인트 삽입

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

### 버전 관리
- 변경 추적: **JSON Patch (RFC 6902)** — 컴포넌트 단위 정밀 추적
- 스냅샷 롤백: Git (프로젝트 전체 상태 저장)
- LLM Prompt / 응답 로그 함께 저장

### 유저 API Key 관리
- 저장: AES-256 암호화 (Fernet), 복호화 키는 KMS 관리
- 요청 처리 중에만 메모리에 plaintext 존재
- 로그 / 에러 스택트레이스에 key 절대 기록 안 함 — sanitization 미들웨어 필수
- 유저가 본인 key 사용 내역 조회 가능
- 계정 삭제 시 key 즉시 파기

### 실시간 통신
- FastAPI 내장 WebSocket
- Agent 작업 상태 / LLM 스트리밍 응답 FE 전달

## 개발 원칙

- Agent 로그 항상 저장 (디버깅 + 롤백 근거)
- LLM 호출 시 prompt caching 적용 (Anthropic SDK)
- 컴포넌트 단위 diff — 페이지 전체 교체 API 설계 지양
- key sanitization 미들웨어 초기부터 적용
