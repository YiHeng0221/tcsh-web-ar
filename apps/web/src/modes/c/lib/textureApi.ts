/**
 * Texture-list shape used by Mode C.
 *
 * The backend owns a `textures` table and exposes a full CRUD surface
 * directly (no Supabase Storage anymore — bytes live alongside the FastAPI
 * service). The shape below mirrors what `GET /textures` and
 * `POST /textures` return.
 *
 * When the OpenAPI spec lands a `TextureOut` schema, swap this for a re-export
 * from `@/lib/api`. Until then this is hand-written and must stay in sync
 * with `apps/api/src/tcsh_ar_api/textures/schemas.py`.
 */
export type Texture = {
  id: string;
  /** Optional human-friendly label set by the admin during upload. */
  label?: string | null;
  /** Original filename from the upload. */
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** API-relative URL for the binary, e.g. "/textures/abc123/file". The
   *  frontend prepends `VITE_API_BASE_URL` via {@link textureUrl}. */
  file_url: string;
  created_at: string;
  updated_at: string;
};

interface ViteEnv {
  readonly VITE_API_BASE_URL?: string;
}

const env = import.meta.env as unknown as ViteEnv;
const API_BASE = env.VITE_API_BASE_URL ?? "";

/**
 * Resolve a render-able URL for a texture's binary endpoint.
 *
 * The API returns `file_url` as an absolute path (`/textures/<id>/file`).
 * In dev we want to hit the FastAPI server directly (so the browser loads
 * the bytes from `http://localhost:8000`); in prod the same convention
 * works as long as `VITE_API_BASE_URL` is set at build time. If it's
 * missing we fall back to a relative path so a misconfiguration is loud
 * (broken image) rather than silently wrong.
 */
export function textureUrl(texture: Pick<Texture, "file_url">): string {
  if (!texture.file_url) return "";
  if (!API_BASE) return texture.file_url;
  return `${API_BASE}${texture.file_url}`;
}
