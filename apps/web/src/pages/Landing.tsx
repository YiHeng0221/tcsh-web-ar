import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

type Health = { status: string; version: string };

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Dev-only landing page. Production will route visitors straight into Mode A
 * (the public one); Mode B and Mode C ship behind their own entry points.
 * For now we expose all three from `/` so local development can click
 * through the scaffolds.
 */
export default function Landing() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  return (
    <main className="safe-area mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">tcsh-web-ar</h1>
        <p className="text-sm text-muted">
          Scaffold landing — pick a mode to open the placeholder. Real entry
          points ship behind `/` (Mode A), handheld share links (Mode B), and
          the obfuscated studio path (Mode C).
        </p>
      </header>

      <section className="grid gap-3">
        <ModeCard
          to="/a"
          title="Mode A · On-site AR"
          subtitle="QR-anchored, IMU-tracked AR painting"
          accent
        />
        <ModeCard
          to="/b"
          title="Mode B · 3D Viewer"
          subtitle="Handheld 3D viewer of the full artwork"
        />
        <ModeCard
          to="/_studio/dev"
          title="Mode C · Creator Admin"
          subtitle="Texture upload + placement editor (hidden route)"
        />
      </section>

      <footer className="mt-auto rounded-card border border-border bg-surface p-4 text-xs">
        <p className="font-medium">API health check</p>
        {isLoading && <p className="text-muted">checking…</p>}
        {error && (
          <p className="text-danger">unreachable: {String(error)}</p>
        )}
        {data && (
          <p className="text-success">
            {data.status} · v{data.version}
          </p>
        )}
      </footer>
    </main>
  );
}

function ModeCard({
  to,
  title,
  subtitle,
  accent = false,
}: {
  to: string;
  title: string;
  subtitle: string;
  accent?: boolean;
}) {
  const border = accent
    ? "border-accent hover:bg-border"
    : "border-border hover:border-fg";
  return (
    <Link
      to={to}
      className={`block rounded-card border bg-surface p-5 transition-colors ${border}`}
    >
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted">{subtitle}</p>
    </Link>
  );
}
