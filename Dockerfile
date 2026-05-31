# Knock — single-service image: build the React frontend, then serve it from
# Flask (gunicorn) alongside the API. Railway auto-detects this Dockerfile.

# ---- Stage 1: build the React frontend into frontend/dist ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python backend that serves the built frontend ----
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ ./backend/
# app.py serves FRONTEND_DIST = ../frontend/dist relative to backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
EXPOSE 8080

# Seed-if-empty runs once (not per worker) so concurrent workers never race on
# the reseed, then gunicorn boots. Railway injects $PORT; default 8080 locally.
CMD ["sh", "-c", "python bootstrap.py && exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 2 --timeout 60 app:app"]
