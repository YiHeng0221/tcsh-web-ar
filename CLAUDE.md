# CLAUDE.md

Guide for Claude (and any agent) working in this repo. Keep it short, keep it
current, treat it as the single source of truth for conventions the code
can't self-document.

---

## What this project is

A **web-based AR installation** for a large interactive artwork. See
`README.md` for the full product description. Three modes, one web origin:

- **Mode A** — on-site AR painting over physical objects (camera + QR
  anchor + IMU tracking + overlaid textures). The artwork is a ~2m-tall
  outdoor spiral metal mesh; visitors stand inside. Trackers **cannot** be
  attached to the artwork — anchors live on the ground at viewing stations.
- **Mode B** — handheld 3D viewer of the full textured artwork.
- **Mode C** — creator admin for uploading textures and placing them on
  objects. Gated by a hash-obfuscated path + login.

Backend owns placement truth, frontend owns rendering, binary assets live in
object storage.

---

## Repo shape

```
apps/
  web/        # React + Vite + Bun SPA (all three modes, code-split)
  api/        # FastAPI + uv JSON API
docs/
  setup.md            # step-by-step beginner setup
  docker.md           # Docker beginner guide
  fastapi.md          # FastAPI learning notes
  dev-journal/        # append-only learning log
docker-compose.yml    # dev-environment services
Makefile              # orchestration commands
```

**Schema sync:** Pydantic models in `apps/api` are the source of truth for
data shapes. Frontend types are generated from the FastAPI-emitted OpenAPI
spec via `openapi-typescript`. Do not hand-write matching TS types.

---

## Stack decisions

### Frontend (`apps/web`)

- Runtime / package manager: **Bun** (1.1+)
- Framework: **React 19 + Vite** (not Next.js — Vite is simpler for a
  single SPA with custom routing)
- Language: **TypeScript**, strict mode, no `any` without an inline reason
- 3D: **`@react-three/fiber`** + **`@react-three/drei`** on Three.js
- WebAR: **`@zxing/browser`** (QR detect) + **OpenCV.js `solvePnP`**
  (6DoF pose from QR corners) + **`DeviceMotionEvent` / `DeviceOrientationEvent`**
  (IMU rotation between QR reads). MindAR is a candidate stability helper
  but is **not** the primary tracker — see "AR tracking architecture" below.
- Styling: **Tailwind CSS 4** + **shadcn/ui**
- Data fetching: **TanStack Query**
- Forms: **React Hook Form** + **Zod**

### Backend (`apps/api`)

- Language: **Python 3.12**
- Framework: **FastAPI**
- Deps: **uv** (fast, Rust-based, PEP 621 `[project]` + `uv.lock`)
- ASGI server (dev): **uvicorn --reload**
- ASGI server (prod): **uvicorn** behind a reverse proxy, or **gunicorn**
  with uvicorn workers
- Validation / schemas: **Pydantic v2** (+ `pydantic-settings` for config)
- DB client: **SQLAlchemy 2.0** (async) + **`aiosqlite`** driver
  (relational data lives in a local SQLite file by default; the API is
  fully self-hosted now — no Supabase, no managed Auth, no managed
  Storage)
- Auth: single-admin **bcrypt + HS256 JWT** (`pyjwt` + the canonical
  `bcrypt` module). One admin identity configured via env vars; no user
  table.
- Binary storage: **local filesystem** under
  `apps/api/storage/textures/`, served back via `GET /textures/{id}/file`.
- Migrations: **Alembic**
- Lint / format: **Ruff** (lint + format, replaces Black + isort + flake8)
- Type check: **mypy** (strict on `src/tcsh_ar_api/`)
- Tests: **pytest** + **httpx** (for FastAPI test client)

### Infrastructure

- Auth: **local single-admin** — env vars `ADMIN_EMAIL` +
  `ADMIN_PASSWORD_HASH` (bcrypt) + `JWT_SECRET`. POST `/auth/login`
  mints HS256 JWTs; `/auth/me` and every mutating route verify them.
  No user table, no managed auth provider.
- Binary storage: **local filesystem** at `TEXTURE_STORAGE_DIR`
  (default `apps/api/storage/textures/`). Uploads go through
  `POST /textures` (multipart/form-data); the API persists the bytes
  and serves them back at `GET /textures/{id}/file`. Reads are
  unauthenticated; mutations are admin-only.
