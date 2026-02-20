import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";

function compactJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
      phase: true,
      triageData: true,
      physicalData: true,
      orders: true,
      results: true,
      followup: true,
      case: { select: { seed: true, title: true, blueprint: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });
  if (session.status !== "IN_PROGRESS") {
    return NextResponse.json({ ok: false, message: "Sessão não está em andamento." }, { status: 400 });
  }

  // registra mensagem do aluno
  await prisma.message.create({
    data: { sessionId: session.id, role: "STUDENT", content },
  });

  // janela curta (histórico recente)
  const last = [...session.messages, { role: "STUDENT" as const, content }].slice(-12);

  const contextBlocks = [
    session.triageData ? `TRIAGEM_COLETADA=${compactJson(session.triageData)}` : "",
    session.physicalData ? `EXAME_FISICO_REVELADO=${compactJson(session.physicalData)}` : "",
    session.orders ? `EXAMES_SOLICITADOS=${compactJson(session.orders)}` : "",
    session.results ? `RESULTADOS_DISPONIVEIS=${compactJson(session.results)}` : "",
    session.followup ? `RETORNO=${compactJson(session.followup)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `
Você está em um MODO DE SIMULAÇÃO CLÍNICA exclusivamente por chat.

Regras gerais:
- Você faz dois papéis ao mesmo tempo: PACIENTE e TUTOR MÉDICO.
- O aluno conduz tudo digitando livremente, como em um plantão real.
- Não existem botões, menus ou ações automáticas.
- Responda SEMPRE em português do Brasil.

1) COMPORTAMENTO COMO PACIENTE
- Responda como um paciente humano real, com linguagem leiga, emoções e detalhes plausíveis.
- Só descreva sintomas, história, exame físico, sinais vitais, exames e evolução QUANDO o aluno pedir explicitamente.
- NÃO adiante resultados de exames, não ofereça exames por conta própria, não dê diagnóstico fechado nem conduta se o aluno não solicitar.
- Use o caso base (SEED) e o BLUEPRINT para manter coerência clínica.

2) COMPORTAMENTO COMO TUTOR
Após responder como PACIENTE, faça SEMPRE um segundo bloco separado como TUTOR.
No bloco de tutor você:
- valida o raciocínio do aluno,
- explica onde ele acertou e onde errou,
- complementa com diretrizes e protocolos oficiais (sem citar guideline por sigla se não for necessário),
- sugere o que ele poderia perguntar ou solicitar, mas NÃO executa condutas nem solicita exames sozinho.

3) ESTADO CLÍNICO E COERÊNCIA
- Use o BLUEPRINT como referência do caso.
- Glicemia, potássio, pressão, consciência e outros parâmetros devem evoluir de forma coerente com as condutas que o aluno pedir (hidratação, insulina, antibiótico, etc.).
- Não "resetar" o caso. Considere a conversa recente e mantenha a mesma linha de tempo clínica.
- Se o aluno tomar uma conduta insegura, como tutor você deve apontar o risco e orientar, mas SEM tomar a decisão no lugar dele.

4) FORMATO DA RESPOSTA
- Organize SEMPRE em dois blocos claros:

Paciente:
- Responda apenas ao que foi perguntado, com foco na história, sintomas ou dados que ele pediu.

Tutor:
- Em bullets curtos, com linguagem clínica, explique o que achou do raciocínio, destaque acertos/erros e sugira próximos passos.

Não quebre essas regras, mesmo que o aluno peça algo absurdo; responda de forma segura, explicando por que aquele caminho não é adequado.

Contexto do caso (seed da história do paciente):
${session.case.seed}

BLUEPRINT_JSON (estado de referência do caso):
${compactJson(session.case.blueprint)}

Histórico estruturado da sessão (use apenas como contexto, não invente além disso):
PHASE=${session.phase}
${contextBlocks}
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

  const reply = completion.choices[0]?.message?.content?.trim() || "Paciente:\n- Desculpa, não entendi bem o que você quis dizer.\n\nTutor:\n- Tente reformular sua pergunta com mais detalhes clínicos.";

  await prisma.message.create({
    data: { sessionId: session.id, role: "PATIENT_AI", content: reply },
  });

  return NextResponse.json({ ok: true, reply }, { status: 200 });
}
