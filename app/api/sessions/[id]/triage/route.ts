import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { Prisma } from "@prisma/client";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asInputJsonValue(v: unknown): Prisma.InputJsonValue | undefined {
  // No Prisma v6, InputJsonValue não aceita null diretamente.
  if (v === null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v as unknown as Prisma.InputJsonValue;
  if (typeof v === "object" && v !== null) return v as unknown as Prisma.InputJsonValue;
  return undefined;
}

function getTriageFromBlueprint(blueprint: unknown): Record<string, unknown> | null {
  if (!isRecord(blueprint)) return null;
  const triage = blueprint["triage"];
  return isRecord(triage) ? triage : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      phase: true,
      triageData: true,
      case: { select: { blueprint: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  const triage = session.triageData ?? getTriageFromBlueprint(session.case.blueprint);

  return NextResponse.json(
    {
      ok: true,
      phase: session.phase,
      triage: triage ?? null,
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      phase: true,
      triageData: true,
      case: { select: { blueprint: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  // Se já existe triageData, só devolve.
  if (session.triageData) {
    return NextResponse.json({ ok: true, triage: session.triageData }, { status: 200 });
  }

  // Busca triage no blueprint do caso
  const triageObj = getTriageFromBlueprint(session.case.blueprint);
  if (!triageObj) {
    return NextResponse.json(
      { ok: false, message: "Este caso não possui triagem estruturada." },
      { status: 400 },
    );
  }

  const triageJson = asInputJsonValue(triageObj);
  if (!triageJson) {
    return NextResponse.json(
      { ok: false, message: "Falha ao serializar triagem para JSON." },
      { status: 500 },
    );
  }

  await prisma.consultSession.update({
    where: { id: session.id },
    data: {
      triageData: triageJson,
      // não muda phase aqui; a UI decide quando entra na consulta
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "SYSTEM",
      content: "Triagem registrada (MVP). Você pode iniciar a consulta no mesmo chat.",
    },
  });

  return NextResponse.json({ ok: true, triage: triageJson }, { status: 200 });
}
