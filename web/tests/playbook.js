globalThis.Engine = require(require('path').join(__dirname, '../engine.js'));
const P = require(require('path').join(__dirname, '../apps/playbook-core.js'));
const A = require(require('path').join(__dirname, '../apps/analytics.js'));
const assert = require('assert');
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, a + ' != ' + b);
let n = 0; const ok = () => n++;

// normal distribution
near(P.normCdf(0), 0.5, 1e-7); near(P.normCdf(1.959964), 0.975, 1e-6); near(P.normCdf(-1), 0.158655, 1e-6);
for (const p of [0.001, 0.02, 0.3, 0.5, 0.9, 0.99, 0.9999]) near(P.normCdf(P.normInv(p)), p, 1e-6); ok();

// moments: symmetric sample has zero skew
{ const m = P.moments([1, 2, 3, 4, 5]); near(m.mean, 3); near(m.sd, Math.sqrt(2.5)); near(m.skew, 0); near(m.kurt, 1.7); ok(); }

// deflated Sharpe: one trial = probabilistic Sharpe; more trials lower it; zero Sharpe = 50%
{
  const one = P.deflatedSharpe({ sr: 0.2, n: 101, skew: 0, kurt: 3, trials: 1 });
  near(one.dsr, P.normCdf(0.2 * 10 / Math.sqrt(1 + 0.5 * 0.04)), 1e-9);
  const many = P.deflatedSharpe({ sr: 0.2, n: 101, skew: 0, kurt: 3, trials: 144, srVar: 0.01 });
  assert(many.dsr < one.dsr && many.sr0 > 0);
  // expected max of 144 draws from N(0, 0.1^2) is about 0.25, so a 0.2 Sharpe is no longer convincing
  near(many.sr0, 0.1 * ((1 - 0.5772156649) * P.normInv(1 - 1 / 144) + 0.5772156649 * P.normInv(1 - 1 / (144 * Math.E))), 1e-12);
  assert(many.dsr < 0.5);
  near(P.deflatedSharpe({ sr: 0, n: 50, trials: 1 }).dsr, 0.5, 1e-7); ok();
}

// sizing: risk-based, cap-based, gate-based
{
  let s = P.sizePlan({ account: 10000, riskPct: 0.01, mult: 1, entry: 50, stop: 48, capPct: 0.25 });
  assert.equal(s.shares, 50); assert.equal(s.limitedBy, 'risk'); near(s.riskDollars, 100); near(s.t2, 54);
  s = P.sizePlan({ account: 10000, riskPct: 0.01, mult: 1, entry: 50, stop: 48, capPct: 0.10 }); assert.equal(s.shares, 20); assert.equal(s.limitedBy, 'cap');
  s = P.sizePlan({ account: 10000, riskPct: 0.01, mult: 0.5, entry: 50, stop: 48, capPct: 1 }); assert.equal(s.shares, 25);
  s = P.sizePlan({ account: 10000, riskPct: 0.01, mult: 0, entry: 50, stop: 48, capPct: 1 }); assert.equal(s.shares, 0); assert.equal(s.limitedBy, 'gate');
  s = P.sizePlan({ account: 10000, riskPct: 0.01, entry: 50, stop: 52, capPct: 1 }); assert.equal(s.side, -1); near(s.t1, 48); ok();
}

// gate
const day = i => { const d = new Date(Date.UTC(2023, 0, 2) + i * 86400000).toISOString().slice(0, 10); return { d, t: Date.parse(d + 'T21:00:00Z') }; };
const series = (n, f, v) => Array.from({ length: n }, (_, i) => { const c = f(i); return Object.assign(day(i), { o: c, h: c * 1.005, l: c * 0.995, c, v: v ? v(i) : 1e6 }); });
{
  const up = series(300, i => 400 + i), calm = series(300, i => 14 + Math.sin(i) * 0.3 - (i > 280 ? 1 : 0));
  const g = P.gate(up, calm, 0.7); assert.equal(g.verdict, 'go'); assert.equal(g.mult, 1); assert(g.score >= 3);
  const down = series(300, i => 700 - i), wild = series(300, i => 20 + i * 0.07);
  const h = P.gate(down, wild, 0.2); assert.equal(h.verdict, 'aside'); assert.equal(h.sizeMult, 0);
  assert(h.volScale <= 1 && h.volScale >= 0.5);
  const mixed = P.gate(up, series(300, i => 20 + i * 0.03), 0.5); assert.equal(mixed.verdict, 'half'); ok();
}

