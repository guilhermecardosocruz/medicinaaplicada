import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-app text-app" />}>
      <LoginClient />
    </Suspense>
  );
}
