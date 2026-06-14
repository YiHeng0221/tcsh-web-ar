import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiGet, apiPatch } from "@/lib/api/client";
import type {
  ARObject,
  Anchor,
  Placement,
  PlacementUpdate,
  Vec3,
} from "@/lib/api";

import AdminShell from "../components/AdminShell";
import { CanvasPlacementScene } from "../components/CanvasPlacementScene";
import type { CanvasViewMode } from "../components/CanvasPlacementScene";
import { PlacementSidebar } from "../components/PlacementSidebar";
import {
  degToRad,
  placementToFormValues,
  shallowEqualForm,
  validatePlacementForm,
  type PlacementFormValues,
} from "../components/PlacementSidebar";
import { PlacementThumbnails } from "../components/PlacementThumbnails";
import { TexturePalette } from "../components/TexturePalette";
import type { Texture } from "../lib/textureApi";

/**
 * C5 · Placement Editor (issue #28).
 *
 * Three-pane desktop layout from the Figma:
 *   ┌──────────────── 1280 wide ────────────────┐
 *   │ TopNav (back · title · 預覽 · 儲存變更)     │
 *   ├──────────────────┬────────────────────────┤
 *   │                  │ Sidebar 360×664        │
 *   │  Canvas 920×664  │  - ID / Label / Anchor │
 *   │   (R3F + drei)   │  - Texture (80×80)     │
 *   │                  │  - UV Transform        │
 *   │                  │  - Position            │
 *   ├──────────────────┴────────────────────────┤
 *   │ Thumbnail strip (60×60 each)              │
 *   └────────────────────────────────────────────┘
 *
 * State flow:
 *   1. `placementId` URL param → fetch the placement + sibling indexes.
 *   2. Selected placement → form values via `placementToFormValues`.
 *   3. Form mutates `formValues` (controlled). Canvas reads `selectedId` +
 *      a synthetic override so the cube tracks the form before save.
 *   4. 儲存變更 → PATCH `/placements/:id`, optimistic cache update via
 *      TanStack Query.
 *   5. Picking a different placement (canvas click or thumbnail) updates
 *      the URL via `navigate` — keeps deep links honest.
 */
