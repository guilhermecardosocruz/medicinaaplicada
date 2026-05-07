"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Msg = {
  id: string;
  role: "STUDENT" | "PATIENT_AI" | "COORDINATOR_AI" | "SYSTEM";
  content: string;
};

type Evaluation = {
  score: number;

  diagnosisScore?: number;

  treatmentScore?: number;

  feedback: string;

  treatmentFeedback?: string;

  communication?: number;
  anamnesis?: number;
  reasoning?: number;
  safety?: number;
  exams?: number;
  closing?: number;
  organization?: number;

  studentDiagnosis?: string;

  clinicalJustification?: string;

  correctDiagnosis?: string;

  diagnosisCorrect?: boolean;

  treatmentPlan?: string;
};

type Session = {
  case: {
    title: string;
  };

  status:
    | "IN_PROGRESS"
    | "WAITING_EVAL"
    | "WAITING_TREATMENT"
    | "DONE";

  phase?: string;

  messages: Msg[];

  evaluation?: Evaluation;
};

type Mode =
  | "consult"
  | "diagnosis"
  | "treatment"
  | "done";

function getLabel(m: Msg) {
  if (m.role === "STUDENT") {
    return "Médico";
  }

  if (m.role === "SYSTEM") {
    return "Sistema";
  }

  const normalized = m.content.trim().toLowerCase();

  if (normalized.startsWith("equipe:")) {
    return "Equipe";
  }

  if (normalized.startsWith("tutor:")) {
    return "Tutor";
  }

  if (normalized.startsWith("exame físico:")) {
    return "Licença";
  }

  return "Paciente";
}

function getBubbleClass(m: Msg) {
  if (m.role === "STUDENT") {
    return "bg-blue-950 border border-blue-700";
  }

  const normalized = m.content.trim().toLowerCase();

  if (normalized.startsWith("equipe:")) {
    return "bg-emerald-950 border border-emerald-700";
  }

  if (normalized.startsWith("tutor:")) {
    return "bg-amber-950 border border-amber-700";
  }

  if (normalized.startsWith("exame físico:")) {
    return "bg-fuchsia-950 border border-fuchsia-700";
  }

  return "bg-[#111827] border border-gray-700";
}

