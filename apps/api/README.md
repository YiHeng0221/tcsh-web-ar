# apps/api

FastAPI backend for tcsh-web-ar.

## Run locally (without Docker)

```bash
cd apps/api
cp .env.example .env
# generate an admin hash + JWT secret to paste into .env:
uv run python -m tcsh_ar_api.create_admin admin@example.com 'admin1234' --with-jwt-secret
uv sync
uv run alembic upgrade head             # create tables
uv run python -m tcsh_ar_api.seed       # optional: sample anchors / objects
uv run uvicorn tcsh_ar_api.main:app --reload
```

Open http://localhost:8000/docs — FastAPI's auto-generated Swagger UI.

## Run in Docker

From the repo root:

```bash
make docker-up
# api available at http://localhost:8000
```

## Layout

依 `docs/dev-journal/2026-04-18-backend-architecture.md` 的 layered + domain-modular 架構。

```
src/tcsh_ar_api/
  main.py           FastAPI app entrypoint (mounts routers, middleware)
  config.py         pydantic-settings based config (reads .env)
  db/               SQLAlchemy base + async session (to be added in #4)
  core/             cross-cutting helpers (exceptions, logging)
  health/           /health
  auth/             local single-admin JWT (login + me + verify)
  anchors/          router / schemas / repository / service / models
  objects/          ar_objects domain
  placements/       per-anchor object placements
  textures/         multipart upload + local-filesystem storage
  create_admin.py   CLI to bcrypt a password for ADMIN_PASSWORD_HASH
  seed.py           CLI seed script
```

## Lint / typecheck / test

```bash
uv run ruff check src tests
uv run ruff format src tests
uv run mypy
uv run pytest
```

See `../../docs/fastapi.md` for a deeper walkthrough of what each piece
does and why it's structured this way.