export default function C5PlacementEditor() {
  const params = useParams<{ placementId?: string; token?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Mode C lives under `/_studio/:token/*`; we keep the token in URL when
  // navigating between sub-routes so a refresh stays inside Mode C.
  const studioBase = `/_studio/${params.token ?? ""}`;

  // ── Data fetching ─────────────────────────────────────────────────
  // List queries are cheap (small JSON), single-fetch; per-placement
  // detail keeps its own cache so editing one doesn't refetch the list.
  const placementsQuery = useQuery({
    queryKey: ["placements"],
    queryFn: ({ signal }) => apiGet<Placement[]>("/placements", { signal }),
  });
  const objectsQuery = useQuery({
    queryKey: ["ar-objects"],
    queryFn: ({ signal }) => apiGet<ARObject[]>("/objects", { signal }),
  });
  const anchorsQuery = useQuery({
    queryKey: ["anchors"],
    queryFn: ({ signal }) => apiGet<Anchor[]>("/anchors", { signal }),
  });
  // Texture index isn't in the OpenAPI spec yet — see `lib/textureApi.ts`
  // for the assumed shape. The C3 agent will wire `GET /textures` for real.
  const texturesQuery = useQuery({
    queryKey: ["textures"],
    queryFn: ({ signal }) => apiGet<Texture[]>("/textures", { signal }),
  });

  const placements = placementsQuery.data ?? [];
  const objects = objectsQuery.data ?? [];
  const anchors = anchorsQuery.data ?? [];
  const textures = texturesQuery.data ?? [];

  // ── Selection ─────────────────────────────────────────────────────
  // Default to the URL param; fall back to the first placement once the
  // list lands. Keep the URL in sync so reloading lands on the same one.
  const selectedId = params.placementId ?? placements[0]?.id ?? null;

  const firstPlacementId = placements[0]?.id ?? null;
  useEffect(() => {
    if (!params.placementId && firstPlacementId) {
      navigate(`${studioBase}/placements/${firstPlacementId}`, {
        replace: true,
      });
    }
    // Re-runs only when the first placement id changes (initial landing
    // or list reorder) — re-deriving via a memoised primitive keeps the
    // exhaustive-deps lint happy without a disable comment.
  }, [firstPlacementId, navigate, params.placementId, studioBase]);

  const selectedPlacement = useMemo(
    () => placements.find((p) => p.id === selectedId) ?? null,
    [placements, selectedId],
  );

  const selectedObject = useMemo(
    () =>
      selectedPlacement
        ? (objects.find((o) => o.id === selectedPlacement.ar_object_id) ?? null)
        : null,
    [selectedPlacement, objects],
  );

  // ── View mode (isolation vs preview) ──────────────────────────────
  // Isolation focuses the canvas on the iron frame + the one selected
  // placement; preview shows every placement together so the admin can
  // check the whole composition. Default to isolation since the editor is
  // about positioning one piece at a time.
  const [viewMode, setViewMode] = useState<CanvasViewMode>("isolation");

  // Resolve a texture record for any placement (preview mode draws every
  // marker with its own saved texture, not just the selected one).
  const textureById = useMemo(
    () => new Map(textures.map((t) => [t.id, t])),
    [textures],
  );
  const textureForPlacement = useCallback(
    (placement: Placement): Texture | null =>
      placement.texture_id ? (textureById.get(placement.texture_id) ?? null) : null,
    [textureById],
  );

  // ── Form state ────────────────────────────────────────────────────
  // The pristine snapshot is rebuilt every time the selected placement
  // (or its underlying record) changes — it's the "what's on the server"
  // baseline that drives the dirty indicator.
  const pristine = useMemo<PlacementFormValues | null>(
    () =>
      selectedPlacement
        ? placementToFormValues(selectedPlacement, selectedObject)
        : null,
    [selectedPlacement, selectedObject],
  );

  const [formValues, setFormValues] = useState<PlacementFormValues | null>(
    null,
  );
  // Inline validation errors surfaced from `handleSave`. Replaces the
  // previous `window.alert` — alerts block the main thread, are not
  // screen-reader-friendly, and behave inconsistently across PWA / mobile
  // contexts. We render them inside an `role="alert"` banner above the
  // canvas so admins see them in-context.
  const [validationErrors, setValidationErrors] = useState<string[] | null>(
    null,
  );
  // Unsaved-changes guard for selection switches. window.confirm blocks
  // the main thread and is silently skipped (auto-true) in several PWA /
  // fullscreen contexts, so we use the same inline-banner pattern as the
  // validation errors: stash the requested target, render a banner with
  // an explicit confirm button.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // Reset form state when the selection changes (or the underlying server
  // record changes via cache invalidation).
  useEffect(() => {
    setFormValues(pristine);
    setValidationErrors(null);
    setPendingSwitch(null);
  }, [pristine]);

  // ── Save mutation ─────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (input: { id: string; body: PlacementUpdate }) => {
      return apiPatch<Placement>(`/placements/${input.id}`, input.body);
    },
    onSuccess: (updated) => {
      // Update both caches atomically so the editor doesn't flash stale
      // data: the list keeps the same identity, the detail cache for
      // /placements/:id (if seeded elsewhere) gets the new record.
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
      queryClient.setQueryData<Placement>(["placement", updated.id], updated);
    },
  });

  /**
   * Drag-and-drop auto-save mutation. Distinct from `saveMutation` so a
   * texture drop (small focussed PATCH) doesn't share its loading/error
   * state with the explicit 儲存變更 button — the designer wouldn't
   * understand "儲存中…" lighting up because they dropped a tile somewhere
   * else. Also lets us run a slim, optimistic update against the cache for
   * instant feedback, while a manual save still waits on the server reply.
   */
  const dropSaveMutation = useMutation({
    mutationFn: async (input: { id: string; textureId: string | null }) => {
      const body: PlacementUpdate = { texture_id: input.textureId };
      return apiPatch<Placement>(`/placements/${input.id}`, body);
    },
    onMutate: async ({ id, textureId }) => {
      // Optimistic cache update so the thumbnail strip + sidebar reflect
      // the new texture immediately — the auto-save's whole appeal is
      // "drop and it's there", so we can't wait on the round-trip.
      await queryClient.cancelQueries({ queryKey: ["placements"] });
      const previous = queryClient.getQueryData<Placement[]>(["placements"]);
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) =>
          p.id === id ? { ...p, texture_id: textureId } : p,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back on failure; the banner above the canvas surfaces the
      // error string so the designer knows the drop didn't stick.
      if (ctx?.previous) {
        queryClient.setQueryData(["placements"], ctx.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
      queryClient.setQueryData<Placement>(["placement", updated.id], updated);
      // C2's dashboard reads ["c", "placements"] — same endpoint, separate
      // cache entry. Mirror C4's dual-key invalidation so its 已上貼圖
      // stats recompute after edits here.
      void queryClient.invalidateQueries({ queryKey: ["c", "placements"] });
    },
  });

  /**
   * is_show toggle mutation. PATCHes `{is_show}` on a placement and mirrors
   * the dual-key cache update the drop / save mutations use so C2's
   * dashboard (`["c", "placements"]`) and the editor list (`["placements"]`)
   * both reflect the change. Optimistic so the checkbox + preview dim flip
   * instantly. Keyed by placement id so two rapid toggles don't clobber.
   */
  const showMutation = useMutation({
    mutationFn: async (input: { id: string; isShow: boolean }) => {
      const body: PlacementUpdate = { is_show: input.isShow };
      return apiPatch<Placement>(`/placements/${input.id}`, body);
    },
    onMutate: async ({ id, isShow }) => {
      await queryClient.cancelQueries({ queryKey: ["placements"] });
      const previous = queryClient.getQueryData<Placement[]>(["placements"]);
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) => (p.id === id ? { ...p, is_show: isShow } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["placements"], ctx.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
      queryClient.setQueryData<Placement>(["placement", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["c", "placements"] });
    },
  });

  function handleToggleShow(id: string, isShow: boolean) {
    showMutation.mutate({ id, isShow });
  }

  // ── Gizmo translate → form position ─────────────────────────────────
  // The canvas gizmo writes its world position back into the form so the
  // sidebar inputs + dirty indicator stay in lockstep. Save still goes
  // through the explicit 儲存變更 button.
  const handleGizmoMove = useCallback((position: Vec3) => {
    setFormValues((prev) =>
      prev ? { ...prev, position: { x: position.x, y: position.y, z: position.z } } : prev,
    );
  }, []);

  // ── Cmd + wheel → equilateral scale ─────────────────────────────────
  // Scale isn't exposed in the sidebar form (the form only edits position +
  // UV), so we persist it directly on the placement's transform.
  // Optimistic + multiplicative so rapid Cmd-scrolls *compound* smoothly:
  // each delta reads the cache's latest scale (not a stale closure), writes
  // the scaled value back immediately, then PATCHes it. We patch only
  // `transform` (round-tripping rotation) to avoid racing the form's
  // unsaved position edits onto the server.
  const scaleMutation = useMutation({
    mutationFn: async (input: { id: string; factor: number }) => {
      // Read the freshest placement from the cache so consecutive scrolls
      // compound rather than all multiplying the same stale base scale.
      const list = queryClient.getQueryData<Placement[]>(["placements"]);
      const current = list?.find((p) => p.id === input.id);
      if (!current) throw new Error("placement 不存在");
      const s = current.transform.scale;
      const body: PlacementUpdate = {
        transform: {
          position: current.transform.position,
          rotation: current.transform.rotation,
          scale: {
            x: s.x * input.factor,
            y: s.y * input.factor,
            z: s.z * input.factor,
          },
        },
      };
      return apiPatch<Placement>(`/placements/${input.id}`, body);
    },
    onMutate: async ({ id, factor }) => {
      // Optimistic: write the scaled value to the cache immediately so the
      // canvas marker grows/shrinks live and the next scroll reads it.
      await queryClient.cancelQueries({ queryKey: ["placements"] });
      const previous = queryClient.getQueryData<Placement[]>(["placements"]);
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) =>
          p.id === id
            ? {
                ...p,
                transform: {
                  ...p.transform,
                  scale: {
                    x: p.transform.scale.x * factor,
                    y: p.transform.scale.y * factor,
                    z: p.transform.scale.z * factor,
                  },
                },
              }
            : p,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["placements"], ctx.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Placement[]>(["placements"], (prev) =>
        prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
      queryClient.setQueryData<Placement>(["placement", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["c", "placements"] });
    },
  });

  const handleScaleDelta = useCallback(
    (factor: number) => {
      if (!selectedId) return;
      scaleMutation.mutate({ id: selectedId, factor });
    },
    [selectedId, scaleMutation],
  );

  // ── Deselect (Esc / empty click) ────────────────────────────────────
  // The editor always has a placement *selected* (the URL falls back to the
  // first placement), so "deselect" means "leave edit mode": flip to
  // preview, which hides the gizmo and shows the whole composition. The
  // sidebar's 隔離編輯 toggle (or clicking a marker) re-enters isolation.
  const handleDeselect = useCallback(() => {
    setViewMode("preview");
  }, []);

  function handleSave() {
    if (!formValues || !pristine || !selectedPlacement) return;
    const errors = validatePlacementForm(formValues);
    if (errors) {
      // Inline banner instead of `window.alert` — the banner already
      // hosts save / drop errors, so validation joins the same channel.
      setValidationErrors(errors);
      return;
    }
    setValidationErrors(null);
    if (shallowEqualForm(formValues, pristine)) return;

    const body: PlacementUpdate = {
      texture_id: formValues.texture_id ?? null,
      transform: {
        // Position changes are the only piece of `transform` the form
        // exposes today; we round-trip rotation + scale untouched so we
        // don't accidentally normalise an admin's edit elsewhere.
        position: {
          x: formValues.position.x,
          y: formValues.position.y,
          z: formValues.position.z,
        },
        rotation: selectedPlacement.transform.rotation,
        scale: selectedPlacement.transform.scale,
      },
      uv_transform: {
        scale_x: formValues.uv.scale_x,
        scale_y: formValues.uv.scale_y,
        rotate: degToRad(formValues.uv.rotate_deg),
        offset_x: formValues.uv.offset_x,
        offset_y: formValues.uv.offset_y,
      },
    };
    saveMutation.mutate({ id: selectedPlacement.id, body });
  }

  function handleSelect(id: string) {
    // Selecting a marker (canvas click, thumbnail, or sidebar list) is an
    // intent to *edit* it — drop into isolation mode so the gizmo appears
    // and the canvas focuses on the one piece. Re-selecting the same id
    // from preview still flips to isolation (the common "go edit this" path).
    if (id === selectedId) {
      if (viewMode !== "isolation") setViewMode("isolation");
      return;
    }
    setViewMode("isolation");
    // Reset form if dirty? Mockup doesn't show a confirm dialog — but a
    // silent loss feels rude, so we ask. Save-on-select would mask the
    // explicit 儲存變更 affordance.
    if (formValues && pristine && !shallowEqualForm(formValues, pristine)) {
      // Dirty form — ask via the inline banner instead of window.confirm
      // (blocked / auto-confirmed in some PWA contexts).
      setPendingSwitch(id);
      return;
    }
    navigate(`${studioBase}/placements/${id}`);
  }

  /**
   * Drag-and-drop handler. Behaviour:
   *   1. If the drop lands on the *currently selected* placement, just
   *      update the form's `texture_id` and fire the auto-save. The form's
   *      other dirty fields (UV, position) ride along — re-using the manual
   *      save path would be cleaner here, but designers expect the drop
   *      itself to feel atomic, so we PATCH only `texture_id` and let the
   *      explicit 儲存 button handle the rest.
   *   2. If the drop lands on a different placement, we still auto-save
   *      that placement's texture without changing selection — the user's
   *      drag intent was about that target, not about navigating. Any
   *      dirty edits on the *previously* selected placement are preserved
   *      because we don't touch its form state.
   *   3. If the user has unsaved edits *and* drops on a different
   *      placement, we still go ahead — the drop only writes `texture_id`
   *      on the target, never on the dirty placement, so nothing is lost.
   */
  function handleTextureDrop(placementId: string, textureId: string) {
    const target = placements.find((p) => p.id === placementId);
    if (!target) return;
    // Same placement — keep form + canvas in sync so the designer sees the
    // change before the round-trip finishes.
    if (placementId === selectedId && formValues) {
      setFormValues({ ...formValues, texture_id: textureId });
    }
    dropSaveMutation.mutate({ id: placementId, textureId });
  }

  // ── Loading / empty / error states ────────────────────────────────
  const isLoading =
    placementsQuery.isLoading ||
    objectsQuery.isLoading ||
    anchorsQuery.isLoading ||
    texturesQuery.isLoading;

  const error =
    placementsQuery.error ||
    objectsQuery.error ||
    anchorsQuery.error ||
    texturesQuery.error;

  const dirty =
    !!formValues && !!pristine && !shallowEqualForm(formValues, pristine);

  return (
    <AdminShell
      variant="back"
      title="Placement 編輯器"
      contentClassName="mx-0 max-w-none px-0 py-0"
      actions={
        <div className="flex items-center gap-2">
          {/* Isolation ↔ Preview toggle. Isolation: bare iron frame + the
              one selected placement (edit with the gizmo). Preview: every
              placement shown together (is_show off → dimmed), free orbit. */}
          <div
            role="group"
            aria-label="檢視模式"
            data-testid="mode-c-view-mode"
            className="flex items-center overflow-hidden rounded-md border border-c-hairline"
          >
            <button
              type="button"
              data-testid="mode-c-view-isolation"
              aria-pressed={viewMode === "isolation"}
              onClick={() => setViewMode("isolation")}
              className={`px-3 py-2 text-sm transition-colors ${
                viewMode === "isolation"
                  ? "bg-accent text-bg"
                  : "bg-c-surface text-c-muted hover:text-fg"
              }`}
            >
              隔離編輯
            </button>
            <button
              type="button"
              data-testid="mode-c-view-preview"
              aria-pressed={viewMode === "preview"}
              onClick={() => setViewMode("preview")}
              className={`px-3 py-2 text-sm transition-colors ${
                viewMode === "preview"
                  ? "bg-accent text-bg"
                  : "bg-c-surface text-c-muted hover:text-fg"
              }`}
            >
              同時預覽
            </button>
          </div>
          <button
            type="button"
            data-testid="mode-c-placement-save"
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveMutation.isPending ? "儲存中…" : "儲存變更"}
          </button>
        </div>
      }
    >
      <div
        data-mode="c"
        data-screen="c5"
        className="flex h-[calc(100dvh-56px)] w-full flex-col overflow-hidden"
      >
        {error && (
          <div
            role="alert"
            className="border-b border-danger/40 bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            {(error as Error).message ?? "資料載入失敗"}
          </div>
        )}

        {validationErrors && validationErrors.length > 0 && (
          <div
            role="alert"
            className="border-b border-danger/40 bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            <p className="font-medium">表單驗證失敗</p>
            <ul className="mt-1 list-disc pl-5">
              {validationErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {pendingSwitch && (
          <div
            role="alert"
            className="flex items-center gap-4 border-b border-warning/40 bg-warning/10 px-6 py-3 text-sm"
          >
            <span>有未儲存的變更，切換後將會遺失。</span>
            <button
              type="button"
              className="rounded border border-danger px-3 py-1 text-danger"
              onClick={() => {
                const target = pendingSwitch;
                setPendingSwitch(null);
                navigate(`${studioBase}/placements/${target}`);
              }}
            >
              捨棄變更並切換
            </button>
            <button
              type="button"
              className="rounded border border-muted px-3 py-1"
              onClick={() => setPendingSwitch(null)}
            >
              留在這裡
            </button>
          </div>
        )}

        {saveMutation.isError && (
          <div
            role="alert"
            className="border-b border-danger/40 bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            儲存失敗：
            {(saveMutation.error as Error)?.message ?? "請稍後再試"}
          </div>
        )}

        {dropSaveMutation.isError && (
          <div
            role="alert"
            className="border-b border-danger/40 bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            貼圖指派失敗：
            {(dropSaveMutation.error as Error)?.message ?? "請稍後再試"}
          </div>
        )}

        {showMutation.isError && (
          <div
            role="alert"
            className="border-b border-danger/40 bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            顯示狀態更新失敗：
            {(showMutation.error as Error)?.message ?? "請稍後再試"}
          </div>
        )}

        {scaleMutation.isError && (
          <div
            role="alert"
            className="border-b border-danger/40 bg-danger/10 px-6 py-3 text-sm text-danger"
          >
            縮放更新失敗：
            {(scaleMutation.error as Error)?.message ?? "請稍後再試"}
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Canvas area — Figma calls for 920×664 but we let it flex so
              the editor scales gracefully on larger desktops. */}
          <div className="relative flex flex-1 items-stretch border-r border-border">
            {selectedPlacement && formValues ? (
              <CanvasPlacementScene
                className="h-full w-full"
                placements={placements}
                selectedId={selectedPlacement.id}
                onSelect={handleSelect}
                onDeselect={handleDeselect}
                onTextureDrop={handleTextureDrop}
                viewMode={viewMode}
                onGizmoMove={handleGizmoMove}
                onScaleDelta={handleScaleDelta}
                textureForPlacement={textureForPlacement}
                selectedOverride={canvasOverride(formValues, selectedPlacement)}
                selectedTexture={
                  textures.find((t) => t.id === formValues.texture_id) ?? null
                }
                overlay={
                  textures.length > 0 ? (
                    <TexturePalette
                      textures={textures}
                      activeTextureId={formValues.texture_id}
                    />
                  ) : null
                }
              />
            ) : (
              <EmptyCanvas isLoading={isLoading} />
            )}
          </div>

          {selectedPlacement && formValues && pristine ? (
            <PlacementSidebar
              values={formValues}
              pristine={pristine}
              anchors={anchors}
              textures={textures}
              isShow={selectedPlacement.is_show !== false}
              onToggleShow={(next) =>
                handleToggleShow(selectedPlacement.id, next)
              }
              isShowPending={showMutation.isPending}
              onChange={setFormValues}
              // The dedicated C3 picker dialog (issue follow-up) isn't
              // built yet. Until it ships the only realistic way to set a
              // texture is the drag-and-drop palette at the canvas edge,
              // so we mark the change-texture affordance as unavailable
              // here. We pass `null` so PlacementSidebar can render a
              // hint instead of a clickable button that asks the admin to
              // type a UUID.
              onChangeTexture={null}
            />
          ) : (
            <aside className="w-[360px] shrink-0 border-l border-border bg-bg p-6 text-sm text-muted">
              {isLoading ? "載入中…" : "請從下方挑選一個 Placement。"}
            </aside>
          )}
        </div>

        <PlacementThumbnails
          placements={placements}
          textures={textures}
          selectedId={selectedId}
          onSelect={handleSelect}
          onToggleShow={handleToggleShow}
        />
      </div>
    </AdminShell>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Bridge form state to the canvas marker's override shape. Position is
 * the only `Transform` field the form edits; we leave scale alone so the
 * marker stays the same size while the admin nudges position around.
 */
function canvasOverride(
  values: PlacementFormValues,
  placement: Placement,
): { position: Vec3; scale: Vec3 } {
  return {
    position: {
      x: values.position.x,
      y: values.position.y,
      z: values.position.z,
    },
    scale: placement.transform.scale,
  };
}

// ── Empty canvas placeholder ─────────────────────────────────────────
function EmptyCanvas({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a] text-sm text-muted">
      {isLoading ? "載入中…" : "尚未挑選 Placement"}
    </div>
  );
}
