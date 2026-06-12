# tcsh-web-ar — orchestration commands.
#
# Sectioned into: setup · dev · test · quality · build · db · clean.
# `make` (no args) prints the help table; every target with a trailing
# `## description` comment shows up automatically.
#
# Style: tabs for recipes, two-space indentation inside multi-line shell.
# Keep target names stable — CI / docs / other PRs reference them.

API_DIR := apps/api
WEB_DIR := apps/web

# Default goal: show help when `make` is run with no target.
.DEFAULT_GOAL := help

# ─── Help ─────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help (grouped target list)
	@awk 'BEGIN { \
	    FS = ":.*?## "; \
	    printf "tcsh-web-ar — Makefile targets\n\n"; \
	  } \
	  /^# ===== / { \
	    section = $$0; sub(/^# ===== /, "", section); sub(/ =====$$/, "", section); \
	    printf "\n\033[1m%s\033[0m\n", section; next; \
	  } \
	  /^[a-zA-Z0-9_-]+:.*?## / { \
	    printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2; \
	  }' $(MAKEFILE_LIST)

# ===== Setup =====

.PHONY: install setup setup-api setup-web

install: setup ## Alias for `setup` (kept for back-compat)

setup: setup-api setup-web ## Install Python (uv) and JS (Bun) deps for both apps

setup-api: ## Install Python deps via `uv sync` in apps/api
	cd $(API_DIR) && uv sync

setup-web: ## Install JS deps via `bun install` in apps/web
	cd $(WEB_DIR) && bun install

# ===== Dev =====

.PHONY: dev dev-api dev-web web-dev-https docker-up docker-down docker-build

dev: ## Run api + web dev servers in parallel (Ctrl-C stops both)
	@echo "Starting api and web in parallel. Ctrl-C stops both."
	@trap 'kill 0' EXIT; \
	  (cd $(API_DIR) && uv run uvicorn tcsh_ar_api.main:app --reload --host 0.0.0.0 --port 8000) & \
	  (cd $(WEB_DIR) && bun run dev) & \
	  wait

dev-api: ## Run only the FastAPI server (uvicorn --reload on :8000)
	cd $(API_DIR) && uv run uvicorn tcsh_ar_api.main:app --reload --host 0.0.0.0 --port 8000

dev-web: ## Run only the Vite dev server (:5173)
	cd $(WEB_DIR) && bun run dev

web-dev-https: ## Vite dev server over HTTPS (mkcert) — for iPhone testing
	# getUserMedia / sensors need a secure context on real devices.
	# One-time setup: `brew install mkcert nss && mkcert -install`.
	# See docs/dev/https-local.md for iPhone trust setup.
	cd $(WEB_DIR) && VITE_HTTPS=1 bun run dev

docker-up: ## Build images and start the full stack via docker compose
	docker compose up --build

docker-down: ## Stop and remove docker compose containers
	docker compose down

docker-build: ## Rebuild docker images without starting them
	docker compose build

# ===== Test =====

.PHONY: test test-api test-web

test: test-api test-web ## Run pytest (api) and tests (web)

test-api: ## Run pytest in apps/api
	cd $(API_DIR) && uv run pytest

test-web: ## Run JS tests via bun (vitest if present; tolerated if absent)
	cd $(WEB_DIR) && bun test || true  # TODO: remove || true after vitest is set up (see PR #59)

# ===== Lint / Format / Typecheck =====

.PHONY: lint lint-api lint-web format format-api format-web typecheck typecheck-api typecheck-web

lint: lint-api lint-web ## Run ruff (api) and eslint (web)

lint-api: ## Ruff check on apps/api (src + tests when present)
	cd $(API_DIR) && if [ -d tests ]; then uv run ruff check src tests; else uv run ruff check src; fi

lint-web: ## ESLint over apps/web/src
	cd $(WEB_DIR) && bun run lint

format: format-api format-web ## Auto-format Python (ruff) + JS (eslint --fix)

format-api: ## Ruff format on apps/api/src
	cd $(API_DIR) && uv run ruff format src

format-web: ## ESLint --fix on apps/web (best effort)
	cd $(WEB_DIR) && bun run lint --fix || true

typecheck: typecheck-api typecheck-web ## mypy (api) + tsc --noEmit (web)

typecheck-api: ## mypy on apps/api
	cd $(API_DIR) && uv run mypy

typecheck-web: ## tsc --noEmit on apps/web
	cd $(WEB_DIR) && bun run typecheck

# ===== Build =====

.PHONY: build build-api build-web

build: build-api build-web ## Build api docker image and web production bundle

build-api: ## Build the FastAPI docker image (compose service `api`)
	docker compose build api

build-web: ## Build the Vite production bundle into apps/web/dist
	cd $(WEB_DIR) && bun run build

# ===== Database (Alembic) =====

.PHONY: db-upgrade db-downgrade db-revision db-current db-history

db-upgrade: ## Apply all pending Alembic migrations (alembic upgrade head)
	cd $(API_DIR) && uv run alembic upgrade head

db-downgrade: ## Roll back the most recent Alembic migration (alembic downgrade -1)
	cd $(API_DIR) && uv run alembic downgrade -1

db-revision: ## Autogenerate a new Alembic revision (override MSG="message")
	@if [ -z "$(MSG)" ]; then \
	  echo "Usage: make db-revision MSG=\"describe change\""; exit 2; \
	fi
	cd $(API_DIR) && uv run alembic revision --autogenerate -m '$(MSG)'

db-current: ## Show the currently applied Alembic revision
	cd $(API_DIR) && uv run alembic current

db-history: ## Print the Alembic revision history
	cd $(API_DIR) && uv run alembic history

# ===== Clean =====

.PHONY: clean clean-api clean-web

clean: clean-api clean-web ## Remove caches, build outputs, and node_modules

clean-api: ## Remove Python caches and the api .venv
	rm -rf $(API_DIR)/.venv $(API_DIR)/.pytest_cache $(API_DIR)/.mypy_cache $(API_DIR)/.ruff_cache
	find $(API_DIR) -type d -name __pycache__ -exec rm -rf {} +

clean-web: ## Remove node_modules and the Vite dist/ output
	rm -rf $(WEB_DIR)/node_modules $(WEB_DIR)/dist
