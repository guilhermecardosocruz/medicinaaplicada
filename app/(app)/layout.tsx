import type { ReactNode } from "react";

type Props = { children: ReactNode };

export default function AppLayout({ children }: Props) {
  return <div className="min-h-screen bg-app text-app">{children}</div>;
}
