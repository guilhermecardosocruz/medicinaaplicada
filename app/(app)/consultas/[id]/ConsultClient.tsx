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
  const [showActions, setShowActions] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false); // controla o auto-start da consulta

  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        cache: "no-store",
      });
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

  // send agora aceita um conteúdo customizado (usado no auto-start)
  async function send(customContent?: string) {
    const raw = customContent ?? text;
    const content = raw.trim();
    if (!content || sending) return;

    setSending(true);
    if (!customContent) {
      // só limpa o input quando foi o usuário que digitou
      setText("");
    }

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        // se der erro, devolve o texto para o input apenas quando foi mensagem do usuário
        if (!customContent) {
          setText(content);
        }
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
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/finalize`, {
        method: "POST",
      });
      if (res.ok) await load();
    } finally {
      setFinalizing(false);
    }
  }

  // AUTO-START: ao abrir a sessão, se ainda não existe resposta da IA (PATIENT_AI),
  // mandamos uma mensagem padrão "Paciente: iniciar consulta"
  useEffect(() => {
    if (!session) return;
    if (bootstrapped) return;
    if (sending) return;

    const hasPatientAI = session.messages.some((m) => m.role === "PATIENT_AI");

    if (session.status === "IN_PROGRESS" && !hasPatientAI) {
      setBootstrapped(true);
      // mensagem padrão para disparar a primeira resposta com TRIAGEM + modos
      void send("Paciente: iniciar consulta");
    }
  }, [session, bootstrapped, sending]); // eslint-disable-line react-hooks/exhaustive-deps

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
    session.status === "IN_PROGRESS"
      ? "Em andamento"
      : session.status === "WAITING_EVAL"
      ? "Avaliando"
      : "Finalizado";

  const phaseLabel =
    session.phase === "TRIAGE"
      ? "Triagem"
      : session.phase === "CONSULT"
      ? "Consulta"
      : session.phase === "FOLLOWUP"
      ? "Retorno"
      : "Encerrado";

  return (
    <div className="flex min-h-screen justify-center">
      <div className="flex w-full max-w-3xl flex-col px-4 pt-4 pb-24">
        {/* Cabeçalho topo do chat */}
        <div className="surface-strong rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="mt-1 text-xs text-muted">
                Status: {statusLabel} • Fase: {phaseLabel}
                {session.case.triage ? ` • Triagem: ${session.case.triage}` : ""}
              </div>
            </div>

            {session.status === "IN_PROGRESS" && (
              <div className="hidden items-center gap-2 sm:flex">
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

        {/* Área de mensagens estilo WhatsApp */}
        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pb-24 pr-1">
          {session.messages.map((m) => {
            const isMe = m.role === "STUDENT";
            const isSystem = m.role === "SYSTEM";
            const bubble = isSystem
              ? "surface px-3 py-2 text-xs text-muted rounded-xl"
              : isMe
              ? "ml-auto max-w-[85%] rounded-2xl bg-card-strong border border-app px-3 py-2 text-sm"
              : "mr-auto max-w-[85%] rounded-2xl bg-card border border-app px-3 py-2 text-sm";

            return (
              <div key={m.id} className={isSystem ? "flex justify-center" : isMe ? "flex justify-end" : "flex justify-start"}>
                <div className={bubble} style={{ whiteSpace: "pre-wrap" }}>
                  {m.content}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Avaliação do coordenador */}
        {session.status === "DONE" && session.evaluation && (
          <div className="mt-4 surface rounded-2xl p-4">
            <div className="text-sm font-semibold">Avaliação do coordenador</div>
            <div className="mt-2 text-sm">
              Nota: <span className="font-semibold">{session.evaluation.score}/10</span>
            </div>
            <div className="mt-2 text-sm text-muted" style={{ whiteSpace: "pre-wrap" }}>
              {session.evaluation.feedback}
            </div>
          </div>
        )}

        {/* Barra de input fixa embaixo, com menu de ações */}
        {session.status === "IN_PROGRESS" && (
          <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-card-strong/95 backdrop-blur">
            <div className="relative mx-auto max-w-3xl px-4 py-3">
              {/* Menu de ações */}
              {showActions && (
                <div className="absolute bottom-14 right-4 z-20 w-64 rounded-2xl border border-app bg-card shadow-xl">
                  <div className="px-3 py-2 text-xs font-semibold text-muted">Ações da consulta</div>
                  <button
                    onClick={() => {
                      setShowActions(false);
                      void finalize();
                    }}
                    disabled={finalizing}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-card-strong disabled:opacity-60"
                  >
                    <span>Encerrar caso e chamar coordenação</span>
                    <span className="text-xs text-muted">⇧</span>
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                {/* Botão de ações (menu) */}
                <button
                  type="button"
                  onClick={() => setShowActions((prev) => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-app text-xl font-semibold hover:opacity-80"
                >
                  +
                </button>

                {/* Input de mensagem */}
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Digite sua mensagem… (Paciente:, Equipe:, Licença:, Tutor:)"
                  className="input-app w-full flex-1 rounded-2xl border px-3 py-2 text-sm outline-none"
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
          </div>
        )}
      </div>
    </div>
  );
}
