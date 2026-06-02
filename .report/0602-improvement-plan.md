# Slidant 개선 로드맵 — 멀티 에이전트 관점 통합
**작성일**: 2026-06-02  
**근거**: `.report/0602.md` (Snapdeck vs Slidant 실사용 분석)  
**방법**: UX 관점 · 기술 아키텍처 관점 · 비즈니스 전략 관점 독립 검토 후 통합

---

## 요약 판결

> **기술 과잉, UX 결핍.** Agent 협업 파이프라인은 있지만 Export도 없고 썸네일도 빈 슬라이드다.  
> 지금 당장 사용자가 결과물을 꺼낼 방법이 없다. 이게 먼저다.

---

## 관점별 핵심 주장

### UX/Product 관점
- **진입 루프가 망가졌다.** 드라이브 → 에디터 → 채팅 3단계를 거쳐야 첫 생성이 시작된다.  
  랜딩 = 생성 박스로 바꾸면 전환율 직결.
- **결과물 출구가 없다.** Export, 공유 링크 없이는 재방문이 없다.
- **Agent 협업이 "보여야" 차별점이 된다.** 충돌 UI는 있는데 사용자가 이 시나리오를 경험하지 못한다.

### 기술 아키텍처 관점
- **35초의 실제 원인은 직렬 LLM 호출 3회**다. `planner → design_resolver → content_planner`가 순차 실행되며 각각 reasoning 모델을 호출한다.  
  이 세 노드를 **단일 호출로 통합**하면 12~15초로 줄어든다.
- **iframe + `allow-scripts` + sanitize**가 Shadow DOM 전환보다 빠른 경로다.  
  CSS 애니메이션과 Chart.js 인라인 실행 모두 해결된다.
- **Playwright worker 서비스** 분리가 Export와 썸네일을 동시에 해결한다.

### 비즈니스 전략 관점
- **"더 예쁜 PPT" 경쟁을 그만둬야 한다.** 디자인 품질로 Snapdeck을 이길 수 없다.  
  "한 번 만들고 끝나는 PPT"가 아니라 **"계속 살아있는 문서"** 포지셔닝으로 전환.
- **킬러 사용자는 반복 보고서를 만드는 팀이다.** 주간 투자자 업데이트, 영업 덱 커스터마이징. 파이프라인 저장·재실행이 이들의 진짜 페인포인트.
- **6개월 안에 "파이프라인 재실행으로 30분 아꼈다"는 사용자 한 명을 만들어야** 한다.

---

## 관점 간 이견 정리

| 이슈 | 기술 관점 | 전략 관점 | 통합 결론 |
|------|-----------|-----------|-----------|
| 생성 속도 우선순위 | 즉시 해결 (구조 개선) | 지금 단계 우선순위 아님 | **구조 개선은 하되 속도 자체를 목적으로 삼지 않는다**. 사용자는 30초를 봐주지 않지만, 파이프라인 재실행의 가치가 크면 기다린다. |
| iframe vs Shadow DOM | iframe + allow-scripts | 해당 없음 | iframe 유지, allow-scripts 추가 후 sanitize |
| Export 방법 | Playwright worker | 구현해야 함 | Playwright 별도 서비스. Docker compose에 추가. |
| 차트 지원 | Recharts 컴포넌트 연결 | DataAgent로 Sheets 연동 | 단기: SVG 인라인, 중기: Recharts, 장기: DataAgent |

---

## 우선순위별 개선 로드맵

### P0 — 즉시 (1~2주): 제품 최소 요건

| # | 항목 | 이유 | 예상 구현 시간 |
|---|------|------|---------------|
| 1 | **PDF Export** | 결과물을 꺼낼 수 없으면 재방문 없음. 경쟁의 최소 기준선 | 3일 (Playwright worker) |
| 2 | **HTML 슬라이드 썸네일** | 드라이브가 "빈 슬라이드" 그리드이면 신뢰도 0. Agent 완료 후 PNG 캡처 | 3일 |
| 3 | **프레젠테이션 제목 자동 설정** | Agent summary에서 제목 추출 → `presentation.title` 저장 | 1일 |

### P1 — 단기 (2~4주): 편집 및 공유

| # | 항목 | 이유 | 기술 방향 |
|---|------|------|-----------|
| 4 | **캔버스 직접 편집** | Agent 생성 결과를 수동 수정 불가는 치명적 | iframe allow-scripts + contentEditable |
| 5 | **공유 링크** | 바이럴 루프 시작. `project.share_token` UUID 하나로 구현 가능 | 읽기 전용 `/share/{token}` |
| 6 | **Undo/Redo** | `slide_history` 기반 즉시 롤백 버튼. 이미 이력 저장됨 | 기존 archive 활용 |
| 7 | **랜딩 = 생성 UI** | 드라이브가 진입점이면 전환율 낮음 | `/` 라우트에 프롬프트 박스 |

### P2 — 중기 (1~2개월): 차별화 가시화

