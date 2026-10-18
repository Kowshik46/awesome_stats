// Session bar: time on page, idle countdown (resets on activity) and hard session limit.
(function () {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;padding:6px 12px;background:#0f0f18ee;border-bottom:1px solid #24243a;font:12px/1.4 Inter,system-ui,sans-serif;color:#9a9ab3;backdrop-filter:blur(6px)';
  document.body.prepend(bar);
  const fmt = (ms) => { ms = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(ms / 3600), m = Math.floor(ms % 3600 / 60), s = ms % 60; const p = (n) => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : m) + ':' + p(s); };
  const span = (label, id) => `<span>${label} <b id="${id}" style="color:#e8e8f0;font-variant-numeric:tabular-nums">–</b></span>`;
  bar.innerHTML = span('On this page', 'sb-page') + span('Auto-logout in', 'sb-idle') + span('Session ends in', 'sb-max') + '<a href="/logout" style="color:#818cf8;text-decoration:none">Log out</a>';
  const $ = (id) => document.getElementById(id);
  let idle = 15 * 60e3, max = 4 * 3600e3, started = Date.now(), skew = 0;
  const pageStart = Date.now();
  let lastActive = Date.now(), lastPing = 0;
  const ping = () => { lastPing = Date.now(); fetch('/api/session').then((r) => r.ok ? r.json() : (location.href = '/login')).then((d) => { if (d) { idle = d.idleMs; max = d.maxMs; started = d.started; skew = d.now - Date.now(); } }).catch(() => {}); };
  ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach((e) => addEventListener(e, () => { lastActive = Date.now(); if (Date.now() - lastPing > 60e3) ping(); }, { passive: true }));
  ping();
  setInterval(() => {
    const now = Date.now(), idleLeft = idle - (now - lastActive), maxLeft = max - (now + skew - started);
    $('sb-page').textContent = fmt(now - pageStart);
    $('sb-idle').textContent = fmt(idleLeft);
    $('sb-max').textContent = fmt(maxLeft);
    $('sb-idle').style.color = idleLeft < 60e3 ? '#f87171' : '#e8e8f0';
    $('sb-max').style.color = maxLeft < 300e3 ? '#f87171' : '#e8e8f0';
    if (idleLeft <= 0 || maxLeft <= 0) location.href = '/logout';
  }, 1000);
})();
