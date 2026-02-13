import { NextResponse } from "next/server";

export async function GET() {
  const manifest = {
    name: "Medicina Aplicada",
    short_name: "MedAplicada",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