- Relational data: **SQLite** via `aiosqlite` (file path configured by
  `DATABASE_URL`, defaults to `apps/api/tcsh.db`). Models use the
  dialect-portable `GUID` TypeDecorator + SQLAlchemy `JSON` type, so
  swapping back to Postgres later is a `DATABASE_URL` change.
- Containerization: **Docker** (multi-stage builds) + **Docker Compose**
  for dev
- Orchestration: **Makefile** at repo root

### Why these choices

- **Vite instead of Next.js:** Next's SSR / App Router adds complexity we
  don't need (SPA with camera / WebGL, not a content site).
- **uv over Poetry:** migrated 2026-04-18 — an order of magnitude faster,
  standard `[project]` table, single static binary. See
  [`docs/dev-journal/2026-04-18-poetry-to-uv-migration.md`](docs/dev-journal/2026-04-18-poetry-to-uv-migration.md).
- **Self-hosted (no Supabase):** at this scale a single admin + a few
  hundred MB of texture files doesn't justify a managed auth + storage
  bill. One env-var-driven admin and `FileResponse`-served textures keeps
  ops surface minimal — swap back if multi-user becomes a real need.

---

## How to work in this repo

### Commands (via Makefile at repo root)

```bash
make install          # install Python + JS deps
make dev              # run api + web together (local, no Docker)
make dev-api          # just the FastAPI server
make dev-web          # just the Vite dev server
make docker-up        # full stack in containers
make docker-down      # stop containers
make lint             # ruff (api) + eslint (web)
make typecheck        # mypy (api) + tsc --noEmit (web)
make test             # pytest + vitest
```

### Before finishing any non-trivial change

Run at minimum `make typecheck && make lint`. For UI / AR changes, also
verify in a real browser — type-checking won't catch a camera permission
bug.

### Where to put things

- A new API endpoint → new module in `apps/api/src/tcsh_ar_api/routes/`,
  Pydantic response/request models alongside it. After shipping, regenerate
  the frontend's types from the updated OpenAPI spec.
- A new 3D helper that both Mode A and Mode B need → `apps/web/src/lib/3d/`.
- Mode-specific logic → stays inside `apps/web/src/modes/<mode>/`.
- A new DB table → SQLAlchemy model in `apps/api/src/tcsh_ar_api/db/models/`
  + Alembic migration (`alembic revision --autogenerate`).

---

## Conventions

- **Frontend:** TypeScript, strict. `.ts` / `.tsx` only.
- **Backend:** Python 3.12, type hints on every function signature, mypy
  strict on app code.
- **Pydantic is the source of truth** for data crossing the network.
  Frontend TS types are generated from OpenAPI, not hand-written.
- **No placement logic on the client.** The client renders placements; it
  does not decide them. Mode C mutates via the API.
- **Asset URLs are returned by the API**, not constructed on the client.
  Texture rows carry a relative `file_url` pointing at
  `/textures/{id}/file`; the frontend prepends `VITE_API_BASE_URL` when
  it fetches.
- **HTTPS in dev too.** `getUserMedia` and WebXR require a secure context;
  Vite supports it via `--https` (mkcert recommended for local certs).
- **Feature flags over branches** for WIP modes where possible.

---

## AR tracking architecture (Mode A)

Chosen model: **station-based AR**. Details in
`docs/dev-journal/2026-04-18-ar-tracking-architecture.md`.

Field constraints driving the design:
- Artwork is outdoor, ~2m tall, monochrome metal mesh (spiral, visitor
  stands inside). Rich visual texture from the grid pattern, but lighting
  is uncontrolled.
- **No markers on the artwork.** Markers on the ground / fixtures around
  the artwork are OK.
- iOS Safari required. WebXR is not available, so SLAM via WebXR is out.
- Target alignment precision: **cm-level** when user stands at a station.

Architecture:

1. **Anchor layer — QR on the ground.** Several (5–8) printed QR codes
   placed at designated viewing stations on the grass / pavers around and
   inside the spiral. Each QR encodes `{station_id, size_mm}`. The client
   detects the QR with `@zxing/browser`, takes the four corner pixel
   coordinates, and runs `solvePnP` (OpenCV.js) against the known
   real-world corner positions to recover full 6DoF camera pose.
