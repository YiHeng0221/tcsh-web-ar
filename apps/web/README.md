# apps/web

React 19 + Vite SPA, run under Bun.

## Run locally (without Docker)

```bash
cd apps/web
cp .env.example .env
bun install
bun run dev
```

Open http://localhost:5173.

`/api/*` requests are proxied to the FastAPI server on `localhost:8000`
during dev (see `vite.config.ts`).

## Run in Docker

From the repo root:

```bash
make docker-up
# web available at http://localhost:8080
# the nginx container proxies /api/* to the api service
```

## Layout

```
src/
  main.tsx      React entry + QueryClient provider
  App.tsx       app shell
  modes/        a-ar / b-viewer / c-admin (to be scaffolded)
  lib/          ar, 3d, api client helpers
```

See `../../docs/setup.md` for the full setup walkthrough.
