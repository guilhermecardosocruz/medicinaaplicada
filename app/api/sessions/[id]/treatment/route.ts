import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type TreatmentEval = {
  hospitalization?: number;
  initialTreatment?: number;
  medications?: number;
  followup?: number;
  safety?: number;
  treatmentFeedback?: string;
};

function safeJsonParse(text: string): TreatmentEval | null {
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    treatmentPlan?: unknown;
  } | null;

  const action = typeof body?.action === "string" ? body.action : "submit";

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    include: {
      case: true,
      evaluation: true,
    },
  });

  if (!session || !session.evaluation) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (action === "start") {
    const prompt = `
Tutor:
Agora vamos para o tratamento do problema real:

${session.evaluation.correctDiagnosis}

Responda como médico responsável pela conduta.

Inclua obrigatoriamente:
- precisa de internação? sim ou não;
- se sim, tratamento inicial na internação;
- se não, tratamento em casa;
- medicamentos, doses e intervalo;
- exames adicionais se necessários;
- orientações ao paciente;
- retorno/reavaliação;
- atestado, se necessário.
`.trim();

    await prisma.message.create({
      data: {
        sessionId: session.id,
        role: "COORDINATOR_AI",
        content: prompt,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const treatmentPlan =
    typeof body?.treatmentPlan === "string" ? body.treatmentPlan.trim() : "";

  if (!treatmentPlan) {
    return NextResponse.json(
      { ok: false, message: "Plano terapêutico inválido." },
      { status: 400 },
    );
  }

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "STUDENT",
      content: `Tratamento:\n${treatmentPlan}`,
    },
  });

  const system = `
Você é um tutor médico avaliando a fase de tratamento e encerramento.

Use 5 itens, cada um de 0 a 2:
- hospitalization: decisão de internação/alta
- initialTreatment: tratamento inicial
- medications: medicações, dose e intervalo
- followup: retorno, exames adicionais, orientações e atestado
- safety: segurança, sinais de alarme e reavaliação

A soma gera nota terapêutica de 0 a 10.

Retorne APENAS JSON:
{
  "hospitalization": 0-2,
  "initialTreatment": 0-2,
  "medications": 0-2,
  "followup": 0-2,
  "safety": 0-2,
  "treatmentFeedback": "feedback estilo tutor humano"
}
`.trim();

  const user = `
CASO:
${session.case.seed}

DIAGNÓSTICO CORRETO:
${session.evaluation.correctDiagnosis}

CONDUTA DO ESTUDANTE:
${treatmentPlan}
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

  const hospitalization = clamp(parsed?.hospitalization, 2);
  const initialTreatment = clamp(parsed?.initialTreatment, 2);
  const medications = clamp(parsed?.medications, 2);
  const followup = clamp(parsed?.followup, 2);
  const safety = clamp(parsed?.safety, 2);

  const treatmentScore = Number(
    (hospitalization + initialTreatment + medications + followup + safety).toFixed(1),
  );

  const diagnosisScore = session.evaluation.diagnosisScore || 0;

  const finalScore = Number(((diagnosisScore + treatmentScore) / 2).toFixed(1));

  const finalMessage = `
Tutor:
Avaliação do tratamento e encerramento:

- Internação/alta: ${hospitalization}/2
- Tratamento inicial: ${initialTreatment}/2
- Medicações, dose e intervalo: ${medications}/2
- Retorno, exames, orientações e atestado: ${followup}/2
- Segurança e sinais de alarme: ${safety}/2

Nota terapêutica: ${treatmentScore}/10

Nota diagnóstica: ${diagnosisScore}/10
Média final da consulta: ${finalScore}/10

${parsed?.treatmentFeedback?.trim() || "Sem feedback terapêutico."}
`.trim();

  await prisma.evaluation.update({
    where: { sessionId: session.id },
    data: {
      treatmentPlan,
      treatmentFeedback: finalMessage,
      treatmentScore,
      score: finalScore,
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "COORDINATOR_AI",
      content: finalMessage,
    },
  });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "DONE" },
  });

  return NextResponse.json({ ok: true, finalScore }, { status: 200 });
}
