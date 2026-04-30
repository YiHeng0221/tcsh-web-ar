.PHONY: help install dev dev-api dev-web web-dev-https docker-up docker-down \
        docker-build lint lint-api lint-web format typecheck test clean

help:
	@echo "tcsh-web-ar — Makefile targets"
	@echo ""
	@echo "  make install        Install Python (uv) and JS (Bun) deps"
	@echo "  make dev            Run api + web dev servers locally (two processes)"
	@echo "  make dev-api        Run only the FastAPI server"
	@echo "  make dev-web        Run only the Vite dev server"
	@echo "  make web-dev-https  Vite dev server over HTTPS (mkcert) — for iPhone testing"
	@echo ""
	@echo "  make docker-up      Build images and start all containers"
	@echo "  make docker-down    Stop and remove containers"
	@echo "  make docker-build   Rebuild images without starting"
	@echo ""
	@echo "  make lint           Run ruff (api) and eslint (web)"
	@echo "  make format         Auto-format Python + TS"
	@echo "  make typecheck      mypy (api) + tsc --noEmit (web)"
	@echo "  make test           pytest + vitest"
	@echo ""
	@echo "  make clean          Remove caches, build outputs, node_modules"

# ─── install ──────────────────────────────────────────────────────────
install:
	cd apps/api && uv sync
	cd apps/web && bun install

# ─── dev (local, no docker) ───────────────────────────────────────────
dev:
	@echo "Starting api and web in parallel. Ctrl-C stops both."
	@trap 'kill 0' EXIT; \
	  (cd apps/api && uv run uvicorn tcsh_ar_api.main:app --reload --host 0.0.0.0 --port 8000) & \
	  (cd apps/web && bun run dev) & \
	  wait

dev-api:
	cd apps/api && uv run uvicorn tcsh_ar_api.main:app --reload --host 0.0.0.0 --port 8000

dev-web:
	cd apps/web && bun run dev

# HTTPS dev server (Mode A iPhone testing — getUserMedia + DeviceOrientationEvent
# need a secure context). One-time: `brew install mkcert nss && mkcert -install`.
# See docs/dev/https-local.md for iPhone trust setup.
web-dev-https:
	cd apps/web && VITE_HTTPS=1 bun run dev

# ─── docker ───────────────────────────────────────────────────────────
docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-build:
	docker compose build

# ─── quality ──────────────────────────────────────────────────────────
lint: lint-api lint-web

lint-api:
	cd apps/api && uv run ruff check src tests 2>/dev/null || uv run ruff check src

lint-web:
	cd apps/web && bun run lint

format:
	cd apps/api && uv run ruff format src
	cd apps/web && bun run lint --fix || true

typecheck:
	cd apps/api && uv run mypy
	cd apps/web && bun run typecheck

test:
	cd apps/api && uv run pytest
	cd apps/web && bun test || true

# ─── clean ────────────────────────────────────────────────────────────
clean:
	rm -rf apps/web/node_modules apps/web/dist
	rm -rf apps/api/.venv apps/api/.pytest_cache apps/api/.mypy_cache apps/api/.ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
