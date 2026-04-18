# apps/api

FastAPI backend for tcsh-web-ar.

## Run locally (without Docker)

```bash
cd apps/api
cp .env.example .env          # then fill Supabase keys
uv sync
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
  auth/             Supabase JWT verification (to be added in #5)
  anchors/          (to be added in #7) router / schemas / repository / service / models
  objects/          (to be added in #8)
  placements/       (to be added in #9)
  textures/         (to be added in #6, #10) + storage.py for Supabase Storage
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
