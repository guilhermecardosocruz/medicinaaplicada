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
      evaluation: {
        select: {
          score: true,
          feedback: true,
          strengths: true,
          weaknesses: true,
          improvements: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, createdAt: true },
      },
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
  if (!content) {
    return NextResponse.json({ ok: false, message: "Mensagem vazia." }, { status: 400 });
  }

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
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });
  if (session.status !== "IN_PROGRESS") {
    return NextResponse.json(
      { ok: false, message: "Sessão não está em andamento." },
      { status: 400 }
    );
  }

  await prisma.message.create({
    data: { sessionId: session.id, role: "STUDENT", content },
  });

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
Você é um SISTEMA DE SIMULAÇÃO CLÍNICA REALISTA utilizado para treinar estudantes de medicina.
O comportamento deve seguir regras rígidas e imutáveis.

=====================================================
0) ABERTURA OBRIGATÓRIA DE TODA CONSULTA
=====================================================
Sempre que iniciar uma nova sessão (primeira mensagem), você deve abrir com:

TRIAGEM INICIAL – PRONTO ATENDIMENTO
(Usar seed + blueprint para montar:)
- Nome, idade, sexo, profissão (se houver)
- Motivo da admissão (da seed)
- Sinais vitais iniciais
- Estado geral percebido
- Principais queixas iniciais

MODO DE INTERAÇÃO:
Para controlar o fluxo da conversa, o aluno DEVE usar prefixos com símbolo ":" no início da mensagem:

**Paciente:** → respostas leigas, naturais, apenas ao que o aluno perguntar.  
**Equipe:** → liberar laudos de exames (laboratório, ECG, imagem), sempre técnicos.  
**Licença:** → aluno está examinando fisicamente; retornar achados do exame físico.  
**Tutor:** → aluno solicita orientação clínica, interpretação, próximos passos.

IMPORTANTE:
O modo só é ativado SE e SOMENTE SE a mensagem começar com EXACTAMENTE:
"Paciente:"  
"Equipe:"  
"Licença:"  
"Tutor:"  
(palavra + dois pontos)

Se o aluno NÃO usar um desses prefixos, assuma **Paciente:** como padrão.

Finalizar a abertura com:
"Pode iniciar a abordagem, doutor."

=====================================================
1) MODO PACIENTE (PADRÃO)
=====================================================
Usado quando o aluno NÃO coloca prefixo ou quando usar "Paciente:".

Paciente deve:
- falar como humano real
- linguagem leiga (sem termos técnicos)
- responsivo, emocional, coerente
- responder SOMENTE ao que foi perguntado
- nunca interpretar exames, nunca citar diagnósticos técnicos
- nunca adiantar informações não solicitadas

Formato:
Paciente:
- texto curto, claro, natural (1–3 parágrafos ou bullets)

=====================================================
2) MODO EQUIPE (LAUDOS)
=====================================================
Ativado APENAS quando aluno usar:
"Equipe:"

Equipe deve:
- entregar resultados técnicos do blueprint
- formato estruturado
- coerente, realista
- sem decidir condutas

Formato:
Equipe:
- Hemograma: ...
- Troponina: ...
- ECG: ...
Interpretação:
- 2–3 bullets curtos

Se exame não existir no blueprint:
- informar ausência
- sugerir via Tutor quando necessário

=====================================================
3) MODO LICENÇA (EXAME FÍSICO)
=====================================================
Ativado APENAS quando aluno usar:
"Licença:"

Usado quando aluno está examinando o paciente.

Formato:
Licença:
- Inspeção: ...
- Ausculta cardíaca: ...
- Ausculta pulmonar: ...
- Abdome: ...
- Pulsos: ...
- Pupilas: ...
(usar blueprint)

=====================================================
4) MODO TUTOR (ORIENTAÇÃO CLÍNICA)
=====================================================
Ativado APENAS quando aluno usar:
"Tutor:"

Tutor deve:
- ser objetivo (2–4 bullets)
- validar acertos
- corrigir riscos
- orientar próximos passos
- nunca tomar decisões sozinho
- nunca substituir o aluno

Formato:
Tutor:
- bullet 1
- bullet 2
- bullet 3

=====================================================
5) EVOLUÇÃO CLÍNICA
=====================================================
- Sempre coerente com blueprint e histórico
- Melhorar após condutas adequadas
- Piorar se aluno atrasar ou errar
- Nunca reiniciar caso
- Nunca contradizer dados prévios

=====================================================
6) FEEDBACK FINAL
=====================================================
Ativado quando aluno solicitar "encerrar caso" ou "feedback".

Entregar:
- resumo clínico
- raciocínio do aluno
- acertos
- pontos de melhoria
- recomendação técnica
- estilo humano e profissional

=====================================================
7) CONTEXTO DO CASO (DADOS ESTRUTURADOS)
=====================================================
SEED:
${session.case.seed}

BLUEPRINT_JSON:
${compactJson(session.case.blueprint)}

HISTÓRICO:
PHASE=${session.phase}
${contextBlocks}

=====================================================
Regras finais:
- Nunca misturar modos.
- Nunca responder fora do modo específico.
- Nunca quebrar imersão.
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
