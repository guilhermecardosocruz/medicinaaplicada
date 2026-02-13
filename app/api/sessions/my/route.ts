import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const items = await prisma.consultSession.findMany({
    where: { userId: me.id },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      case: { select: { title: true, triage: true } },
      evaluation: { select: { score: true } },
    },
  });

  return NextResponse.json({ ok: true, items }, { status: 200 });
}
