/**
 * Texture-list shape used by Mode C.
 *
 * The backend owns a `textures` table and exposes a full CRUD surface
 * directly (no Supabase Storage anymore — bytes live alongside the FastAPI
 * service). The shape below mirrors what `GET /textures` and
 * `POST /textures` return.
 *
 * The backend now publishes a `TextureOut` schema in the generated
 * OpenAPI, so we narrow this alias to it (re-homing the type satisfies the
 * `Pydantic is the source of truth` rule from CLAUDE.md). We keep the
 * `Texture` name + a tolerant `label` so the existing C3/C4 call-sites that
 * read `texture.label ?? …` don't have to change.
 *
 * `kind` is the render-path discriminator: "model" → place the glTF binary
 * as-is, "image" → draw the bytes on a 2D quad. The backend derives it from
 * the mime type so the client never sniffs bytes.
 */
import type { components } from "@/lib/api";

type TextureOut = components["schemas"]["TextureOut"];

export type TextureKind = "image" | "model";

export type Texture = Omit<TextureOut, "label" | "kind"> & {
  /** Human-friendly label set by the admin during upload. The API always
   *  sends a string, but older mock fixtures may omit it — keep it
   *  tolerant so `texture.label ?? texture.filename` stays sound. */
  label?: string | null;
  /** Render-path discriminator: image (2D quad) vs model (glTF placed
   *  as-is). Backend-derived from the mime type. */
  kind: TextureKind;
};

/** Narrow the backend's `kind: string` to the client union. Anything the
 *  backend doesn't explicitly mark as a model is treated as an image. */
export function textureKind(texture: Pick<Texture, "kind">): TextureKind {
  return texture.kind === "model" ? "model" : "image";
}

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
