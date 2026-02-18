import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

type EvalJson = {
  score: number;
  feedback: string;
  strengths?: string[];
  weaknesses?: string[];
  improvements?: string[];
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

function compactJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      status: true,
      phase: true,
      triageData: true,
      physicalData: true,
      orders: true,
      results: true,
      followup: true,
      case: { select: { title: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } },
      evaluation: { select: { id: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });
  if (session.evaluation) return NextResponse.json({ ok: false, message: "Sessão já avaliada." }, { status: 400 });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "WAITING_EVAL", phase: "FINALIZED" },
  });

  // Resumo estruturado (pra coordenação avaliar com menos token)
  const structuredSummary = [
    session.triageData ? `TRIAGEM=${compactJson(session.triageData)}` : "",
    session.physicalData ? `EXAME_FISICO=${compactJson(session.physicalData)}` : "",
    session.orders ? `EXAMES_SOLICITADOS=${compactJson(session.orders)}` : "",
    session.results ? `RESULTADOS=${compactJson(session.results)}` : "",
    session.followup ? `RETORNO=${compactJson(session.followup)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Também envia uma transcrição curta (últimas 20 mensagens) pra não perder contexto do raciocínio
  const tail = session.messages.slice(-20);
  const transcript = tail
    .map((m) => {
      const who =
        m.role === "STUDENT" ? "ALUNO" :
        m.role === "PATIENT_AI" ? "PACIENTE" :
        m.role === "COORDINATOR_AI" ? "COORDENADOR" : "SISTEMA";
      return `${who}: ${m.content}`;
    })
    .join("\n");

  const system = `
Você é um COORDENADOR avaliando uma consulta simulada de estudante de medicina.
Retorne APENAS JSON válido, sem markdown, sem texto extra.

Critérios (nota 0-10):
- Acolhimento e comunicação
- Anamnese (perguntas relevantes)
- Organização do raciocínio
- Segurança do paciente (red flags, orientação responsável)
- Uso adequado de exame físico e exames
- Encerramento (resumo e próximos passos)

Formato:
{
  "score": 0-10,
  "feedback": "texto curto e objetivo",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "improvements": ["..."]
}
`.trim();

  const openai = getOpenAIClient();
  const model = getOpenAIModel();

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Caso: ${session.case.title}\n\nResumo estruturado:\n${structuredSummary || "(vazio)"}\n\nTranscrição (últimas mensagens):\n${transcript}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const parsed = safeJsonParse(text) as Partial<EvalJson> | null;

  const scoreRaw = parsed?.score;
  const score =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
      ? Math.max(0, Math.min(10, Math.round(scoreRaw)))
      : 0;

  const feedback = typeof parsed?.feedback === "string" ? parsed.feedback.trim() : "Avaliação indisponível.";
  const strengths = Array.isArray(parsed?.strengths) ? parsed?.strengths.filter((s) => typeof s === "string") : [];
  const weaknesses = Array.isArray(parsed?.weaknesses) ? parsed?.weaknesses.filter((s) => typeof s === "string") : [];
  const improvements = Array.isArray(parsed?.improvements) ? parsed?.improvements.filter((s) => typeof s === "string") : [];

  await prisma.evaluation.create({
    data: {
      sessionId: session.id,
      score,
      feedback,
      strengths,
      weaknesses,
      improvements,
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "COORDINATOR_AI",
      content: `Nota: ${score}/10\n\n${feedback}`,
    },
  });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "DONE" },
  });

  return NextResponse.json({ ok: true, score }, { status: 200 });
}
