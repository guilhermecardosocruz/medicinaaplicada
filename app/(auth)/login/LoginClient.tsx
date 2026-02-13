"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

type LoginOk = { success: true; user: { id: string; name: string; email: string } };
type LoginFail = { success: false; message?: string; errors?: Record<string, string[]> };
type LoginResult = LoginOk | LoginFail;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseLoginResult(payload: unknown): LoginResult | null {
  if (!isRecord(payload)) return null;

  const success = payload["success"];
  if (success === true) {
    const user = payload["user"];
    if (!isRecord(user)) return null;

    const id = user["id"];
    const name = user["name"];
    const email = user["email"];

    if (typeof id !== "string" || typeof name !== "string" || typeof email !== "string") return null;

    return { success: true, user: { id, name, email } };
  }

  if (success === false) {
    const message = payload["message"];
    return {
      success: false,
      message: typeof message === "string" ? message : undefined,
    };
  }

  return null;
}

export default function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();

  const nextUrl = useMemo(() => {
    const n = params.get("next");
    return n && n.startsWith("/") ? n : "/dashboard";
  }, [params]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const raw = (await res.json().catch(() => null)) as unknown;
      const data = parseLoginResult(raw);

      if (!res.ok || !data || data.success === false) {
        const msg =
          (data && data.success === false && data.message) ||
          "Não foi possível entrar. Verifique suas credenciais.";
        setError(msg);
        return;
      }

      router.push(nextUrl);
      router.refresh();
    } catch {
      setError("Erro de rede ao entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
      <div className="w-full max-w-md surface-strong p-6">
        <h1 className="text-lg font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-muted">
          Acesse sua conta para iniciar os atendimentos simulados.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted">E-mail</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2 input-app"
              placeholder="voce@exemplo.com"
              type="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted">Senha</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2 input-app"
              placeholder="********"
              type="password"
              required
            />
          </label>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl border border-[var(--border)] bg-card px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Entrando..." : "Entrar"}
          </button>

          <div className="flex items-center justify-between pt-2 text-xs">
            <Link className="text-emerald-300 hover:opacity-80" href="/register">
              Criar conta
            </Link>
            <Link className="text-muted hover:opacity-80" href="/recover">
              Esqueci minha senha
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
