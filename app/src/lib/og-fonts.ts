/**
 * Loads Barlow Condensed font data for use in next/og ImageResponse.
 * Fetches are cached by Next.js for 24 hours so repeated OG renders are fast.
 */
async function fetchGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const api = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  // No User-Agent → Google Fonts returns TTF, which is what Satori requires.
  // A modern Chrome UA would return woff2, which Satori cannot parse.
  const css = await fetch(api, { next: { revalidate: 86400 } }).then((r) => r.text());

  const url = css.match(/src: url\((.+?)\) format\('truetype'\)/)?.[1];
  if (!url) throw new Error(`Could not parse font URL for ${family} ${weight}`);

  return fetch(url, { next: { revalidate: 86400 } }).then((r) => r.arrayBuffer());
}

export async function loadOgFonts() {
  const [w400, w700, w900] = await Promise.all([
    fetchGoogleFont("Barlow Condensed", 400),
    fetchGoogleFont("Barlow Condensed", 700),
    fetchGoogleFont("Barlow Condensed", 900),
  ]);

  return [
    { name: "Barlow Condensed", data: w400, weight: 400 as const, style: "normal" as const },
    { name: "Barlow Condensed", data: w700, weight: 700 as const, style: "normal" as const },
    { name: "Barlow Condensed", data: w900, weight: 900 as const, style: "normal" as const },
  ];
}
