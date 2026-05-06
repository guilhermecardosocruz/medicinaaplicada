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

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
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

  if (!session || !session.evaluation) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const transcript = session.messages
    .slice(-60)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const blueprint =
    typeof session.case.blueprint === "object" &&
    session.case.blueprint !== null
      ? session.case.blueprint as Record<string, unknown>
      : {};

  const blueprintDiagnosis =
    typeof blueprint.correctDiagnosis === "string"
      ? blueprint.correctDiagnosis
      : typeof blueprint.diagnosis === "string"
        ? blueprint.diagnosis
        : "";

  const studentDiagnosis =
    session.evaluation.studentDiagnosis || "";

  const studentJustification =
    session.evaluation.clinicalJustification || "";

  const system = `
Você é um tutor médico experiente e professor de medicina.

IMPORTANTE:
- Você deve agir como um tutor humano.
- Explique o raciocínio clínico correto.
- Explique o que o estudante deveria ter investigado.
- Explique quais pistas clínicas indicavam o diagnóstico correto.
- Seja didático.
- Nunca deixe feedback vazio.
- Nunca deixe o diagnóstico correto vazio.
- Nunca responda "não identificado".
- Mesmo quando o aluno erra, valorize os pontos positivos.
- O aluno pode ganhar pontos mesmo errando o diagnóstico.
- Se o aluno acertar, parabenize explicitamente.

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

  "correctDiagnosis": "diagnóstico correto",

  "diagnosisExplanation": "explicação do raciocínio clínico correto",

  "studentFeedback": "feedback pedagógico estilo tutor humano",

  "feedback": "resumo final",

  "strengths": [],
  "weaknesses": [],
  "improvements": []
}
`.trim();

  const user = `
CASO CLÍNICO:

${session.case.seed}

DIAGNÓSTICO ESPERADO:
${blueprintDiagnosis}

TRANSCRIÇÃO DA CONSULTA:
${transcript}

DIAGNÓSTICO DO ESTUDANTE:
${studentDiagnosis}

JUSTIFICATIVA:
${studentJustification}
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
    blueprintDiagnosis ||
    "Diagnóstico clínico principal.";

  const normalizedStudent =
    normalize(studentDiagnosis);

  const normalizedCorrect =
    normalize(correctDiagnosis);

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
    "O caso precisava de melhor correlação clínica entre sintomas, exame físico e exames complementares.";

  let studentFeedback =
    parsed?.studentFeedback?.trim() ||
    "";

  if (!studentFeedback) {
    if (diagnosisCorrect) {
      studentFeedback =
        "Parabéns. O raciocínio clínico utilizado foi compatível com o diagnóstico correto.";
    } else {
      studentFeedback =
        `O diagnóstico principal esperado era ${correctDiagnosis}. Você apresentou outra hipótese diagnóstica, porém alguns elementos importantes do caso deveriam ter sido melhor explorados.`;
    }
  }

  const feedback =
    parsed?.feedback?.trim() ||
    "";

  const tutorIntervention = diagnosisCorrect
    ? `
Tutor:
Parabéns. Você conseguiu identificar corretamente o diagnóstico principal do caso.

Os dados clínicos, os sintomas apresentados e os exames solicitados estavam compatíveis com ${correctDiagnosis}.

Seu raciocínio clínico foi adequado para o cenário apresentado.
`.trim()
    : `
Tutor:
O diagnóstico principal esperado neste caso era:

${correctDiagnosis}

O diagnóstico informado pelo estudante não corresponde ao quadro clínico principal esperado.

Para chegar ao diagnóstico correto, seria importante investigar melhor:

- relação entre sintomas e esforço físico;
- padrão temporal da dor;
- sinais de gravidade;
- correlação clínica com os exames complementares;
- hipóteses cardiovasculares prioritárias.

Pistas importantes do caso:
${diagnosisExplanation}

Mesmo assim, alguns aspectos positivos da consulta foram observados e o caso pode continuar para definição do tratamento.
`.trim();

  const finalFeedback = `
${tutorIntervention}

${studentFeedback}

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
