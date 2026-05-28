# Git 컨벤션 — Slidant Monorepo

## 브랜치 전략

```
main
└── dev-0.*.*
    ├── feature-0.*.*/브랜치명
    ├── fix-0.*.*/브랜치명
    ├── refactor-0.*.*/브랜치명
    ├── style-0.*.*/브랜치명
    ├── chore-0.*.*/브랜치명
    ├── docs-0.*.*/브랜치명
    ├── test-0.*.*/브랜치명
    ├── hotfix-0.*.*/브랜치명
    └── infra-0.*.*/브랜치명
```

### 브랜치 prefix 정의

| prefix | 용도 |
|--------|------|
| `feature` | 신규 기능 개발 |
| `fix` | 버그 수정 |
| `refactor` | 기능 변경 없는 코드 개선 |
| `style` | UI/CSS 스타일 수정 |
| `chore` | 빌드 설정, 패키지, 환경 설정 |
| `docs` | 문서 작성·수정 |
| `test` | 테스트 코드 추가·수정 |
| `hotfix` | 운영 긴급 수정 (main 직접 분기) |
| `infra` | DB 스키마, 마이그레이션, 인프라 |

### 예시

```
feature-0.1.0/슬라이드-렌더러
feature-0.1.1/컴포넌트-드래그앤드롭
feature-0.1.2/langgraph-agent-오케스트레이션
feature-0.1.3/api-key-암호화-저장
fix-0.1.4/iframe-렌더링-오류
fix-0.1.5/websocket-연결-끊김
refactor-0.2.0/zustand-스토어-구조
refactor-0.2.1/uow-패턴-적용
style-0.1.3/에디터-사이드바-레이아웃
infra-0.1.0/alembic-초기-마이그레이션
hotfix-0.1.6/api-key-로그-노출
chore-0.1.0/프로젝트-초기-설정
```

---

## 커밋 메시지

### 형식

```
{type} :: {한글 설명}
```

### type 정의

| type | 용도 |
|------|------|
| `feat` | 신규 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 |
| `style` | 스타일·UI 수정 |
| `chore` | 빌드·환경 설정 변경 |
| `docs` | 문서 수정 |
| `test` | 테스트 추가·수정 |
| `perf` | 성능 개선 |
| `infra` | DB 스키마·마이그레이션·인프라 |
| `hotfix` | 운영 긴급 수정 |
| `security` | 보안 관련 수정 |
| `revert` | 이전 커밋 되돌리기 |

### 예시

```
feat :: 슬라이드 iframe 샌드박스 렌더러 구현
feat :: 컴포넌트 드래그앤드롭 편집 구현
feat :: ContentAgent LangGraph 노드 구현
feat :: 유저 API key AES-256 암호화 저장
fix :: 컴포넌트 드래그 후 위치 초기화 버그 수정
fix :: LangGraph State 병렬 실행 충돌 수정
refactor :: Zustand 슬라이드 스토어 셀렉터 분리
refactor :: UnitOfWork 패턴 Repository 분리
style :: 에디터 사이드바 레이아웃 조정
infra :: slides 테이블 Alembic 마이그레이션 추가
security :: 에러 응답에서 API key 노출 제거
perf :: Claude API prompt caching 적용
hotfix :: 계정 삭제 시 API key 미파기 버그 수정
docs :: 컴포넌트 스키마 문서 업데이트
test :: DesignAgent 유닛 테스트 추가
```
