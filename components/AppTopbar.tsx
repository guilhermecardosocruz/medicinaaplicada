"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

type User = {
  id?: string;
  name?: string | null;
  email?: string | null;
};

type MeResponse =
  | { authenticated: true; user: { id: string; name: string; email: string } }
  | { authenticated: false }
  | { user?: unknown }
  | unknown;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseUserFromMePayload(payload: MeResponse): User | null {
  if (!isRecord(payload)) return null;

  const directUser = payload["user"];
  if (isRecord(directUser)) {
    const id = pickString(directUser["id"]);
    const name = pickString(directUser["name"]);
    const email = pickString(directUser["email"]);
    if (id) return { id, name: name ?? null, email: email ?? null };
  }

  const me = payload["me"];
  if (isRecord(me)) {
    const id = pickString(me["id"]);
    const name = pickString(me["name"]);
    const email = pickString(me["email"]);
    if (id) return { id, name: name ?? null, email: email ?? null };
  }

  return null;
}

export function AppTopbar() {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isAuthed = !!user?.id;

  const firstName = useMemo(() => {
    if (!user?.name) return "usuário";
    const part = String(user.name).split(" ")[0];
    return part || "usuário";
  }, [user]);

  const showAuthUI = useMemo(() => {
    return !(
      pathname?.startsWith("/login") ||
      pathname?.startsWith("/register") ||
      pathname?.startsWith("/recover") ||
      pathname?.startsWith("/reset")
    );
  }, [pathname]);

  useEffect(() => {
    let active = true;

    async function loadMe() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!active) return;

        if (!res.ok) {
          setUser(null);
          return;
        }

        const data = (await res.json().catch(() => null)) as MeResponse;
        const parsed = parseUserFromMePayload(data);
        setUser(parsed);
      } catch {
        if (!active) return;
        setUser(null);
      } finally {
        if (active) setLoaded(true);
      }
    }

    void loadMe();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!menuOpen) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      setUser(null);
      setMenuOpen(false);
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--border)] bg-card-strong backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold text-app hover:opacity-80">
          Medicina Aplicada
        </Link>

        <div className="flex items-center gap-3">
          <nav className="hidden sm:flex items-center gap-3">
            <Link href="/dashboard" className="text-xs font-medium text-muted hover:opacity-80">
              Dashboard
            </Link>

            <Link href="/desempenho" className="text-xs font-medium text-muted hover:text-app">
              Desempenho
            </Link>

            <Link href="/retornos" className="text-xs font-medium text-muted hover:text-app">
              Retornos
            </Link>

            {showAuthUI && (
              <>
                {!loaded && <span className="text-[11px] text-muted">Carregando...</span>}

                {loaded && isAuthed && (
                  <>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-card px-3 py-1.5 text-[11px] font-semibold text-app">
                      <span>Olá, {firstName}</span>
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    </span>

                    <button
                      type="button"
                      onClick={handleLogout}
                      className="text-xs font-medium text-red-400 hover:text-red-500"
                    >
                      Sair
                    </button>
                  </>
                )}

                {loaded && !isAuthed && (
                  <Link
                    href={`/login?next=${encodeURIComponent(pathname || "/dashboard")}`}
                    className="text-xs font-semibold text-emerald-400 hover:text-emerald-500"
                  >
                    Entrar
                  </Link>
                )}
              </>
            )}
          </nav>

          {showAuthUI && (
            <div className="relative sm:hidden" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-card px-3 py-1.5 text-xs font-semibold text-app"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span>Menu</span>
                {loaded && isAuthed && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-[var(--border)] bg-card shadow-xl overflow-hidden">
                  <div className="px-4 py-3">
                    {loaded ? (
                      isAuthed ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-app">Olá, {firstName}</span>
                          <span className="flex items-center gap-2 text-[11px] text-muted">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            Logado
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-app">Você não está logado</span>
                          <span className="text-[11px] text-muted">Visitante</span>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-muted">Carregando...</span>
                    )}
                  </div>

                  <div className="h-px bg-[var(--border)]" />

                  <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-xs font-medium hover:bg-card/70">
                    Dashboard
                  </Link>
                  <Link href="/desempenho" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-xs font-medium hover:bg-card/70">
                    Desempenho
                  </Link>
                  <Link href="/retornos" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-xs font-medium hover:bg-card/70">
                    Retornos
                  </Link>

                  <div className="h-px bg-[var(--border)]" />

                  {isAuthed ? (
                    <button onClick={handleLogout} className="w-full px-4 py-3 text-left text-xs font-semibold text-red-400 hover:bg-card/70">
                      Sair
                    </button>
                  ) : (
                    <Link
                      href={`/login?next=${encodeURIComponent(pathname || "/dashboard")}`}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-3 text-xs font-semibold text-emerald-400 hover:bg-card/70"
                    >
                      Entrar
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
