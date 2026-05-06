import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const me = getSessionUser(req);

  if (!me) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const openai = getOpenAIClient();

  const system = `
Você é um gerador de casos clínicos médicos realistas.

IMPORTANTE:
- O nome do paciente é OBRIGATÓRIO.
- Nunca use "não informado".
- Gere um caso plausível e coerente.
- O diagnóstico correto deve ficar oculto do estudante.
- O tratamento ideal deve ficar oculto do estudante.

Retorne APENAS JSON válido.

Formato:
{
  "title": "título curto do caso",

  "seed": "descrição médica interna completa",

  "blueprint": {
    "patientName": "nome completo",
    "age": número,
    "sex": "Masculino/Feminino",
    "chiefComplaint": "queixa principal",
    "correctDiagnosis": "diagnóstico correto",
    "idealTreatment": "tratamento ideal resumido",
    "triage": {
      "risk": "BAIXA/MODERADA/ALTA",
      "pain": "0-10",
      "vitals": {
        "pa": "...",
        "fc": "...",
        "fr": "...",
        "temp": "...",
        "spo2": "..."
      }
    }
  }
}
`.trim();

  const completion = await openai.chat.completions.create({
    model: getOpenAIModel(),

    temperature: 0.7,

    messages: [
      {
        role: "system",
        content: system,
      },

      {
        role: "user",
        content: "Gere um caso clínico aleatório de pronto atendimento.",
      },
    ],
  });

  const parsed = safeJsonParse(
    completion.choices[0]?.message?.content || "",
  );

  if (!parsed) {
    return NextResponse.json(
      {
        ok: false,
        message: "Falha ao gerar caso.",
      },
      { status: 500 },
    );
  }

  const createdCase = await prisma.case.create({
    data: {
      title:
        parsed.title ||
        "Caso clínico",

      seed:
        parsed.seed ||
        "Caso clínico sem descrição.",

      blueprint:
        parsed.blueprint || {},
    },
  });

  const session = await prisma.consultSession.create({
    data: {
      userId: me.id,
      caseId: createdCase.id,

      messages: {
        create: {
          role: "SYSTEM",
          content:
            "Você iniciou uma consulta simulada. Comece pela triagem estruturada e depois conduza a anamnese.",
        },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
  });
}
