# Slidant

**AI Agent-powered collaborative HTML slide editor**

Multiple AI agents work in parallel to create and edit slides as raw HTML. Users review each agent's changes component-by-component before applying. Think "Git for slides, with AI co-authors."

---

## How It Works

```
User prompt
    │
    ▼
planner → html_composer → html_validator → formatter
                 ↑________________| (retry on invalid HTML)
    │
    ▼
AgentProposal saved
    │
    ▼
User approves/rejects per component
    │
    ▼
merge_component_changes() → archive_and_apply()
```

Each slide is stored as a single HTML string. Agents generate HTML directly — no intermediate JSON schema. Every element carries a `data-component-id` attribute that drives the approval UI and version diffing.

---

## Features

- **Multi-agent collaboration** — Content, Design, and Layout agents run concurrently; conflicts surface in a resolver modal
- **Component-level approval** — Accept or reject individual elements from an agent's proposal before merging
- **Full CSS expression** — Gradient, animation, SVG, anything the browser renders
- **Version history** — Per-component change log with rollback to any snapshot
- **Bring your own LLM key** — User API keys stored AES-256 encrypted; plaintext exists only during the request
- **Real-time streaming** — SSE pipeline streams planner narration and agent tokens live

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite |
| Slide rendering | `<iframe srcDoc>` (HTML) / JSON renderer (legacy) |
| Backend | FastAPI + Python 3.12 |
| Agent orchestration | LangGraph |
| LLM | OpenRouter (default) / Anthropic Claude |
| Database | PostgreSQL + SQLModel (async) |
| Cache / checkpointer | Redis |
| Realtime | SSE (Server-Sent Events) |
| DB migrations | Alembic |
| API key encryption | Fernet (AES-256) |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- An LLM API key (OpenRouter or Anthropic)

### Quick Start

```bash
git clone https://github.com/your-org/slidant.git
cd slidant

# Copy and fill in env files
cp .env.example .env
cp api/.env.example api/.env
# Edit api/.env — set OPENROUTER_API_KEY or ANTHROPIC_API_KEY

docker compose up --build
```

App runs at `http://localhost` (UI) and `http://localhost:8000` (API).

### Local Development

**Backend**
```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Start infra only
docker compose up db redis -d

# Run migrations
alembic upgrade head

# Start API
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd ui
pnpm install
pnpm dev
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL async URL |
| `REDIS_URL` | Yes | Redis URL |
| `SECRET_KEY` | Yes | JWT signing key |
| `FERNET_KEY` | Yes | AES-256 key for encrypting user API keys |
| `OPENROUTER_MODEL` | No | Default: `deepseek/deepseek-v4-pro` |
| `ANTHROPIC_MODEL` | No | Default: `claude-sonnet-4-6` |
| `AGENT_MAX_RETRIES` | No | HTML validation retry limit (default: 2) |
| `AGENT_MAX_TOKENS` | No | LLM output token cap (default: 4096) |

Generate a Fernet key:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

## Project Structure

```
slidant/
├── api/                        # FastAPI backend
│   └── app/
│       ├── agent/              # LangGraph pipeline (planner, composer, validator)
│       ├── api/v1/endpoints/   # HTTP routes
│       ├── core/domain/        # Pure business logic (no I/O)
│       ├── models/             # SQLModel ORM models
│       ├── repositories/       # DB CRUD
│       └── services/           # Orchestration layer
├── ui/                         # React frontend
│   └── src/
│       ├── features/
│       │   ├── editor/         # Slide editor, component selection
│       │   ├── drive/          # Project list
│       │   └── auth/           # Login / register
│       └── shared/             # UI primitives, stores
└── docker-compose.yml
```

---

## Data Model

Slides store HTML directly:

```html
<style>.slide{width:960px;height:540px;position:relative;overflow:hidden;}</style>
<div class="slide">
  <div data-component-id="bg" style="position:absolute;inset:0;background:#0A0F1E"></div>
  <div data-component-id="title" style="position:absolute;left:80px;top:170px;font-size:68px;color:#F9FAFB">
    Title
  </div>
</div>
```

Rules:
- Every element has `data-component-id` — **immutable once created**
- `position: absolute` on all elements
- Rendered as-is in `<iframe srcDoc>`

---

## Agent Architecture

Three built-in agents, all customizable:

| Agent | Role |
|-------|------|
| `ContentAgent` | Text, copy, structure |
| `DesignAgent` | Colors, typography, visual style |
| `LayoutAgent` | Positioning, spacing, composition |

Agents run as LangGraph threads. Each run is logged (`LLM_LOG`) with prompt, response, token counts, and cache hit status.

When two agents edit the same component simultaneously, a conflict is recorded and surfaced in the UI for manual resolution.

---

## Contributing

```
main
└── dev-x.x.x
    ├── feature-x.x.x/description
    ├── fix-x.x.x/description
    └── ...
```

Commit format: `type :: 설명` (e.g. `feat :: add component resize handle`)

Types: `feat` `fix` `refactor` `style` `chore` `docs` `test` `perf` `infra` `security` `hotfix` `revert`

---

## Security

- User LLM API keys: Fernet (AES-256) encrypted at rest; plaintext only in-memory during request handling
- Sanitization middleware strips key material from logs and error traces
- Key destroyed immediately on account deletion

---

## License

MIT
