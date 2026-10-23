const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compute, visitRows } = require('./stats');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD, SESSION_SECRET } = process.env;
const PORT = process.env.PORT || 3000;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD, SESSION_SECRET }))
  if (!v) { console.error(`Missing env var ${k}`); process.exit(1); }

// Sessions: a browser-session cookie (gone when the browser closes), signed with a key that includes a
// random per-process value, so every Render restart or spin-down after inactivity logs everyone out.
// Also an idle timeout (sliding) and a hard maximum lifetime.
const BOOT = crypto.randomBytes(16).toString('hex');
const IDLE_MS = 15 * 60e3, MAX_MS = 4 * 3600e3;
const sign = (s) => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('hex');
const sig = (s) => crypto.createHmac('sha256', SESSION_SECRET + BOOT).update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const makeToken = (iat = Date.now()) => { const p = `${iat}.${Date.now()}`; return `${p}.${sig(p)}`; };
const sessionOf = (t) => {
  const [iat, last, s] = String(t || '').split('.');
  if (!s || !safeEq(s, sig(`${iat}.${last}`))) return null;
  const now = Date.now();
  return now - Number(last) < IDLE_MS && now - Number(iat) < MAX_MS ? Number(iat) : null;
};
const sessionCookie = (iat) => `session=${makeToken(iat)}; HttpOnly; Secure; SameSite=Strict; Path=/`;
const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)));

// Login throttle: 5 failures per IP per 15 minutes.
const fails = new Map();
const blocked = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < 9e5).length >= 5;

async function fetchAll(table, columns, sinceIso) {
  const rows = [];
  for (let from = 0; from < 200000; from += 1000) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}&created_at=gte.${encodeURIComponent(sinceIso)}&order=id.asc`;
    const r = await fetch(url, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`Supabase ${table}: ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

const VIEW_COLS = 'id,created_at_ist,ip_hash,visitor_hash,country,path,referrer,browser,device_type,language,utm_source,utm_campaign';
let vcache = new Map();
async function visits(days) {
  const hit = vcache.get(days);
  if (hit && Date.now() - hit.t < 30e3) return hit.v;
  const views = await fetchAll('page_views', VIEW_COLS, new Date(Date.now() - days * 864e5).toISOString());
  const v = { rows: visitRows(views), days, generatedAt: new Date().toISOString() };
  vcache.set(days, { t: Date.now(), v });
  return v;
}

let cache = new Map();
async function stats(days) {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.t < 30e3) return hit.v;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [views, events] = await Promise.all([
    fetchAll('page_views', 'id,created_at_ist,ip_hash,visitor_hash,country,path,referrer,browser,device_type,language,utm_source,utm_campaign', since),
    fetchAll('page_events', 'id,created_at,path,event_type,seconds,scroll_pct,target', since),
  ]);
  // page_events only has UTC created_at; derive IST wall-clock like page_views.created_at_ist.
  for (const e of events) e.created_at_ist = new Date(new Date(e.created_at).getTime() + 5.5 * 3600e3).toISOString().slice(0, 19);
  const v = { ...compute(views, events, days), generatedAt: new Date().toISOString(), days };
  cache.set(days, { t: Date.now(), v });
  return v;
}

const sbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
async function reports() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/step_reports?select=id,created_at_ist,path,what_broke,expected,email,version,browser,status&order=id.desc&limit=500`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase step_reports: ${r.status}`);
  return r.json();
}
async function setReportStatus(id, status) {
  if (!Number.isInteger(id) || !['new', 'fixed', 'wontfix'].includes(status)) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/step_reports?id=eq.${id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  return r.ok;
}

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(body);
};
const file = (res, name, type) => send(res, 200, fs.readFileSync(path.join(__dirname, 'public', name)), { 'Content-Type': type });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (url.pathname === '/healthz') return send(res, 200, `ok ${(process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7)} routes=visits,reports`);
    if (url.pathname === '/login' && req.method === 'POST') {
      if (blocked(ip)) return send(res, 429, 'Too many attempts. Try again later.');
      let body = ''; for await (const c of req) { body += c; if (body.length > 1e4) break; }
      const pw = new URLSearchParams(body).get('password') || '';
      if (safeEq(sign(pw), sign(ADMIN_PASSWORD))) {
        return send(res, 302, '', { Location: '/', 'Set-Cookie': sessionCookie() });
      }
      fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
      return send(res, 302, '', { Location: '/login?e=1' });
    }
    if (url.pathname === '/login') return file(res, 'login.html', 'text/html; charset=utf-8');
    if (url.pathname === '/logout') return send(res, 302, '', { Location: '/login', 'Set-Cookie': 'session=; Max-Age=0; Path=/' });
    const iat = sessionOf(cookieOf(req).session);
    if (iat == null) {
      return url.pathname.startsWith('/api/') ? send(res, 401, '{"error":"auth"}', { 'Content-Type': 'application/json' }) : send(res, 302, '', { Location: '/login' });
    }
    res.setHeader('Set-Cookie', sessionCookie(iat));
    if (url.pathname === '/api/session') return send(res, 200, JSON.stringify({ started: iat, now: Date.now(), idleMs: IDLE_MS, maxMs: MAX_MS }), { 'Content-Type': 'application/json' });
    if (url.pathname === '/session.js') return file(res, 'session.js', 'application/javascript; charset=utf-8');
    if (url.pathname === '/api/stats') {
      const days = [7, 30, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
      return send(res, 200, JSON.stringify(await stats(days)), { 'Content-Type': 'application/json' });
    }
    if (url.pathname === '/api/visits') {
      const days = [7, 30, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
      return send(res, 200, JSON.stringify(await visits(days)), { 'Content-Type': 'application/json' });
    }
    if (url.pathname === '/api/reports' && req.method === 'GET') return send(res, 200, JSON.stringify(await reports()), { 'Content-Type': 'application/json' });
    if (url.pathname === '/api/reports/status' && req.method === 'POST') {
      let body = ''; for await (const c of req) { body += c; if (body.length > 1e4) break; }
      let j = {}; try { j = JSON.parse(body); } catch {}
      const ok = await setReportStatus(Number(j.id), j.status);
      return send(res, ok ? 200 : 400, JSON.stringify({ ok }), { 'Content-Type': 'application/json' });
    }
    if (url.pathname === '/reports') return file(res, 'reports.html', 'text/html; charset=utf-8');
    if (url.pathname === '/visits') return file(res, 'visits.html', 'text/html; charset=utf-8');
    if (url.pathname === '/') return file(res, 'index.html', 'text/html; charset=utf-8');
    send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    send(res, 500, '{"error":"server"}', { 'Content-Type': 'application/json' });
  }
}).listen(PORT, () => console.log(`Dashboard on :${PORT}`));
