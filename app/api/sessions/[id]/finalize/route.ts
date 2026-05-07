import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type EvalResponse = {
  communication?: number;
  anamnesis?: number;
  reasoning?: number;
  safety?: number;
  investigation?: number;
  diagnosisAccuracy?: number;

  correctDiagnosis?: string;
  diagnosisExplanation?: string;
  studentFeedback?: string;
  feedback?: string;

  strengths?: string[];
  weaknesses?: string[];
  improvements?: string[];
};

function safeJsonParse(text: string): EvalResponse | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function clamp(v: unknown, max: number) {
  if (typeof v !== "number") return 0;
  return Math.max(0, Math.min(max, Number(v.toFixed(1))));
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    include: {
      case: true,
      messages: true,
      evaluation: true,
    },
  });

  if (!session || !session.evaluation) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const transcript = session.messages
    .slice(-70)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const blueprint =
    typeof session.case.blueprint === "object" && session.case.blueprint !== null
      ? (session.case.blueprint as Record<string, unknown>)
      : {};

  const blueprintDiagnosis =
    typeof blueprint.correctDiagnosis === "string"
      ? blueprint.correctDiagnosis
      : typeof blueprint.diagnosis === "string"
        ? blueprint.diagnosis
        : "";

  const studentDiagnosis = session.evaluation.studentDiagnosis || "";

  const system = `
Você é um tutor médico humano experiente.

Avalie a fase diagnóstica da consulta.

Use 5 itens, cada um de 0 a 2:
- communication
- anamnesis
- reasoning
- safety
- investigation

A soma gera nota diagnóstica de 0 a 10.

IMPORTANTE:
- use notas parciais como 0.5, 1.2, 1.8.
- não zere comunicação facilmente.
- o estudante pode errar o diagnóstico e ainda receber pontos nos outros itens.
- se o estudante acertar, parabenize.
- se errar, explique como tutor: "o problema real era..." e diga quais passos levariam ao diagnóstico correto.
- nunca deixe correctDiagnosis vazio.

Retorne APENAS JSON válido:
{
  "communication": 0-2,
  "anamnesis": 0-2,
  "reasoning": 0-2,
  "safety": 0-2,
  "investigation": 0-2,
  "correctDiagnosis": "texto",
  "diagnosisExplanation": "texto",
  "studentFeedback": "texto estilo tutor",
  "feedback": "resumo",
  "strengths": [],
  "weaknesses": [],
  "improvements": []
}
`.trim();

  const user = `
CASO:
${session.case.seed}

DIAGNÓSTICO ESPERADO:
${blueprintDiagnosis}

TRANSCRIÇÃO:
${transcript}

DIAGNÓSTICO DO ESTUDANTE:
${studentDiagnosis}
`.trim();

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: getOpenAIModel(),
    temperature: 0.25,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = safeJsonParse(completion.choices[0]?.message?.content || "");

  const communication = clamp(parsed?.communication, 2);
  const anamnesis = clamp(parsed?.anamnesis, 2);
  const reasoning = clamp(parsed?.reasoning, 2);
  const safety = clamp(parsed?.safety, 2);
  const investigation = clamp(parsed?.investigation, 2);

  const correctDiagnosis =
    parsed?.correctDiagnosis?.trim() ||
    blueprintDiagnosis ||
    "Diagnóstico clínico principal";

  const diagnosisCorrect =
    normalize(studentDiagnosis).length > 2 &&
    (normalize(studentDiagnosis).includes(normalize(correctDiagnosis)) ||
      normalize(correctDiagnosis).includes(normalize(studentDiagnosis)));

  const diagnosisScore = Number(
    (communication + anamnesis + reasoning + safety + investigation).toFixed(1),
  );

  const diagnosisExplanation =
    parsed?.diagnosisExplanation?.trim() ||
    "O caso precisava de melhor correlação entre sintomas, exame físico e exames complementares.";

  const tutorMessage = diagnosisCorrect
    ? `
Tutor:
Parabéns, você acertou o diagnóstico principal.

Diagnóstico correto:
${correctDiagnosis}

Por que estava correto:
${diagnosisExplanation}

Avaliação diagnóstica:
- Comunicação: ${communication}/2
- Anamnese: ${anamnesis}/2
- Raciocínio clínico: ${reasoning}/2
- Segurança: ${safety}/2
- Investigação/exames: ${investigation}/2

Nota diagnóstica: ${diagnosisScore}/10

Agora siga para a fase de tratamento. Clique em "Tratamento" e defina a conduta.
`.trim()
    : `
Tutor:
Jovem, ainda não era esse o problema principal.

O problema real do paciente era:
${correctDiagnosis}

O que deveria ter sido feito para chegar lá:
${diagnosisExplanation}

Avaliação diagnóstica:
- Comunicação: ${communication}/2
- Anamnese: ${anamnesis}/2
- Raciocínio clínico: ${reasoning}/2
- Segurança: ${safety}/2
- Investigação/exames: ${investigation}/2

Nota diagnóstica: ${diagnosisScore}/10

${parsed?.studentFeedback?.trim() || ""}

Agora siga para a fase de tratamento do problema real. Clique em "Tratamento" e defina a conduta.
`.trim();

  await prisma.evaluation.update({
    where: { sessionId: session.id },
    data: {
      communication,
      anamnesis,
      reasoning,
      safety,
      exams: investigation,
      closing: null,
      organization: null,
      correctDiagnosis,
      diagnosisCorrect,
      diagnosisScore,
      score: diagnosisScore,
      feedback: tutorMessage,
      strengths: parsed?.strengths || [],
      weaknesses: parsed?.weaknesses || [],
      improvements: parsed?.improvements || [],
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "COORDINATOR_AI",
      content: tutorMessage,
    },
  });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "WAITING_TREATMENT" },
  });

  return NextResponse.json({ ok: true, score: diagnosisScore }, { status: 200 });
}