// volume-shock setup and its simulated trade: entry above the high, stop under the low (clamped by ATR), target 2R
{
  const b = series(270, i => 100 + i * 0.05);
  const i = 262; b[i] = Object.assign(day(i), { o: 113, h: 115, l: 112.5, c: 114.8, v: 5e6 });   // 5x volume, up close, upper half
  b[i + 1] = Object.assign(day(i + 1), { o: 114.9, h: 117, l: 114.5, c: 116.5, v: 2e6 });          // trades through 115.01
  for (let k = i + 2; k < 270; k++) b[k] = Object.assign(day(k), { o: 116.5, h: 130, l: 116, c: 125, v: 1e6 });
  const x = P.prep(b); const s = P.setupsAt(b, x, i).find(z => z.id === 'volume');
  assert(s, 'volume setup found'); near(s.entry, 115.01);
  const a = x.atr[i]; const dist = Math.min(Math.max(115.01 - 112.49, 0.75 * a), 2.5 * a); near(s.stop, 115.01 - dist);
  near(s.target, 115.01 + 2 * dist);
  const tr = P.simulate(b, x, { hold: 10, cost: 0 }).filter(t => t.id === 'volume');
  assert.equal(tr.length, 1); near(tr[0].fill, 115.01); assert.equal(tr[0].why, 'Target'); near(tr[0].R, 2, 1e-9); ok();
  // a gap above the entry fills at the open
  const b2 = b.map(z => Object.assign({}, z)); b2[i + 1] = Object.assign(day(i + 1), { o: 116, h: 117, l: 115.5, c: 116.5, v: 2e6 });
  const t2 = P.simulate(b2, P.prep(b2), { hold: 10, cost: 0 }).find(t => t.id === 'volume'); near(t2.fill, 116); ok();
  // a stop and a target in the same bar count as the stop
  const b3 = b.map(z => Object.assign({}, z)); b3[i + 2] = Object.assign(day(i + 2), { o: 116, h: 140, l: 100, c: 120, v: 1e6 });
  const t3 = P.simulate(b3, P.prep(b3), { hold: 10, cost: 0 }).find(t => t.id === 'volume'); assert.equal(t3.why, 'Stop'); near(t3.R, -1, 1e-9); ok();
}

// evidence on random walks: no edge should be called real
{
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sets = Array.from({ length: 12 }, (_, k) => { let p = 50; return { sym: 'R' + k, bars: Array.from({ length: 700 }, (_, i) => { const o = p; p = p * (1 + (rnd() - 0.5) * 0.04 + 0.0004); const h = Math.max(o, p) * (1 + rnd() * 0.01), l = Math.min(o, p) * (1 - rnd() * 0.01); return Object.assign(day(i), { o, h, l, c: p, v: 1e6 * (0.5 + rnd() * (rnd() < 0.03 ? 6 : 1)) }); }) }; });
  const ev = P.evaluate ? null : P.evidence(sets, { hold: 10, cost: 0.0005, trials: 20, priorSrs: [0.1, -0.05, 0.02] });
  assert.equal(ev.rows.length, 6); assert(ev.trials === 20);
  ev.rows.forEach(r => { if (r.n >= 30) assert(r.verdict.key !== 'holds' || r.deflated.dsr >= 0.95); });
  assert(ev.trades.length > 50, 'trades: ' + ev.trades.length); ok();
}

// volume curve and projected relative volume
near(P.volShare(0), 0); near(P.volShare(390), 1); near(P.volShare(30), 0.17); assert(P.volShare(200) > P.volShare(100));
near(P.projRvol(1.7e6, 1e7, 600), 1); ok();

// opening range breakout and half-hour momentum on synthetic 5-minute bars (New York 9:30 = 13:30 UTC in November... use EST date)
{
  const base = Date.parse('2026-01-06T14:30:00Z');   // 9:30 New York (EST)
  const bars = Array.from({ length: 78 }, (_, k) => { const t = base + k * 300000; const o = 100 + k * 0.05; return { t, o, h: o + 0.3, l: o - 0.1, c: o + 0.2, v: 1000 }; });
  const p = P.orbPlan(bars, 700); assert.equal(p.dir, 1); near(p.entry, 100.31); near(p.stop, 99.89); assert.equal(p.state, 'triggered');
  assert.equal(P.orbPlan(bars.slice(0, 1), 572).state, 'forming');
  const hh = P.halfHour(bars, 99, 940); assert.equal(hh.dir, 1); assert.equal(hh.state, 'window'); assert.equal(P.halfHour(bars, 99, 590).state, 'forming'); ok();
}

