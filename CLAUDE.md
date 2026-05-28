# Slidant — AI Agent 기반 HTML PPT 협업 툴

## 프로젝트 개요

여러 AI Agent가 역할 분담하여 HTML 기반 슬라이드를 생성·편집하는 협업 플랫폼.
사용자는 자연어로 요청 → Agent들이 디자인/콘텐츠/레이아웃 역할 수행 → 컴포넌트 단위로 변경 관리.

## 디렉터리 구조

```
slidant/
├── ui/          # 프론트엔드 (슬라이드 렌더링, 편집 UI, Diff 뷰어)
├── api/         # 백엔드 (Agent 오케스트레이션, 버전 관리, LLM 로그)
└── CLAUDE.md
```

## 핵심 아키텍처

### 슬라이드 데이터 모델
- 저장: **의미 단위 JSON 스키마** (raw CSS 값 금지, 시맨틱 토큰 사용)
  ```json
  { "role": "title", "size": "xl", "weight": "bold", "content": "제목" }
  // NOT: { "fontSize": 48, "fontWeight": 700 }
  ```
- 컴포넌트 타입: `text` | `image` | `chart` | `layout` | `shape`
- **렌더링**: JSON → React 렌더러 (iframe 아님) — 컴포넌트 단위 선택/diff 용이
- **Agent 컨텍스트**: JSON → HTML string 변환본을 텍스트로 첨부 (`data-component-id` 속성 포함)
  - vision 모델 불필요 → 어떤 LLM도 읽을 수 있음, 모델 교체 시 영향 없음
- Agent 출력: 항상 JSON Patch (RFC 6902) — structured output으로 강제
- 사용자는 HTML/코드 직접 편집 안 함 — 컴포넌트 단위 시각 편집만 노출

### 유저 LLM API Key 관리
- **방식**: BE 프록시 — 유저 key를 암호화 저장, 매 LLM 요청 시 복호화 후 forwarding
- **저장**: AES-256 암호화, 복호화 키는 KMS(AWS/GCP) 별도 관리
- **신뢰 장치**:
  - 유저가 본인 key 사용 내역 조회 가능
  - 계정 삭제 시 key 즉시 파기
  - 유저에게 Anthropic 콘솔에서 월 사용 한도 설정 권장
- **서버 역할**: key plaintext는 요청 처리 중에만 메모리 존재, 로그에 절대 기록 안 함
- LLM 호출은 api/에서 수행 (Agent 오케스트레이션과 동일 레이어)

### AI Agent 시스템
- 역할별 Agent: `ContentAgent` | `DesignAgent` | `LayoutAgent`
- 사용자 정의 Agent 생성 지원
- 다중 Agent 동시 작업 → 충돌 감지 → 병합 UI 제공

### 버전 관리
- Git 기반 변경 이력 (컴포넌트 단위 diff)
- 작업 자동 저장 + 특정 버전 롤백
- LLM Prompt/응답 로그 함께 저장

### 충돌 해결
- Agent 간 동일 컴포넌트 수정 시 충돌 감지
- Git Diff 형태 시각화 (컴포넌트 단위)
- 선택적 병합 지원

## 기술 스택 (미확정 — 결정 시 업데이트)

| 영역 | 후보 |
|------|------|
| Frontend | React + TypeScript |
| Slide Render | JSON → React 렌더러 (iframe 아님) |
| Backend | Node.js / FastAPI |
| LLM | Claude API (Anthropic SDK) |
| 버전 관리 | Git (libgit2 / isomorphic-git) |
| 실시간 협업 | WebSocket / CRDT |

## 개발 원칙

- 컴포넌트 단위가 핵심 — 페이지 전체 교체 금지, 항상 컴포넌트 레벨로 diff/patch
- LLM 호출 시 prompt caching 적용 (Anthropic SDK)
- 사용자에게 HTML 노출 금지 — 모든 편집은 컴포넌트 추상화 레이어 통과
- Agent 작업 로그 항상 저장 (디버깅 + 롤백 근거)

## 유사 서비스 분석

| 서비스 | 강점 | 약점 |
|--------|------|------|
| 젠스파크 | AI PPT 생성 특화 | 수정·협업 어려움 |
| 미리캔버스 | 사람 중심 편집 | AI 기능 유료, Agent 협업 없음 |

**차별점**: Agent 간 협업 + 컴포넌트 단위 버전 관리 + 충돌 시각화
