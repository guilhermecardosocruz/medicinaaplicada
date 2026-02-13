import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PwaProvider } from "@/components/PwaProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export const metadata: Metadata = {
  title: "Medicina Aplicada",
  description: "Treinamento de consultas simuladas para estudantes de medicina",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-app text-app">
        <PwaProvider />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
