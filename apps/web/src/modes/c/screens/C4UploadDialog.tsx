import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { getAccessToken } from "@/modes/c/lib/auth";
import type { Texture } from "@/modes/c/lib/textureApi";

/**
 * C4 · Upload Dialog (issue #27).
 *
 * 560×580 modal opened from C3. Drag-drop or click to pick files. Each file
 * is uploaded directly to the FastAPI backend in a single multipart POST:
 *
 *   POST /textures   (multipart/form-data, Authorization: Bearer <jwt>)
 *     field `file`  — image bytes
 *     field `label` — optional admin-friendly label (defaults to filename)
 *
 * Per-file progress comes from XMLHttpRequest (fetch streams uploads only on
 * a few browsers; XHR's `upload.onprogress` is universally supported and
 * cheap to wrap). Concurrency is intentionally 1 — small upload counts and
 * an outdoor venue where bandwidth might be flaky make sequential safer
 * than parallel for now.
 *
 * Migration note (2026-04): the previous implementation went through a
 * Supabase signed-URL flow (`POST /textures/upload-url` → PUT to storage).
 * That whole signed-URL handshake is gone — the bytes now live with the
 * FastAPI service and a single POST is the entire upload.
 */

export type C4UploadDialogProps = {
  open: boolean;
  onClose: () => void;
};

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/ktx2"];
const ACCEPT_ATTR = "image/jpeg,image/png,image/webp,.ktx2";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the modal copy.

type FileStatus = "queued" | "uploading" | "done" | "error";

interface UploadEntry {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0..1
  error?: string;
}

interface ViteEnv {
  readonly VITE_API_BASE_URL?: string;
}
const env = import.meta.env as unknown as ViteEnv;
const API_BASE = env.VITE_API_BASE_URL ?? "";

