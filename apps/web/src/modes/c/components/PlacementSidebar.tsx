import { useEffect, useId, useMemo, useState } from "react";

import type { ARObject, Anchor, Placement } from "@/lib/api";

import type { Texture } from "../lib/textureApi";
import { textureUrl } from "../lib/textureApi";
import { TEXTURE_DRAG_MIME } from "./TexturePalette";

/**
 * Editable form state for a single placement. Mirrors the OpenAPI
 * `PlacementUpdate` shape but with `null` collapsed to defaults so React
 * can render controlled inputs without juggling `?? ""` everywhere.
 */
export type PlacementFormValues = {
  /** Read-only — exposed in the form UI but never PATCHed. */
  id: string;
  /** Editable display label, sourced from the linked AR object. */
  label: string;
  anchor_id: string;
  texture_id: string | null;
  uv: {
    scale_x: number;
    scale_y: number;
    /** Stored as degrees in form state for human-friendly editing; the
     *  API consumes radians, so {@link degToRad} converts on save. */
    rotate_deg: number;
    offset_x: number;
    offset_y: number;
  };
  position: { x: number; y: number; z: number };
};

const DEFAULT_UV: PlacementFormValues["uv"] = {
  scale_x: 1,
  scale_y: 1,
  rotate_deg: 0,
  offset_x: 0,
  offset_y: 0,
};

/**
 * Project a `PlacementOut` (+ adjacent objects/anchors) into form-ready
 * state. Centralised so the editor screen, save mutation, and "discard
 * changes" reset all hit the same source of truth.
 */
export function placementToFormValues(
  placement: Placement,
  arObject: ARObject | null,
): PlacementFormValues {
  return {
    id: placement.id,
    label: arObject?.label ?? "",
    anchor_id: placement.anchor_id,
    texture_id: placement.texture_id ?? null,
    uv: placement.uv_transform
      ? {
          scale_x: placement.uv_transform.scale_x,
          scale_y: placement.uv_transform.scale_y,
          rotate_deg: radToDeg(placement.uv_transform.rotate),
          offset_x: placement.uv_transform.offset_x,
          offset_y: placement.uv_transform.offset_y,
        }
      : { ...DEFAULT_UV },
    position: {
      x: placement.transform.position.x,
      y: placement.transform.position.y,
      z: placement.transform.position.z,
    },
  };
}

/**
 * Validate form values for a save attempt. Returns either a list of
 * field-level error strings or `null` when valid. Mirrors the backend's
 * "scale must be strictly positive" rule + `NaN/Inf` rejection so the
 * admin gets feedback without a 422 round-trip.
 */
export function validatePlacementForm(
  values: PlacementFormValues,
): string[] | null {
  const errors: string[] = [];
  if (!values.anchor_id) errors.push("請選擇 Anchor");
  if (!isFiniteNumber(values.uv.scale_x) || values.uv.scale_x <= 0)
    errors.push("UV Scale X 必須為正數");
  if (!isFiniteNumber(values.uv.scale_y) || values.uv.scale_y <= 0)
    errors.push("UV Scale Y 必須為正數");
  for (const key of ["x", "y", "z"] as const) {
    if (!isFiniteNumber(values.position[key]))
      errors.push(`Position ${key.toUpperCase()} 必須為有效數字`);
  }
  for (const key of ["rotate_deg", "offset_x", "offset_y"] as const) {
    if (!isFiniteNumber(values.uv[key]))
      errors.push(`UV ${key} 必須為有效數字`);
  }
  return errors.length === 0 ? null : errors;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function shallowEqualForm(
  a: PlacementFormValues,
  b: PlacementFormValues,
): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.anchor_id === b.anchor_id &&
    a.texture_id === b.texture_id &&
    a.uv.scale_x === b.uv.scale_x &&
    a.uv.scale_y === b.uv.scale_y &&
    a.uv.rotate_deg === b.uv.rotate_deg &&
    a.uv.offset_x === b.uv.offset_x &&
    a.uv.offset_y === b.uv.offset_y &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.position.z === b.position.z
  );
}

// ── Sidebar component ─────────────────────────────────────────────────

