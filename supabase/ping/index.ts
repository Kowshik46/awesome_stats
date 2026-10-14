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

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const int = (v: unknown, max: number) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null);

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST" || !origin || !ALLOWED.includes(origin)) {
    return new Response("forbidden", { status: 403, headers });
  }

  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) return new Response("not configured", { status: 500, headers });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") || "";
  const ipHash = ip ? await sha256(salt + ":" + ip) : null;
  // Random per-browser ID from the site script, stored only as a salted hash.
  const vid = clip(body.visitor_id, 80);
  const visitorHash = vid ? await sha256(salt + ":vid:" + vid) : null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const type = body.type;
  let error;
  if (type === "engage" || type === "click") {
    ({ error } = await supabase.from("page_events").insert({
      view_id: clip(body.view_id, 40),
      ip_hash: ipHash,
      visitor_hash: visitorHash,
      path: clip(body.path, 300),
      event_type: type,
      seconds: int(body.seconds, 86400),
      scroll_pct: int(body.scroll_pct, 100),
      target: clip(body.target, 300),
    }));
  } else {
    const tz = clip(body.timezone, 60);
    ({ error } = await supabase.from("page_views").insert({
      view_id: clip(body.view_id, 40),
      ip_hash: ipHash,
      visitor_hash: visitorHash,
      country: tz ? TZ_COUNTRY[tz] ?? null : null,
      path: clip(body.path, 300),
      referrer: clip(body.referrer, 300),
      browser: clip(body.browser, 60),
      device_type: clip(body.device_type, 20),
      screen: clip(body.screen, 20),
      language: clip(body.language, 20),
      timezone: tz,
      utm_source: clip(body.utm_source, 80),
      utm_medium: clip(body.utm_medium, 80),
      utm_campaign: clip(body.utm_campaign, 80),
    }));
  }
  return new Response(error ? "error" : "ok", { status: error ? 500 : 200, headers });
});