export default function ConsultClient({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);

  const [text, setText] = useState("");

  const [mode, setMode] = useState<Mode>("consult");

  const [loading, setLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const startedRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      cache: "no-store",
    });

    const data = await res.json();

    if (data.ok) {
      setSession(data.session);

      if (data.session.status === "WAITING_TREATMENT") {
        setMode("treatment");
      }

      if (data.session.status === "DONE") {
        setMode("done");
      }
    }
  }, [sessionId]);

  useEffect(() => {
    const run = async () => {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!data.ok) {
        return;
      }

      setSession(data.session);

      if (data.session.status === "WAITING_TREATMENT") {
        setMode("treatment");
      }

      if (data.session.status === "DONE") {
        setMode("done");
      }

      const hasTriage = data.session.messages.some((m: Msg) =>
        m.content.includes("TRIAGEM INICIAL"),
      );

      if (!hasTriage && !startedRef.current) {
        startedRef.current = true;

        await fetch(`/api/sessions/${sessionId}/messages`, {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            content: "Paciente: iniciar consulta",
          }),
        });

        await load();
      }
    };

    run();
  }, [load, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [session?.messages]);

  const placeholder = useMemo(() => {
    if (mode === "diagnosis") {
      return "Digite o diagnóstico principal e sua justificativa clínica...";
    }

    if (mode === "treatment") {
      return `Descreva:
- internação ou alta
- tratamento inicial
- medicações
- doses
- exames adicionais
- orientações
- retorno
- atestado`;
    }

    return "Digite sua mensagem...";
  }, [mode]);

  async function sendNormalMessage(message: string) {
    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        content: message,
      }),
    });
  }

  async function sendDiagnosis(message: string) {
    await fetch(`/api/sessions/${sessionId}/diagnosis`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        diagnosis: message,
      }),
    });

    await fetch(`/api/sessions/${sessionId}/finalize`, {
      method: "POST",
    });

    setMode("treatment");
  }

  async function sendTreatment(message: string) {
    await fetch(`/api/sessions/${sessionId}/treatment`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        treatmentPlan: message,
      }),
    });

    setMode("done");
  }

  async function send() {
    if (!text.trim()) {
      return;
    }

    if (!session) {
      return;
    }

    if (loading) {
      return;
    }

    setLoading(true);

    try {
      if (mode === "consult") {
        await sendNormalMessage(text);
      } else if (mode === "diagnosis") {
        await sendDiagnosis(text);
      } else if (mode === "treatment") {
        await sendTreatment(text);
      }

      setText("");

      await load();
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function startDiagnosis() {
    setMode("diagnosis");

    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        content:
          "Tutor: Agora informe o diagnóstico principal e explique seu raciocínio clínico.",
      }),
    });

    await load();
  }

  async function startTreatment() {
    await fetch(`/api/sessions/${sessionId}/treatment`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        action: "start",
      }),
    });

    setMode("treatment");

    await load();
  }

  function renderMessage(m: Msg) {
    const label = getLabel(m);

    return (
      <div key={m.id} className="mb-3">

        <div className="font-semibold text-sm mb-1">
          {label}
        </div>

        <div
          className={`text-sm whitespace-pre-wrap p-3 rounded ${getBubbleClass(m)}`}
        >
          {m.content.replace(/ - /g, "\n- ")}
        </div>

      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen justify-center bg-[#020817]">

      <div className="w-full max-w-3xl px-4 pt-4 pb-40">

        <div className="mb-4">

          <div className="text-lg font-bold text-white">
            {session.case.title}
          </div>

          <div className="text-xs text-gray-400">
            {session.status}
          </div>

        </div>

        <div>
          {session.messages.map(renderMessage)}
          <div ref={bottomRef} />
        </div>

        {mode !== "done" && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#0b1220] border-t border-gray-700">

            <div className="max-w-3xl mx-auto p-3">

              {mode === "consult" && (
                <div className="flex gap-2 mb-2 text-xs overflow-x-auto">

                  <button
                    onClick={() => setText("Equipe: ")}
                    className="border px-2 py-1 rounded text-white"
                  >
                    Equipe
                  </button>

                  <button
                    onClick={() => setText("Licença: ")}
                    className="border px-2 py-1 rounded text-white"
                  >
                    Licença
                  </button>

                  <button
                    onClick={() => setText("Tutor: ")}
                    className="border px-2 py-1 rounded text-white"
                  >
                    Tutor
                  </button>

                  <button
                    onClick={startDiagnosis}
                    className="ml-auto border px-3 py-1 rounded bg-white text-black"
                  >
                    Diagnóstico
                  </button>

                </div>
              )}

              {mode === "diagnosis" && (
                <div className="flex gap-2 mb-2 text-xs">

                  <div className="px-3 py-1 rounded bg-amber-900 text-white border border-amber-700">
                    Fase diagnóstica
                  </div>

                  <button
                    onClick={startTreatment}
                    className="ml-auto border px-3 py-1 rounded bg-white text-black"
                  >
                    Tratamento
                  </button>

                </div>
              )}

              {mode === "treatment" && (
                <div className="flex gap-2 mb-2 text-xs">

                  <div className="px-3 py-1 rounded bg-emerald-900 text-white border border-emerald-700">
                    Fase terapêutica
                  </div>

                  <div className="ml-auto px-3 py-1 rounded bg-white text-black">
                    Encerramento após envio
                  </div>

                </div>
              )}

              <div className="flex gap-2">

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKey}
                  className="flex-1 p-3 rounded bg-white text-black"
                  rows={4}
                  placeholder={placeholder}
                />

                <button
                  onClick={send}
                  disabled={loading}
                  className="px-4 py-2 border rounded bg-white text-black min-w-[100px]"
                >
                  {loading ? "..." : "Enviar"}
                </button>

              </div>

            </div>

          </div>
        )}

      </div>

    </div>
  );
}
