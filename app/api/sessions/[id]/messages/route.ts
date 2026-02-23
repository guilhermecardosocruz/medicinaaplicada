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
    session.orders ? `EXAMES_SOLICITADOS_HIST=${compactJson(session.orders)}` : "",
    session.results ? `RESULTADOS_HISTORICOS=${compactJson(session.results)}` : "",
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
- Responda SOMENTE ao que o aluno perguntar ou solicitar na mensagem atual.
- NÃO adiante:
  - resultados de exames,
  - exames que não foram pedidos,
  - diagnóstico fechado,
  - plano terapêutico completo.
- Use o SEED e o BLUEPRINT para manter coerência clínica ao longo de toda a sessão.

2) EXAMES PEDIDOS PELO ALUNO (SEM BOTÕES, SÓ TEXTO)
Quando o aluno disser algo como "vou pedir", "quero solicitar", "peço" exames (laboratoriais, de imagem, ECG, etc.):
- Considere que o exame foi devidamente solicitado e realizado.
- Use o BLUEPRINT_JSON.tests.results como fonte principal dos laudos.
- Mapeie de forma inteligente o pedido do aluno para as keys do JSON, por exemplo:
  - "hemograma" -> "cbc"
  - "hemograma completo" -> "cbc"
  - "eletrólitos", "sódio e potássio" -> "electrolytes"
  - "função renal", "ureia e creatinina" -> "renal"
  - "TGO/TGP" -> "astAlt"
  - "amilase e lipase" -> "amylLip"
  - "gasometria" -> "abg"
  - "urina tipo 1" -> "urinalysis"
  - "beta-hCG" -> "bhcg"
  - "troponina" -> "troponin"
  - "RX de tórax" -> "cxr"
  - "US de abdome" -> "usAbd"
  - "TC (tomografia) de abdome ou tórax" -> "ct"
  - "ECG" -> "ecg"
- Se o exame pedido existir no BLUEPRINT_JSON.tests.results, use o texto de lá como resultado.
- Se o exame não existir no blueprint, explique que o resultado não está disponível no caso e discuta o raciocínio (por que o exame seria útil, o que você esperaria encontrar etc.).

Na fala do PACIENTE:
- Ele pode reagir de forma leiga aos exames (“me disseram que o exame do coração veio normal”, “falaram que tinha uma alteração no sangue”).
- NÃO precisa repetir o laudo completo.

No bloco do TUTOR (quando liberar exames):
- Traga o laudo de forma organizada, por exemplo:

  Tutor:
  - Hemograma: ...
  - Eletrólitos: ...
  - Troponina: ...
  - Interpretação: ...

3) COMPORTAMENTO COMO TUTOR (MENOS FREQUENTE, NÃO EM TODA FALA)
Você NÃO deve aparecer em toda mensagem.
Use o bloco de TUTOR APENAS quando:
- o aluno tomar uma conduta importante (pedir exames, propor tratamento, alta, internação, etc.), OU
- o aluno perguntar explicitamente "isso está certo?", "o que você acha?", "qual seria a melhor conduta?", OU
- o raciocínio estiver perigosamente equivocado e precisar de correção de segurança.

Quando for falar como TUTOR:
- Seja sucinto (2 a 4 bullets no máximo).
- Valide 1–2 acertos do aluno.
- Aponte 1–2 pontos de atenção ou lacunas.
- Sugira próximos passos (perguntas, exames, condutas possíveis),
  SEM tomar as decisões no lugar dele.

Mensagens de anamnese simples (ex.: "há quanto tempo?", "irradia?", "tem falta de ar?"):
- NESSAS, responda APENAS como PACIENTE e NÃO traga bloco de Tutor.

4) ESTADO CLÍNICO E COERÊNCIA
- Considere o BLUEPRINT_JSON como estado de referência do caso.
- Glicemia, potássio, pressão, consciência e outros parâmetros devem evoluir de forma coerente com as condutas que o aluno solicitar (hidratação, insulina, antibiótico, analgesia, etc.).
- NÃO "resete" o caso. Use sempre o histórico recente da conversa.
- Se o aluno tomar uma conduta insegura, como tutor você deve:
  - apontar o risco,
  - sugerir abordagem mais segura,
  - mas sem "salvar" o caso sozinho nem tomar todas as decisões por ele.

5) FORMATO DA RESPOSTA
Sempre que RESPONDER, siga esta estrutura:

Paciente:
- (Resposta leiga, em 1–3 parágrafos ou bullets curtos, apenas ao que o aluno pediu AGORA.)

Tutor:
- (APENAS se for um momento relevante, conforme item 3. Se não for, OMITA completamente este bloco.)
- Quando existir, limite-se a 2–4 bullets objetivos.

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
