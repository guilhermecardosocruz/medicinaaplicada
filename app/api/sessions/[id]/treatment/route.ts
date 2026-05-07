import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type TreatmentEval = {
  treatmentScore?: number;

  treatmentFeedback?: string;
};

function safeJsonParse(text: string): TreatmentEval | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);

  if (!me) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as {
    treatmentPlan?: string;
  } | null;

  const treatmentPlan =
    typeof body?.treatmentPlan === "string"
      ? body.treatmentPlan.trim()
      : "";

  if (!treatmentPlan) {
    return NextResponse.json(
      {
        ok: false,
        message: "Plano terapêutico inválido.",
      },
      { status: 400 },
    );
  }

  const session = await prisma.consultSession.findFirst({
    where: {
      id,
      userId: me.id,
    },

    include: {
      case: true,
      evaluation: true,
    },
  });

  if (!session || !session.evaluation) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const system = `
Você é um tutor médico avaliando ENCERRAMENTO E TRATAMENTO.

Você deve analisar:
- necessidade de internação;
- medicações;
- dose e modo de uso;
- exames adicionais;
- retorno;
- orientações;
- segurança;
- atestado;
- monitorização;
- encaminhamento.

IMPORTANTE:
- notas de 0 até 10
- pode usar notas parciais
- seja justo
- explique o motivo da nota

Retorne APENAS JSON:

{
  "treatmentScore": número de 0 a 10,
  "treatmentFeedback": "feedback detalhado estilo tutor humano"
}
`.trim();

  const user = `
CASO:
${session.case.seed}

DIAGNÓSTICO CORRETO:
${session.evaluation.correctDiagnosis}

PLANO TERAPÊUTICO:
${treatmentPlan}
`.trim();

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: getOpenAIModel(),

    temperature: 0.3,

    messages: [
      {
        role: "system",
        content: system,
      },

      {
        role: "user",
        content: user,
      },
    ],
  });

  const parsed = safeJsonParse(
    completion.choices[0]?.message?.content || "",
  );

  const treatmentScore =
    typeof parsed?.treatmentScore === "number"
      ? Math.max(0, Math.min(10, Number(parsed.treatmentScore.toFixed(1))))
      : 0;

  const diagnosisScore =
    session.evaluation.diagnosisScore || 0;

  const finalScore =
    Number(
      (
        (diagnosisScore + treatmentScore) / 2
      ).toFixed(1),
    );

  const treatmentFeedback =
    parsed?.treatmentFeedback?.trim() ||
    "Sem feedback terapêutico.";

  await prisma.evaluation.update({
    where: {
      sessionId: session.id,
    },

    data: {
      treatmentPlan,
      treatmentFeedback,
      treatmentScore,
      score: finalScore,
    },
  });

  await prisma.consultSession.update({
    where: {
      id: session.id,
    },

    data: {
      status: "DONE",
    },
  });

  return NextResponse.json({
    ok: true,
    finalScore,
  });
}
