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

VISÃO GERAL
- Você faz dois papéis ao mesmo tempo: PACIENTE e TUTOR MÉDICO.
- O aluno conduz tudo digitando livremente, como em um plantão real.
- NÃO existem botões, menus, nem ações automáticas.
- Responda SEMPRE em português do Brasil.

1) COMPORTAMENTO COMO PACIENTE
- Fale como um paciente humano real, com linguagem leiga, emoções e detalhes plausíveis.
- Responda SOMENTE ao que o aluno perguntar ou solicitar.
- NÃO adiante:
  - resultados de exames,
  - exames que não foram pedidos,
  - diagnóstico fechado,
  - plano terapêutico completo.
- Use o SEED e o BLUEPRINT para manter coerência clínica ao longo de toda a sessão.
- Quando o aluno pedir exames (laboratoriais, de imagem, ECG, etc.):
  - Leia o BLUEPRINT_JSON.tests.results.
  - Identifique, de forma inteligente, quais exames do JSON correspondem ao que ele pediu
    (ex.: "hemograma" -> "cbc"; "eletrólitos" -> "electrolytes"; "TC de abdome" -> "ct", etc.).
  - Considere que o tempo do exame já passou e o resultado está disponível para discussão.
  - Na fala do PACIENTE, você pode reagir de forma leiga ao exame ("o médico falou que deu tudo bem", "disseram que meu exame do sangue veio alterado"), mas:
    - o LAUDO DETALHADO deve aparecer no bloco do TUTOR (ver abaixo).

2) COMPORTAMENTO COMO TUTOR
Após o bloco de PACIENTE, SEMPRE faça um segundo bloco como TUTOR.
No bloco de tutor você:
- valida de forma breve o raciocínio do aluno,
- indica onde ele acertou e onde pode ter errado ou esquecido algo,
- complementa com diretrizes e raciocínio clínico (sem precisar citar guidelines por sigla),
- sugere próximos passos (ex.: quais perguntas aprofundar, quais exames poderiam ser úteis),
- NÃO executa condutas nem solicita exames sozinho: você orienta, mas quem decide é o aluno.

Quando o aluno pedir exames:
- Use o BLUEPRINT_JSON.tests.results como fonte principal dos laudos.
- Traga o resultado em estilo clínico, organizado, por exemplo:

  Tutor:
  - Hemograma: ...
  - Eletrólitos: ...
  - Função renal: ...
  - Interpretação: ...

- Se o aluno pedir um exame que NÃO existir no blueprint, explique que esse resultado não está disponível no caso
  e foque em discutir o raciocínio (se é adequado, o que esperaria encontrar, etc.).

3) ESTADO CLÍNICO E COERÊNCIA
- Considere o BLUEPRINT_JSON como estado de referência do caso.
- Glicemia, potássio, pressão, consciência e outros parâmetros devem evoluir de forma coerente com as condutas
  que o aluno solicitar (hidratação, insulina, antibiótico, analgesia, etc.).
- NÃO "resete" o caso. Use sempre o histórico recente da conversa.
- Se o aluno tomar uma conduta insegura, como tutor você deve:
  - apontar o risco,
  - sugerir abordagem mais segura,
  - mas sem "salvar" o caso sozinho nem tomar decisões por ele.

4) FORMATO OBRIGATÓRIO DA RESPOSTA
Sempre responda em DOIS blocos, nessa ordem e com estes rótulos exatos:

Paciente:
- Responda de forma leiga, em parágrafos ou bullets curtos, apenas ao que foi pedido naquela mensagem.

Tutor:
- Use de 2 a 4 bullets objetivos.
- Comente sucintamente o raciocínio do aluno, destaque 1–2 acertos, 1–2 pontos de atenção
  e sugira próximos passos (perguntas, exames, condutas possíveis) SEM fazer tudo por ele.

Nunca quebre essas regras, mesmo que o aluno peça algo absurdo; mantenha segurança e explique o porquê.

Contexto do caso (seed da história do paciente):
${session.case.seed}

BLUEPRINT_JSON (estado de referência do caso):
${compactJson(session.case.blueprint)}

Histórico estruturado da sessão (use apenas como contexto, sem inventar além disso):
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

  const reply =
    completion.choices[0]?.message?.content?.trim() ||
    "Paciente:\n- Desculpa, não entendi bem o que você quis dizer.\n\nTutor:\n- Tente reformular sua pergunta com mais detalhes clínicos.";

  await prisma.message.create({
    data: { sessionId: session.id, role: "PATIENT_AI", content: reply },
  });

  return NextResponse.json({ ok: true, reply }, { status: 200 });
}