type Props = {
  values: PlacementFormValues;
  /** Original (server-side) values — used to compute the dirty indicator. */
  pristine: PlacementFormValues;
  anchors: Anchor[];
  textures: Texture[];
  /** Server-side visibility flag (`is_show`). Lives on the placement record,
   *  not the form, because it persists immediately on toggle (no 儲存 step)
   *  — it's a publish switch, not a draft edit. */
  isShow: boolean;
  /** Toggle handler for `is_show`. PATCHes immediately + optimistically. */
  onToggleShow: (next: boolean) => void;
  /** True while the visibility PATCH is in flight (disable the checkbox). */
  isShowPending?: boolean;
  onChange: (next: PlacementFormValues) => void;
  /**
   * Called when the admin clicks 更換. Hooks into the C3 texture-library
   * picker dialog once it ships. Pass `null` to surface a "use the
   * palette" hint instead of a clickable button — that keeps the affordance
   * honest while the picker is in-flight (previous behaviour fell back to
   * a `window.prompt` that asked admins to paste a UUID).
   */
  onChangeTexture: (() => void) | null;
};

/**
 * Right-side 360-wide property panel from the C5 Figma. Pure controlled
 * inputs — the screen owns the form state so the canvas can render the
 * live values without prop-drilling through here.
 */
