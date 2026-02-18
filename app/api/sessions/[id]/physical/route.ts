import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { Prisma } from "@prisma/client";

type SectionKey =
  | "vitals"
  | "general"
  | "heent"
  | "cardio"
  | "resp"
  | "abdomen"
  | "neuro"
  | "skin"
  | "extremities"
  | "gynUro";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringOrNull(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asInputJsonValue(v: unknown): Prisma.InputJsonValue | undefined {
  // No seu Prisma (v6), InputJsonValue não aceita null diretamente.
  if (v === null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v as unknown as Prisma.InputJsonValue;
  if (typeof v === "object" && v !== null) return v as unknown as Prisma.InputJsonValue;
  return undefined;
}

function getFromBlueprint(blueprint: unknown, section: SectionKey): unknown {
  if (!isRecord(blueprint)) return null;

  if (section === "vitals") {
    const triage = blueprint["triage"];
    if (!isRecord(triage)) return null;
    return triage["vitals"] ?? null;
  }

  const physical = blueprint["physical"];
  if (!isRecord(physical)) return null;
  return physical[section] ?? null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { section?: unknown } | null;
  const section = typeof body?.section === "string" ? body.section : "";

  const allowed: SectionKey[] = [
    "vitals",
    "general",
    "heent",
    "cardio",
    "resp",
    "abdomen",
    "neuro",
    "skin",
    "extremities",
    "gynUro",
  ];

  if (!allowed.includes(section as SectionKey)) {
    return NextResponse.json({ ok: false, message: "Seção inválida." }, { status: 400 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      phase: true,
      physicalData: true,
      case: { select: { blueprint: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  const value = getFromBlueprint(session.case.blueprint, section as SectionKey);
  if (value == null) {
    return NextResponse.json(
      { ok: false, message: "Sem achados disponíveis para esta seção." },
      { status: 400 },
    );
  }

  const current = isRecord(session.physicalData) ? session.physicalData : {};

  if (current[section] != null) {
    return NextResponse.json({ ok: true, section, value: current[section] }, { status: 200 });
  }

  // Monta o próximo objeto, mas tipa como JSON aceito pelo Prisma.
  const nextPhysicalObject: Record<string, unknown> = { ...current, [section]: value };
  const nextPhysical = asInputJsonValue(nextPhysicalObject);

  if (!nextPhysical) {
    return NextResponse.json(
      { ok: false, message: "Falha ao serializar achados para JSON." },
      { status: 500 },
    );
  }

  await prisma.consultSession.update({
    where: { id: session.id },
    data: {
      physicalData: nextPhysical,
      phase: session.phase === "TRIAGE" ? "CONSULT" : session.phase,
    },
  });

  const labelMap: Record<SectionKey, string> = {
    vitals: "Sinais vitais",
    general: "Inspeção geral",
    heent: "HEENT (olho/ouvido/garganta)",
    cardio: "Cardiovascular",
    resp: "Respiratório",
    abdomen: "Abdome",
    neuro: "Neurológico",
    skin: "Pele",
    extremities: "Extremidades",
    gynUro: "Ginecológico/Urológico",
  };

  const rendered =
    section === "vitals"
      ? JSON.stringify(value, null, 2)
      : asStringOrNull(value) ?? JSON.stringify(value, null, 2);

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "SYSTEM",
      content: `Exame físico solicitado: ${labelMap[section as SectionKey]}\n\n${rendered}`,
    },
  });

  return NextResponse.json({ ok: true, section, value }, { status: 200 });
}
