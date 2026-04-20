/**
 * Source URL for the primary artwork glTF.
 *
 * Dev: `apps/web/public/models/TaiJai.glb` (see README there).
 * Prod: set `VITE_ARTWORK_MODEL_URL` at build time to the Supabase
 * Storage public URL; the fallback below keeps dev builds green even
 * without the env var.
 */
export const ARTWORK_MODEL_URL =
  import.meta.env.VITE_ARTWORK_MODEL_URL ?? "/models/TaiJai.glb";
