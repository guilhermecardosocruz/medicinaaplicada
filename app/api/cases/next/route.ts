import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type CasePayload = {
  title: string;
  triage?: string;
  seed: string;
};

function safeJsonParse(text: string): unknown {
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

export async function POST(req: NextRequest) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const openai = getOpenAIClient();
  const model = getOpenAIModel();

  const system = `
Você é um gerador de casos clínicos para simulação com estudantes de medicina.
Retorne APENAS JSON válido, sem markdown, sem texto extra.

Regras:
- Caso realista, linguagem leiga do paciente.
- Não entregue diagnóstico final.
- "seed" deve descrever a persona do paciente + contexto + sintomas + histórico curto + sinais de alarme (se houver).
- "title" curto (ex: "Dor abdominal e náuseas").
- "triage" opcional (ex: "Baixa", "Média", "Alta").
Formato:
{"title":"...","triage":"...","seed":"..."}
`;

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      { role: "system", content: system.trim() },
      {
        role: "user",
        content:
          "Gere 1 caso para atendimento ambulatorial (MVP), com sintomas iniciais suficientes para iniciar anamnese.",
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const parsed = safeJsonParse(text) as Partial<CasePayload> | null;

  if (!parsed || typeof parsed.title !== "string" || typeof parsed.seed !== "string") {
    return NextResponse.json(
      { ok: false, message: "Falha ao gerar caso (JSON inválido).", raw: text.slice(0, 500) },
      { status: 500 },
    );
  }

  const created = await prisma.case.create({
    data: {
      title: parsed.title.trim(),
      triage: typeof parsed.triage === "string" ? parsed.triage.trim() : null,
      seed: parsed.seed.trim(),
      sessions: {
        create: {
          userId: me.id,
          status: "IN_PROGRESS",
          messages: {
            createMany: {
              data: [
                {
                  role: "SYSTEM",
                  content:
                    "Você iniciou uma consulta simulada. Faça anamnese, explore sintomas, antecedentes, e finalize quando achar adequado.",
                },
              ],
            },
          },
          memory: {
            create: {
              summary: "",
              turnCount: 0,
              // facts: (não enviar) — evita conflito de tipos do Json no Prisma
            },
          },
        },
      },
    },
    select: {
      id: true,
      title: true,
      triage: true,
      sessions: { select: { id: true } },
    },
  });

  const sessionId = created.sessions[0]?.id;
  return NextResponse.json(
    { ok: true, sessionId, case: { id: created.id, title: created.title, triage: created.triage } },
    { status: 200 },
  );
}
