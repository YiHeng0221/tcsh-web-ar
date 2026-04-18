# apps/api

FastAPI backend for tcsh-web-ar.

## Run locally (without Docker)

```bash
cd apps/api
cp .env.example .env          # then fill Supabase keys
poetry install
poetry run uvicorn tcsh_ar_api.main:app --reload
```

Open http://localhost:8000/docs — FastAPI's auto-generated Swagger UI.

## Run in Docker

From the repo root:

```bash
make docker-up
# api available at http://localhost:8000
```

## Layout

```
src/tcsh_ar_api/
  main.py        FastAPI app entrypoint (mounts routers, middleware)
  config.py      pydantic-settings based config (reads .env)
  routes/        one module per route group
    health.py    /health
    artworks.py  /artworks
  db/            (to be added) SQLAlchemy models + session
  auth/          (to be added) Supabase JWT verification
  storage/       (to be added) Supabase Storage signing helpers
```

## Lint / typecheck / test

```bash
poetry run ruff check src tests
poetry run ruff format src tests
poetry run mypy
poetry run pytest
```

See `../../docs/fastapi.md` for a deeper walkthrough of what each piece
does and why it's structured this way.
