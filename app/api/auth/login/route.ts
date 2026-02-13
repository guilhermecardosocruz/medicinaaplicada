/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import { validateLogin } from "@/lib/auth";
import { buildSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    const user = await validateLogin(email, password);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Credenciais inválidas" },
        { status: 401 },
      );
    }

    const sessionCookie = buildSessionCookie({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    const res = NextResponse.json({ success: true, user }, { status: 200 });
    res.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);
    return res;
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return NextResponse.json(
        { success: false, errors: err.flatten().fieldErrors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, message: "Erro ao fazer login" },
      { status: 400 },
    );
  }
}
