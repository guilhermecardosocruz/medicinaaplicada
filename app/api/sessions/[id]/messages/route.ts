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

function detectAssistantRole(content: string) {
  const normalized = content.trim().toLowerCase();

  if (
    normalized.startsWith("equipe:") ||
    normalized.startsWith("ecg:") ||
    normalized.startsWith("laudo:") ||
    normalized.startsWith("resultados laboratoriais:")
  ) {
    return "COORDINATOR_AI" as const;
  }

  if (
    normalized.startsWith("tutor:") ||
    normalized.startsWith("exame físico:")
  ) {
    return "COORDINATOR_AI" as const;
  }

  return "PATIENT_AI" as const;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);

  if (!me) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { id } = await ctx.params;

  const session = await prisma.consultSession.findFirst({
    where: {
      id,
      userId: me.id,
    },
    select: {
      id: true,
      status: true,
      phase: true,
      triageData: true,
      physicalData: true,
      orders: true,
      results: true,
      followup: true,

      case: {
        select: {
          title: true,
          triage: true,
        },
      },

      evaluation: {
        select: {
          score: true,
          feedback: true,
          strengths: true,
          weaknesses: true,
          improvements: true,
          studentDiagnosis: true,
          clinicalJustification: true,
          correctDiagnosis: true,
          diagnosisCorrect: true,
          communication: true,
          anamnesis: true,
          reasoning: true,
          safety: true,
          exams: true,
          closing: true,
          organization: true,
        },
      },

      messages: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      session,
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);

  if (!me) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as {
    content?: unknown;
  } | null;

  const content =
    typeof body?.content === "string"
      ? body.content.trim()
      : "";

  if (!content) {
    return NextResponse.json(
      {
        ok: false,
        message: "Mensagem vazia.",
      },
      { status: 400 },
    );
  }

  const session = await prisma.consultSession.findFirst({
    where: {
      id,
      userId: me.id,
    },

    select: {
      id: true,
      status: true,
      phase: true,
      triageData: true,
      physicalData: true,
      orders: true,
      results: true,
      followup: true,

      case: {
        select: {
          seed: true,
          title: true,
          blueprint: true,
        },
      },

      messages: {
        orderBy: {
          createdAt: "asc",
        },

        select: {
          role: true,
          content: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (session.status !== "IN_PROGRESS") {
    return NextResponse.json(
      {
        ok: false,
        message: "Sessão não está em andamento.",
      },
      { status: 400 },
    );
  }

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "STUDENT",
      content,
    },
  });

  const last = [
    ...session.messages,
    {
      role: "STUDENT" as const,
      content,
    },
  ].slice(-12);

  const contextBlocks = [
    session.triageData
      ? `TRIAGEM_COLETADA=${compactJson(session.triageData)}`
      : "",

    session.physicalData
      ? `EXAME_FISICO_REVELADO=${compactJson(session.physicalData)}`
      : "",

    session.orders
      ? `EXAMES_SOLICITADOS_HIST=${compactJson(session.orders)}`
      : "",

    session.results
      ? `RESULTADOS_HISTORICOS=${compactJson(session.results)}`
      : "",

    session.followup
      ? `RETORNO=${compactJson(session.followup)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const triageAlreadyShown = session.messages.some(
    (m) =>
      m.content.includes("TRIAGEM INICIAL") ||
      m.content.includes("Pode iniciar a abordagem, doutor."),
  );

  const triageFlag = triageAlreadyShown ? "SIM" : "NAO";

  const system = `
Você está em um SIMULADOR CLÍNICO realista, imersivo e educacional por chat.

TRIAGEM_JA_MOSTRADA=${triageFlag}

OBJETIVO
Criar uma experiência fiel a um atendimento médico real, com quatro modos:
- Paciente
- Equipe
- Licença
- Tutor

REGRAS FUNDAMENTAIS
- Responda SEMPRE em português do Brasil.
- Nunca diga que é IA.
- Nunca explique a simulação fora do contexto.
- Nunca quebre a imersão.
- Nunca avance etapas sozinho.
- Responda somente ao que o aluno perguntou ou solicitou naquela mensagem.
- Use sempre o SEED e o BLUEPRINT_JSON como fonte principal.
- Não contradiga dados do caso.
- Não invente achados incompatíveis com o caso.
- Preserve coerência clínica durante toda a consulta.

=====================================================
0) ABERTURA OBRIGATÓRIA DA CONSULTA
=====================================================

SE, E SOMENTE SE, TRIAGEM_JA_MOSTRADA=NAO:

A primeira resposta DEVE começar com:

Equipe:
TRIAGEM INICIAL – PRONTO ATENDIMENTO

Organize em lista, com uma informação por linha:

- Nome completo do paciente:
- Idade:
- Sexo:
- Profissão:
- Motivo da admissão:
- Início e tempo de evolução dos sintomas:
- Sinais vitais:

  - PA:
  - FC:
  - FR:
  - Temperatura:
  - SpO₂:
  - Dor:
  - Glicemia, se houver:

- Classificação de risco:
- Principais red flags presentes:

Depois da triagem, escreva:

MODO DE INTERAÇÃO:
- Paciente: perguntas e falas diretamente ao paciente.
- Equipe: solicitação de exames, resultados laboratoriais, ECG e imagem.
- Licença: exame físico; retornar apenas achados objetivos.
- Tutor: ajuda de raciocínio clínico e próximos passos.

Finalize exatamente com:
"Pode iniciar a abordagem, doutor."

Depois disso:
- Nunca repita a triagem completa, a menos que o aluno peça.
- Nunca repita o bloco de modos, a menos que o aluno peça.

=====================================================
1) IDENTIFICAÇÃO DO MODO
=====================================================

Determine o modo pela primeira palavra da mensagem:

Paciente:
- Fale como paciente.

Equipe:
- Responda como equipe assistencial/laboratório/laudo.

Licença:
- Responda apenas com achados de exame físico.

Tutor:
- Responda como tutor médico.

Se a mensagem NÃO começar com nenhum prefixo:
- Trate como Paciente:.

=====================================================
2) MODO PACIENTE
=====================================================

Você deve agir como um paciente humano real.

O paciente deve:
- falar de forma simples, natural e leiga;
- responder apenas o que foi perguntado;
- demonstrar medo, dor, ansiedade ou dúvida quando coerente;
- manter sempre os mesmos dados pessoais;
- não usar termos técnicos;
- não citar diagnóstico;
- não interpretar exames;
- não falar como médico.

Evite respostas longas demais.
Evite entregar informações que não foram perguntadas.

=====================================================
3) MODO EQUIPE — EXAMES E RESULTADOS
=====================================================

Quando a mensagem começar com Equipe:, o aluno está solicitando exames, resultados ou laudos.

REGRAS:
- Sempre gerar um resultado plausível e coerente com o caso.
- Nunca negar exame.
- Mesmo se o exame não estiver explicitamente no blueprint, gerar um laudo coerente com os dados clínicos do caso.
- Ecocardiograma, ressonância, tomografia, ultrassom, raio-x e exames laboratoriais SEMPRE devem retornar algo útil.

-----------------------------------------------------
3.1 LABORATÓRIO
-----------------------------------------------------

Resultados laboratoriais:
- trazer valores
- unidade
- valor de referência

Nunca interpretar exames laboratoriais.

-----------------------------------------------------
3.2 ECG
-----------------------------------------------------

ECG:
- Ritmo:
- Frequência:
- Eixo:
- PR:
- QRS:
- QTc:
- ST:
- Onda T:
- Conclusão descritiva:

-----------------------------------------------------
3.3 IMAGEM
-----------------------------------------------------

Laudo:
- Técnica:
- Achados:
- Impressão:

=====================================================
4) MODO LICENÇA — EXAME FÍSICO
=====================================================

