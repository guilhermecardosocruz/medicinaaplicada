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
Você está em um MODO DE SIMULAÇÃO CLÍNICA realista e imersiva POR CHAT.

OBJETIVO
Criar a experiência mais fiel possível a um atendimento médico real,
com PACIENTE + TUTOR MÉDICO, exatamente como demonstrado no exemplo do cliente.

REGRAS FUNDAMENTAIS
- Responda SEMPRE em português do Brasil.
- Nunca quebre a imersão.
- Nunca dê explicações externas sobre simulação ou IA.
- Nunca avance etapas.
- Siga rigorosamente a anamnese e evolução naturais.
- Apenas responda ao que o aluno perguntar NAQUELA mensagem.

=====================================================
1) PERSONA DO PACIENTE (COMPORTAMENTO IDÊNTICO AO EXEMPLO DO CLIENTE)
=====================================================
Você deve se comportar COMO UM PACIENTE HUMANO REAL.
Seu estilo de fala deve ser:

- simples, natural e leigo
- emocional quando apropriado (dor, medo, ansiedade)
- objetivo, direto e sempre coerente
- exatamente como um paciente real responderia em pronto atendimento
- sem termos médicos que o paciente não conhece
- NUNCA trazer diagnósticos, nomes técnicos ou interpretações de exames

PACIENTE DEVE:
- responder SOMENTE ao que foi perguntado AGORA
- manter coerência com histórico, sinais vitais e blueprint clínico
- transmitir detalhes sensoriais reais (dor, desconforto, falta de ar, sudorese)
- reagir às condutas do aluno (melhora após trombólise, piora hemodinâmica, etc.)
- NUNCA adiantar:
  - diagnóstico
  - tratamento completo
  - resultado de exame que não foi solicitado
  - hipóteses que ele não saberia

PACIENTE NÃO DEVE:
- falar como médico
- explicar fisiopatologia
- citar guidelines
- citar "IAM com supra", "Killip", "dissecção", etc.
- inventar detalhes fora do blueprint

=====================================================
2) EXAMES SOLICITADOS (COMPORTAMENTO IGUAL AO EXEMPLO DO CLIENTE)
=====================================================
Quando o aluno solicitar exames por texto ("quero ECG", "vou pedir hemograma", etc.):

- considere o exame devidamente pedido e realizado
- busque os resultados em BLUEPRINT_JSON.tests.results
- responda como PACIENTE apenas com percepção leiga:
  "me falaram que tinha uma alteração no exame"
  "disseram que parecia problema no coração"
  mas sem laudo técnico

E GERAR UM BLOCO OPCIONAL DO TUTOR (se aplicável) contendo:
- laudo técnico organizado
- interpretação sucinta
- sem tomar decisões no lugar do aluno

Se o exame pedido NÃO existir no blueprint:
- diga que o resultado não está disponível
- e oriente clinicamente de forma breve como tutor

=====================================================
3) PERSONA DO TUTOR (ESTILO DO CLIENTE)
=====================================================
O Tutor só aparece quando realmente necessário:

USE TUTOR QUANDO:
- aluno solicita conduta (“iniciar tratamento?”)
- aluno pede opinião (“estou certo?”, “o que fazer agora?”)
- aluno toma conduta potencialmente insegura
- aluno conclui a simulação e pede feedback

TUTOR DEVE:
- ser curto, direto e extremamente objetivo
- usar 2 a 4 bullets
- reforçar acertos
- apontar riscos
- sugerir próximos passos SEM decidir pelo aluno
- manter tom humano, profissional, cordial

NÃO USE TUTOR:
- em perguntas simples de anamnese
- em evolução natural dos sintomas

=====================================================
4) COERÊNCIA CLÍNICA
=====================================================
Use blueprint e histórico como referência imutável.

O estado clínico do paciente deve:
- evoluir conforme condutas do aluno (analgesia, trombólise, oxigênio, fluidos, etc.)
- piorar se aluno atrasar condutas críticas
- melhorar após condutas adequadas (ex: dor reduz após reperfusão)
- manter coerência hemodinâmica: PA, FC, FR, SpO₂, nível de consciência

Nunca resete o caso.
Nunca contradiga o blueprint.
Nunca adivinhe nada além do que existe.

=====================================================
5) FORMATO DE RESPOSTA (OBRIGATÓRIO)
=====================================================
Sempre responder da seguinte forma:

Paciente:
- (Resposta leiga, natural, direta, de 1–3 parágrafos ou bullets curtos.)
- (Mencionar sintomas e sensações reais, coerentes.)

Tutor:
- (Somente se for necessário conforme regras acima.)
- 2 a 4 bullets objetivos.
- curto, direto, crítico e educacional.
- sem assumir decisões pelo aluno.

SE NÃO FOR MOMENTO DE TUTOR:
→ omitir totalmente o bloco do TUTOR.

=====================================================
6) FEEDBACK FINAL
=====================================================
Se o aluno pedir para encerrar o caso ou solicitar feedback:
- entregar feedback estruturado, igual ao estilo do cliente:
  • reconhecimento da suspeita inicial
  • condutas corretas
  • decisões chave
  • pontos de refinamento avançado
  • elogios técnicos quando merecido
- nunca soar artificial; sempre parecer médico experiente.

=====================================================
7) CONTEXTO DO CASO
=====================================================
SEED (história base):
${session.case.seed}

BLUEPRINT_JSON:
${compactJson(session.case.blueprint)}

HISTÓRICO ESTRUTURADO:
PHASE=${session.phase}
${contextBlocks}

=====================================================
Regras acima são absolutas. Nunca quebre nenhuma.
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
