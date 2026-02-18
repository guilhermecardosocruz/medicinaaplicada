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

type TestsGetPayload = {
  ok: boolean;
  catalog: { key: string; label: string }[];
  orders: unknown;
  results: unknown;
};

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined;
}

export default function ConsultClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [showTools, setShowTools] = useState(false);
  const [tests, setTests] = useState<TestsGetPayload | null>(null);
  const [selectedTests, setSelectedTests] = useState<Record<string, boolean>>({});

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

  async function loadTests() {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/tests`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as TestsGetPayload;
    if (data?.ok) setTests(data);
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

  async function ensureTriage() {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/triage`, { method: "POST" });
    if (res.ok) await load();
  }

  async function requestPhysical(
    section:
      | "vitals"
      | "general"
      | "heent"
      | "cardio"
      | "resp"
      | "abdomen"
      | "neuro"
      | "skin"
      | "extremities"
      | "gynUro",
  ) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/physical`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section }),
    });
    if (res.ok) await load();
  }

  async function orderSelectedTests() {
    if (!tests?.catalog?.length) return;
    const keys = tests.catalog.map((c) => c.key).filter((k) => selectedTests[k]);
    if (keys.length === 0) return;

    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });

    if (res.ok) {
      setSelectedTests({});
      await load();
      await loadTests();
    }
  }

  async function followup(outcome: "improved" | "same" | "worse" | "sideEffect") {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    if (res.ok) await load();
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
                onClick={async () => {
                  setShowTools((v) => !v);
                  if (!tests) await loadTests();
                }}
                className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
              >
                {showTools ? "Fechar ferramentas" : "Ferramentas"}
              </button>

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

        {showTools && session.status === "IN_PROGRESS" && (
          <div className="mt-4 surface p-3">
            <div className="text-xs font-semibold">Triagem</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => void ensureTriage()}
                className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
              >
                Registrar triagem estruturada
              </button>
              <button
                onClick={() => {
                  const txt = hasValue(session.triageData) ? pretty(session.triageData) : "(sem triagem registrada)";
                  navigator.clipboard?.writeText(txt).catch(() => {});
                }}
                className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
              >
                Copiar triagem JSON
              </button>
            </div>

            <div className="mt-4 text-xs font-semibold">Exame físico (botões)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("vitals")}>Sinais vitais</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("general")}>Inspeção geral</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("heent")}>HEENT</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("cardio")}>Cardiovascular</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("resp")}>Respiratório</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("abdomen")}>Abdome</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("neuro")}>Neurológico</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("skin")}>Pele</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("extremities")}>Extremidades</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void requestPhysical("gynUro")}>Ginecológico/Urológico</button>
            </div>

            <div className="mt-4 text-xs font-semibold">Exames (laboratório / imagem)</div>
            <div className="mt-2">
              {!tests ? (
                <div className="text-xs text-muted">Carregando catálogo…</div>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tests.catalog.map((t) => (
                      <label key={t.key} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={!!selectedTests[t.key]}
                          onChange={(e) => setSelectedTests((s) => ({ ...s, [t.key]: e.target.checked }))}
                        />
                        <span>{t.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void orderSelectedTests()}
                      className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
                    >
                      Solicitar exames selecionados
                    </button>
                    <button
                      onClick={() => void loadTests()}
                      className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
                    >
                      Atualizar
                    </button>
                    <button
                      onClick={() => {
                        const txt = hasValue(session.results) ? pretty(session.results) : "(sem resultados)";
                        navigator.clipboard?.writeText(txt).catch(() => {});
                      }}
                      className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80"
                    >
                      Copiar resultados JSON
                    </button>
                  </div>

                  {hasValue(session.results) && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-card px-3 py-2 text-[11px]">
                      {pretty(session.results)}
                    </pre>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 text-xs font-semibold">Retorno (mesma sessão)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void followup("improved")}>Melhorou</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void followup("same")}>Permaneceu igual</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void followup("worse")}>Piorou</button>
              <button className="rounded-xl border border-app px-3 py-2 text-xs font-semibold hover:opacity-80" onClick={() => void followup("sideEffect")}>Efeito colateral</button>
            </div>
          </div>
        )}
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
