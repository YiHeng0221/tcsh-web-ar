# Review Pipeline Overrides

> This file is injected into every reviewer session (`/review` command and
> `.github/scripts/ai-review.sh`) as the highest-priority instruction block.
> It overrides what gets flagged, at what severity, and how findings are
> reported. Project conventions live in `CLAUDE.md` — this file only governs
> *review behaviour*.

---

## What "Important" means in this repo

Reserve 🔴 **Important** for findings that would:

- Break behaviour in production (broken Mode A on iOS Safari, wrong placement
  rendering, API 500 on a documented happy path).
- Leak user data or service-role credentials (Supabase service-role key on
  the client, JWT in logs, signed-URL contents leaking).
- Block a rollback — irreversible Alembic migration without a tested
  downgrade, breaking schema change without backward compat shim.
- Introduce a security vulnerability — auth bypass on Mode C, missing JWT
  verification, raw SQL with user input, XSS via `dangerouslySetInnerHTML`,
  CSRF on a mutating endpoint.
- Violate a Hard Rule listed in `CLAUDE.md` ("Things NOT to do").
- Cause cm-level pose drift in Mode A (off-by-one on QR corner ordering,
  wrong coordinate frame, accelerometer integration where the spec said not
  to).

Style preferences, naming nits, and "I would have written it this way"
refactor suggestions are 🟡 **Nit** at most.

---

## Nit volume cap

Report at most **5 nits per review**. If you found more, say "plus N similar
items in this file" in the summary and pick the highest-impact 5 inline.

If everything you found is a Nit, lead the summary with: **「沒有阻擋合併的問題」**.

---

## Do not report

Skip these — they're either CI's job or out of review scope:

- Anything `ci.yml` already enforces (ruff lint, mypy types, tsc errors,
  pytest failures, vitest failures, gitleaks hits, PR size).
- Generated files: `apps/web/src/types/api.gen.ts` (openapi-typescript output),
  `dist/`, `build/`, `node_modules/`, `.venv/`.
- Lockfiles: `bun.lock`, `uv.lock`, `pnpm-lock.yaml`.
- Migrations already merged on `main` (pre-existing).
- `docs/` changes — unless they contradict the code in this PR.
- `apps/web/public/models/*` binaries (excluded by `.gitignore` anyway).

---

## Always check (AR-specific)

When reviewing a PR, always verify these — they're easy to miss and expensive
to catch in field testing:

### Mode A / WebAR
- New `getUserMedia` / camera flows handle permission denial without crashing.
- QR detection code disposes of `BrowserQRCodeReader` on unmount (memory leak
  on iOS Safari otherwise).
- Three.js objects (geometries, materials, textures) have a matching
  `.dispose()` call on unmount — `r3f` does NOT auto-dispose user-created
  resources.
- IMU listeners (`deviceorientation` / `devicemotion`) are removed on
  unmount, and the iOS permission gate (`DeviceMotionEvent.requestPermission`)
  is called from a user-activation handler — not on mount.
- Anchor pose math (`solvePnP` inputs/outputs) uses consistent units (mm vs
  m vs px) and a documented coordinate frame.
- HTTPS-only APIs (`getUserMedia`, sensors) are not called on `http://`
  fallback paths.

### Backend (FastAPI)
- New API routes have an integration test (pytest + httpx TestClient).
- Mutating endpoints verify the Supabase JWT and check the user's role —
  Mode C is "obscurity, not security".
- Pydantic models are the source of truth — frontend types are regenerated
  (`make types` / `openapi-typescript`) and committed in the same PR.
- New DB tables have indexes on foreign keys and common WHERE-clause columns.
- Alembic migrations have a working `downgrade()` (or an explicit comment
  saying why a one-way migration is intentional).
- Async DB sessions are scoped per-request (no shared session leaks across
  requests).
- Log statements don't include emails, JWTs, request bodies, or signed
  Storage URLs.

### Frontend (React + Vite)
- Mode-specific code stays under `apps/web/src/modes/<mode>/` — no Mode A
  importing from Mode C admin.
- Code-split bundles: a Mode A visitor doesn't pull in the admin bundle.
- Boundary data is parsed with Zod, not trusted because "the type says so".
- TanStack Query keys include all inputs that affect the response.

### General
- PR body has a summary that matches the diff (not stale from an earlier
  commit).
- No new env var without an `.env.example` update in the same PR.
- No service-role key, secret, or token in frontend code paths.

---

## Verification bar

Before posting a finding, verify it's grounded:

- Behaviour claims must cite `file_path:line_number` from the diff — not
  inferred from naming.
- Performance claims must reference a measurement, a profile, or a documented
  threshold (e.g., "FPS drops below 30 on mid-range Android" cites the rule
  in `CLAUDE.md` "Performance rules").
- Security claims must name the attack vector — "this could be exploited" is
  not enough; "user-supplied `x` reaches `eval` at line N" is.
- If you can't verify in the diff, mark it as a question, not a 🔴.
- **Existence claims need full-file proof.** "Field/symbol/file X doesn't
  exist" must be verified by opening the actual file (Read/Grep on the
  checkout) — diff context truncation has produced false 🔴s here before.
  A claim that 98 passing tests contradict is almost certainly wrong.
- **Don't contradict the previous round.** If round N-1 asked for a change
  and the author made it, don't ask to revert it in round N unless you can
  cite a concrete defect the change introduced.

---

## Severity tags

- 🔴 **Important** — blocks merge (per "What Important means" above).
- 🟡 **Nit** — improvement, doesn't block. Cap 5 per review.
- 🟣 **Pre-existing** — out of scope of this PR (pre-dates the diff).

---

## Output format

The reviewer agent produces a single Markdown report posted as a PR comment
(GitHub comment size limit: 65 536 chars — `ai-review.sh` truncates if
needed):

```
## AI Code Review

**Verdict:** pass | changes-requested

| Lens | 🔴 | 🟡 | 🟣 |
|------|----|----|----|
| Correctness  | N | N | N |
| Security     | N | N | N |
| Architecture | N | N | N |

### Top 3 concerns
1. <one line, with file:line>
2. <one line, with file:line>
3. <one line, with file:line>

### Details
<per-finding block: severity, lens, file:line, description, suggested patch>

### Positive notes (optional)
<what looks good — keeps reviews from being purely negative>

_Generated by Claude (model: <model>) with REVIEW.md context._
```

If there are zero findings of any severity, lead with **「沒有阻擋合併的問題」**
and still emit the table (all zeros) — the empty review is the audit signal.
