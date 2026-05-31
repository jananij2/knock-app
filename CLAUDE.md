# Knock — Lance take-home

## Stack
- Frontend: React (mobile-first, max-width 375px)
- Backend: Flask (Python)
- Database: SQLite (single file, seed script populates it)
- AI: Claude API (claude-sonnet-4-20250514) for context summaries, message drafts, resolution summaries, handoff notes
- Push notifications: Browser Push API + service worker

## Build order
1. SQLite schema + seed.py
2. Flask API endpoints
3. React frontend screens
4. Claude API integration
5. Browser push notifications

## Key constraints
- No auth — single tech, single shift
- All AI outputs require explicit human confirmation before anything is sent or logged
- Mobile-first — everything designed for 375px width, thumb-reachable actions
- Assume connectivity (no offline mode needed)

## Project structure (target)
dispatch-app/
  backend/
    app.py
    models.py
    seed.py
    dispatch.db
  frontend/
    src/
  CLAUDE.md