Quando a mensagem começar com Licença:, responder APENAS exame físico objetivo.

Sempre começar com:

Exame físico:

=====================================================
5) MODO TUTOR
=====================================================

Quando a mensagem começar com Tutor:, responder como tutor médico.

Sempre começar com:

Tutor:

- Seja objetivo
- Máximo 4 bullets
- Não entregar tudo pronto

=====================================================
6) FORMATO
=====================================================

Paciente:
...

Equipe:
...

Exame físico:
...

Tutor:
...

=====================================================
7) CONTEXTO DO CASO
=====================================================

SEED:
${session.case.seed}

BLUEPRINT_JSON:
${compactJson(session.case.blueprint)}

HISTÓRICO:
PHASE=${session.phase}

${contextBlocks}
`.trim();

  const openai = getOpenAIClient();

  const model = getOpenAIModel();

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.25,

    messages: [
      {
        role: "system",
        content: system,
      },

      ...last.map((m) => ({
        role:
          m.role === "STUDENT"
            ? ("user" as const)
            : ("assistant" as const),

        content: m.content,
      })),
    ],
  });

  const reply =
    completion.choices[0]?.message?.content?.trim() ||
    "Paciente:\nNão consegui entender bem, doutor.";

  const assistantRole = detectAssistantRole(reply);

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: assistantRole,
      content: reply,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      reply,
    },
    { status: 200 },
  );
}
