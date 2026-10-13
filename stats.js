// Pure aggregation: turns raw page_views / page_events rows into dashboard numbers.
const EXCLUDED = (p) => !p || p === '/test' || p.startsWith('/test/');
const top = (map, n = 10) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); };
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const host = (r) => { if (!r) return 'Direct'; try { return new URL(r).hostname.replace(/^www\./, '') || 'Direct'; } catch { return r; } };
const istDay = (s) => String(s).slice(0, 10);
const istHour = (s) => Number(String(s).slice(11, 13));

function compute(views, events, days) {
  views = views.filter((v) => !EXCLUDED(v.path));
  events = events.filter((e) => !EXCLUDED(e.path));
  const uniq = new Set(views.map((v) => v.ip_hash));
  const perDay = new Map(), perDayUniq = new Map(), hours = new Array(24).fill(0);
  const pages = new Map(), countries = new Map(), refs = new Map(), campaigns = new Map();
  const devices = new Map(), browsers = new Map(), langs = new Map();
  const pageUniq = new Map();
  for (const v of views) {
    const d = istDay(v.created_at_ist);
    bump(perDay, d);
    if (!perDayUniq.has(d)) perDayUniq.set(d, new Set());
    perDayUniq.get(d).add(v.ip_hash);
    hours[istHour(v.created_at_ist)]++;
    bump(pages, v.path);
    if (!pageUniq.has(v.path)) pageUniq.set(v.path, new Set());
    pageUniq.get(v.path).add(v.ip_hash);
    bump(countries, v.country || 'Unknown');
    bump(refs, v.utm_source ? `${v.utm_source} (utm)` : host(v.referrer));
    if (v.utm_campaign) bump(campaigns, v.utm_campaign);
    bump(devices, v.device_type || 'Unknown');
    bump(browsers, v.browser || 'Unknown');
    bump(langs, v.language || 'Unknown');
  }
  // Continuous day series (IST), filling zero days.
  const series = [];
  const last = new Date(Date.now() + 5.5 * 3600e3);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(last.getTime() - i * 864e5).toISOString().slice(0, 10);
    series.push({ day: d, views: perDay.get(d) || 0, visitors: perDayUniq.get(d)?.size || 0 });
  }
  const engage = events.filter((e) => e.event_type === 'engage');
  const secs = engage.map((e) => e.seconds).filter((n) => Number.isFinite(n));
  const scrolls = engage.map((e) => e.scroll_pct).filter((n) => Number.isFinite(n));
  const byPath = new Map();
  for (const e of engage) {
    if (!byPath.has(e.path)) byPath.set(e.path, { s: [], c: [] });
    if (Number.isFinite(e.seconds)) byPath.get(e.path).s.push(e.seconds);
    if (Number.isFinite(e.scroll_pct)) byPath.get(e.path).c.push(e.scroll_pct);
  }
  const clicks = new Map();
  for (const e of events) if (e.event_type === 'click' && e.target) bump(clicks, e.target);
  const articles = [...pages.keys()].filter((p) => /^\/claude-code\/day-\d+\/?$/.test(p)).sort().map((p) => ({
    path: p, views: pages.get(p), visitors: pageUniq.get(p).size,
    avgSeconds: avg(byPath.get(p)?.s || []), avgScroll: avg(byPath.get(p)?.c || []),
  }));
  const peak = hours.indexOf(Math.max(...hours));
  const busiestDay = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const repeat = [...views.reduce((m, v) => (bump(m, v.ip_hash), m), new Map()).values()].filter((n) => n > 1).length;
  return {
    totals: { views: views.length, visitors: uniq.size, returning: repeat, countries: countries.size },
    series, hours, topPages: top(pages), countries: top(countries), referrers: top(refs), campaigns: top(campaigns),
    devices: top(devices), browsers: top(browsers), languages: top(langs, 5),
    engagement: { avgSeconds: avg(secs), medianSeconds: median(secs), avgScroll: avg(scrolls), fullReads: scrolls.filter((n) => n >= 90).length, sessions: scrolls.length },
    clicks: top(clicks, 8), articles,
    fun: {
      busiestHourIST: views.length ? peak : null,
      busiestDay: busiestDay ? { day: busiestDay[0], views: busiestDay[1] } : null,
      viewsPerVisitor: uniq.size ? +(views.length / uniq.size).toFixed(2) : 0,
      topCountry: top(countries, 1)[0]?.name || null,
    },
  };
}
module.exports = { compute };
