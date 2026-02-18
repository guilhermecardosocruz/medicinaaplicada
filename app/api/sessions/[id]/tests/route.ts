import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { Prisma } from "@prisma/client";

type CatalogItem = { key: string; label: string };

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

function getCatalog(blueprint: unknown): CatalogItem[] {
  if (!isRecord(blueprint)) return [];
  const tests = blueprint["tests"];
  if (!isRecord(tests)) return [];
  const cat = tests["catalog"];
  if (!Array.isArray(cat)) return [];

  const out: CatalogItem[] = [];
  for (const item of cat) {
    if (isRecord(item) && typeof item.key === "string" && typeof item.label === "string") {
      out.push({ key: item.key, label: item.label });
    }
  }
  return out;
}

function getResults(blueprint: unknown): Record<string, unknown> | null {
  if (!isRecord(blueprint)) return null;
  const tests = blueprint["tests"];
  if (!isRecord(tests)) return null;
  const r = tests["results"];
  return isRecord(r) ? r : null;
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
      orders: true,
      results: true,
      case: { select: { blueprint: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  const catalog = getCatalog(session.case.blueprint);

  return NextResponse.json(
    {
      ok: true,
      phase: session.phase,
      catalog,
      orders: session.orders ?? null,
      results: session.results ?? null,
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = getSessionUser(req);
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { keys?: unknown } | null;
  const keys = Array.isArray(body?.keys) ? body?.keys.filter((k) => typeof k === "string") : [];
  if (keys.length === 0) {
    return NextResponse.json({ ok: false, message: "Informe keys dos exames." }, { status: 400 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id, userId: me.id },
    select: {
      id: true,
      phase: true,
      orders: true,
      results: true,
      case: { select: { blueprint: true } },
    },
  });

  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  const catalog = getCatalog(session.case.blueprint);
  const allowedKeys = new Set(catalog.map((c) => c.key));
  const filtered = keys.filter((k) => allowedKeys.has(k));

  if (filtered.length === 0) {
    return NextResponse.json({ ok: false, message: "Nenhum exame válido." }, { status: 400 });
  }

  const currentOrders = isRecord(session.orders) ? session.orders : { ordered: [] as string[] };
  const orderedArr = Array.isArray(currentOrders["ordered"])
    ? (currentOrders["ordered"] as unknown[]).filter((v) => typeof v === "string") as string[]
    : [];

  const already = new Set(orderedArr);
  const newly = filtered.filter((k) => !already.has(k));

  const nextOrdersObject: Record<string, unknown> = {
    ordered: Array.from(new Set([...orderedArr, ...filtered])),
  };

  const blueprintResults = getResults(session.case.blueprint);
  const currentResults = isRecord(session.results) ? session.results : {};
  const nextResultsObject: Record<string, unknown> = { ...currentResults };

  for (const k of newly) {
    const val = blueprintResults?.[k];
    if (typeof val === "string") nextResultsObject[k] = val;
    else nextResultsObject[k] = "Resultado indisponível.";
  }

  const nextOrders = asInputJsonValue(nextOrdersObject);
  const nextResults = asInputJsonValue(nextResultsObject);

  if (!nextOrders || !nextResults) {
    return NextResponse.json(
      { ok: false, message: "Falha ao serializar orders/results para JSON." },
      { status: 500 },
    );
  }

  await prisma.consultSession.update({
    where: { id: session.id },
    data: {
      orders: nextOrders,
      results: nextResults,
      phase: session.phase === "TRIAGE" ? "CONSULT" : session.phase,
    },
  });

  const labelByKey = new Map<string, string>(catalog.map((c) => [c.key, c.label]));
  const orderedLabels = newly.map((k) => labelByKey.get(k) ?? k).join(", ");

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "SYSTEM",
      content: `Exames solicitados: ${orderedLabels}\n\nResultados liberados (MVP). Abra a seção “Exames” para revisar.`,
    },
  });

  return NextResponse.json(
    { ok: true, orders: nextOrders, results: nextResults, newly },
    { status: 200 },
  );
}