// edge report: groups, after-loss tagging, drawdown
{
  const T = (d, h) => Date.parse('2026-03-' + String(d).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':00:00Z');
  const orders = [];
  for (let d = 2; d <= 27; d++) { const win = d % 3 !== 0; orders.push({ symbol: 'S' + d, side: 'buy', qty: 10, price: 10, t: T(d, 15) }, { symbol: 'S' + d, side: 'sell', qty: 10, price: win ? 11 : 8, t: T(d, 19) }); }
  const { trips } = A.roundTrips(orders);
  trips.forEach(t => { t.entryMin = 660; t.gate = 'go'; t.setups = []; });
  const r = P.edgeReport(trips);
  assert.equal(r.all.n, trips.length); assert(r.maxDD > 0); assert.equal(r.worstStreak, 1);
  const mind = r.groups.find(g => g.title === 'Your state of mind').rows;
  assert(mind[0].s.n + mind[1].s.n === trips.length - 1);
  assert(r.curve.length === trips.length); ok();
}

// liquidity: a thin name produces no setup; the same name passes with a lower bar
{
  const b = series(270, i => 100 + i * 0.05, () => 1000);   // $100k a day
  const i = 262; b[i] = Object.assign(day(i), { o: 113, h: 115, l: 112.5, c: 114.8, v: 5000 });
  const x = P.prep(b);
  assert(P.setupsAt(b, x, i).some(z => z.id === 'volume'));
  assert.equal(P.setupsAt(b, x, i, { minPrice: 5, minDollarVol: 5e6 }).length, 0);
  assert(P.setupsAt(b, x, i, { minPrice: 5, minDollarVol: 5e4 }).some(z => z.id === 'volume'));
  assert.equal(P.setupsAt(b, x, i, { minPrice: 200, minDollarVol: 0 }).length, 0); ok();
}

// earnings: weekday sessions, am/pm, and whether a hold crosses the gap
{
  assert.equal(P.sessionsUntil('2026-11-06', '2026-11-09'), 1);   // Friday to Monday
  assert.equal(P.sessionsUntil('2026-11-05', '2026-11-05'), 0);
  const reps = [{ date: '2026-08-01', timing: 'pm' }, { date: '2026-11-12', timing: 'pm' }, { date: '2026-11-05', timing: 'am' }];
  let r = P.nextReport(reps, '2026-11-05', 500); assert.equal(r.date, '2026-11-05'); assert.equal(r.gapIn, 0);   // before the open: still ahead
  r = P.nextReport(reps, '2026-11-05', 600); assert.equal(r.date, '2026-11-12'); assert.equal(r.sessions, 5); assert.equal(r.gapIn, 6);
  assert.equal(P.earningsInside(r, 10), true); assert.equal(P.earningsInside(r, 5), false);
  assert.equal(P.nextReport([{ date: '2026-01-01' }], '2026-11-05', 600), null); ok();
}

