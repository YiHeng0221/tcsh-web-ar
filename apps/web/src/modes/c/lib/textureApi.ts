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

/**
 * Resolve a render-able URL for a texture's binary endpoint.
 *
 * The API returns `file_url` as a host-relative path (`/textures/<id>/file`).
 * We prefix the same-origin `/api` proxy that `lib/api/client.ts` uses for
 * every request — NOT `VITE_API_BASE_URL`. An absolute `http://localhost:8000`
 * URL gets blocked as mixed content from the https dev origin
 * (`make web-dev-https`), which left every texture (image + glb) blank in
 * Mode C while curl — which ignores mixed-content — wrongly reported 200.
 * Same-origin keeps the bytes on the secure origin in dev and behind the
 * reverse proxy in prod.
 */
const API_PREFIX = "/api";

export function textureUrl(texture: Pick<Texture, "file_url">): string {
  if (!texture.file_url) return "";
  return `${API_PREFIX}${texture.file_url}`;
}
