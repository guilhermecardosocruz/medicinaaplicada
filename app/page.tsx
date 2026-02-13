import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const store = await cookies();
  const session = store.get("session")?.value;

  if (!session) {
    redirect("/login");
  }

  redirect("/dashboard");
}