export function PlacementSidebar({
  values,
  pristine,
  anchors,
  textures,
  isShow,
  onToggleShow,
  isShowPending,
  onChange,
  onChangeTexture,
}: Props) {
  const dirty = useMemo(
    () => !shallowEqualForm(values, pristine),
    [values, pristine],
  );

  const idForId = useId();
  const labelId = useId();
  const anchorId = useId();

  const selectedTexture =
    textures.find((t) => t.id === values.texture_id) ?? null;

  function patch<K extends keyof PlacementFormValues>(
    key: K,
    next: PlacementFormValues[K],
  ) {
    onChange({ ...values, [key]: next });
  }

  function patchUV<K extends keyof PlacementFormValues["uv"]>(
    key: K,
    next: number,
  ) {
    onChange({ ...values, uv: { ...values.uv, [key]: next } });
  }

  function patchPosition<K extends keyof PlacementFormValues["position"]>(
    key: K,
    next: number,
  ) {
    onChange({ ...values, position: { ...values.position, [key]: next } });
  }

  return (
    <aside
      data-testid="placement-sidebar"
      className="flex h-full w-[360px] shrink-0 flex-col gap-5 overflow-y-auto bg-bg p-6"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-medium text-fg">物件屬性</h2>
        {dirty && (
          <span
            className="flex items-center gap-1 text-xs text-[#f59e0b]"
            aria-live="polite"
            data-testid="dirty-indicator"
          >
            <span aria-hidden>●</span>
            未儲存
          </span>
        )}
      </header>

      <label
        data-testid="placement-is-show"
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
      >
        <input
          type="checkbox"
          checked={isShow}
          disabled={isShowPending}
          onChange={(e) => onToggleShow(e.target.checked)}
          className="h-4 w-4 accent-accent disabled:opacity-50"
        />
        <span>於預覽 / AR 顯示</span>
        {isShowPending && (
          <span className="text-[11px] text-muted" aria-live="polite">
            更新中…
          </span>
        )}
      </label>

      <FieldRow>
        <FieldLabel htmlFor={idForId}>ID</FieldLabel>
        <input
          id={idForId}
          value={values.id}
          readOnly
          className={`${inputClass} text-muted`}
        />
      </FieldRow>

      <FieldRow>
        <FieldLabel htmlFor={labelId}>Label</FieldLabel>
        <input
          id={labelId}
          value={values.label}
          // Label lives on `ar_objects`, not `placements` — the field is
          // informational here. The C3/C2 screens own object label edits.
          readOnly
          className={`${inputClass} text-fg`}
        />
      </FieldRow>

      <FieldRow>
        <FieldLabel htmlFor={anchorId}>Anchor</FieldLabel>
        <select
          id={anchorId}
          value={values.anchor_id}
          onChange={(e) => patch("anchor_id", e.target.value)}
          className={`${inputClass} text-fg`}
        >
          {anchors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </FieldRow>

      <div className="flex flex-col gap-2">
        <FieldLabel>Texture</FieldLabel>
        <div className="flex items-center gap-3">
          <div
            data-testid="texture-thumb"
            // Draggable only when there's actually a texture to drag. Empty
            // thumbs would put a transparent ghost on the cursor and let
            // designers "drop nothing" onto markers — confusing.
            draggable={selectedTexture != null}
            onDragStart={(e) => {
              if (!selectedTexture) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.setData(TEXTURE_DRAG_MIME, selectedTexture.id);
              e.dataTransfer.effectAllowed = "copy";
              const target = e.currentTarget as HTMLElement;
              e.dataTransfer.setDragImage(target, 40, 40);
            }}
            title={
              selectedTexture
                ? `拖曳到場景中的 Placement 即可指派：${
                    selectedTexture.label ?? selectedTexture.filename
                  }`
                : "目前沒有貼圖"
            }
            className={[
              "flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-border bg-surface",
              selectedTexture
                ? "cursor-grab active:cursor-grabbing"
                : "cursor-default",
            ].join(" ")}
          >
            {selectedTexture ? (
              <img
                src={textureUrl(selectedTexture)}
                alt={selectedTexture.label ?? selectedTexture.filename}
                // pointer-events-none keeps the wrapping div as the drag
                // origin so dataTransfer payload + setDragImage stay tied
                // to the styled wrapper, not the inner <img>.
                className="pointer-events-none h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <span className="text-[10px] text-muted">無材質</span>
            )}
          </div>
          {onChangeTexture ? (
            <button
              type="button"
              onClick={onChangeTexture}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-fg transition-colors hover:border-fg"
            >
              更換
            </button>
          ) : (
            <span className="max-w-[140px] text-[11px] leading-snug text-muted">
              拖曳左側調色盤指派
            </span>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium text-fg">UV Transform</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <NumberField
            label="Scale X"
            value={values.uv.scale_x}
            step={0.1}
            decimals={1}
            onChange={(n) => patchUV("scale_x", n)}
          />
          <NumberField
            label="Scale Y"
            value={values.uv.scale_y}
            step={0.1}
            decimals={1}
            onChange={(n) => patchUV("scale_y", n)}
          />
          <NumberField
            label="Rotate"
            value={values.uv.rotate_deg}
            step={1}
            decimals={0}
            unit="°"
            onChange={(n) => patchUV("rotate_deg", n)}
          />
          <NumberField
            label="Offset X"
            value={values.uv.offset_x}
            step={0.1}
            decimals={1}
            onChange={(n) => patchUV("offset_x", n)}
          />
          <NumberField
            label="Offset Y"
            value={values.uv.offset_y}
            step={0.1}
            decimals={1}
            onChange={(n) => patchUV("offset_y", n)}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium text-fg">Position</legend>
        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
          <NumberField
            label="X"
            value={values.position.x}
            step={0.01}
            decimals={2}
            onChange={(n) => patchPosition("x", n)}
          />
          <NumberField
            label="Y"
            value={values.position.y}
            step={0.01}
            decimals={2}
            onChange={(n) => patchPosition("y", n)}
          />
          <NumberField
            label="Z"
            value={values.position.z}
            step={0.01}
            decimals={2}
            onChange={(n) => patchPosition("z", n)}
          />
        </div>
      </fieldset>
    </aside>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none";

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs text-muted">
      {children}
    </label>
  );
}

/**
 * Number input that:
 * - keeps a local string buffer so admins can type "1." / "-" without us
 *   stomping it back to the parsed number on every keystroke,
 * - commits a parsed numeric value upstream as soon as the buffer parses
 *   to a finite number,
 * - re-syncs from the parent when the parent value changes for a reason
 *   *other* than the user's own typing (e.g. a different placement gets
 *   selected), so canvas drag-style updates land in the field too.
 * - displays a unit suffix ("°") inside the input so the layout matches
 *   the Figma exactly.
 */
function NumberField({
  label,
  value,
  step,
  unit,
  decimals,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  unit?: string;
  /** When set, the canonical buffer is `value.toFixed(decimals)`. */
  decimals?: number;
  onChange: (next: number) => void;
}) {
  const id = useId();
  const canonical = decimals != null ? value.toFixed(decimals) : `${value}`;

  // Local buffer keeps focus + caret stable through parent re-renders.
  const [buffer, setBuffer] = useState(canonical);

  // Re-sync when the *number* the parent thinks we hold diverges from the
  // *number* our buffer parses to. Comparing parsed numbers (rather than
  // strings) lets the user keep typing "1.0" without us snapping it to
  // "1". When `value` flips externally (admin selects a different
  // placement), the buffers re-sync.
  useEffect(() => {
    const parsedBuf = Number(buffer);
    if (!Number.isFinite(parsedBuf) || parsedBuf !== value) {
      setBuffer(canonical);
    }
    // Only react to external value flips; buffer changes are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, canonical]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={buffer}
          step={step}
          onChange={(e) => {
            const next = e.target.value;
            setBuffer(next);
            const parsed = Number(next);
            if (next.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => setBuffer(canonical)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 pr-6 text-sm focus:border-accent focus:outline-none"
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
