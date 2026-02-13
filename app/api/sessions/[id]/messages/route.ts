import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      status: true,
      case: { select: { title: true, triage: true } },
      evaluation: { select: { score: true, feedback: true, strengths: true, weaknesses: true, improvements: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, createdAt: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  return NextResponse.json({ ok: true, session }, { status: 200 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ ok: false, message: "Mensagem vazia." }, { status: 400 });

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      status: true,
      case: { select: { seed: true, title: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });
  if (session.status !== "IN_PROGRESS") {
    return NextResponse.json({ ok: false, message: "Sessão não está em andamento." }, { status: 400 });
  }

  // grava mensagem do aluno
  await prisma.message.create({
    data: { sessionId: session.id, role: "STUDENT", content },
  });

  // monta contexto barato: seed + últimas mensagens (janela curta)
  const last = [...session.messages, { role: "STUDENT" as const, content }].slice(-12);

  const system = `
Você é um PACIENTE simulando um atendimento médico.
Você deve responder como paciente humano, linguagem leiga, com emoções e detalhes realistas.
Não diga que é IA. Não invente exames ou diagnósticos definitivos.
Se o aluno fizer perguntas vagas, peça esclarecimentos.
Caso base (persona e contexto):
${session.case.seed}
`.trim();

  const openai = getOpenAIClient();
  const model = getOpenAIModel();

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.8,
    messages: [
      { role: "system", content: system },
      ...last.map((m) => ({
        role: m.role === "STUDENT" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ],
  });

  const reply = completion.choices[0]?.message?.content?.trim() || "Desculpa, não entendi bem…";

  await prisma.message.create({
    data: { sessionId: session.id, role: "PATIENT_AI", content: reply },
  });

  // atualiza updatedAt (já acontece) e pronto
  return NextResponse.json({ ok: true, reply }, { status: 200 });
}
