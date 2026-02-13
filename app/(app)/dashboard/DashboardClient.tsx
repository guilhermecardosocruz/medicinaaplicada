"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  status: "IN_PROGRESS" | "WAITING_EVAL" | "DONE";
  createdAt: string;
  updatedAt: string;
  case: { title: string; triage: string | null };
  evaluation: { score: number } | null;
};

export default function DashboardClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/my", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { ok: boolean; items: Item[] };
      if (data?.ok) setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function nextCase() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/cases/next", { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; sessionId: string };
      if (data?.ok && data.sessionId) {
        router.push(`/consultas/${encodeURIComponent(data.sessionId)}`);
        return;
      }
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="mt-2 text-sm text-muted">
            Clique em <span className="font-semibold">Atender próximo</span> para gerar um paciente por IA (sem desperdício).
          </p>
        </div>

        <button
          onClick={nextCase}
          disabled={creating}
          className="rounded-2xl border border-app px-4 py-2 text-sm font-semibold hover:opacity-80 disabled:opacity-60"
        >
          {creating ? "Gerando…" : "Atender próximo"}
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading && (
          <div className="surface p-4 text-sm text-muted">Carregando sessões…</div>
        )}

        {!loading && items.length === 0 && (
          <div className="surface p-4 text-sm text-muted">
            Você ainda não iniciou nenhuma consulta.
          </div>
        )}

        {items.map((it) => {
          const badge =
            it.status === "IN_PROGRESS" ? "Em andamento" :
            it.status === "WAITING_EVAL" ? "Avaliando" : "Finalizado";

          return (
            <button
              key={it.id}
              onClick={() => router.push(`/consultas/${encodeURIComponent(it.id)}`)}
              className="surface p-4 text-left hover:opacity-[0.98]"
            >
              <div className="text-sm font-semibold">{it.case.title}</div>
              <div className="mt-1 text-xs text-muted">
                {badge}{it.case.triage ? ` • Triagem: ${it.case.triage}` : ""}
              </div>

              {it.evaluation?.score !== null && it.evaluation?.score !== undefined && it.status === "DONE" && (
                <div className="mt-3 text-sm">
                  Nota: <span className="font-semibold">{it.evaluation.score}/10</span>
                </div>
              )}

              <div className="mt-3 text-xs text-muted">
                Clique para abrir
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}
