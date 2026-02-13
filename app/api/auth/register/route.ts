/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation";
import { registerUser } from "@/lib/auth";
import { buildSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();

    const safeBody = {
      ...rawBody,
      confirmPassword:
        rawBody?.confirmPassword !== undefined
          ? rawBody.confirmPassword
          : rawBody?.password,
    };

    const { name, email, password } = registerSchema.parse(safeBody);

    const user = await registerUser(name, email, password);

    const sessionCookie = buildSessionCookie({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    const res = NextResponse.json({ success: true, user }, { status: 201 });
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
      { success: false, message: err?.message ?? "Erro ao registrar" },
      { status: 400 },
    );
  }
}
