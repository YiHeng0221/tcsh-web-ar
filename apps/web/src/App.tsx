import { useQuery } from "@tanstack/react-query";

type Health = { status: string; version: string };

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export default function App() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>tcsh-web-ar</h1>
      <p>Scaffold is alive. API connection check:</p>
      {isLoading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>API unreachable: {String(error)}</p>}
      {data && (
        <pre style={{ background: "#f5f5f5", padding: "1rem", borderRadius: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </main>
  );
}