| # | 항목 | 이유 | 기술 방향 |
|---|------|------|-----------|
| 8 | **생성 속도 개선** | 3개 노드 단일 LLM 호출로 통합 + Haiku 라우팅 | 35초 → 12~15초 |
| 9 | **차트 컴포넌트** | Snapdeck 대비 가장 눈에 띄는 품질 격차 | SVG 인라인 → Recharts |
| 10 | **슬라이드 재생성 버튼** | 각 슬라이드 썸네일에 "다시 생성" | 채팅 @슬라이드N 자동 전송 |
| 11 | **Agent 작업 타임라인** | 누가 언제 어떤 컴포넌트를 왜 바꿨는지 — Snapdeck 차별점 시각화 | component_history 기반 UI |

### P3 — 중기 (2~3개월): 차별점 완성

| # | 항목 | 이유 | 기술 방향 |
|---|------|------|-----------|
| 12 | **파이프라인 저장·재실행 완성** | 반복 업무 사용자 락인. 핵심 차별점 | 기존 pipeline builder 확장 |
| 13 | **브랜드 가이드라인 Agent** | B2B 킬러. DesignAgent에 브랜드 규칙 레이어 | system_prompt + 색상/폰트 고정 |
| 14 | **외부 데이터 소스 (URL 스크랩)** | Snapdeck의 Web Research 대응 | Tavily 이미 연동됨, UI 노출만 필요 |

### P4 — 장기 (3~6개월): B2B 전환

| # | 항목 | 이유 |
|---|------|------|
| 15 | **DataAgent (Google Sheets / Notion)** | "살아있는 문서" 포지셔닝의 기술적 완성 |
| 16 | **팀 Agent 권한 모델** | DesignAgent를 디자이너만 수정, ContentAgent는 기획자만 — B2B |
| 17 | **다중 Agent 동시 실행 워크플로우 UX** | 충돌 UI는 있지만 이 시나리오를 유도하는 UX가 없음 |

---

## Snapdeck이 못하는 것 (Slidant 우위)

1. **컴포넌트 단위 롤백** — "제목 텍스트만 3버전 전으로 되돌려". Snapdeck은 덱 전체 단위.
2. **파이프라인 저장·재실행** — 매주 같은 구조의 리포트를 데이터만 바꿔 재실행. Snapdeck은 매번 처음.
3. **멀티 Agent 충돌·병합** — ContentAgent와 DesignAgent가 같은 컴포넌트를 동시에 수정할 때 두 버전을 나란히 비교하고 선택.
4. **커스텀 파이프라인** — 기업 브랜드 가이드 학습 후 팀 전체 재사용. Snapdeck은 단일 모델.
5. **완전한 CSS 표현력** — 테마 박스 안에 갇힌 Snapdeck vs 임의 HTML/CSS 생성.
6. **LLM 모델 선택 자유도** — Agent별로 다른 모델 할당 가능.

---

## 기술 결정 사항 (바로 실행 가능한 것)

### Export — Playwright worker 방식
```yaml
# docker-compose.yml 추가
playwright-worker:
  image: mcr.microsoft.com/playwright/python:v1.44.0
  environment:
    - WORKER_MODE=pdf
  ports:
    - "3001:3001"
```
```python
# API: POST /api/v1/projects/{id}/export?format=pdf
# playwright로 html_content 렌더링 → PDF 바이너리 반환
```

### 속도 개선 — planner+design+content 통합
```python
# 현재: planner → design_resolver → content_planner (3 LLM 호출)
# 변경: UNIFIED_PLANNER_PROMPT 하나로 통합
# 출력: {"plan":"...","design_tokens":{...},"slides":[{"title":"...","layout":"...","key_points":[...]},...]}
# 예상: 35초 → 12~15초
```

### iframe allow-scripts
```tsx
// SlideCanvas.tsx
<iframe
  srcDoc={iframeSrc}
  sandbox="allow-same-origin allow-scripts"  // allow-scripts 추가
  // LLM 생성 HTML은 DOMPurify로 script sanitize 후 주입
/>
```

### 공유 링크
```python
# Project 모델에 share_token: str | None 추가
# GET /share/{token} → 인증 없이 읽기 전용 슬라이드 렌더링
```

---

## 냉정한 결론

Slidant의 기술 기반(LangGraph 파이프라인, HTML 직렬화, 컴포넌트 이력)은 Snapdeck보다 야심차다.  
하지만 지금은 **엔지니어링 프로토타입**이지 제품이 아니다.

**제품이 되려면 세 가지만 먼저 해결하라:**

1. **Export** — Agent가 만든 슬라이드를 꺼낼 수 있어야 한다  
2. **썸네일** — 드라이브에서 내 결과물이 보여야 한다  
3. **직접 편집** — Agent가 틀린 부분을 클릭해서 고칠 수 있어야 한다  

이 세 가지가 완성되기 전에 다중 Agent 워크플로우나 DataAgent 같은 기능을 추가하는 것은  
출구 없는 방을 더 화려하게 꾸미는 것이다.

**목표**: 6개월 안에 "파이프라인 재실행으로 매주 30분 아꼈다"는 팀을 한 곳 찾아라.  
그게 되면 방향이 맞는 것이다.
