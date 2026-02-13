"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RegisterOk = { success: true; user: { id: string; name: string; email: string } };
type RegisterFail = { success: false; message?: string; errors?: Record<string, string[]> };
type RegisterResult = RegisterOk | RegisterFail;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseRegisterResult(payload: unknown): RegisterResult | null {
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

export default function RegisterClient() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });

      const raw = (await res.json().catch(() => null)) as unknown;
      const data = parseRegisterResult(raw);

      if (!res.ok || !data || data.success === false) {
        const msg =
          (data && data.success === false && data.message) ||
          "Não foi possível criar sua conta.";
        setError(msg);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Erro de rede ao cadastrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
      <div className="w-full max-w-md surface-strong p-6">
        <h1 className="text-lg font-semibold">Criar conta</h1>
        <p className="mt-1 text-sm text-muted">Crie sua conta para começar a treinar.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2 input-app"
              placeholder="Seu nome"
              required
            />
          </label>

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

          <label className="block">
            <span className="text-xs font-semibold text-muted">Confirmar senha</span>
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {busy ? "Criando..." : "Criar conta"}
          </button>

          <div className="pt-2 text-xs">
            <Link className="text-muted hover:opacity-80" href="/login">
              Já tenho conta
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
