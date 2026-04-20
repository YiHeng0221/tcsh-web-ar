import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { apiGet } from "@/lib/api/client";
import type { Anchor } from "@/lib/api";

/**
 * A2 · Station Picker (issue #12).
 *
 * Top-down plan view of the artwork with station dots the visitor can tap
 * to jump straight into A3 scan for that station. Follows Figma 4:31.
 *
 * Positioning today: anchors returned by `/api/anchors` have
 * `world_pos: null` (venue layout hasn't been measured yet). Until those
 * populate, we arrange stations evenly around the middle dashed ring. Once
 * `world_pos.position` is filled in upstream (anchors CRUD supports it),
 * we'll switch to a top-down projection using (x, z).
 */
export default function A2StationPicker() {
  const navigate = useNavigate();
  const {
    data: anchors,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["anchors"],
    queryFn: () => apiGet<Anchor[]>("/anchors"),
  });

  const stations = anchors ?? [];
  const primaryCta = stations[0];

  return (
    <main
      data-mode="a"
      data-screen="a2"
      className="safe-area relative mx-auto flex min-h-dvh w-full max-w-md flex-col bg-a1-surface text-a1-ink"
    >
      <header className="flex h-12 items-center px-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center text-[22px] leading-none"
          aria-label="返回"
        >
          ‹
        </button>
      </header>

      <h1 className="mt-2 text-center text-2xl font-medium">找一個站點開始</h1>

      <section className="mx-6 mt-7 rounded-xl border border-a1-hairline bg-a1-surface p-4">
        <StationMap
          stations={stations}
          loading={isLoading}
          error={error}
          onPick={(id) => navigate(`/a/scan/${id}`)}
        />
      </section>

      <p className="mt-5 px-6 text-center text-sm text-a1-caption">
        走到任一站點並對準地面 QR
      </p>

      <div className="mt-auto px-6 pb-8">
        <button
          type="button"
          disabled={!primaryCta}
          onClick={() => primaryCta && navigate(`/a/scan/${primaryCta.id}`)}
          className="h-14 w-full rounded-lg bg-black text-base font-medium text-white transition-opacity disabled:opacity-40"
        >
          開啟相機掃描 QR
        </button>
      </div>
    </main>
  );
}

const MAP_SIZE = 280;
const CENTER = MAP_SIZE / 2;
// Four concentric dashed rings from the Figma; stations sit on the
// second-outermost ring when we don't have real world_pos data yet.
const RINGS = [140, 110, 80, 50];
const STATION_RING_R = RINGS[1] - 8;
const DOT_RADIUS = 8;

function StationMap({
  stations,
  loading,
  error,
  onPick,
}: {
  stations: Anchor[];
  loading: boolean;
  error: unknown;
  onPick: (id: string) => void;
}) {
  if (loading) {
    return (
      <StateFrame>
        <p className="text-sm text-a1-caption">載入站點中…</p>
      </StateFrame>
    );
  }
  if (error) {
    return (
      <StateFrame>
        <p className="text-sm text-danger">無法載入站點（API 連線失敗）</p>
      </StateFrame>
    );
  }
  if (stations.length === 0) {
    return (
      <StateFrame>
        <p className="text-sm text-a1-caption">
          尚未建立站點 — 請管理員在 Mode C 新增 anchor。
        </p>
      </StateFrame>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
      className="mx-auto h-auto w-full max-w-[320px]"
      role="img"
      aria-label="站點平面圖"
    >
      {RINGS.map((r) => (
        <circle
          key={r}
          cx={CENTER}
          cy={CENTER}
          r={r}
          fill="none"
          stroke="var(--color-a1-hairline)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
      ))}

      {stations.map((s, i) => {
        const angle = (i * 2 * Math.PI) / stations.length - Math.PI / 2;
        const cx = CENTER + STATION_RING_R * Math.cos(angle);
        const cy = CENTER + STATION_RING_R * Math.sin(angle);
        const badgeLabel = stationBadge(s.label, i);
        return (
          <g
            key={s.id}
            className="cursor-pointer"
            onClick={() => onPick(s.id)}
            role="button"
            tabIndex={0}
            aria-label={s.label}
          >
            <circle
              cx={cx}
              cy={cy}
              r={DOT_RADIUS}
              fill="var(--color-a1-ink)"
            />
            <text
              x={cx}
              y={cy + DOT_RADIUS + 14}
              textAnchor="middle"
              className="pointer-events-none select-none fill-[var(--color-a1-ink)] text-[11px]"
            >
              {badgeLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center">
      {children}
    </div>
  );
}

/** Circled-letter badge (ⓐ ⓑ ...) matching the Figma, falling back to
 *  the raw label when the anchor isn't one of A/B/C/D/E. */
function stationBadge(label: string, index: number): string {
  const CIRCLED = ["ⓐ", "ⓑ", "ⓒ", "ⓓ", "ⓔ", "ⓕ", "ⓖ", "ⓗ"];
  // Anchors seeded as "Station A" / "Station B" etc — take the trailing
  // letter. If the label doesn't end in a single A-Z, fall back to
  // index-based circled letter.
  const trailingLetter = /([A-Z])\s*$/.exec(label)?.[1];
  if (trailingLetter) {
    const code = trailingLetter.charCodeAt(0) - "A".charCodeAt(0);
    if (code >= 0 && code < CIRCLED.length) return CIRCLED[code];
  }
  return CIRCLED[index] ?? label;
}
