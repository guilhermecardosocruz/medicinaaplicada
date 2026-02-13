"use client";

import { useEffect, type ReactNode } from "react";

type Props = { children: ReactNode };

export function ThemeProvider({ children }: Props) {
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
  }, []);

  return <>{children}</>;
}
