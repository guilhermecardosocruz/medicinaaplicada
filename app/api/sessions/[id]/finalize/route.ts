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

function clampScore(v: unknown) {
  if (typeof v !== "number") {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(v.toFixed(1))));
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
Você é um tutor médico humano experiente.

Você deve:
- avaliar o estudante de forma JUSTA
- usar notas PARCIAIS
- evitar notas 0 absolutas sem necessidade
- valorizar boas decisões mesmo em consultas incompletas
- explicar o motivo da nota
- agir como professor humano

IMPORTANTE:
- as notas devem ir de 0 até 1
- pode usar 0.1, 0.2, 0.5, 0.7 etc
- comunicação NÃO deve zerar facilmente
- valorize tentativa de raciocínio clínico

Retorne APENAS JSON válido.

Formato:
{
  "communication": 0-1,
  "anamnesis": 0-1,
  "reasoning": 0-1,
  "safety": 0-1,
  "exams": 0-1,
  "closing": 0-1,
  "organization": 0-1,

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

DIAGNÓSTICO ESPERADO:
${blueprintDiagnosis}

CONSULTA:
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

  const communication = clampScore(parsed?.communication);
  const anamnesis = clampScore(parsed?.anamnesis);
  const reasoning = clampScore(parsed?.reasoning);
  const safety = clampScore(parsed?.safety);
  const exams = clampScore(parsed?.exams);
  const closing = clampScore(parsed?.closing);
  const organization = clampScore(parsed?.organization);

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
    Math.min(
      Number((criteriaScore + diagnosisBonus).toFixed(1)),
      10,
    );

  const diagnosisExplanation =
    parsed?.diagnosisExplanation?.trim() ||
    "O caso precisava de melhor correlação clínica.";

  let studentFeedback =
    parsed?.studentFeedback?.trim() ||
    "";

  if (!studentFeedback) {
    if (diagnosisCorrect) {
      studentFeedback =
        "Parabéns. O raciocínio clínico foi compatível com o diagnóstico correto.";
    } else {
      studentFeedback =
        `O diagnóstico principal esperado era ${correctDiagnosis}. Algumas pistas clínicas importantes deveriam ter sido melhor exploradas.`;
    }
  }

  const feedback =
    parsed?.feedback?.trim() ||
    "";

  const tutorIntervention = diagnosisCorrect
    ? `
Tutor:
Parabéns. Você conseguiu identificar corretamente o diagnóstico principal do caso.

Os sinais clínicos, sintomas e exames complementares estavam compatíveis com ${correctDiagnosis}.

Seu raciocínio clínico foi adequado para o cenário apresentado.
`.trim()
    : `
Tutor:
O diagnóstico principal esperado era:

${correctDiagnosis}

Para chegar ao diagnóstico correto, seria importante investigar melhor:

- padrão temporal dos sintomas;
- evolução clínica;
- sinais de gravidade;
- correlação entre sintomas e exames;
- principais diagnósticos diferenciais.

Pistas importantes do caso:
${diagnosisExplanation}

Mesmo assim, alguns aspectos positivos foram identificados na condução clínica.
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
