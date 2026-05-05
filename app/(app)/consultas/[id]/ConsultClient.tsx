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
  messages: Msg[];
  evaluation?: any;
};

export default function ConsultClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  const [showDiag, setShowDiag] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [justification, setJustification] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) setSession(data.session);
  }

  useEffect(() => { load(); }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages]);

  async function send(custom?: string) {
    const msg = (custom ?? text).trim();
    if (!msg) return;

    setSending(true);

    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg }),
    });

    setText("");
    await load();
    setSending(false);
  }

  async function finalize() {
    if (finalizing) return;
    setFinalizing(true);

    await fetch(`/api/sessions/${sessionId}/finalize`, { method: "POST" });

    await load();
    setFinalizing(false);
  }

  async function saveDiagnosis() {
    const res = await fetch(`/api/sessions/${sessionId}/diagnosis`, {
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
      await load();
    }
  }

  // AUTO START
  useEffect(() => {
    if (!session) return;
    if (bootstrapped) return;

    const hasPatient = session.messages.some((m) => m.role === "PATIENT_AI");

    if (!hasPatient) {
      setBootstrapped(true);
      send("Paciente: iniciar consulta");
    }
  }, [session]);

  function insert(prefix: "Equipe:" | "Licença:" | "Tutor:") {
    setText(prefix + " ");
  }

  if (!session) return null;

  return (
    <div className="flex min-h-screen justify-center">
      <div className="w-full max-w-3xl px-4 pt-4 pb-32">

        {/* HEADER */}
        <div className="flex justify-between mb-4">
          <div>
            <div className="font-bold">{session.case.title}</div>
            <div className="text-xs text-gray-400">{session.status}</div>
          </div>

          {session.status === "IN_PROGRESS" && (
            <button
              onClick={() => setShowDiag(true)}
              className="border px-3 py-2 rounded-xl text-sm"
            >
              Diagnosticar
            </button>
          )}
        </div>

        {/* CHAT */}
        <div className="space-y-3">
          {session.messages.map((m) => (
            <div key={m.id}>
              <b>{m.role}:</b> {m.content}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* INPUT FIXED */}
        {session.status === "IN_PROGRESS" && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#0b1220] border-t border-gray-700">
            <div className="max-w-3xl mx-auto p-3">

              {/* BOTÕES */}
              <div className="flex gap-2 mb-2 text-xs">

                <button onClick={() => insert("Equipe:")} className="px-2 py-1 border rounded">
                  Equipe
                </button>

                <button onClick={() => insert("Licença:")} className="px-2 py-1 border rounded">
                  Licença
                </button>

                <button onClick={() => insert("Tutor:")} className="px-2 py-1 border rounded">
                  Tutor
                </button>

                <button
                  onClick={finalize}
                  className="ml-auto px-3 py-1 border rounded"
                >
                  Encerrar
                </button>
              </div>

              {/* INPUT */}
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="flex-1 p-2 rounded bg-white text-black"
                  placeholder="Digite sua mensagem..."
                />

                <button
                  onClick={() => send()}
                  className="px-4 py-2 border rounded bg-white text-black"
                >
                  Enviar
                </button>
              </div>

            </div>
          </div>
        )}

        {/* MODAL */}
        {showDiag && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
            <div className="bg-white p-4 rounded w-full max-w-md">

              <div className="font-bold mb-2">Diagnóstico</div>

              <input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full border p-2 mb-2"
                placeholder="Diagnóstico"
              />

              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                className="w-full border p-2 mb-2"
                placeholder="Justificativa"
              />

              <div className="flex gap-2">
                <button onClick={saveDiagnosis} className="flex-1 border p-2">Salvar</button>
                <button onClick={() => setShowDiag(false)} className="flex-1 border p-2">Cancelar</button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}
