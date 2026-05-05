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
    studentDiagnosis?: string;
    clinicalJustification?: string;
    correctDiagnosis?: string;
    diagnosisCorrect?: boolean;
    communication?: number;
    anamnesis?: number;
    reasoning?: number;
    safety?: number;
    exams?: number;
    closing?: number;
    organization?: number;
  } | null;
};

export default function ConsultClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [text, setText] = useState("");
  const [bootstrapped, setBootstrapped] = useState(false);

  // 🔥 NOVO
  const [showDiag, setShowDiag] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [justification, setJustification] = useState("");

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
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages?.length]);

  const title = useMemo(() => session?.case?.title ?? "Consulta", [session]);

  async function send(customContent?: string) {
    const raw = customContent ?? text;
    const content = raw.trim();
    if (!content || sending) return;

    setSending(true);
    if (!customContent) setText("");

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        if (!customContent) setText(content);
        return;
      }

      await load();
    } finally {
      setSending(false);
    }
  }

  async function finalize() {
    if (finalizing) return;

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Tem certeza que deseja encerrar este caso e enviar para coordenação?"
      );
      if (!confirmed) return;
    }

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

  // 🔥 NOVO
  async function saveDiagnosis() {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/diagnosis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        diagnosis,
        justification,
      }),
    });

    if (res.ok) {
      setShowDiag(false);
      setDiagnosis("");
      setJustification("");
      await load();
    }
  }

  useEffect(() => {
    if (!session) return;
    if (bootstrapped) return;
    if (sending) return;

    const hasPatientAI = session.messages.some((m) => m.role === "PATIENT_AI");

    if (session.status === "IN_PROGRESS" && !hasPatientAI) {
      setBootstrapped(true);
      void send("Paciente: iniciar consulta");
    }
  }, [session, bootstrapped, sending]);

  function insertPrefix(prefix: "Equipe:" | "Licença:" | "Tutor:") {
    setText((prev) => {
      const trimmed = prev.trimStart();
      const existingPrefixes = ["Paciente:", "Equipe:", "Licença:", "Tutor:"] as const;
      const found = existingPrefixes.find((p) => trimmed.startsWith(p));

      const rest =
        found != null
          ? trimmed.slice(found.length).replace(/^(\s)+/, "")
          : trimmed;

      return `${prefix} ${rest}`.trimEnd() + (rest ? "" : " ");
    });
  }

  if (loading) return <div className="p-8 text-sm">Carregando…</div>;
  if (!session) return <div className="p-8">Sessão não encontrada</div>;

  return (
    <div className="flex min-h-screen justify-center">
      <div className="flex w-full max-w-3xl flex-col px-4 pt-4 pb-24">

        <div className="surface-strong rounded-2xl p-4 flex justify-between">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted">{session.status}</div>
          </div>

          {/* 🔥 BOTÃO NOVO */}
          {session.status === "IN_PROGRESS" && !session.evaluation && (
            <button
              onClick={() => setShowDiag(true)}
              className="border px-3 py-2 rounded-xl text-xs"
            >
              Diagnosticar
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {session.messages.map((m) => (
            <div key={m.id}>
              <b>{m.role}:</b> {m.content}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {session.status === "DONE" && session.evaluation && (
          <div className="mt-4 border p-4 rounded-xl">
            <div>Nota: {session.evaluation.score}/10</div>
            <div>{session.evaluation.feedback}</div>
          </div>
        )}

        {session.status === "IN_PROGRESS" && (
          <div className="fixed bottom-0 w-full max-w-3xl p-4 bg-white">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="border w-full p-2"
            />
            <button onClick={() => send()}>Enviar</button>
          </div>
        )}

        {/* 🔥 MODAL */}
        {showDiag && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-white p-4 rounded-xl w-full max-w-md space-y-3">

              <div className="font-semibold">Fechar diagnóstico</div>

              <input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="Diagnóstico"
                className="w-full border p-2 rounded"
              />

              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Justificativa clínica"
                className="w-full border p-2 rounded"
              />

              <div className="flex gap-2">
                <button onClick={saveDiagnosis} className="flex-1 border p-2 rounded">
                  Salvar
                </button>
                <button onClick={() => setShowDiag(false)} className="flex-1 border p-2 rounded">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
