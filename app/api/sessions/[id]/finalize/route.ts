import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type EvalResponse = {
  communication?: number;
  anamnesis?: number;
  reasoning?: number;
  safety?: number;
  exams?: number;
  closing?: number;
  organization?: number;

  feedback?: string;

  strengths?: string[];

  weaknesses?: string[];

  improvements?: string[];

  correctDiagnosis?: string;

  diagnosisExplanation?: string;

  studentFeedback?: string;
};

function safeJsonParse(text: string): EvalResponse | null {
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

  const session = await prisma.consultSession.findFirst({
    where: {
      id,
      userId: me.id,
    },

    include: {
      case: true,
      messages: true,
      evaluation: true,
    },
  });

  if (!session) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (!session.evaluation) {
    return NextResponse.json(
      {
        ok: false,
        message: "Diagnóstico ainda não informado.",
      },
      { status: 400 },
    );
  }

  const transcript = session.messages
    .slice(-30)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const studentDiagnosis =
    session.evaluation.studentDiagnosis || "";

  const studentJustification =
    session.evaluation.clinicalJustification || "";

  const system = `
Você é um avaliador pedagógico de um simulador clínico.

Sua função:
- avaliar a consulta
- avaliar o diagnóstico
- explicar o raciocínio correto
- orientar o aluno

IMPORTANTE:
- o aluno pode acertar parcialmente
- seja justo
- valorize raciocínio clínico
- não exija exames desnecessários
- não penalize excesso de prudência

Você DEVE descobrir o diagnóstico correto baseado no caso clínico.

Retorne APENAS JSON válido.

Formato:
{
  "communication": 0 ou 1,
  "anamnesis": 0 ou 1,
  "reasoning": 0 ou 1,
  "safety": 0 ou 1,
  "exams": 0 ou 1,
  "closing": 0 ou 1,
  "organization": 0 ou 1,

  "correctDiagnosis": "texto",

  "diagnosisExplanation": "explicação objetiva do diagnóstico correto",

  "studentFeedback": "texto pedagógico explicando se o aluno acertou, errou, parcialmente acertou e o que faltou",

  "feedback": "resumo geral",

  "strengths": [],

  "weaknesses": [],

  "improvements": []
}
`.trim();

  const user = `
TRANSCRIÇÃO DA CONSULTA:

${transcript}

DIAGNÓSTICO DO ALUNO:
${studentDiagnosis}

JUSTIFICATIVA DO ALUNO:
${studentJustification}
`.trim();

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: getOpenAIModel(),

    temperature: 0.2,

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

  const correctDiagnosis =
    parsed?.correctDiagnosis?.trim() ||
    "Não informado";

  const normalizedStudent =
    studentDiagnosis.toLowerCase().trim();

  const normalizedCorrect =
    correctDiagnosis.toLowerCase().trim();

  const diagnosisCorrect =
    normalizedStudent.includes(normalizedCorrect) ||
    normalizedCorrect.includes(normalizedStudent);

  const criteriaScore =
    (parsed?.communication || 0) +
    (parsed?.anamnesis || 0) +
    (parsed?.reasoning || 0) +
    (parsed?.safety || 0) +
    (parsed?.exams || 0) +
    (parsed?.closing || 0) +
    (parsed?.organization || 0);

  const diagnosisBonus = diagnosisCorrect ? 3 : 0;

  const finalScore = criteriaScore + diagnosisBonus;

  const diagnosisExplanation =
    parsed?.diagnosisExplanation?.trim() ||
    "";

  const studentFeedback =
    parsed?.studentFeedback?.trim() ||
    "";

  const finalFeedback = `
${studentFeedback}

Diagnóstico correto:
${correctDiagnosis}

Explicação clínica:
${diagnosisExplanation}

Resumo da avaliação:
${parsed?.feedback || ""}
`.trim();

  await prisma.evaluation.update({
    where: {
      sessionId: session.id,
    },

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

      feedback: finalFeedback,

      strengths: parsed?.strengths || [],

      weaknesses: parsed?.weaknesses || [],

      improvements: parsed?.improvements || [],
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

  return NextResponse.json(
    {
      ok: true,
      score: finalScore,
    },
    { status: 200 },
  );
}
