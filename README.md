# Slidant

**[한국어](README.ko.md)**

**Multiple AI agents that collaborate to build and edit slides**

Slidant is a platform where several AI agents divide roles to generate and edit HTML slides. Users describe what they want in plain language, agents produce a proposal, and users accept or reject changes component by component.

---

## What Makes It Different

Most AI slide tools focus on generation — create once, done. Slidant is designed around **continuous editing and collaboration**.

| | Typical AI slide tools | Slidant |
|--|--|--|
| Editing | Full regeneration | Per-component edits |
| AI role | Single generator | Role-divided collaborative agents |
| Change tracking | None | Version history + rollback |
| Conflict handling | None | Conflict visualization + manual resolution |
| Expressiveness | Template-bound | Full CSS (animation, SVG, etc.) |

---

## Core Concepts

### Slides are HTML

Each slide is stored as a single HTML string, rendered as-is in an `<iframe>`. Anything CSS can do is available — gradients, animations, SVG, blur effects, and more.

```html
<div class="slide">
  <div data-component-id="bg" style="position:absolute;inset:0;background:#0A0F1E"></div>
  <div data-component-id="title" style="position:absolute;left:80px;top:170px;font-size:68px;color:#F9FAFB">
    Title
  </div>
</div>
```

Every element carries a `data-component-id`. This ID is the key for the approval UI, version diffs, and conflict detection.

### Agent Pipeline

```
User request
    ↓
planner        — plans what to change and how (streamed live)
    ↓
html_composer  — generates HTML directly
    ↓
html_validator — validates output, retries on failure
    ↓
AgentProposal saved
    ↓
User approves / rejects per component
    ↓
Selected components merged → slide updated
```

Agents never modify slides directly. They submit a proposal (`AgentProposal`), and the user picks which components to keep.

### Role-Divided Agents

Three built-in agents:

| Agent | Responsibility |
|-------|----------------|
| ContentAgent | Text, copy, structure |
| DesignAgent | Color, typography, visual style |
| LayoutAgent | Position, spacing, composition |

Multiple agents can edit the same slide simultaneously. If two agents touch the same component, a conflict is detected and the user chooses which version to use.

### Version History

Every change is recorded. Per-component change logs are available, and any past snapshot can be restored.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite |
| Slide rendering | `<iframe srcDoc>` |
| Backend | FastAPI + Python 3.12 |
| Agent orchestration | LangGraph |
| LLM | OpenRouter (default) / Anthropic Claude |
| Database | PostgreSQL |
| Cache | Redis |
| Realtime | SSE (Server-Sent Events) |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- LLM API key (OpenRouter or Anthropic)

### Run

```bash
git clone https://github.com/bssm-oss/Slidant.git
cd slidant

cp .env.example .env
cp api/.env.example api/.env
# Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in api/.env

docker compose up --build
```

- UI: `http://localhost`
- API: `http://localhost:8000`

### Local Development

**Backend**
```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

docker compose up db redis -d  # infra only
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd ui
pnpm install
pnpm dev
```

---

## Security

Users register their own LLM API keys. Keys are encrypted at rest with AES-256 (Fernet); plaintext exists only in memory during request handling and is never written to logs or error responses.

---

## License

MIT
