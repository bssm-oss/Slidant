# Slidant BE — ERD

```mermaid
erDiagram

    USER {
        uuid id PK
        string email UK
        string hashed_password
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }

    API_KEY {
        uuid id PK
        uuid user_id FK
        string provider
        text encrypted_key
        timestamp created_at
        timestamp deleted_at
    }

    API_KEY_USAGE_LOG {
        uuid id PK
        uuid api_key_id FK
        int tokens_input
        int tokens_output
        string model
        timestamp created_at
    }

    PROJECT {
        uuid id PK
        uuid owner_id FK
        string title
        timestamp created_at
        timestamp updated_at
    }

    SLIDE {
        uuid id PK
        uuid project_id FK
        int order
        string title
        timestamp created_at
        timestamp updated_at
    }

    COMPONENT {
        uuid id PK
        uuid slide_id FK
        uuid parent_id FK
        string type
        json properties
        int order
        timestamp created_at
        timestamp updated_at
    }

    VERSION {
        uuid id PK
        uuid project_id FK
        string git_commit_hash
        string message
        json snapshot
        timestamp created_at
    }

    COMPONENT_PATCH {
        uuid id PK
        uuid version_id FK
        uuid component_id FK
        json patch_ops
        timestamp created_at
    }

    AGENT_DEFINITION {
        uuid id PK
        uuid user_id FK
        string name
        string role
        json config
        bool is_system
        timestamp created_at
    }

    AGENT_RUN {
        uuid id PK
        uuid project_id FK
        uuid agent_definition_id FK
        string langgraph_thread_id
        string status
        timestamp started_at
        timestamp finished_at
    }

    LLM_LOG {
        uuid id PK
        uuid agent_run_id FK
        string model
        text prompt
        text response
        int tokens_input
        int tokens_output
        bool cache_hit
        timestamp created_at
    }

    CONFLICT {
        uuid id PK
        uuid project_id FK
        uuid component_id FK
        uuid agent_run_a_id FK
        uuid agent_run_b_id FK
        string status
        json patch_a
        json patch_b
        uuid resolved_by_user_id FK
        timestamp created_at
        timestamp resolved_at
    }

    USER ||--o{ API_KEY : "owns"
    API_KEY ||--o{ API_KEY_USAGE_LOG : "tracks"
    USER ||--o{ PROJECT : "owns"
    PROJECT ||--o{ SLIDE : "contains"
    SLIDE ||--o{ COMPONENT : "contains"
    COMPONENT ||--o{ COMPONENT : "nests (parent_id)"
    PROJECT ||--o{ VERSION : "snapshots"
    VERSION ||--o{ COMPONENT_PATCH : "records"
    COMPONENT_PATCH }o--|| COMPONENT : "patches"
    USER ||--o{ AGENT_DEFINITION : "defines (null=system)"
    PROJECT ||--o{ AGENT_RUN : "runs"
    AGENT_DEFINITION ||--o{ AGENT_RUN : "instantiates"
    AGENT_RUN ||--o{ LLM_LOG : "logs"
    PROJECT ||--o{ CONFLICT : "has"
    COMPONENT ||--o{ CONFLICT : "conflicts on"
    AGENT_RUN ||--o{ CONFLICT : "agent_run_a"
    AGENT_RUN ||--o{ CONFLICT : "agent_run_b"
    USER ||--o{ CONFLICT : "resolves"
```

## 엔티티 요약

| 테이블 | 역할 |
|--------|------|
| `USER` | 계정 |
| `API_KEY` | 유저 LLM API key (암호화 저장) |
| `API_KEY_USAGE_LOG` | key 사용 내역 — 유저 조회용 |
| `PROJECT` | 슬라이드 묶음 단위 |
| `SLIDE` | 프로젝트 내 개별 슬라이드 |
| `COMPONENT` | 슬라이드 내 컴포넌트 트리 (`text`/`image`/`chart`/`layout`/`shape`) |
| `VERSION` | 프로젝트 전체 Git 스냅샷 |
| `COMPONENT_PATCH` | RFC 6902 JSON Patch — 컴포넌트 단위 diff 기록 |
| `AGENT_DEFINITION` | 시스템 기본 Agent + 유저 정의 커스텀 Agent |
| `AGENT_RUN` | LangGraph thread 실행 이력 |
| `LLM_LOG` | 프롬프트/응답 로그 (캐시 히트 여부 포함) |
| `CONFLICT` | Agent 간 동일 컴포넌트 충돌 — 병합 전까지 pending |

## 버전 관리 이중 구조

- **`VERSION` + `COMPONENT_PATCH`**: 컴포넌트 단위 정밀 추적 (RFC 6902 JSON Patch)
- **`VERSION.git_commit_hash`**: 프로젝트 전체 상태 Git 스냅샷 → 롤백 단위

## 보안 메모

- `API_KEY.encrypted_key`: Fernet(AES-256) 암호화값만 저장, plaintext 절대 기록 안 함
- `LLM_LOG`: sanitization 미들웨어로 key plaintext 필터링 후 저장
- `API_KEY.deleted_at` set → 계정 삭제 시 key 즉시 파기 처리
