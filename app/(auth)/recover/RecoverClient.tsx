"use client";

import Link from "next/link";
import { useState } from "react";

export default function RecoverClient() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        setError("Não foi possível solicitar recuperação agora.");
        return;
      }

      setDone(true);
    } catch {
      setError("Erro de rede ao solicitar recuperação");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
      <div className="w-full max-w-md surface-strong p-6">
        <h1 className="text-lg font-semibold">Recuperar acesso</h1>
        <p className="mt-1 text-sm text-muted">
          Informe seu e-mail para receber o link de redefinição.
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

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {done && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Se o e-mail existir, você receberá um link em instantes.
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl border border-[var(--border)] bg-card px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Enviando..." : "Enviar link"}
          </button>

          <div className="pt-2 text-xs">
            <Link className="text-muted hover:opacity-80" href="/login">
              Voltar ao login
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
