/* Analytics for the Book, Market, Congress and Pairs desks. Pure functions, no DOM, tested in Node. */
(function (root) {
  "use strict";
  const EPS = 1e-9;
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  const smaLast = (c, i, n) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += c[k]; return s / n; };

  /* ---------- journal: FIFO round trips from filled orders ----------
     orders: [{symbol, side:"buy"|"sell", qty, price, t (ms), ext (bool), fees}]
     A sell is matched to the oldest open buys of the same symbol. Shares sold that were bought before the
     window cannot be matched and are counted, not guessed. */
  function roundTrips(orders) {
    const lots = new Map(), trips = [], unmatched = [];
    const sorted = orders.filter(o => o.qty > EPS && o.price > 0).slice().sort((a, b) => a.t - b.t);
    for (const o of sorted) {
      if (!lots.has(o.symbol)) lots.set(o.symbol, []);
      const q = lots.get(o.symbol);
      if (o.side === "buy") { q.push({ qty: o.qty, px: o.price, t: o.t, ext: !!o.ext, fee: (o.fees || 0) / o.qty }); continue; }
      let left = o.qty; const sellFee = (o.fees || 0) / o.qty;
      while (left > EPS && q.length) {
        const lot = q[0], take = Math.min(lot.qty, left);
        trips.push({ symbol: o.symbol, qty: take, entryPx: lot.px, exitPx: o.price, entryT: lot.t, exitT: o.t, entryExt: lot.ext, exitExt: !!o.ext,
          pnl: (o.price - lot.px) * take - (lot.fee + sellFee) * take, ret: o.price / lot.px - 1, holdDays: (o.t - lot.t) / 86400000 });
        lot.qty -= take; left -= take;
        if (lot.qty <= EPS) q.shift();
      }
      if (left > EPS) unmatched.push({ symbol: o.symbol, qty: left, t: o.t, px: o.price });
    }
    const open = [];
    lots.forEach((q, sym) => q.forEach(l => { if (l.qty > EPS) open.push({ symbol: sym, qty: l.qty, px: l.px, t: l.t }); }));
    return { trips, unmatched, open };
  }

  function groupStats(trips) {
    if (!trips.length) return null;
    const w = trips.filter(t => t.pnl > 0), l = trips.filter(t => t.pnl <= 0);
    const gw = w.reduce((s, t) => s + t.pnl, 0), gl = l.reduce((s, t) => s + t.pnl, 0);
    return { n: trips.length, win: w.length / trips.length, pnl: gw + gl, avgWin: w.length ? gw / w.length : null, avgLoss: l.length ? gl / l.length : null,
      pf: gl !== 0 ? gw / -gl : (gw > 0 ? Infinity : null), avgRet: mean(trips.map(t => t.ret)),
      holdWin: w.length ? mean(w.map(t => t.holdDays)) : null, holdLoss: l.length ? mean(l.map(t => t.holdDays)) : null };
  }

  /* ---------- risk ---------- */
  function dailyReturns(bars) { const m = new Map(); for (let i = 1; i < bars.length; i++) m.set(bars[i].d, bars[i].c / bars[i - 1].c - 1); return m; }
  function alignedReturns(barsList, lookback) {
    const maps = barsList.map(dailyReturns);
    let dates = null;
    maps.forEach(m => { const ks = new Set(m.keys()); dates = dates ? dates.filter(d => ks.has(d)) : [...ks].sort(); });
    dates = (dates || []).slice(-lookback);
    return { dates, rows: maps.map(m => dates.map(d => m.get(d))) };
  }
  function correlation(a, b) {
    const n = Math.min(a.length, b.length); if (n < 10) return null;
    const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n)); let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
  }
  /* weights: fraction of equity per position (can sum below 1 when cash is held). Returns daily sigma of the
     whole account, 1-day 95% loss at the normal approximation, and pairs that move together. */
  function portfolioRisk(weights, barsList, lookback) {
    lookback = lookback || 60;
    const { dates, rows } = alignedReturns(barsList, lookback);
    const k = rows.length, n = dates.length;
    if (k === 0 || n < 20) return { n, sigma: null, var95: null, corrPairs: [], vols: rows.map(() => null) };
    const ms = rows.map(mean), cov = [];
    for (let i = 0; i < k; i++) { cov.push([]); for (let j = 0; j < k; j++) { let s = 0; for (let t = 0; t < n; t++) s += (rows[i][t] - ms[i]) * (rows[j][t] - ms[j]); cov[i].push(s / (n - 1)); } }
    let v = 0; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) v += weights[i] * weights[j] * cov[i][j];
    const sigma = Math.sqrt(Math.max(0, v));
    const corrPairs = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) { const c = correlation(rows[i], rows[j]); if (c != null) corrPairs.push({ i, j, c }); }
    corrPairs.sort((a, b) => b.c - a.c);
    return { n, sigma, var95: 1.645 * sigma, corrPairs, vols: cov.map((r, i) => Math.sqrt(r[i])) };
  }

  /* ---------- breadth ---------- */
  function breadth(barsMap, histDays) {
    histDays = histDays || 120;
    const now = { n: 0, a20: 0, a50: 0, a200: 0, n200: 0, hi: 0, lo: 0, n252: 0, adv: 0, dec: 0 };
    const hist = new Map();
    for (const bars of Object.values(barsMap)) {
      if (!bars || bars.length < 51) continue;
      const c = bars.map(b => b.c), i = bars.length - 1;
      now.n++;
      if (c[i] > smaLast(c, i, 20)) now.a20++;
      if (c[i] > smaLast(c, i, 50)) now.a50++;
      if (bars.length >= 200) { now.n200++; if (c[i] > smaLast(c, i, 200)) now.a200++; }
      if (bars.length >= 253) {
        now.n252++; let mx = -Infinity, mn = Infinity;
        for (let k = i - 252; k < i; k++) { mx = Math.max(mx, bars[k].h); mn = Math.min(mn, bars[k].l); }
        if (bars[i].h >= mx) now.hi++; if (bars[i].l <= mn) now.lo++;
      }
      if (c[i] > c[i - 1]) now.adv++; else if (c[i] < c[i - 1]) now.dec++;
      // % above 50-day, by date
      let s = 0; for (let k = 0; k < 50; k++) s += c[k];
      for (let k = 49; k < c.length; k++) {
        if (k > 49) s += c[k] - c[k - 50];
        const d = bars[k].d; if (!hist.has(d)) hist.set(d, [0, 0]);
        const h = hist.get(d); h[1]++; if (c[k] > s / 50) h[0]++;
      }
    }
    const dates = [...hist.keys()].sort().slice(-histDays);
    const minN = Math.max(1, Math.floor(now.n * 0.8));
    const series = dates.map(d => { const h = hist.get(d); return h[1] >= minN ? h[0] / h[1] : null; });
    return { now, dates, series };
  }

  /* ---------- pairs ---------- */
  function ols(y, x) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxx > 0 ? sxy / sxx : 0; return { b, a: my - b * mx }; }
  /* Engle-Granger step 2: Dickey-Fuller regression on the spread, no lags: ds_t = c + g s_(t-1). */
  function adf(s) {
    const y = [], x = []; for (let i = 1; i < s.length; i++) { y.push(s[i] - s[i - 1]); x.push(s[i - 1]); }
    const { a, b } = ols(y, x), n = y.length; let sse = 0, sxx = 0; const mx = mean(x);
    for (let i = 0; i < n; i++) { sse += (y[i] - a - b * x[i]) ** 2; sxx += (x[i] - mx) ** 2; }
    const se = Math.sqrt(sse / (n - 2) / sxx);
    return { gamma: b, t: se > 0 ? b / se : null, halfLife: b < 0 && b > -1 ? -Math.LN2 / Math.log(1 + b) : null };
  }
  function alignPrices(a, b) {
    const mb = new Map(b.map(x => [x.d, x.c])), d = [], pa = [], pb = [];
    a.forEach(x => { if (mb.has(x.d)) { d.push(x.d); pa.push(x.c); pb.push(mb.get(x.d)); } });
    return { d, pa, pb };
  }
  /* One pair over a formation window [f0, f1) and a trading window [f1, t1). Spread = ln A - beta ln B - alpha,
     standardized with formation statistics. Open at |z| >= open, close when z crosses zero or at the end. */
  function pairWindow(pa, pb, f0, f1, t1, o) {
    o = Object.assign({ open: 2, cost: 0.0005 }, o || {});
    const la = pa.map(Math.log), lb = pb.map(Math.log);
    const fy = la.slice(f0, f1), fx = lb.slice(f0, f1);
    const { a, b } = ols(fy, fx);
    const spread = la.map((v, i) => v - b * lb[i] - a);
    const fs = spread.slice(f0, f1), m = mean(fs), s = sd(fs);
    const z = spread.map(v => s > 0 ? (v - m) / s : 0);
    const norm = (arr, i) => arr[i] / arr[f0];
    let ssd = 0; for (let i = f0; i < f1; i++) ssd += (norm(pa, i) - norm(pb, i)) ** 2;
    const df = adf(fs), trades = [];
    let pos = null;
    for (let i = f1; i < t1; i++) {
      if (!pos && Math.abs(z[i]) >= o.open && i < t1 - 1) pos = { i, dir: z[i] > 0 ? -1 : 1 }; // dir 1 = long A short B
      else if (pos && (Math.sign(z[i]) !== Math.sign(z[pos.i]) || i === t1 - 1)) {
        const ra = pa[i] / pa[pos.i] - 1, rb = pb[i] / pb[pos.i] - 1;
        trades.push({ open: pos.i, close: i, dir: pos.dir, ret: pos.dir * (ra - rb) / 1 - 4 * o.cost, forced: i === t1 - 1 && Math.sign(z[i]) === Math.sign(z[pos.i]) });
        pos = null;
      }
    }
    return { beta: b, alpha: a, z, ssd, adfT: df.t, halfLife: df.halfLife, trades };
  }
  /* Scan all pairs. History test: form on [n-378, n-126), trade the last 126 days.
     Current read: form on the last 252 days and report today's z. */
  function scanPairs(series, o) {
    o = Object.assign({ top: 15, form: 252, trade: 126, open: 2, cost: 0.0005 }, o || {});
    const syms = Object.keys(series).filter(k => series[k] && series[k].length >= o.form + o.trade + 5);
    const cands = [];
    for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) {
      const al = alignPrices(series[syms[i]], series[syms[j]]);
      const n = al.d.length; if (n < o.form + o.trade + 5) continue;
      const f0 = n - o.form - o.trade, f1 = n - o.trade;
      let ssd = 0; for (let k = f0; k < f1; k++) ssd += (al.pa[k] / al.pa[f0] - al.pb[k] / al.pb[f0]) ** 2;
      cands.push({ a: syms[i], b: syms[j], al, ssd });
    }
    cands.sort((x, y) => x.ssd - y.ssd);
    return cands.slice(0, o.top).map(c => {
      const n = c.al.d.length;
      const hist = pairWindow(c.al.pa, c.al.pb, n - o.form - o.trade, n - o.trade, n, o);
      const cur = pairWindow(c.al.pa, c.al.pb, n - o.form, n, n, o);
      const zNow = cur.z[n - 1];
      return { a: c.a, b: c.b, dates: c.al.d, pa: c.al.pa, pb: c.al.pb, ssd: c.ssd, corr: correlation(rets(c.al.pa.slice(-o.form)), rets(c.al.pb.slice(-o.form))),
        beta: cur.beta, adfT: cur.adfT, halfLife: cur.halfLife, zNow, zSeries: cur.z.slice(-o.form), hist: { trades: hist.trades, adfT: hist.adfT } };
    });
  }
  const rets = p => p.slice(1).map((v, i) => v / p[i] - 1);

  /* ---------- event returns (Congress) ----------
     Bought at the first open AFTER the disclosure date, held h sessions to the close; excess vs SPY on the same dates. */
  function eventReturn(bars, spy, date, h) {
    const i = bars.findIndex(b => b.d > date);
    if (i < 0 || i + h - 1 >= bars.length) return null;
    const r = bars[i + h - 1].c / bars[i].o - 1;
    const si = spy.findIndex(b => b.d === bars[i].d), sj = spy.findIndex(b => b.d === bars[i + h - 1].d);
    const sr = si >= 0 && sj >= 0 ? spy[sj].c / spy[si].o - 1 : null;
    return { r, excess: sr == null ? null : r - sr, from: bars[i].d, to: bars[i + h - 1].d };
  }
  function summarize(xs) {
    const a = xs.filter(x => x != null && isFinite(x));
    if (!a.length) return { n: 0 };
    const m = mean(a), s = sd(a), so = a.slice().sort((x, y) => x - y);
    return { n: a.length, mean: m, median: so[so.length >> 1], hit: a.filter(x => x > 0).length / a.length, t: s > 0 && a.length > 1 ? m / (s / Math.sqrt(a.length)) : null };
  }

  /* ---------- SEC facts: company-wide value for the latest quarter and the same quarter a year earlier ----------
     Only rows without a breakdown (axises empty). Durations of 80 to 100 days count as quarters; instants are
     balance-sheet points. Returns {latest, prior, latestEnd, priorEnd} or null. */
  function pickFact(facts, concept) {
    const rows = facts.filter(f => f.concept === concept && (!f.axises || !f.axises.length) && f.value !== "" && isFinite(+f.value));
    if (!rows.length) return null;
    const dur = r => r.start_date ? (Date.parse(r.end_date) - Date.parse(r.start_date)) / 86400000 : 0;
    const q = rows.filter(r => r.start_date && dur(r) >= 80 && dur(r) <= 100), inst = rows.filter(r => !r.start_date);
    const pool = q.length ? q : inst.length ? inst : rows;
    pool.sort((a, b) => b.end_date.localeCompare(a.end_date));
    const latest = pool[0];
    const target = Date.parse(latest.end_date) - 365 * 86400000;
    const prior = pool.slice(1).find(r => Math.abs(Date.parse(r.end_date) - target) <= 20 * 86400000) || (inst.length && !q.length ? pool[1] : null);
    return { latest: +latest.value, latestEnd: latest.end_date, prior: prior ? +prior.value : null, priorEnd: prior ? prior.end_date : null, quarterly: q.length > 0 };
  }

  /* ---------- earnings reactions ----------
     reports: [{date, timing:"am"|"pm"|..., est, act}]. The reaction session is the report date for "am" and the next
     session for "pm" (unknown timing is treated as "pm" only when the report date's session exists and the next one too).
     Reaction = close of the reaction session / close of the session before it - 1. Drift = the following h sessions, vs SPY. */
  function earningsReactions(bars, spy, reports, h) {
    h = h || 20;
    const idx = new Map(bars.map((b, i) => [b.d, i]));
    return reports.map(r => {
      if (r.act == null) return null;
      let i = bars.findIndex(b => b.d >= r.date);
      if (i < 0) return null;
      if (r.timing !== "am" && bars[i].d === r.date) i = i + 1;
      if (i < 1 || i >= bars.length) return null;
      const reaction = bars[i].c / bars[i - 1].c - 1, gap = bars[i].o / bars[i - 1].c - 1;
      let drift = null, driftEx = null;
      if (i + h < bars.length) {
        drift = bars[i + h].c / bars[i].c - 1;
        const si = spy.findIndex(b => b.d === bars[i].d), sj = spy.findIndex(b => b.d === bars[i + h].d);
        if (si >= 0 && sj >= 0) driftEx = drift - (spy[sj].c / spy[si].c - 1);
      }
      const surprise = r.est != null && r.act != null ? r.act - r.est : null;
      const surprisePct = surprise != null && r.est !== 0 ? surprise / Math.abs(r.est) : null;
      return { date: r.date, session: bars[i].d, timing: r.timing, est: r.est, act: r.act, surprise, surprisePct, reaction, gap, drift, driftEx };
    }).filter(Boolean);
  }

  const A = { pickFact, earningsReactions, roundTrips, groupStats, dailyReturns, alignedReturns, correlation, portfolioRisk, breadth, ols, adf, alignPrices, pairWindow, scanPairs, eventReturn, summarize, mean, sd };
  if (typeof module !== "undefined" && module.exports) module.exports = A; else root.Analytics = A;
})(typeof self !== "undefined" ? self : this);
