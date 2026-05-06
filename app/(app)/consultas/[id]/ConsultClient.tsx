"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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

  messages: Msg[];

  evaluation?: Evaluation;
};

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

function renderCriterion(v?: number) {
  return v === 1 ? "✔️" : "❌";
}

export default function ConsultClient({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);

  const [text, setText] = useState("");

  const [showDiag, setShowDiag] = useState(false);

  const [diagnosis, setDiagnosis] = useState("");

  const [justification, setJustification] = useState("");

  const [showTreatment, setShowTreatment] = useState(false);

  const [treatmentPlan, setTreatmentPlan] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const startedRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      cache: "no-store",
    });

    const data = await res.json();

    if (data.ok) {
      setSession(data.session);
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

  async function send() {
    if (!text.trim()) {
      return;
    }

    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        content: text,
      }),
    });

    setText("");

    await load();
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

    if (!res.ok) {
      return;
    }

    await fetch(`/api/sessions/${sessionId}/finalize`, {
      method: "POST",
    });

    setShowDiag(false);

    setDiagnosis("");

    setJustification("");

    await load();
  }

  async function saveTreatment() {
    const res = await fetch(`/api/sessions/${sessionId}/treatment`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        treatmentPlan,
      }),
    });

    if (!res.ok) {
      return;
    }

    setShowTreatment(false);

    setTreatmentPlan("");

    await load();
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function format(m: Msg) {
    const label = getLabel(m);

    return (
      <div key={m.id} className="mb-3">
        <div className="font-semibold text-sm">
          {label}
        </div>

        <div className="text-sm whitespace-pre-wrap bg-[#111827] p-3 rounded">
          {m.content.replace(/ - /g, "\n- ")}
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen justify-center">
      <div className="w-full max-w-3xl px-4 pt-4 pb-40">

        <div className="mb-4">
          <div className="text-lg font-bold">
            {session.case.title}
          </div>

          <div className="text-xs text-gray-400">
            {session.status}
          </div>
        </div>

        <div>
          {session.messages.map(format)}
          <div ref={bottomRef} />
        </div>

        {session.evaluation && (
          <div className="mt-6 p-4 bg-white text-black rounded-xl">

            <div className="font-bold text-lg mb-4">
              Avaliação clínica
            </div>

            <div className="mb-4">
              <div className="font-semibold">
                Diagnóstico do aluno
              </div>

              <div>
                {session.evaluation.studentDiagnosis}
              </div>
            </div>

            <div className="mb-4">
              <div className="font-semibold">
                Diagnóstico correto
              </div>

              <div>
                {session.evaluation.correctDiagnosis}
              </div>
            </div>

            <div className="mb-4">
              Comunicação: {renderCriterion(session.evaluation.communication)}
              <br />
              Anamnese: {renderCriterion(session.evaluation.anamnesis)}
              <br />
              Raciocínio: {renderCriterion(session.evaluation.reasoning)}
              <br />
              Segurança: {renderCriterion(session.evaluation.safety)}
              <br />
              Exames: {renderCriterion(session.evaluation.exams)}
              <br />
              Organização: {renderCriterion(session.evaluation.organization)}
            </div>

            {session.evaluation.diagnosisScore != null && (
              <div className="mb-4">
                <div className="font-bold">
                  Nota diagnóstica: {session.evaluation.diagnosisScore}/10
                </div>
              </div>
            )}

            <div className="whitespace-pre-wrap text-sm">
              {session.evaluation.feedback}
            </div>

            {session.status === "WAITING_TREATMENT" && (
              <div className="mt-6 border-t pt-4">

                <button
                  onClick={() => setShowTreatment(true)}
                  className="w-full bg-black text-white p-3 rounded-xl"
                >
                  Encerrar caso e definir tratamento
                </button>

              </div>
            )}

            {session.status === "DONE" && (
              <div className="mt-6 border-t pt-4">

                <div className="font-bold text-lg">
                  Avaliação terapêutica
                </div>

                <div className="mt-3 whitespace-pre-wrap">
                  {session.evaluation.treatmentPlan}
                </div>

                <div className="mt-4 whitespace-pre-wrap text-sm">
                  {session.evaluation.treatmentFeedback}
                </div>

                <div className="mt-4">
                  <div className="font-bold">
                    Nota terapêutica: {session.evaluation.treatmentScore}/10
                  </div>

                  <div className="font-bold text-xl mt-2">
                    Nota final da consulta: {session.evaluation.score}/10
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

        {session.status === "IN_PROGRESS" && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#0b1220] border-t border-gray-700">
            <div className="max-w-3xl mx-auto p-3">

              <div className="flex gap-2 mb-2 text-xs">
                <button
                  onClick={() => setText("Equipe: ")}
                  className="border px-2 py-1 rounded"
                >
                  Equipe
                </button>

                <button
                  onClick={() => setText("Licença: ")}
                  className="border px-2 py-1 rounded"
                >
                  Licença
                </button>

                <button
                  onClick={() => setText("Tutor: ")}
                  className="border px-2 py-1 rounded"
                >
                  Tutor
                </button>

                <button
                  onClick={() => setShowDiag(true)}
                  className="ml-auto border px-3 py-1 rounded"
                >
                  Diagnosticar
                </button>
              </div>

              <div className="flex gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKey}
                  className="flex-1 p-2 rounded bg-white text-black"
                  rows={2}
                />

                <button
                  onClick={send}
                  className="px-4 py-2 border rounded bg-white text-black"
                >
                  Enviar
                </button>
              </div>

            </div>
          </div>
        )}

        {showDiag && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
            <div className="bg-white text-black p-6 rounded-xl w-full max-w-md">

              <div className="text-lg font-bold mb-4">
                Fechar diagnóstico
              </div>

              <input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="w-full border p-2 mb-3 rounded"
                placeholder="Diagnóstico"
              />

              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                className="w-full border p-2 mb-4 rounded"
                rows={4}
                placeholder="Justificativa clínica"
              />

              <div className="flex gap-2">
                <button
                  onClick={saveDiagnosis}
                  className="flex-1 bg-black text-white p-2 rounded"
                >
                  Salvar diagnóstico
                </button>

                <button
                  onClick={() => setShowDiag(false)}
                  className="flex-1 border p-2 rounded"
                >
                  Cancelar
                </button>
              </div>

            </div>
          </div>
        )}

        {showTreatment && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
            <div className="bg-white text-black p-6 rounded-xl w-full max-w-2xl">

              <div className="text-lg font-bold mb-4">
                Encerramento e tratamento
              </div>

              <textarea
                value={treatmentPlan}
                onChange={(e) => setTreatmentPlan(e.target.value)}
                className="w-full border p-2 mb-4 rounded"
                rows={12}
                placeholder="Medicações, exames adicionais, internação, orientações, retorno, monitorização..."
              />

              <div className="flex gap-2">
                <button
                  onClick={saveTreatment}
                  className="flex-1 bg-black text-white p-2 rounded"
                >
                  Finalizar caso
                </button>

                <button
                  onClick={() => setShowTreatment(false)}
                  className="flex-1 border p-2 rounded"
                >
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
