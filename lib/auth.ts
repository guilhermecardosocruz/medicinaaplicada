import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function registerUser(name: string, email: string, password: string) {
  const normalizedEmail = email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    throw new Error("E-mail já cadastrado");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email: normalizedEmail,
      passwordHash,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  return user;
}

export async function validateLogin(email: string, password: string) {
  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

export async function createResetToken(email: string) {
  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    // em produção, não revelamos se o e-mail existe
    return null;
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  return token;
}

export async function resetPassword(token: string, newPassword: string) {
  const reset = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!reset) {
    throw new Error("Token inválido ou expirado");
  }

  if (reset.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({
      where: { token },
    });
    throw new Error("Token expirado");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  const updatedUser = await prisma.user.update({
    where: { id: reset.userId },
    data: { passwordHash },
    select: {
      id: true,
      email: true,
    },
  });

  await prisma.passwordResetToken.delete({
    where: { token },
  });

  return updatedUser;
}
