# Visual Validator — Playwright 사이드카 설계

## 목적

에이전트 파이프라인 내 HTML 슬라이드 생성 후 시각적 품질 문제를 자동 검출하고, 이슈 발생 시 LLM 재시도를 강제한다.

## 검출 대상

| 검사 | 기준 |
|------|------|
| 텍스트 대비 부족 | WCAG AA: 일반 텍스트 4.5:1, 큰 텍스트(18px+ / 14px+ bold) 3:1 미만 |
| 텍스트 오버플로우 | `scrollHeight > clientHeight + 5` 또는 `scrollWidth > clientWidth + 5` |
| 줄 간격 불열 | computed `lineHeight / fontSize < 1.4` (normal이면 1.2로 간주) |
| 컴포넌트 겹침 | 텍스트 요소가 다른 컴포넌트에 50% 이상 가려짐 (BoundingClientRect 교집합) |

## 아키텍처

### 컨테이너 구성

```
docker-compose.yml
├── api          (기존, ~335MB 유지)
├── playwright   (신규 사이드카, ~700MB)
│   └── POST /check  HTML → issues[]
├── db
├── redis
└── ui
```

playwright 컨테이너는 `mcr.microsoft.com/playwright/python` 공식 이미지 기반. Proxmox LXC 환경이므로 Chromium 실행 시 `--no-sandbox --disable-setuid-sandbox` 필수.

### playwright 서비스 (`playwright/`)

신규 디렉터리 `playwright/` 생성:

```
playwright/
├── Dockerfile
├── requirements.txt   (playwright, fastapi, uvicorn)
└── main.py            (FastAPI + /check 엔드포인트)
```

**API 계약**

```
POST /check
Content-Type: application/json

Request:  { "html": "<style>...</style><div class='slide'>...</div>" }
Response: {
  "issues": [
    {
      "component_id": "title",
      "type": "contrast" | "overflow" | "line_height" | "overlap",
      "message": "대비 2.1:1 (WCAG AA 4.5:1 미달)",
      "severity": "error" | "warning"
    }
  ]
}
```

playwright 서비스 다운 시 → `[]` 반환 (빈 이슈), api 측 폴백으로 처리.

### 파이프라인 통합

**graph.py 변경:**

```
html_editor / slide_composer
    ↓
html_aggregator
    ↓
html_validator    (기존 정적 검사: 경계 초과, font-size, 빈 텍스트)
    ↓
visual_validator  (신규: playwright HTTP 호출)
    ↓
should_retry_html (기존 로직 재사용, validation_errors 합산)
```

**validator.py 변경:**

- `make_visual_validator(ctx)` 노드 추가
- `PLAYWRIGHT_SERVICE_URL` 환경변수로 서비스 URL 주입 (기본: `http://playwright:3001`)
- 결과를 기존 `validation_errors` 리스트에 append

**retry 지시문 포맷:**

기존 `html_editor` retry 프롬프트에 visual 이슈 포함:
```
[재시도 지시]
- "title": 텍스트 대비 2.1:1 → 배경 또는 텍스트 색 변경 (WCAG AA 4.5:1 이상)
- "body": 텍스트 오버플로우 34px → font-size 축소 또는 height 확장
```

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PLAYWRIGHT_SERVICE_URL` | `http://playwright:3001` | playwright 사이드카 주소 |
| `VISUAL_VALIDATION_ENABLED` | `true` | 기능 on/off 스위치 |

## 폴백 전략

1. playwright 서비스 미응답 (타임아웃 5s) → `logger.warning` 후 visual 검사 스킵
2. `VISUAL_VALIDATION_ENABLED=false` → `visual_validator` 노드 즉시 `{validation_errors: []}` 반환
3. HTML 렌더링 실패 시 → 해당 슬라이드 이슈 스킵, 나머지 계속

## 미결 사항

없음.
