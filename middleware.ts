import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "session";

// Rotas públicas (não exigir login)
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/recover",
  "/reset",
  "/api/auth",
  "/_next",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons",
  "/public",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // ignora rotas públicas
  if (isPublicPath(pathname)) return NextResponse.next();

  // permite APIs (exceto as de auth já estão liberadas acima)
  if (pathname.startsWith("/api")) return NextResponse.next();

  // regra: qualquer rota "do app" deve exigir sessão
  // (neste MVP, vamos exigir sessão para tudo fora do auth)
  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!session) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname + (search ?? ""));
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
