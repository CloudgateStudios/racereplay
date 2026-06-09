#!/usr/bin/env node
/**
 * check-legs.mjs
 *
 * Fetches all timing points for an RTRT event and prints a leg summary.
 * Use this before scraping to verify leg names are correct and consistent
 * with what's already in the database.
 *
 * Usage:
 *   node scraper/check-legs.mjs <eventId> --appid <appid>
 *
 * Examples:
 *   node scraper/check-legs.mjs <event-id> --appid <id>
 */

const API = "https://api.rtrt.me";
const UA = "racereplay-leg-check/1.0";
const PAGE = 20; // RTRT returns up to 20 points per page

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const eventId = args.find((a) => !a.startsWith("--"));
const appidIdx = args.indexOf("--appid");
const appid = appidIdx !== -1 ? args[appidIdx + 1] : null;

if (!eventId || !appid || args[0] === "--help" || args[0] === "-h") {
  if (eventId && !appid) console.error("Error: --appid is required.\n");
  console.error("Usage: node scraper/check-legs.mjs <eventId> --appid <id>");
  process.exit(eventId && !appid ? 1 : 0);
}

// ─── RTRT Helpers ─────────────────────────────────────────────────────────────

async function rtrtFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`RTRT ${path} → HTTP ${res.status}`);
  return res.json();
}

async function register(appid) {
  const data = await rtrtFetch(`/register?appid=${appid}`);
  if (!data.token) throw new Error(`Registration failed: ${JSON.stringify(data)}`);
  return data.token;
}

async function fetchAllPoints(eventId, appid, token) {
  const qs = `appid=${appid}&token=${token}`;
  const allPoints = [];
  let start = 1;

  while (true) {
    const data = await rtrtFetch(`/events/${eventId}/points?${qs}&start=${start}`);
    if (data.error || !data.list?.length) break;
    allPoints.push(...data.list);
    if (data.list.length < PAGE) break;
    start = parseInt(data.info?.last ?? start) + 1;
    await new Promise((r) => setTimeout(r, 100));
  }

  return allPoints.sort((a, b) => parseFloat(a.km || 0) - parseFloat(b.km || 0));
}

/**
 * Same cleanLabel logic as racereplay.mjs — keep in sync if that changes.
 */
function cleanLabel(label) {
  let clean = (label || "").split("/")[0].split("|")[0].trim();
  clean = clean.replace(/\s+finish$/i, "").trim();
  if (/^(finish|start)$/i.test(clean)) return "";
  return clean;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nChecking legs for event: ${eventId}`);
  console.log(`App ID: ${appid}\n`);

  const token = await register(appid);
  const allPoints = await fetchAllPoints(eventId, appid, token);

  if (!allPoints.length) {
    console.error(`No timing points found for event "${eventId}". Check the event ID.`);
    process.exit(1);
  }

  const startPoint  = allPoints.find((p) => p.isStart === "1");
  const finishPoint = allPoints.find((p) => p.isFinish === "1");
  const isTransition = (p) => /^T\d+$/i.test(p.name) || /^T\d+$/i.test(p.label);
  const intermediate = allPoints.filter(
    (p) =>
      p.publish === "1" &&
      p.isStart !== "1" &&
      p.isFinish !== "1" &&
      (p.hide_in_badges !== "1" || isTransition(p))
  );
  const hidden = allPoints.filter(
    (p) =>
      p.publish !== "1" ||
      (p.hide_in_badges === "1" && !isTransition(p) && p.isStart !== "1" && p.isFinish !== "1")
  );

  // ── Print summary ──────────────────────────────────────────────────────────

  console.log("═══════════════════════════════════════════════════════");
  console.log(`  ${allPoints.length} total timing points`);
  console.log("═══════════════════════════════════════════════════════\n");

  const legPoints = [
    ...(startPoint ? [{ ...startPoint, role: "START" }] : []),
    ...intermediate.map((p) => ({ ...p, role: "LEG" })),
    ...(finishPoint ? [{ ...finishPoint, role: "FINISH" }] : []),
  ];

  console.log("Legs that will be used for scraping:\n");
  console.log(
    "  #  Role      Name (raw)          Label (raw)              Cleaned leg name   km"
  );
  console.log(
    "  ─  ────────  ──────────────────  ───────────────────────  ─────────────────  ────"
  );

  legPoints.forEach((p, i) => {
    const role    = p.role.padEnd(8);
    const name    = (p.name || "").padEnd(18);
    const label   = (p.label || "").padEnd(23);
    const cleaned =
      p.role === "START"
        ? "(wave start)"
        : p.role === "FINISH"
        ? "Finish"
        : cleanLabel(p.label || p.name) || `Leg ${i}`;
    const km      = p.km ?? "—";
    console.log(`  ${String(i + 1).padStart(1)}  ${role}  ${name}  ${label}  ${cleaned.padEnd(17)}  ${km}`);
  });

  if (hidden.length) {
    console.log(`\nHidden / unpublished points (excluded from scraping):\n`);
    for (const p of hidden) {
      const reason = p.publish !== "1" ? "unpublished" : "hidden_in_badges";
      console.log(`  • ${p.name} — "${p.label}" @ ${p.km ?? "?"}km  [${reason}]`);
    }
  }

  const legNames = intermediate.map((p, i) => {
    const cleaned = cleanLabel(p.label || p.name);
    return cleaned || `Leg ${i + 1}`;
  });
  legNames.push("Finish");

  console.log(`\nFinal leg names for ingest:\n  ${legNames.join(", ")}`);
  console.log();
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
