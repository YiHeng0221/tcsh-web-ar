import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { apiGet } from "@/lib/api/client";
import type { Anchor, ARObject, Placement } from "@/lib/api";
import { cn } from "@/lib/cn";
import AdminShell from "@/modes/c/components/AdminShell";

/**
 * C2 · Dashboard (issue #25).
 *
 * Three stat cards (objects / textured / stations) + quick actions list +
 * recent activity. The "已上貼圖" stat is derived from placements that
 * have a non-null `texture_id` — the API doesn't expose a dedicated count
 * yet, so we tally client-side from the placements list. That's fine for
 * 200-300 objects; revisit if it grows.
 *
 * Recent activity is currently a placeholder list — there's no audit-log
 * endpoint yet (open question in CLAUDE.md). The list mirrors the Figma
 * so the layout settles, and is wired up later.
 */
export default function C2Dashboard() {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  const objectsQ = useQuery({
    queryKey: ["c", "objects"],
    queryFn: ({ signal }) => apiGet<ARObject[]>("/objects", { signal }),
  });
  const placementsQ = useQuery({
    queryKey: ["c", "placements"],
    queryFn: ({ signal }) => apiGet<Placement[]>("/placements", { signal }),
  });
  const anchorsQ = useQuery({
    queryKey: ["c", "anchors"],
    queryFn: ({ signal }) => apiGet<Anchor[]>("/anchors", { signal }),
  });

  const isLoading =
    objectsQ.isLoading || placementsQ.isLoading || anchorsQ.isLoading;
  const isError = objectsQ.isError || placementsQ.isError || anchorsQ.isError;

  const objectsCount = objectsQ.data?.length ?? 0;
  const placements = placementsQ.data ?? [];
  const texturedCount = placements.filter((p) => p.texture_id).length;
  const stationsCount = anchorsQ.data?.length ?? 0;
  const texturedPct =
    objectsCount > 0 ? Math.min(1, texturedCount / objectsCount) : 0;

  const studioBase = `/_studio/${token ?? ""}`;

  const actions: QuickAction[] = [
    {
      icon: "🧱",
      label: "上傳貼圖",
      onClick: () => navigate(`${studioBase}/textures`),
    },
    {
      icon: "🎯",
      label: "編輯 placement",
      onClick: () => navigate(`${studioBase}/placements`),
    },
    { icon: "📍", label: "管理 anchor", onClick: () => navigate(`${studioBase}/anchors`) },
    { icon: "👀", label: "預覽 Mode A / B", onClick: () => navigate(`${studioBase}/preview`) },
  ];

  return (
    <AdminShell variant="default">
      {/* Stat cards */}
      <section className="grid grid-cols-3 gap-6">
        <StatCard
          value={objectsCount}
          label="物件總數"
          loading={objectsQ.isLoading}
          error={objectsQ.isError}
        />
        <StatCard
          value={texturedCount}
          label="已上貼圖"
          loading={placementsQ.isLoading || objectsQ.isLoading}
          error={placementsQ.isError}
          progress={texturedPct}
        />
        <StatCard
          value={stationsCount}
          label="站點"
          loading={anchorsQ.isLoading}
          error={anchorsQ.isError}
        />
      </section>

      {isError && (
        <p className="mt-4 text-xs text-danger" role="alert">
          無法載入儀表板資料（API 連線失敗）
        </p>
      )}

      {/* Quick actions + recent activity */}
      <section className="mt-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-12">
        <div>
          <h2 className="mb-3 text-xs text-c-muted">快速動作</h2>
          <ul className="rounded-xl border border-c-hairline bg-c-surface">
            {actions.map((a, i) => (
              <li key={a.label}>
                <button
                  type="button"
                  onClick={a.onClick}
                  className={cn(
                    "flex w-full items-center justify-between px-5 py-4 text-left text-sm text-c-ink hover:bg-c-hover",
                    i > 0 && "border-t border-c-hairline",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span aria-hidden className="text-base">
                      {a.icon}
                    </span>
                    <span>{a.label}</span>
                  </span>
                  <span aria-hidden className="text-c-muted">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-xs text-c-muted">最近活動</h2>
          <ul className="rounded-xl border border-c-hairline bg-c-surface">
            {(isLoading ? PLACEHOLDER_ACTIVITY : RECENT_ACTIVITY).map((entry, i) => (
              <li
                key={`${entry.when}-${entry.text}-${i}`}
                className={cn(
                  "grid grid-cols-[80px_1fr] items-center gap-4 px-5 py-4 text-sm",
                  i > 0 && "border-t border-c-hairline",
                )}
              >
                <span className="text-xs text-c-muted">{entry.when}</span>
                <span className="text-c-ink">{entry.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </AdminShell>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────

function StatCard({
  value,
  label,
  loading,
  error,
  progress,
}: {
  value: number;
  label: string;
  loading: boolean;
  error: boolean;
  progress?: number;
}) {
  return (
    <div className="rounded-xl border border-c-hairline bg-c-surface px-7 py-6">
      <p className="text-[40px] font-semibold leading-none tracking-tight text-c-ink">
        {error ? "—" : loading ? "…" : value.toLocaleString()}
      </p>
      <p className="mt-3 text-sm text-c-muted">{label}</p>
      {progress !== undefined && (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-c-hairline"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Activity placeholders ────────────────────────────────────────────────
// TODO: replace with `/api/activity` when issue #30 (audit log) lands.
type Activity = { when: string; text: string };

const RECENT_ACTIVITY: Activity[] = [
  { when: "10:24", text: "上傳 12 張新貼圖" },
  { when: "09:50", text: "編輯 obj_042 placement" },
  { when: "昨天", text: "新增 Station E" },
  { when: "昨天", text: "預覽 Mode A 完成" },
  { when: "2 天前", text: "Anchor 位置校正" },
];

const PLACEHOLDER_ACTIVITY: Activity[] = Array.from({ length: 5 }, () => ({
  when: "…",
  text: "載入中…",
}));

type QuickAction = { icon: string; label: string; onClick: () => void };
