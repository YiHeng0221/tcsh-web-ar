# `apps/web/public/models/`

**Not committed to git.** Binary glTF models for the artwork live here in
dev; production loads them from Supabase Storage so the web bundle stays
small (CLAUDE.md: "Don't bundle textures or glTF models into the web app
bundle.").

## Expected files

| File | Size | Notes |
| ---- | ---- | ----- |
| `TaiJai.glb` | ~10 MB | Full textured spiral-mesh artwork |

## Getting the files (dev)

Hand-off URLs and the current artist contact live in the team's
internal docs — ask a maintainer. Drop the file here and Vite will
serve it at `/models/<name>`. #27 (Mode C · C4 upload) replaces the
manual hand-off with a real pipeline.

## Production

Models live under the Supabase Storage bucket `artwork/` with public
read. The frontend reads the URL from `VITE_ARTWORK_MODEL_URL`
(fallback: `/models/TaiJai.glb`). Keep the env var set in Cloudflare
Pages deploy config (#33).
