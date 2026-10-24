// Day 13 quiz certificates: stores the name and score a visitor chose to put on their certificate.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED = ["https://kowshik.co.in", "https://www.kowshik.co.in", "https://kowshik46.github.io"];

// Approximate country from the browser time zone (no IP lookup).
const TZ_COUNTRY: Record<string, string> = {"Asia/Kolkata":"IN","Asia/Calcutta":"IN","America/New_York":"US","America/Chicago":"US","America/Denver":"US","America/Los_Angeles":"US","America/Phoenix":"US","America/Anchorage":"US","Pacific/Honolulu":"US","America/Toronto":"CA","America/Vancouver":"CA","America/Edmonton":"CA","America/Halifax":"CA","America/Mexico_City":"MX","America/Sao_Paulo":"BR","America/Argentina/Buenos_Aires":"AR","America/Bogota":"CO","America/Lima":"PE","America/Santiago":"CL","Europe/London":"GB","Europe/Dublin":"IE","Europe/Paris":"FR","Europe/Berlin":"DE","Europe/Madrid":"ES","Europe/Rome":"IT","Europe/Amsterdam":"NL","Europe/Brussels":"BE","Europe/Zurich":"CH","Europe/Vienna":"AT","Europe/Stockholm":"SE","Europe/Oslo":"NO","Europe/Copenhagen":"DK","Europe/Helsinki":"FI","Europe/Warsaw":"PL","Europe/Prague":"CZ","Europe/Lisbon":"PT","Europe/Athens":"GR","Europe/Istanbul":"TR","Europe/Kiev":"UA","Europe/Kyiv":"UA","Europe/Moscow":"RU","Asia/Dubai":"AE","Asia/Riyadh":"SA","Asia/Tehran":"IR","Asia/Karachi":"PK","Asia/Dhaka":"BD","Asia/Colombo":"LK","Asia/Kathmandu":"NP","Asia/Bangkok":"TH","Asia/Ho_Chi_Minh":"VN","Asia/Jakarta":"ID","Asia/Kuala_Lumpur":"MY","Asia/Singapore":"SG","Asia/Manila":"PH","Asia/Hong_Kong":"HK","Asia/Shanghai":"CN","Asia/Taipei":"TW","Asia/Seoul":"KR","Asia/Tokyo":"JP","Australia/Sydney":"AU","Australia/Melbourne":"AU","Australia/Brisbane":"AU","Australia/Perth":"AU","Pacific/Auckland":"NZ","Africa/Cairo":"EG","Africa/Lagos":"NG","Africa/Nairobi":"KE","Africa/Johannesburg":"ZA","Asia/Jerusalem":"IL","Asia/Tashkent":"UZ"};

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function certId() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(8));
  return "CC13-" + Array.from(b, (x) => a[x % a.length]).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST" || !origin || !ALLOWED.includes(origin)) {
    return new Response('{"error":"forbidden"}', { status: 403, headers });
  }
  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) return new Response('{"error":"not configured"}', { status: 500, headers });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }

  // Honeypot: real people leave this hidden field empty. Pretend success to bots.
  if (typeof body.website === "string" && body.website.length > 0) return new Response(JSON.stringify({ cert_id: certId() }), { status: 200, headers });

  const name = clip(body.name, 60)?.replace(/[\u0000-\u001f<>]/g, "");
  const score = int(body.score), total = int(body.total);
  if (!name || name.length < 2 || !(total > 0 && total <= 100 && score >= 0 && score <= total)) {
    return new Response('{"error":"missing"}', { status: 400, headers });
  }
  let stages: Record<string, unknown> | null = null;
  if (body.stages && typeof body.stages === "object" && !Array.isArray(body.stages)) {
    stages = {};
    for (const [k, v] of Object.entries(body.stages as Record<string, unknown>).slice(0, 8)) stages[k.slice(0, 20)] = clip(v, 10);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipHash = ip ? await sha256(salt + ":" + ip) : null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Rate limit: 10 certificates per IP per hour.
  if (ipHash) {
    const since = new Date(Date.now() - 3600e3).toISOString();
    const { count } = await supabase.from("quiz_certs").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", since);
    if ((count ?? 0) >= 10) return new Response('{"error":"slow down"}', { status: 429, headers });
  }

  const tz = clip(body.tz, 60);
  const cert_id = certId();
  const { error } = await supabase.from("quiz_certs").insert({
    cert_id,
    quiz: clip(body.quiz, 20) ?? "day-13",
    name,
    score,
    total,
    title: clip(body.title, 60),
    stages,
    utm_source: clip(body.utm_source, 60),
    utm_campaign: clip(body.utm_campaign, 60),
    referrer: clip(body.referrer, 300),
    browser: clip(body.browser, 60),
    country: tz ? TZ_COUNTRY[tz] ?? null : null,
    ip_hash: ipHash,
  });
  if (error) return new Response('{"error":"db"}', { status: 500, headers });
  return new Response(JSON.stringify({ cert_id }), { status: 200, headers });
});
