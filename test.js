const assert = require('assert');
const { compute } = require('./stats');
const v = (o) => ({ created_at_ist: '2026-10-12T14:03:00', ip_hash: 'a', country: 'IN', path: '/claude-code/day-02/', referrer: 'https://www.linkedin.com/', browser: 'Chrome', device_type: 'mobile', language: 'en', utm_source: null, utm_campaign: null, ...o });
const r = compute([v({}), v({ ip_hash: 'b', utm_source: 'linkedin', utm_campaign: 'day-02' }), v({ path: '/test' })],
  [{ path: '/claude-code/day-02/', event_type: 'engage', seconds: 60, scroll_pct: 100 }], 7);
assert.equal(r.totals.views, 2); assert.equal(r.totals.visitors, 2);
assert.equal(r.fun.busiestHourIST, 14); assert.equal(r.campaigns[0].name, 'day-02');
assert.equal(r.articles[0].avgSeconds, 60); assert.equal(r.series.day.length, 7); assert.equal(r.series.day.reduce((a, d) => a + d.newVisitors, 0), 2); assert.ok(r.series.week.length >= 1 && r.series.month.length >= 1);
assert.equal(r.raw.views.length, 2); assert.equal(r.raw.views.filter((x) => x.f).length, 2);
console.log('ok');
