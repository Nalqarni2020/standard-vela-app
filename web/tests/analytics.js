const A = require(require('path').join(__dirname, '../apps/analytics.js'));
const assert = require('assert');
const near = (a, b, e = 1e-9) => assert(Math.abs(a - b) < e, a + ' != ' + b);

// --- round trips: FIFO, partial lots, unmatched sells, fees
{
  const T = d => Date.parse('2026-10-' + String(d).padStart(2, '0') + 'T15:00:00Z');
  const r = A.roundTrips([
    { symbol: 'X', side: 'buy', qty: 10, price: 10, t: T(1) },
    { symbol: 'X', side: 'buy', qty: 5, price: 12, t: T(2), ext: true },
    { symbol: 'X', side: 'sell', qty: 12, price: 11, t: T(5), fees: 0.12 },   // 10 @10 then 2 @12
    { symbol: 'Y', side: 'sell', qty: 3, price: 5, t: T(6) },                  // bought before the window
  ]);
  assert.equal(r.trips.length, 2);
  near(r.trips[0].pnl, (11 - 10) * 10 - 0.01 * 10);   // sell fee 0.12/12 per share
  near(r.trips[1].pnl, (11 - 12) * 2 - 0.01 * 2);
  assert.equal(r.trips[1].entryExt, true);
  near(r.trips[0].holdDays, 4);
  assert.equal(r.unmatched.length, 1); assert.equal(r.unmatched[0].symbol, 'Y');
  assert.equal(r.open.length, 1); near(r.open[0].qty, 3);
  const g = A.groupStats(r.trips); assert.equal(g.n, 2); near(g.win, 0.5);
}

