import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter no mínimo 8 caracteres")
  .regex(/[a-z]/, "A senha deve ter pelo menos uma letra minúscula")
  .regex(/[A-Z]/, "A senha deve ter pelo menos uma letra maiúscula")
  .regex(/\d/, "A senha deve ter pelo menos um número")
  .regex(
    /[^A-Za-z0-9]/,
    "A senha deve ter pelo menos um caractere especial (!@#$%&*, etc.)"
  );

export const registerSchema = z
  .object({
    name: z.string().min(3, "Nome muito curto"),
    email: z.string().email("E-mail inválido"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem",
  });

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Informe sua senha"),
});

export const recoverSchema = z.object({
  email: z.string().email("E-mail inválido"),
});

export const resetSchema = z.object({
  token: z.string().min(1, "Token inválido"),
  password: passwordSchema,
});
