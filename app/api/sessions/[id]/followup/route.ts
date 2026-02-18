import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

type FollowKey = "improved" | "same" | "worse" | "sideEffect";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getFollowText(blueprint: unknown, key: FollowKey) {
  if (!isRecord(blueprint)) return null;
  const followup = blueprint["followup"];
  if (!isRecord(followup)) return null;
  const v = followup[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { outcome?: unknown } | null;
  const outcome = typeof body?.outcome === "string" ? body.outcome : "";
  const allowed: FollowKey[] = ["improved", "same", "worse", "sideEffect"];

  if (!allowed.includes(outcome as FollowKey)) {
    return NextResponse.json({ ok: false, message: "Outcome inválido." }, { status: 400 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      phase: true,
      followup: true,
      status: true,
      case: { select: { blueprint: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });
  if (session.status !== "IN_PROGRESS") {
    return NextResponse.json({ ok: false, message: "Sessão não está em andamento." }, { status: 400 });
  }

  const text = getFollowText(session.case.blueprint, outcome as FollowKey);
  if (!text) {
    return NextResponse.json({ ok: false, message: "Sem texto de retorno no caso." }, { status: 400 });
  }

  const current = isRecord(session.followup) ? session.followup : {};
  const next = {
    ...current,
    lastOutcome: outcome,
    at: new Date().toISOString(),
  };

  await prisma.consultSession.update({
    where: { id: session.id },
    data: {
      followup: next,
      phase: "FOLLOWUP",
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "PATIENT_AI",
      content: text,
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "SYSTEM",
      content: "Retorno registrado dentro da mesma sessão (fase FOLLOWUP).",
    },
  });

  return NextResponse.json({ ok: true, outcome, text }, { status: 200 });
}