// --- portfolio risk: identical series are perfectly correlated; sigma of a 100% position equals its own sigma
{
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mk = (f) => { const out = []; let p = 100; for (let i = 0; i < 80; i++) { p *= 1 + f(i); out.push({ d: '2026-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), c: p }); } return out; };
  const shocks = Array.from({ length: 80 }, () => (rnd() - 0.5) * 0.04);
  const a = mk(i => shocks[i]), b = mk(i => shocks[i]);
  const r = A.portfolioRisk([1, 0], [a, b], 60);
  near(r.corrPairs[0].c, 1, 1e-9);
  near(r.sigma, r.vols[0], 1e-12);
  near(r.var95, 1.645 * r.sigma);
  const half = A.portfolioRisk([0.5, 0.5], [a, b], 60); near(half.sigma, r.sigma, 1e-12); // same asset twice
}

// --- ADF: a mean-reverting series rejects a unit root far more strongly than a random walk
{
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ar = [0], rw = [0];
  for (let i = 1; i < 400; i++) { const e = (rnd() - 0.5); ar.push(0.5 * ar[i - 1] + e); rw.push(rw[i - 1] + e); }
  const tAr = A.adf(ar).t, tRw = A.adf(rw).t;
  assert(tAr < -8, 'AR t ' + tAr); assert(tRw > -3.34, 'RW t ' + tRw);
  near(A.adf(ar).halfLife, -Math.LN2 / Math.log(1 + A.adf(ar).gamma));
}

// --- pairs: B = A * noise that mean-reverts -> found, with a negative ADF t and trades
{
  let seed = 21; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const n = 420, d = i => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
  let pa = 50, e = 0; const A1 = [], B1 = [], C1 = [];
  let pc = 30;
  for (let i = 0; i < n; i++) { pa *= 1 + (rnd() - 0.5) * 0.03; e = 0.7 * e + (rnd() - 0.5) * 0.04; pc *= 1 + (rnd() - 0.5) * 0.03;
    A1.push({ d: d(i), c: pa }); B1.push({ d: d(i), c: pa * Math.exp(e) * 0.8 }); C1.push({ d: d(i), c: pc }); }
  const res = A.scanPairs({ AAA: A1, BBB: B1, CCC: C1 }, { top: 3 });
  assert.equal(res[0].a + res[0].b, 'AAABBB');
  assert(res[0].adfT < -5, 'pair adf ' + res[0].adfT);
  assert(res[0].hist.trades.length > 0);
  // trade return sign: z > 0 means A rich -> short A long B
  const w = A.pairWindow(A1.map(x => x.c), B1.map(x => x.c), 0, 252, 378);
  w.trades.forEach(t => assert([1, -1].includes(t.dir)));
}

// --- breadth
{
  const up = Array.from({ length: 260 }, (_, i) => ({ d: 'd' + String(i).padStart(3, '0'), c: 10 + i, h: 10.5 + i, l: 9.5 + i }));
  const down = Array.from({ length: 260 }, (_, i) => ({ d: 'd' + String(i).padStart(3, '0'), c: 300 - i, h: 300.5 - i, l: 299.5 - i }));
  const b = A.breadth({ U: up, D: down });
  assert.equal(b.now.n, 2); assert.equal(b.now.a50, 1); assert.equal(b.now.a200, 1); assert.equal(b.now.hi, 1); assert.equal(b.now.lo, 1);
  assert.equal(b.now.adv, 1); assert.equal(b.now.dec, 1);
  near(b.series[b.series.length - 1], 0.5);
}

// --- event return: buy the first open after the disclosure date
{
  const bars = [{ d: '2026-01-02', o: 10, c: 10 }, { d: '2026-01-05', o: 11, c: 11 }, { d: '2026-01-06', o: 12, c: 13 }];
  const spy = [{ d: '2026-01-02', o: 100, c: 100 }, { d: '2026-01-05', o: 100, c: 101 }, { d: '2026-01-06', o: 101, c: 102 }];
  const r = A.eventReturn(bars, spy, '2026-01-02', 2);
  assert.equal(r.from, '2026-01-05'); near(r.r, 13 / 11 - 1); near(r.excess, (13 / 11 - 1) - (102 / 100 - 1));
  assert.equal(A.eventReturn(bars, spy, '2026-01-06', 1), null);
}
console.log('analytics ok');

// --- SEC facts: total row (no breakdown), latest quarter vs same quarter a year earlier
{
  const f = [
    { concept: 'Revenues', axises: ['Seg: X'], value: '5', start_date: '2026-07-01', end_date: '2026-09-30' },
    { concept: 'Revenues', axises: [], value: '26701000', start_date: '2026-07-01', end_date: '2026-09-30' },
    { concept: 'Revenues', axises: [], value: '71707000', start_date: '2025-07-01', end_date: '2025-09-30' },
    { concept: 'Revenues', axises: [], value: '86376000', start_date: '2026-01-01', end_date: '2026-09-30' },
    { concept: 'Cash', axises: [], value: '656', end_date: '2026-09-30' },
    { concept: 'Cash', axises: [], value: '628', end_date: '2025-12-31' },
  ];
  const r = A.pickFact(f, 'Revenues'); assert.equal(r.latest, 26701000); assert.equal(r.prior, 71707000); assert.equal(r.quarterly, true);
  const c = A.pickFact(f, 'Cash'); assert.equal(c.latest, 656); assert.equal(c.prior, 628);
  assert.equal(A.pickFact(f, 'Nope'), null);
}

// --- earnings reactions: am reacts on the report day, pm on the next session
{
  const bars = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'].map((d, i) => ({ d, o: 10 + i, c: [10, 11, 9, 9.5][i] }));
  const spy = bars.map(b => ({ d: b.d, o: 100, c: 100 }));
  const r = A.earningsReactions(bars, spy, [{ date: '2026-01-06', timing: 'am', est: 0.1, act: 0.2 }, { date: '2026-01-06', timing: 'pm', est: 0.1, act: 0.05 }, { date: '2026-01-08', timing: 'am', est: 0.1, act: null }], 1);
  assert.equal(r.length, 2);
  near(r[0].reaction, 11 / 10 - 1); assert.equal(r[0].session, '2026-01-06'); near(r[0].surprisePct, 1); near(r[0].drift, 9 / 11 - 1);
  near(r[1].reaction, 9 / 11 - 1); assert.equal(r[1].session, '2026-01-07'); near(r[1].driftEx, 9.5 / 9 - 1);
}
console.log('filings and earnings analytics ok');
