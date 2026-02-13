import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "session";

export async function POST() {
  const res = NextResponse.json({ success: true }, { status: 200 });

  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}
