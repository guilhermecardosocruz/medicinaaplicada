import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PwaProvider } from "@/components/PwaProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppTopbar } from "@/components/AppTopbar";

export const metadata: Metadata = {
  title: "Medicina Aplicada",
  description: "Treinamento clínico com IA para estudantes de medicina",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen pt-14 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50">
        <PwaProvider />
        <ThemeProvider>
          <AppTopbar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
