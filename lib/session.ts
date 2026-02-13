import type { NextRequest } from "next/server";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

const SESSION_COOKIE_NAME = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 dias

function decodeSession(raw: string): SessionUser | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const data = JSON.parse(json) as Partial<SessionUser>;

    if (
      !data ||
      typeof data.id !== "string" ||
      typeof data.name !== "string" ||
      typeof data.email !== "string"
    ) {
      return null;
    }

    return {
      id: data.id,
      name: data.name,
      email: data.email,
    };
  } catch {
    return null;
  }
}

export function getSessionUser(req: NextRequest): SessionUser | null {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  return decodeSession(cookie);
}

export function buildSessionCookie(user: SessionUser) {
  const json = JSON.stringify(user);
  const token = Buffer.from(json, "utf-8").toString("base64url");

  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  };
}
