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

function clamp01(v: unknown) {
  return v === 1 ? 1 : 0;
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
    .slice(-40)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const studentDiagnosis =
    session.evaluation.studentDiagnosis || "";

  const studentJustification =
    session.evaluation.clinicalJustification || "";

  const system = `
Você é um avaliador pedagógico médico.

IMPORTANTE:
- descubra o diagnóstico correto
- nunca deixe diagnóstico vazio
- avalie de forma justa
- o aluno pode ganhar pontos mesmo errando o diagnóstico

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

  "diagnosisExplanation": "texto",

  "studentFeedback": "texto",

  "feedback": "texto",

  "strengths": [],
  "weaknesses": [],
  "improvements": []
}
`.trim();

  const user = `
CASO:
${session.case.seed}

CONSULTA:
${transcript}

DIAGNÓSTICO DO ALUNO:
${studentDiagnosis}

JUSTIFICATIVA:
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

  const raw =
    completion.choices[0]?.message?.content || "";

  const parsed = safeJsonParse(raw);

  const communication = clamp01(parsed?.communication);
  const anamnesis = clamp01(parsed?.anamnesis);
  const reasoning = clamp01(parsed?.reasoning);
  const safety = clamp01(parsed?.safety);
  const exams = clamp01(parsed?.exams);
  const closing = clamp01(parsed?.closing);
  const organization = clamp01(parsed?.organization);

  const correctDiagnosis =
    parsed?.correctDiagnosis?.trim() ||
    "Diagnóstico clínico não identificado.";

  const normalizedStudent =
    studentDiagnosis.toLowerCase().trim();

  const normalizedCorrect =
    correctDiagnosis.toLowerCase().trim();

  const diagnosisCorrect =
    normalizedStudent.length > 2 &&
    (
      normalizedStudent.includes(normalizedCorrect) ||
      normalizedCorrect.includes(normalizedStudent)
    );

  const criteriaScore =
    communication +
    anamnesis +
    reasoning +
    safety +
    exams +
    closing +
    organization;

  const diagnosisBonus =
    diagnosisCorrect ? 3 : 0;

  const diagnosisScore =
    Math.min(criteriaScore + diagnosisBonus, 10);

  const diagnosisExplanation =
    parsed?.diagnosisExplanation?.trim() ||
    "Sem explicação clínica.";

  const studentFeedback =
    parsed?.studentFeedback?.trim() ||
    "Sem feedback.";

  const feedback =
    parsed?.feedback?.trim() ||
    "";

  const finalFeedback = `
${studentFeedback}

Diagnóstico correto:
${correctDiagnosis}

Explicação clínica:
${diagnosisExplanation}

Resumo geral:
${feedback}
`.trim();

  await prisma.evaluation.update({
    where: {
      sessionId: session.id,
    },

    data: {
      communication,
      anamnesis,
      reasoning,
      safety,
      exams,
      closing,
      organization,

      correctDiagnosis,

      diagnosisCorrect,

      diagnosisScore,

      score: diagnosisScore,

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
      status: "WAITING_TREATMENT",
    },
  });

  return NextResponse.json({
    ok: true,
    score: diagnosisScore,
  });
}
