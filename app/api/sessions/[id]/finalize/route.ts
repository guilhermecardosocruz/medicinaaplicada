import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type EvalResponse = {
  score?: number;
  strengths?: string[];
  weaknesses?: string[];
  improvements?: string[];

  communication?: number;
  anamnesis?: number;
  reasoning?: number;
  safety?: number;
  exams?: number;
  closing?: number;
  organization?: number;

  feedback?: string;
};

function safeJsonParse(text: string): EvalResponse | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getCorrectDiagnosis(blueprint: unknown): string {
  if (!blueprint || typeof blueprint !== "object") return "Não informado";
  const bp = blueprint as Record<string, unknown>;
  return typeof bp.diagnosis === "string" ? bp.diagnosis : "Não informado";
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

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  if (!session.evaluation) {
    return NextResponse.json(
      { ok: false, message: "Diagnóstico ainda não informado" },
      { status: 400 }
    );
  }

  const transcript = session.messages
    .slice(-20)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const system = `
Avalie a consulta clínica.

REGRAS:
- Exames NÃO são obrigatórios.
- Só penalize se eram ESSENCIAIS e não foram usados.
- Valorize raciocínio clínico.

Retorne JSON:
{
  "communication": 0 ou 1,
  "anamnesis": 0 ou 1,
  "reasoning": 0 ou 1,
  "safety": 0 ou 1,
  "exams": 0 ou 1,
  "closing": 0 ou 1,
  "organization": 0 ou 1,
  "feedback": "texto",
  "strengths": [],
  "weaknesses": [],
  "improvements": []
}
`.trim();

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: getOpenAIModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: transcript },
    ],
  });

  const parsed = safeJsonParse(completion.choices[0]?.message?.content || "");

  const correctDiagnosis = getCorrectDiagnosis(session.case.blueprint);
  const studentDiagnosis = session.evaluation.studentDiagnosis || "";

  const diagnosisCorrect =
    studentDiagnosis.toLowerCase().includes(correctDiagnosis.toLowerCase());

  const criteriaScore =
    (parsed?.communication || 0) +
    (parsed?.anamnesis || 0) +
    (parsed?.reasoning || 0) +
    (parsed?.safety || 0) +
    (parsed?.exams || 0) +
    (parsed?.closing || 0) +
    (parsed?.organization || 0);

  const finalScore = criteriaScore + (diagnosisCorrect ? 3 : 0);

  await prisma.evaluation.update({
    where: { sessionId: session.id },
    data: {
      communication: parsed?.communication ?? null,
      anamnesis: parsed?.anamnesis ?? null,
      reasoning: parsed?.reasoning ?? null,
      safety: parsed?.safety ?? null,
      exams: parsed?.exams ?? null,
      closing: parsed?.closing ?? null,
      organization: parsed?.organization ?? null,

      correctDiagnosis,
      diagnosisCorrect,

      score: finalScore,

      feedback: parsed?.feedback || "",
      strengths: parsed?.strengths || [],
      weaknesses: parsed?.weaknesses || [],
      improvements: parsed?.improvements || [],
    },
  });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "DONE" },
  });

  return NextResponse.json({ ok: true, score: finalScore });
}
