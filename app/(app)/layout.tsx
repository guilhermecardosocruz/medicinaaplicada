import type { ReactNode } from "react";
import { AppTopbar } from "@/components/AppTopbar";

type Props = {
  children: ReactNode;
};

export default function AppLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-app text-app">
      <AppTopbar />
      <main className="relative z-0 pt-14">{children}</main>
    </div>
  );
}