2. **Tracking layer — IMU between QR reads.** Once pose is recovered,
   `DeviceOrientationEvent` (relative or absolute) keeps the camera's
   rotation updated. Rotation drift is tolerable at cm-level for a
   station visit (<1°/min on modern iPhones). Translation drift from
   `DeviceMotionEvent` accelerometer integration is **not** relied on —
   the user is assumed stationary at the station.
3. **Render layer — world-locked textures.** Placements (per object in
   the DB) have a world transform relative to a named anchor. Three.js
   renders them world-locked using the camera pose derived from steps 1–2.
4. **Recalibration policy.**
   - Every frame, if a QR is visible and detection confidence is high,
     re-solve pose (treated as ground truth, snaps drift out).
   - If the user translates noticeably (detected via accelerometer
     magnitude threshold or loss of QR for > N seconds), UI prompts:
     "請對準地面的 QR 重新校準".
5. **UX — discrete viewing stations.** User is guided to Station A,
   scans, views the objects visible from that angle, then walks to
   Station B. 200–300 objects are seen across stations, not all at once.

Why not MindAR as the primary tracker:
- The grid is visually rich, but outdoor lighting + visitor-occluded
  views make pure image tracking unreliable enough to risk cm-level
  misses. MindAR may still be layered in later as a secondary stabilizer
  that refines QR pose using the grid pattern. Ship the QR + IMU path
  first, measure drift, then decide.

Why not 8th Wall / Lightship VPS:
- Cost (USD 3–5k/year). Deferred unless the station + IMU approach
  fails field testing.

What this implies for the DB schema:
- `anchors` table (stations): `id`, `label`, `size_mm`, plus optional
  world position relative to a "venue origin" if we want to render
  cross-station placements.
- `placements.anchor_id` foreign-keys the station the placement is
  expressed relative to. Cross-anchor transforms are resolved at render
  time.

---

## Performance rules (Mode A is the hot path)

- **Never eagerly load all 200–300 textures.** Fetch an index only, then
  lazy-load per visible object with an LRU cache.
- **Prefer `.ktx2`** (Basis Universal) textures. Fall back to `.webp`.
- **Code-split by mode.** A visitor in Mode A should not download the admin
  bundle; an admin should not pay for the QR scan lib unless testing.
- **Profile on a real mid-range Android** before calling any perf work
  done.

---

## Security & access

- Mode C path (`/_studio/<token>`) is **obscurity, not security**. Every
  mutating endpoint must verify a locally-issued JWT server-side via the
  `require_admin` dependency.
- Texture uploads stream straight through `POST /textures` (multipart);
  the API validates mime + size, writes bytes to
  `TEXTURE_STORAGE_DIR/<id>.<ext>`, and inserts the row only after the
  file lands on disk.
- **`JWT_SECRET` and `ADMIN_PASSWORD_HASH` NEVER leave the backend.**
  Frontend only ever sees the issued JWT after a successful login.
- Never commit `.env` files. Every app has `.env.example` documenting
  required keys.
- User-uploaded images are validated (mime allow-list + size cap)
  inside `TextureService.create` before any disk write.

---

## Things NOT to do

- Don't bundle textures or glTF models into the web app bundle.
- Don't add a "switch to admin mode" button in the public UI.
- Don't invent new env vars without updating `.env.example` in the same
  commit.
- Don't skip the zod schema "because the type is obvious" — boundary data
  is parsed, not trusted.
- Don't introduce a second state-management library. Pick one per app and
  stick to it.

---

## Open questions (update as decisions happen)

- Exact station count and layout on the venue floor plan.
- QR size on the ground (bigger = detect from further, but visually
  more intrusive). Starting guess: 20 cm square.
- Whether to use `DeviceOrientationEvent` or the newer `RelativeOrientationSensor`
  — iOS Safari still gates the latter, test both.
- Whether to layer MindAR on top of QR pose for drift reduction, or
  keep the client simple.
- Session storage: Redis or Postgres table?
- Do we need a separate CMS-style editor for Mode C, or is a form-driven
  panel enough?
- Offline behavior when venue Wi-Fi dies mid-session?
- Cloudflare Pages vs Vercel for `apps/web`?

---

## When in doubt

Ask the user before introducing a new dependency, a new top-level package,
or a cross-cutting refactor. This repo is small enough that "just ship the
feature" is usually the right move — resist the urge to architect for
hypothetical scale.
