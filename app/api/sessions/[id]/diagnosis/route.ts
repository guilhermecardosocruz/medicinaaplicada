import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = await req.json().catch(() => null) as {
    diagnosis?: string;
    justification?: string;
  } | null;

  const diagnosis = body?.diagnosis?.trim();
  const justification = body?.justification?.trim();

  if (!diagnosis || !justification) {
    return NextResponse.json({ ok: false, message: "Dados inválidos" }, { status: 400 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    include: { evaluation: true },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  if (session.evaluation) {
    return NextResponse.json({ ok: false, message: "Já existe avaliação" }, { status: 400 });
  }

  await prisma.evaluation.create({
    data: {
      sessionId: session.id,
      score: 0,
      feedback: "",
      strengths: [],
      weaknesses: [],
      improvements: [],
    },
  });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "WAITING_EVAL" },
  });

  return NextResponse.json({ ok: true });
}
