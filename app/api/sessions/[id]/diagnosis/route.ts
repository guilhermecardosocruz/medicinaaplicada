import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as {
    diagnosis?: unknown;
  } | null;

  const diagnosis = typeof body?.diagnosis === "string" ? body.diagnosis.trim() : "";

  if (!diagnosis) {
    return NextResponse.json(
      { ok: false, message: "Informe o diagnóstico e sua justificativa." },
      { status: 400 },
    );
  }

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    include: { evaluation: true },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "STUDENT",
      content: `Diagnóstico:\n${diagnosis}`,
    },
  });

  if (session.evaluation) {
    await prisma.evaluation.update({
      where: { sessionId: session.id },
      data: {
        studentDiagnosis: diagnosis,
        clinicalJustification: diagnosis,
      },
    });
  } else {
    await prisma.evaluation.create({
      data: {
        sessionId: session.id,
        score: 0,
        feedback: "",
        strengths: [],
        weaknesses: [],
        improvements: [],
        studentDiagnosis: diagnosis,
        clinicalJustification: diagnosis,
      },
    });
  }

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { status: "WAITING_EVAL" },
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
