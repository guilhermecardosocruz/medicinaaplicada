"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = {
  id: string;
  role: "STUDENT" | "PATIENT_AI" | "COORDINATOR_AI" | "SYSTEM";
  content: string;
  createdAt: string;
};

type SessionPayload = {
  id: string;
  status: "IN_PROGRESS" | "WAITING_EVAL" | "DONE";
  phase: "TRIAGE" | "CONSULT" | "FOLLOWUP" | "FINALIZED";
  case: { title: string; triage: string | null };
  triageData?: unknown;
  physicalData?: unknown;
  orders?: unknown;
  results?: unknown;
  followup?: unknown;
  messages: Msg[];
  evaluation?: {
    score: number;
    feedback: string;
    strengths: unknown;
    weaknesses: unknown;
    improvements: unknown;
  } | null;
};

export default function ConsultClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, { cache: "no-store" });
      if (!res.ok) {
        setSession(null);
        return;
      }
      const data = (await res.json()) as { ok: boolean; session: SessionPayload };
      if (data?.ok) setSession(data.session);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages?.length]);

  const title = useMemo(() => session?.case?.title ?? "Consulta", [session]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        // se der erro, devolve o texto para o input
        setText(content);
        return;
      }

      await load();
    } finally {
      setSending(false);
    }
  }

  async function finalize() {
    if (finalizing) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/finalize`, { method: "POST" });
      if (res.ok) await load();
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted">Carregando…</div>;
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="surface p-4">
          <div className="text-sm font-semibold">Sessão não encontrada</div>
          <button
            className="mt-3 rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
            onClick={() => router.push("/dashboard")}
          >
            Voltar ao dashboard
          </button>
        </div>
      </div>
    );
  }

  const statusLabel =
    session.status === "IN_PROGRESS" ? "Em andamento" : session.status === "WAITING_EVAL" ? "Avaliando" : "Finalizado";

  const phaseLabel =
    session.phase === "TRIAGE"
      ? "Triagem"
      : session.phase === "CONSULT"
      ? "Consulta"
      : session.phase === "FOLLOWUP"
      ? "Retorno"
      : "Encerrado";

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <div className="surface-strong p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs text-muted">
              Status: {statusLabel} • Fase: {phaseLabel}
              {session.case.triage ? ` • Triagem: ${session.case.triage}` : ""}
            </div>
          </div>

          {session.status === "IN_PROGRESS" && (
            <div className="flex items-center gap-2">
              <button
                onClick={finalize}
                disabled={finalizing}
                className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80 disabled:opacity-60"
              >
                {finalizing ? "Finalizando…" : "Encerrar caso e chamar coordenação"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {session.messages.map((m) => {
          const isMe = m.role === "STUDENT";
          const isSystem = m.role === "SYSTEM";
          const bubble =
            isSystem
              ? "surface px-3 py-2 text-xs text-muted"
              : isMe
              ? "ml-auto max-w-[85%] rounded-2xl bg-card-strong border border-app px-3 py-2 text-sm"
              : "mr-auto max-w-[85%] rounded-2xl bg-card border border-app px-3 py-2 text-sm";

          return (
            <div key={m.id} className={isSystem ? "" : isMe ? "flex justify-end" : "flex justify-start"}>
              <div className={bubble} style={{ whiteSpace: "pre-wrap" }}>
                {m.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {session.status === "DONE" && session.evaluation && (
        <div className="mt-6 surface p-4">
          <div className="text-sm font-semibold">Avaliação do coordenador</div>
          <div className="mt-2 text-sm">
            Nota: <span className="font-semibold">{session.evaluation.score}/10</span>
          </div>
          <div className="mt-2 text-sm text-muted" style={{ whiteSpace: "pre-wrap" }}>
            {session.evaluation.feedback}
          </div>
        </div>
      )}

      {session.status === "IN_PROGRESS" && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-card-strong backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Digite sua mensagem…"
              className="input-app w-full rounded-2xl border px-3 py-2 text-sm outline-none"
              disabled={sending}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="rounded-2xl border border-app px-4 py-2 text-sm font-semibold hover:opacity-80 disabled:opacity-60"
            >
              {sending ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