// plans matched to round trips: R on the planned risk, slip, a broken stop, the planning group
{
  const T = (d, h) => Date.parse('2026-03-' + String(d).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':00:00Z');
  const { trips } = A.roundTrips([
    { symbol: 'X', side: 'buy', qty: 10, price: 10.1, t: T(3, 15) }, { symbol: 'X', side: 'sell', qty: 10, price: 12, t: T(6, 15) },
    { symbol: 'Y', side: 'buy', qty: 10, price: 20, t: T(4, 15) }, { symbol: 'Y', side: 'sell', qty: 10, price: 17, t: T(9, 15) },
    { symbol: 'Z', side: 'buy', qty: 10, price: 5, t: T(4, 15) }, { symbol: 'Z', side: 'sell', qty: 10, price: 6, t: T(5, 15) },
  ]);
  const plans = [{ sym: 'X', entry: 10, stop: 9, date: '2026-03-02', hold: 10 }, { sym: 'Y', entry: 20, stop: 19, date: '2026-03-04', hold: 2 }, { sym: 'Z', entry: 5, stop: 4, date: '2026-02-01' }];
  const m = P.matchPlans(trips, plans);
  assert.equal(m.n, 2);
  const x = trips.find(t => t.symbol === 'X'), y = trips.find(t => t.symbol === 'Y'), z = trips.find(t => t.symbol === 'Z');
  near(x.R, 1.9); near(x.slip, 0.01); assert.equal(x.keptStop, true);
  near(y.R, -3); assert.equal(y.keptStop, false); assert.equal(y.overHold, true); assert.equal(z.plan, null);
  assert.equal(m.brokeStop, 1); assert.equal(m.overHold, 1);
  const rep = P.edgeReport(trips); const g = rep.groups.find(q => q.title === 'Planning').rows;
  assert.equal(g[0].s.n, 2); assert.equal(g[1].s.n, 1); ok();
}

// managing a holding: trailing stop, half at 1R, break-even after half, time exit
{
  const b = series(60, i => 100 + i * 0.5);   // steady climb, ATR about 1
  const d0 = b[30].d, last = b[59].c;
  const r = P.manage({ entry: 115, stop: 110, date: d0, hold: 20 }, b, last, b[59].d);
  assert(r.R > 1); assert(r.todo.some(t => t.k === 'half')); assert(r.todo.some(t => t.k === 'time'));
  assert(r.stop > 110 && r.stop < last);
  const h = P.manage({ entry: 115, stop: 110, date: d0, halfTaken: true }, b, 114, b[59].d);
  assert(h.stop >= 115); assert(h.todo.some(t => t.k === 'exit'));
  assert.equal(P.manage({ entry: 10, stop: 11, date: d0 }, b, 10, b[59].d), null); ok();
}

// broker group appears only when there are Webull trades, and compares the two
{
  const T = (d) => Date.parse('2026-04-' + String(d).padStart(2, '0') + 'T15:00:00Z');
  const mk = (sym, d, px0, px1, broker) => { const r = A.roundTrips([{ symbol: sym, side: 'buy', qty: 10, price: px0, t: T(d) }, { symbol: sym, side: 'sell', qty: 10, price: px1, t: T(d + 2) }]).trips; r.forEach(t => { t.broker = broker; }); return r; };
  const rhOnly = [].concat(...[1, 4, 7, 10, 13, 16].map((d, k) => mk('R' + k, d, 10, k % 2 ? 11 : 9.5, 'rh')));
  assert(!P.edgeReport(rhOnly).groups.some(g => g.title === 'Broker'));
  const both = rhOnly.concat(...[2, 5, 8, 11, 14].map((d, k) => mk('W' + k, d, 10, 13, 'wb')));
  const g = P.edgeReport(both).groups.find(q => q.title === 'Broker');
  assert.equal(g.rows[0].s.n, 6); assert.equal(g.rows[1].s.n, 5); near(g.rows[1].s.exp, 30);
  assert(P.edgeReport(both).lessons.some(l => /your Webull trades \$30/.test(l))); ok();
}

// Hodrick-Prescott: the banded solver matches a dense solve; a straight line is its own trend; the one-sided last point
{
  const dense = (y, lam) => { // (I + lam D'D) x = y by Gaussian elimination
    const n = y.length, A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
    for (let r = 0; r < n - 2; r++) { const d = [1, -2, 1]; for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) A[r + a][r + c] += lam * d[a] * d[c]; }
    const M = A.map((row, i) => row.concat([y[i]]));
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
    const x = new Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s0 = M[r][n]; for (let k = r + 1; k < n; k++) s0 -= M[r][k] * x[k]; x[r] = s0 / M[r][r]; } return x;
  };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [n, lam] of [[8, 1600], [30, 129600], [60, 6350400]]) {
    const y = Array.from({ length: n }, (_, i) => 100 + i * 0.3 + (rnd() - 0.5) * 5);
    const a = P.hpTrend(y, lam), b2 = dense(y, lam);
    a.forEach((v, i) => near(v, b2[i], 1e-6 * Math.max(1, Math.abs(b2[i]))));
  }
  const line = Array.from({ length: 50 }, (_, i) => 20 + 0.5 * i);
  P.hpTrend(line, 6350400).forEach((v, i) => near(v, line[i], 1e-6));
  // the one-sided series uses only the trailing window: its value at i equals the full filter run on c[i-251..i]
  const c = Array.from({ length: 300 }, (_, i) => 50 + 10 * Math.sin(i / 25) + (rnd() - 0.5));
  const hs = P.hpSeries(c), i = 280;
  near(hs.T[i], P.hpTrend(c.slice(i - 251, i + 1), P.HP.lambda).pop(), 1e-7);
  assert.equal(hs.T[250], null); assert(hs.fast[259] === null && hs.fast[260] != null && hs.slow[299] === null);
  // changing a future price never changes a past value
  const c2 = c.slice(); c2[299] += 50; assert.equal(P.hpSeries(c2).T[i], hs.T[i]);
  ok();
}

