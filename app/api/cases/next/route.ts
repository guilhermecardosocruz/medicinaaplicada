import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";
import { Prisma } from "@prisma/client";

type CasePayload = {
  title: string;
  triage?: string;
  seed: string;
  blueprint?: unknown; // Json
};


function asInputJsonValue(v: unknown): Prisma.InputJsonValue | undefined {
  // Prisma aceita apenas JsonValue: string | number | boolean | null | JsonObject | JsonArray
  if (v === null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v as unknown as Prisma.InputJsonValue;
  if (typeof v === "object" && v !== null) return v as unknown as Prisma.InputJsonValue;
  return undefined;
}

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

Objetivo: gerar um caso com "blueprint" estruturado para reduzir chamadas futuras.

Regras:
- Caso realista (ambulatorial/UPA leve para MVP), linguagem leiga do paciente.
- Não entregue diagnóstico final.
- "seed" descreve persona + contexto + sintomas + histórico curto + sinais de alarme (se houver).
- "title" curto (ex: "Dor abdominal e náuseas").
- "triage" opcional (ex: "Baixa", "Média", "Alta").

O campo "blueprint" deve conter:
{
  "triage": {
    "age": number,
    "sex": "M"|"F"|"O",
    "chiefComplaint": string,
    "onset": string,
    "vitals": { "pa": string, "fc": number, "fr": number, "temp": number, "spo2": number, "pain": number, "glucose": number|null },
    "risk": "BAIXA"|"MEDIA"|"ALTA",
    "redFlags": string[]
  },
  "physical": {
    "general": string,
    "heent": string,
    "cardio": string,
    "resp": string,
    "abdomen": string,
    "neuro": string,
    "skin": string,
    "extremities": string,
    "gynUro": string|null
  },
  "tests": {
    "catalog": [
      { "key": "cbc", "label": "Hemograma" },
      { "key": "crp", "label": "PCR" },
      { "key": "electrolytes", "label": "Eletrólitos" },
      { "key": "renal", "label": "Função renal" },
      { "key": "astAlt", "label": "TGO/TGP" },
      { "key": "amylLip", "label": "Amilase/Lipase" },
      { "key": "abg", "label": "Gasometria" },
      { "key": "urinalysis", "label": "Urina tipo 1" },
      { "key": "bhcg", "label": "Beta-hCG" },
      { "key": "troponin", "label": "Troponina" },
      { "key": "cxr", "label": "RX tórax" },
      { "key": "usAbd", "label": "US abdome" },
      { "key": "ct", "label": "TC" },
      { "key": "ecg", "label": "ECG" }
    ],
    "results": {
      "cbc": string,
      "crp": string,
      "electrolytes": string,
      "renal": string,
      "astAlt": string,
      "amylLip": string,
      "abg": string,
      "urinalysis": string,
      "bhcg": string,
      "troponin": string,
      "cxr": string,
      "usAbd": string,
      "ct": string,
      "ecg": string
    }
  },
  "followup": {
    "improved": string,
    "same": string,
    "worse": string,
    "sideEffect": string
  }
}

Importante:
- Coerência: sinais vitais, triagem, exame físico e exames devem ser plausíveis e coerentes.
- Se "sex" = "M", "bhcg" deve ser "não aplicável" ou similar.
- "gynUro" pode ser null quando não aplicável.
Formato final:
{"title":"...","triage":"...","seed":"...","blueprint":{...}}
`.trim();

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.6,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          "Gere 1 caso para atendimento (MVP) com blueprint completo para triagem, exame físico e exames.",
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
  const blueprint = asInputJsonValue(parsed.blueprint);

  const created = await prisma.case.create({
    data: {
      title: parsed.title.trim(),
      triage: typeof parsed.triage === "string" ? parsed.triage.trim() : null,
      seed: parsed.seed.trim(),
      ...(blueprint ? { blueprint } : {}),
      sessions: {
        create: {
          userId: me.id,
          status: "IN_PROGRESS",
          phase: "TRIAGE",
          messages: {
            createMany: {
              data: [
                {
                  role: "SYSTEM",
                  content:
                    "Você iniciou uma consulta simulada. Comece pela triagem estruturada e depois conduza a anamnese.",
                },
              ],
            },
          },
          memory: {
            create: {
              summary: "",
              turnCount: 0,
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
