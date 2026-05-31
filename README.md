# Knock

An AI-powered job companion for a hotel maintenance technician — built for **The Grimmauld**. Knock surfaces the right context (who's in the room, prior tickets, VIP/checkout flags) *before* the tech knocks, drafts guest messages and resolution notes, and handles escalation and shift handoff. Every AI output is a **draft the tech confirms** before anything is sent or logged.

Mobile-first (375px), single tech, single shift, no auth.

## Stack

- **Frontend:** React + Vite (mobile-first, ~375px)
- **Backend:** Flask (Python), raw `sqlite3`
- **Database:** SQLite (single file, populated by a seed script)
- **AI:** Claude API — `claude-sonnet-4-6` (context briefings, message drafts, resolution summaries, escalation routing, handoff notes)
- **Push:** Browser Push API + service worker (VAPID / `pywebpush`)

## Project structure

```
knock-app/
  backend/
    app.py            Flask API (all endpoints)
    ai.py             Claude integration (+ templated fallbacks)
    push.py           Web Push sender (pywebpush + VAPID)
    models.py         sqlite3 connection + schema init
    schema.sql        table definitions
    seed.py           drops + repopulates the demo shift
    bootstrap.py      startup: seed only if the DB is empty (deploy)
    gen_vapid.py      one-time VAPID keypair generator
    requirements.txt
    .env.example
  frontend/
    src/              React app (screens/, components/)
    public/sw.js      service worker (push + notification click)
    package.json
  Dockerfile          single-service image (build frontend → serve via Flask)
  .dockerignore
  README.md
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- An Anthropic API key (optional — without it, AI endpoints return templated fallback drafts)

## Setup

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# configure the API key (optional but recommended)
cp .env.example .env
#   then edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# generate VAPID keys for Web Push (writes vapid_private.pem + vapid.json)
.venv/bin/python gen_vapid.py

# create + populate the database (dispatch.db)
.venv/bin/python seed.py
```

### 2. Frontend

```bash
cd frontend
npm install
```

## Run

Two processes, two terminals:

```bash
# terminal 1 — backend on http://localhost:5001
cd backend && .venv/bin/python app.py

# terminal 2 — frontend on http://localhost:5173
cd frontend && npm run dev
```

Open **http://localhost:5173** (use **Chrome** for the push demo). The Vite dev server proxies `/api/*` to the backend, so there's a single origin.

> **Reset the demo** at any time with `cd backend && .venv/bin/python seed.py` — it drops and repopulates a fresh start-of-shift.

## Using it

The seed loads Dobby's shift at The Grimmauld with 5 jobs:

| Job | Room | Priority | Notes |
|---|---|---|---|
| AC not cooling | 312 | Urgent | Occupied, **VIP** (Minerva McGonagall, Diamond), 2 prior tickets |
| Leaking faucet | 214 | Urgent | Checkout 11 AM (Ron Weasley), 1 prior ticket |
| Shower drain clogged | 408 | High | Occupied (Hermione Granger, Gold) |
| Broken blinds | 301 | High | Checkout noon (Draco Malfoy) |
| Lightbulb replacement | 502 | Normal | Vacant |

Open a job → read the AI **context briefing** and **suggested guest message** → **Start job** (the VIP soft gate triggers on occupied VIP rooms with no message sent) → log findings (chips, photo, voice note) → **Mark resolved** for an AI resolution summary + close-out message, or **Escalate** for AI routing. End the shift for an AI summary + editable handoff note.

### Push notification demo (Chrome)

1. On the home screen, tap **Enable** in the notifications banner and allow.
2. Tap **⚡ Dispatch test job (dev)** — a browser notification appears; tapping it opens the job. The new job also shows in-app with a **NEW** badge and unread count.

## Notes

- **VIP is a boolean** (`rooms.vip`). Loyalty tier is **display-only** and drives no behavior — that's why Hermione (Gold) is not flagged VIP. Only Minerva (312) is VIP, so only she triggers the soft gate.
- **AI is draft-only.** Nothing is sent or logged without an explicit confirm step. If a Claude call fails or no key is set, the endpoint returns a templated fallback (`generated_by: "fallback"`) so the app never breaks.
- **`/api/dev/*` are demo-only and gated** — the MVP has no real job-creation flow; these endpoints exist solely to demonstrate push + the new-job UX and to reseed. They're disabled unless `ENABLE_DEV_ROUTES=1`, and return 404 otherwise.
- The backend runs with `debug=True` on port 5001 for local development only.

## Deployment (Railway — single service)

In production the React app is built to static files that **Flask serves itself**, so the API and UI share one origin and run as **one Railway service** behind a single URL. The included multi-stage `Dockerfile` builds the frontend, copies `frontend/dist` next to the backend, and runs gunicorn (Railway auto-detects the Dockerfile — no build config needed).

**Deploy:**

1. Push this repo to GitHub and create a Railway project from it (Railway detects the `Dockerfile`).
2. Set environment variables in the Railway service:
   - `ANTHROPIC_API_KEY` — optional; without it, AI endpoints return templated fallback drafts.
   - `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` — optional; enable Web Push. Run `python gen_vapid.py` locally once and copy the values. Without them, push is a no-op and the rest of the app works.
   - `KNOCK_DB_PATH` — optional; set to a path on a mounted volume (e.g. `/data/dispatch.db`) to persist data across deploys.
   - `ENABLE_DEV_ROUTES` — optional; set to `1` to expose the unauthenticated dev/demo endpoints (`/api/dev/reset`, `/api/dev/dispatch-job`). Off by default; turn on if you want to demo push or reseed on the live URL.
   - `PORT` is injected by Railway automatically; gunicorn binds to it.
3. Deploy. On first boot, `bootstrap.py` creates the schema and seeds the demo shift **only if the database is empty** — so a fresh/ephemeral disk gets seeded each deploy, while a volume-backed disk keeps its data.

**Data persistence:** SQLite lives on the container's disk, which is ephemeral on Railway. Without a volume, the DB resets (reseeds) on every deploy/restart — fine for a demo. To persist, attach a Railway volume and point `KNOCK_DB_PATH` at it.

**Build/run the image locally** (mirrors production):

```bash
docker build -t knock .
docker run -p 8080:8080 -e ANTHROPIC_API_KEY=sk-ant-... knock
# open http://localhost:8080  (API + UI on one origin)
```

> Note: browser push requires HTTPS (Railway provides it). On `http://localhost` Chrome also permits it, but not over plain-HTTP LAN IPs.

## Out of scope (per the brief)

Job creation/dispatch UI · authentication · real SMS (messages are logged in-app) · offline mode · multi-tech coordination · supervisor/GM view.
