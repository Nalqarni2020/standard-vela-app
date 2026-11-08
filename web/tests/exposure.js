const X = require(require('path').join(__dirname, '../apps/exposure-core.js'));
const assert = require('assert');
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, a + ' != ' + b);
let n = 0; const ok = () => n++;
// Black-Scholes greeks match finite differences of the price (r = q = 0)
{
  const price = (S, K, t, v, type) => { const st = v * Math.sqrt(t), d1 = (Math.log(S / K) + 0.5 * v * v * t) / st, d2 = d1 - st; return type === 'call' ? S * X.cdf(d1) - K * X.cdf(d2) : K * X.cdf(-d2) - S * X.cdf(-d1); };
  for (const type of ['call', 'put']) for (const [S, K, t, v] of [[100, 95, 0.1, 0.3], [100, 110, 0.02, 0.5], [500, 500, 1 / 365, 0.2]]) {
    const g = X.greeks(S, K, t, v, type), h = 0.02 * Math.sqrt(t) * S * v;
    near(g.delta, (price(S + h, K, t, v, type) - price(S - h, K, t, v, type)) / (2 * h), 2e-4);
    near(g.gamma, (price(S + h, K, t, v, type) - 2 * price(S, K, t, v, type) + price(S - h, K, t, v, type)) / (h * h), 2e-3 * Math.max(1, g.gamma));
    const dv = 1e-3; near(g.vanna, (X.greeks(S, K, t, v + dv, type).delta - X.greeks(S, K, t, v - dv, type).delta) / (2 * dv), 1e-3);
    const dt = t * 1e-3; near(g.charm, -(X.greeks(S, K, t + dt, v, type).delta - X.greeks(S, K, t - dt, v, type).delta) / (2 * dt) / 365, 1e-3);
  }
  ok();
}
// expiry is 4 pm New York: 21:00Z in winter, 20:00Z in summer; DST boundaries
{
  assert.equal(new Date(X.expiryMs('2026-11-09')).toISOString(), '2026-11-09T21:00:00.000Z');
  assert.equal(new Date(X.expiryMs('2026-07-17')).toISOString(), '2026-07-17T20:00:00.000Z');
  assert(X.nySummer(2026, 3, 8) && !X.nySummer(2026, 3, 7) && X.nySummer(2026, 10, 31) && !X.nySummer(2026, 11, 1));
  const p = X.nyParts(Date.parse('2026-11-06T21:20:00Z')); assert.equal(p.date, '2026-11-06'); assert.equal(p.min, 16 * 60 + 20); assert.equal(p.wd, 5);
  ok();
}
// a book of big call OI above and big put OI below: King, walls, flip between them, IV filled for a contract without one
{
  const now = Date.parse('2026-11-09T15:00:00Z'), exp = '2026-11-13';
  const cs = [];
  for (let k = 90; k <= 110; k += 2) { cs.push({ k, type: 'call', exp, oi: k === 104 ? 50000 : 1000, iv: 0.3, mark: Math.max(0.1, 100 - k) + 1 }); cs.push({ k, type: 'put', exp, oi: k === 96 ? 40000 : 1000, iv: k === 90 ? null : 0.3, mark: Math.max(0.1, k - 100) + 1 }); }
  const x = X.exposures(cs, 100, now);
  assert.equal(x.callWall.k, 104); assert.equal(x.putWall.k, 96); assert.equal(x.king.k, 104);
  assert(x.flip > 96 && x.flip < 104, 'flip ' + x.flip); assert.equal(x.filled, 1);
  assert(Math.abs(x.gexAtFlip = X.gexAt(X.fillIv(cs.map(c => Object.assign({}, c))), x.flip, now)) < 1e6, 'GEX near zero at the flip');
  assert.equal(x.em.strike, 100); near(x.em.straddle, 2.2); assert.equal(x.exps.length, 1);
  assert(x.total.dex > 0 === (x.total.dex > 0)); assert.equal(x.regime, x.total.gex >= 0 ? 'positive' : 'negative');
  // cells add up to the strike totals
  const k104 = x.strikes.find(s => s.k === 104); near(x.cell[exp + '|104'].gex, k104.gex, 1e-6);
  ok();
}
// level test: an evening snapshot is matched with the next session; a pre-market one with the same day; intraday ones skipped
{
  const bars = [{ d: '2026-11-09', o: 100, h: 103, l: 99, c: 102 }, { d: '2026-11-10', o: 102, h: 106, l: 101, c: 104 }];
  const snaps = [
    { t: Date.parse('2026-11-06T22:00:00Z'), spot: 100, regime: 'positive', emDay: 2, callWall: 102.5, putWall: 95, king: 102 },   // Friday evening -> Monday
    { t: Date.parse('2026-11-10T13:00:00Z'), spot: 102, regime: 'negative', emDay: 2, callWall: 105, putWall: 101.5, king: 100 },      // Tuesday 8 am -> Tuesday
    { t: Date.parse('2026-11-09T16:00:00Z'), spot: 101, regime: 'positive', emDay: 2, callWall: 110, putWall: 90, king: 101 },      // during the session: skipped
  ];
  const r = X.levelTest(snaps, bars);
  assert.equal(r.n, 2); near(r.range.pos, 2); near(r.range.neg, 2.5);
  assert.equal(r.callWall.touched, 2); near(r.callWall.heldShare, 1);   // Mon closed 102 under 102.5, Tue closed 104 under 105
  assert.equal(r.king.n, 2); near(r.king.towardShare, 0.5); assert.equal(r.putWall.touched, 1); near(r.putWall.heldShare, 1);
  ok();
}
console.log('exposure tests passed:', n);
