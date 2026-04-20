# `apps/web/public/models/`

**Not committed to git.** Binary glTF models for the artwork live here in
dev; production loads them from Supabase Storage so the web bundle stays
small (CLAUDE.md: "Don't bundle textures or glTF models into the web app
bundle.").

## Expected files

| File | Source | Size |
| ---- | ------ | ---- |
| `TaiJai.glb` | Artist hand-off via Discord; the full textured spiral-mesh artwork | ~10 MB |

## Getting the files (dev)

Until the upload script lands (#27 Mode C · C4), pull from the shared
Discord channel's `#作品資產` pins or ask @allen for the current version.
Drop the file here and Vite will serve it at `/models/TaiJai.glb`.

## Production

Models live under the Supabase Storage bucket `artwork/` with public
read. The frontend reads the URL from `VITE_ARTWORK_MODEL_URL`
(fallback: `/models/TaiJai.glb`). Keep the env var set in Cloudflare
Pages deploy config (#33).
