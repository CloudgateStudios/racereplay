import { ImageResponse } from "next/og";
import { loadOgFonts } from "@/lib/og-fonts";
import { OgCard } from "@/lib/og-card";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    <OgCard
      centered
      title="Race Replay"
      subtitle="See every pass, know your race."
    />,
    { width: 1200, height: 630, fonts }
  );
}