// HP setup: a fall then a steady rise produces a cross up, a trade with no target, and an exit when the trend turns down
{
  const n = 520, b = Array.from({ length: n }, (_, i) => { const c = i < 300 ? 100 - i * 0.1 : i < 420 ? 70 + (i - 300) * 0.4 : 118 - (i - 420) * 0.5; return Object.assign(day(i), { o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6 }); });
  const x = P.prep(b);
  let first = -1; for (let i = 300; i < n; i++) if (P.setupsAt(b, x, i).some(s => s.id === 'hp')) { first = i; break; }
  assert(first > 300 && first < 420, 'cross up during the rise: ' + first);
  const s = P.setupsAt(b, x, first).find(z => z.id === 'hp'); assert.equal(s.target, Infinity); assert.equal(s.rr, null);
  const tr = P.simulate(b, x, { cost: 0 }).filter(t => t.id === 'hp');
  assert(tr.length >= 1); assert(['Trend turned', 'Time', 'Stop'].includes(tr[0].why));
  assert(tr.some(t => t.why === 'Trend turned' || t.why === 'Time'));
  ok();
}

// base breakout: decline, tight 30-session base, first close above it on volume; and the cases that must not fire
{
  const mk = (opts) => { opts = Object.assign({ fall: 0.45, width: 0.12, vol: 3, already: false }, opts);
    const b = []; let i = 0;
    for (; i < 230; i++) { const c = 100 - (100 * opts.fall) * (i / 229); b.push(Object.assign(day(i), { o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6 })); }
    const lo = 100 * (1 - opts.fall), hi = lo * (1 + opts.width);
    for (; i < 290; i++) { const c = lo + (hi - lo) * (0.3 + 0.4 * ((i % 6) / 5)); b.push(Object.assign(day(i), { o: c, h: Math.min(c * 1.01, hi), l: Math.max(c * 0.99, lo), c, v: 1e6 })); }
    if (opts.already) b[i - 3] = Object.assign(day(i - 3), { o: hi, h: hi * 1.03, l: hi * 0.99, c: hi * 1.02, v: 1e6 });
    b.push(Object.assign(day(i), { o: hi, h: hi * 1.06, l: hi * 0.995, c: hi * 1.05, v: 1e6 * opts.vol }));
    return b; };
  const fires = b => P.setupsAt(b, P.prep(b), b.length - 1).find(z => z.id === 'base');
  const b = mk(), s = fires(b);
  assert(s, 'base breakout found'); near(s.entry, b[b.length - 1].h + 0.01);
  { const k = b.length - 1; let bh = -Infinity, bl = Infinity; for (let j = k - 30; j < k; j++) { bh = Math.max(bh, b[j].h); bl = Math.min(bl, b[j].l); }
    const mm = bh + (bh - bl); near(s.target, mm > s.entry + 0.5 * s.risk ? mm : s.entry + 2 * s.risk, 1e-9); }
  assert(s.stop < s.entry && s.risk <= 2.5 * P.prep(b).atr[b.length - 1] + 1e-9);
  assert(!fires(mk({ fall: 0.15 })), 'no setup without a real decline');
  assert(!fires(mk({ fall: 0.6, width: 1.0 })), 'no setup when the range is too wide'); assert(fires(mk({ fall: 0.6, width: 0.3 })), 'a 9% wide base after a 54% fall does fire');
  assert(!fires(mk({ vol: 1.1 })), 'no setup without heavy volume');
  ok();
}
console.log('playbook tests passed:', n);
