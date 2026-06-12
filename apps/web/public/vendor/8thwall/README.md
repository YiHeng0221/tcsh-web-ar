# 8th Wall engine binary (`XR8`) — vendor notes

This directory is the **self-hosting mount point** for the 8th Wall SLAM engine.
The `/dev/slam-mvp` route does **not** require these files by default — it loads
the engine from jsDelivr at runtime (see `src/lib/slam/load-xr8.ts`). Drop the
engine here only if you need a fully self-hosted / offline build.

## Background

8th Wall went **free and open-source on 2026-02-28**. The framework is MIT
(<https://github.com/8thwall/8thwall>), but the **SLAM engine ships as a
binary-only blob** under its own license — it is *not* MIT. Download point:
<https://8th.io/xrjs> (redirects into the 8thwall.org docs / npm package).

- npm package: **`@8thwall/engine-binary`** (verified `latest = 1.0.0`,
  homepage `https://8thwall.org`, author "8th Wall Team").
- No app key / API key is required for the self-hosted engine binary. Cloud
  features (VPS/Maps, Hand Tracking, Modules/Backends) are **not** supported by
  the binary — we don't use them; we only use world tracking (SLAM).

## How the runtime loader works (default — no files needed here)

`src/lib/slam/load-xr8.ts` injects:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js"
  async crossorigin="anonymous" data-preload-chunks="slam"></script>
```

The jsDelivr response carries `access-control-allow-origin: *`, so it loads
cross-origin from any host. The engine resolves its own chunk / web-worker base
URL from `document.currentScript.src`, so loading from the CDN also pulls the
SLAM chunk + `media-worker.js` from the CDN automatically.

## How to fully self-host (offline / no-CDN builds)

1. Download the whole `dist/` tree of `@8thwall/engine-binary@1` and place it
   under this directory, preserving structure:

   ```bash
   # from apps/web/public/vendor/8thwall/
   npm pack @8thwall/engine-binary@1          # → 8thwall-engine-binary-1.0.0.tgz
   tar -xzf 8thwall-engine-binary-1.0.0.tgz   # → package/dist/...
   mv package/dist ./dist && rm -rf package *.tgz
   ```

   You need the *entire* `dist/` (it includes `xr.js`, the `slam` chunk,
   `resources/media-worker.js` ~5 MB, and `.tflite` models) — the engine
   404s on missing chunks because it derives their paths from `xr.js`'s URL.

2. Point the loader at the local copy:

   ```ts
   // in DevSlamMvp.tsx, or via an env-driven override:
   await loadXR8("/vendor/8thwall/dist/xr.js");
   ```

   Because the engine uses `currentScript.src` for chunk resolution, serving
   `xr.js` from `/vendor/8thwall/dist/` makes it fetch the rest from the same
   path with no extra config.

## License

The binary is distributed under 8th Wall's **binary-only license** (see the
`LICENSE` shipped inside the npm tarball). It is redistributable as part of an
app but is **not** MIT and **not** modifiable. Keep this note with any committed
copy of the binary so the license provenance is never lost.

## Why nothing is committed here yet

For the MVP we load from jsDelivr (zero maintenance, CORS-open, always current).
Committing ~10 MB of binary + worker + model assets is only worth it for an
offline build, and is gated on a real need. If you add the files, commit them
together with their `LICENSE` and update this README's "committed: yes" status.

committed: **no** (CDN runtime load)