export default function C4UploadDialog({ open, onClose }: C4UploadDialogProps) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Reset state every time the dialog reopens — leaving stale "done" rows
  // from the last session would confuse the next batch.
  useEffect(() => {
    if (open) {
      setEntries([]);
      setDragOver(false);
    }
  }, [open]);

  // Esc to close. Only attach when open to avoid a global listener leak.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const addFiles = useCallback((picked: FileList | File[]) => {
    const next: UploadEntry[] = [];
    for (const file of Array.from(picked)) {
      if (file.size > MAX_BYTES) {
        next.push({
          id: makeId(),
          file,
          status: "error",
          progress: 0,
          error: "超過 10MB 上限",
        });
        continue;
      }
      // mime might be empty on .ktx2 — accept by extension as a fallback.
      const isKtx2 = /\.ktx2$/i.test(file.name);
      if (file.type && !ACCEPTED_MIME.includes(file.type) && !isKtx2) {
        next.push({
          id: makeId(),
          file,
          status: "error",
          progress: 0,
          error: "不支援的格式",
        });
        continue;
      }
      next.push({
        id: makeId(),
        file,
        status: "queued",
        progress: 0,
      });
    }
    setEntries((prev) => [...prev, ...next]);
  }, []);

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function updateEntry(id: string, patch: Partial<UploadEntry>) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  }

  const uploadAll = useMutation({
    mutationFn: async () => {
      // Sequential to keep per-file progress legible and to be polite to a
      // potentially flaky outdoor connection.
      for (const entry of entries) {
        if (entry.status !== "queued") continue;
        try {
          updateEntry(entry.id, { status: "uploading", progress: 0 });
          await uploadTexture(entry.file, (p) =>
            updateEntry(entry.id, { progress: p }),
          );
          updateEntry(entry.id, { status: "done", progress: 1 });
        } catch (err) {
          updateEntry(entry.id, {
            status: "error",
            error: err instanceof Error ? err.message : "上傳失敗",
          });
        }
      }
    },
    onSuccess: () => {
      // Refresh the texture list so C3 / C5 see the new uploads. The C5
      // editor uses `["textures"]`; the C3 library is a derived view today
      // (placements-fork) but will switch to the same key, so invalidate
      // both for now.
      void queryClient.invalidateQueries({ queryKey: ["textures"] });
      void queryClient.invalidateQueries({ queryKey: ["c", "textures"] });
    },
  });

  const queuedCount = entries.filter((e) => e.status === "queued").length;
  const allDone = entries.length > 0 && entries.every((e) => e.status === "done");

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="c4-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={(e) => {
        // Click on backdrop closes; click on the modal does not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col rounded-2xl bg-c-surface text-c-ink shadow-xl"
        style={{ width: 560, height: 580 }}
      >
        <header className="flex items-center justify-between border-b border-c-hairline px-7 py-5">
          <h2 id="c4-title" className="text-lg font-semibold">
            上傳貼圖
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-c-muted hover:bg-c-hover hover:text-c-ink"
            aria-label="關閉"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) {
                addFiles(e.dataTransfer.files);
              }
            }}
            className={cn(
              "flex h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors",
              dragOver
                ? "border-accent bg-accent/5"
                : "border-c-hairline-strong bg-c-surface hover:border-c-ink-soft",
            )}
          >
            <span aria-hidden className="text-3xl">
              📁
            </span>
            <p className="mt-3 text-base font-medium text-c-ink">拖曳圖片到這裡</p>
            <p className="mt-1 text-xs text-c-muted">或點擊選擇檔案</p>
            <p className="mt-3 text-[11px] text-c-muted">
              支援格式：JPG、PNG、WebP、KTX2 · 最大 10MB
            </p>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              // Reset value so picking the same file twice still triggers onChange.
              e.target.value = "";
            }}
          />

          {entries.length > 0 && (
            <div className="mt-5">
              <p className="text-xs text-c-muted">已選擇 {entries.length} 個檔案</p>
              <ul className="mt-3 space-y-2">
                {entries.map((entry) => (
                  <FileRow
                    key={entry.id}
                    entry={entry}
                    onRemove={() => removeEntry(entry.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-c-hairline px-7 py-4">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-c-muted hover:text-c-ink"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => uploadAll.mutate()}
            disabled={uploadAll.isPending || queuedCount === 0}
            className="h-10 rounded-md bg-c-ink px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadAll.isPending
              ? "上傳中…"
              : allDone
                ? "完成"
                : `開始上傳${queuedCount > 0 ? ` (${queuedCount})` : ""}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FileRow({
  entry,
  onRemove,
}: {
  entry: UploadEntry;
  onRemove: () => void;
}) {
  const showProgress = entry.status === "uploading" || entry.status === "done";
  const progressPct = Math.round(entry.progress * 100);

  return (
    <li className="rounded-md px-1 py-1.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-xl">
          🖼️
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-c-ink">{entry.file.name}</p>
          <p className="text-xs text-c-muted">
            {formatBytes(entry.file.size)}
            {entry.status === "error" && entry.error && (
              <span className="text-danger"> · {entry.error}</span>
            )}
            {entry.status === "done" && (
              <span className="text-success"> · 已完成</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={entry.status === "uploading"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-c-muted hover:bg-c-hover hover:text-c-ink disabled:opacity-30"
          aria-label={`移除 ${entry.file.name}`}
        >
          ✕
        </button>
      </div>
      {showProgress && (
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-c-hairline">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-150",
              entry.status === "done" ? "bg-success" : "bg-accent",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </li>
  );
}

// ── Network helpers ──────────────────────────────────────────────────────

/**
 * POST a single texture file to `/textures` with progress reporting.
 *
 * We can't reuse the JSON `apiPost` helper because:
 *   1. It serialises the body as JSON — multipart needs a `FormData` instance
 *      (the browser fills in the boundary).
 *   2. `fetch` doesn't expose request-progress events. XHR's
 *      `upload.onprogress` is the only cross-browser way to drive a
 *      per-file progress bar today.
 *
 * The XHR talks directly to the API origin (no Vite proxy), so we resolve
 * `VITE_API_BASE_URL` ourselves. In dev that's `http://localhost:8000`; in
 * prod it's the deployed API hostname. Authorization is read from the same
 * localStorage slot the rest of the app uses.
 *
 * Resolves with the parsed `Texture` on 2xx; rejects with `ApiError` on
 * anything else (incl. abort or network failure) so the UI can show a
 * sensible message.
 */
function uploadTexture(
  file: File,
  onProgress: (p: number) => void,
): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${API_BASE}/textures`;
    xhr.open("POST", url);

    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      // The server's response carries the canonical Texture record. Parse
      // defensively — a 5xx that returns HTML must not throw a confusing
      // `JSON.parse` error in the upload handler.
      const status = xhr.status;
      if (status >= 200 && status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as Texture;
          resolve(parsed);
        } catch (err) {
          reject(
            new ApiError(
              status,
              "上傳成功但回應格式不正確",
              err instanceof Error ? err.message : err,
            ),
          );
        }
        return;
      }

      // Try to extract `{ detail: "..." }`; fall back to status text.
      let message = xhr.statusText || `HTTP ${status}`;
      let detail: unknown;
      try {
        const parsed = JSON.parse(xhr.responseText);
        detail = parsed;
        if (parsed && typeof parsed === "object" && "detail" in parsed) {
          const d = (parsed as { detail: unknown }).detail;
          if (typeof d === "string") message = d;
        }
      } catch {
        // non-JSON body — keep statusText
      }
      reject(new ApiError(status, `${status} ${message}`, detail));
    };
    xhr.onerror = () => reject(new ApiError(0, "網路錯誤"));
    xhr.onabort = () => reject(new ApiError(0, "已取消"));

    const form = new FormData();
    form.append("file", file, file.name);
    // The label field is optional on the server; sending the filename gives
    // admins a sensible default they can rename later. Empty string would
    // also be valid, but a populated label keeps the C3 grid readable.
    form.append("label", file.name);

    xhr.send(form);
  });
}

// ── Misc helpers ────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function makeId(): string {
  // crypto.randomUUID is universal in modern browsers; sufficient for a
  // local-only key.
  return crypto.randomUUID();
}
