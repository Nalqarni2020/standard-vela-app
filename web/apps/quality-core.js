/* Quality and value scores for US stocks from quarterly reports, and a point-in-time test of whether they worked.
   Inputs: Robinhood quarterly financials (revenue, gross profit, net income, period end) and Webull quarterly indicators
   (ROE, ROA, liabilities to assets, diluted EPS, operating cash flow per share, book value per share), matched by fiscal
   year and quarter. A quarter counts as known 45 days after it ends (75 for the fiscal-year report), the usual filing
   deadlines, so the test never uses a figure before it was public. Pure functions, shared with tests. */
(function (root) {
  "use strict";
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lin = (x, lo, hi) => x == null || !isFinite(x) ? null : Math.round(clamp01((x - lo) / (hi - lo)) * 100);
  const DAY = 864e5;

  /* fin: [{fiscal_year, fiscal_quarter, period_end_date, revenue, gross_profit, net_income}] (any order)
     ind: Webull values object { roe: [{fiscal_year, fiscal_period, value}], ... } */
  function merge(fin, ind) {
    const key = (y, q) => y + "Q" + q, by = new Map();
    (fin || []).forEach(r => { if (r.fiscal_quarter == null) return; by.set(key(r.fiscal_year, r.fiscal_quarter), { fy: +r.fiscal_year, fq: +r.fiscal_quarter, end: r.period_end_date, rev: num(r.revenue), gp: num(r.gross_profit), ni: num(r.net_income) }); });
    const F = { roe: "roe", roa: "roa", dta: "debt_to_assets", eps: "diluted_eps_incl_extra", ocfps: "ocf_ps", naps: "naps" };
    for (const [k, src] of Object.entries(F)) for (const v of ((ind || {})[src] || [])) {
      const q = by.get(key(v.fiscal_year, v.fiscal_period)); if (q) q[k] = num(v.value);
    }
    return [...by.values()].filter(q => q.end).map(q => Object.assign(q, { avail: addDays(q.end, q.fq === 4 ? 75 : 45) })).sort((a, b) => a.end < b.end ? -1 : 1);
  }
  const num = v => v == null || v === "" ? null : +v;
  const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
  const sum4 = (qs, i, f) => { if (i < 3) return null; let s = 0; for (let k = i - 3; k <= i; k++) { const v = qs[k][f]; if (v == null || !isFinite(v)) return null; s += v; } return s; };

  /* Scores on the quarters known by quarter index i, at a price. */
  function scoreAt(qs, i, price) {
    if (i < 3 || !(price > 0)) return null;
    const q = qs[i], rev = sum4(qs, i, "rev"), gp = sum4(qs, i, "gp"), ni = sum4(qs, i, "ni");
    const roe = sum4(qs, i, "roe"), roa = sum4(qs, i, "roa"), eps = sum4(qs, i, "eps"), ocf = sum4(qs, i, "ocfps");
    const revPrev = i >= 7 ? sum4(qs, i - 4, "rev") : null;
    const last8 = qs.slice(Math.max(0, i - 7), i + 1).filter(z => z.ni != null);
    const m = {
      roe, roa, gm: rev > 0 && gp != null ? gp / rev : null, growth: rev > 0 && revPrev > 0 ? rev / revPrev - 1 : null,
      consistency: last8.length >= 4 ? last8.filter(z => z.ni > 0).length / last8.length : null, dta: q.dta,
      cash: eps > 0 && ocf != null ? ocf / eps : eps != null && eps <= 0 && ocf != null ? (ocf > 0 ? 0.75 : 0) : null,
      eps, naps: q.naps, ni, rev,
    };
    const parts = {
      roe: lin(roe, 0, 0.25), roa: lin(roa, 0, 0.12), gm: lin(m.gm, 0.1, 0.6), growth: lin(m.growth, -0.1, 0.2),
      consistency: m.consistency == null ? null : Math.round(m.consistency * 100), safety: m.dta == null ? null : lin(0.9 - m.dta, 0, 0.6), cash: lin(m.cash, 0.5, 1.0),
    };
    const pv = Object.values(parts).filter(v => v != null);
    const quality = pv.length >= 4 ? Math.round(pv.reduce((s, v) => s + v, 0) / pv.length) : null;
    const pe = eps > 0 ? price / eps : null, pb = q.naps > 0 ? price / q.naps : null;
    const vparts = { ey: eps == null ? null : lin(eps / price, 0, 0.08), pb: pb == null ? (q.naps != null && q.naps <= 0 ? 0 : null) : Math.round(clamp01(1 - Math.log(Math.max(1, pb)) / Math.log(15)) * 100) };
    const vv = Object.values(vparts).filter(v => v != null);
    const value = vv.length ? Math.round(vv.reduce((s, v) => s + v, 0) / vv.length) : null;
    const graham = eps > 0 && q.naps > 0 ? Math.sqrt(22.5 * eps * q.naps) : null;
    return { quality, parts, value, vparts, m, pe, pb, graham, asOf: q.end, known: q.avail };
  }
  /* The latest quarter known on a date. */
  function knownIndex(qs, date) { let k = -1; for (let i = 0; i < qs.length; i++) if (qs[i].avail <= date) k = i; return k; }

  function trendAt(bars, j) {
    if (j < 200) return null; let s50 = 0, s200 = 0;
    for (let k = j - 199; k <= j; k++) { s200 += bars[k].c; if (k > j - 50) s50 += bars[k].c; }
    s50 /= 50; s200 /= 200; const c = bars[j].c;
    return c > s200 && s50 > s200 ? "up" : c < s200 && s50 < s200 ? "down" : "mixed";
  }
  function decision(s, trend) {
    if (!s || s.quality == null) return { key: "na", label: "Not enough data" };
    if (s.quality >= 70 && trend === "up") return { key: "cand", label: "Candidate" };
    if (s.quality >= 70) return { key: "watch", label: "Watch for the trend" };
    if (s.quality < 40 && s.value != null && s.value >= 60) return { key: "trap", label: "Cheap but weak" };
    if (s.quality < 40 && trend === "down") return { key: "avoid", label: "Avoid" };
    return { key: "neutral", label: "Neutral" };
  }

  /* Point-in-time test. items: [{sym, qs, bars}] with daily bars. On each date a new quarter becomes known, score the
     stock at that day's close and measure the return from the next open to the close 63 and 252 sessions later. Results
     are averaged within each date first (a cross-section), then across dates, so one busy quarter can't dominate. */
  function study(items, o) {
    o = o || {}; const H = [63, 252], obs = [];
    for (const it of items) {
      const b = it.bars, qs = it.qs; if (!b || b.length < 260 || !qs || qs.length < 4) continue;
      for (let i = 3; i < qs.length; i++) {
        const j = b.findIndex(x => x.d >= qs[i].avail); if (j < 200 || j + 1 >= b.length) continue;
        if (o.liq && !(b[j].c >= (o.liq.minPrice || 0))) continue;
        const s = scoreAt(qs, i, b[j].c); if (!s || s.quality == null) continue;
        const e = b[j + 1].o, fw = H.map(h => j + 1 + h - 1 < b.length ? b[j + h].c / e - 1 : null);
        obs.push({ sym: it.sym, date: qs[i].avail.slice(0, 7), q: s.quality, v: s.value, t: trendAt(b, j), fw });
      }
    }
    const groups = [
      ["all", "Every stock-quarter", () => true],
      ["qhi", "Quality 70 or more", z => z.q >= 70], ["qlo", "Quality under 40", z => z.q < 40],
      ["vhi", "Value 60 or more", z => z.v != null && z.v >= 60], ["vlo", "Value under 30", z => z.v != null && z.v < 30],
      ["qv", "Quality 70+ and value 50+", z => z.q >= 70 && z.v != null && z.v >= 50],
      ["qt", "Quality 70+ and trend up", z => z.q >= 70 && z.t === "up"],
      ["trap", "Cheap but weak (value 60+, quality under 40)", z => z.q < 40 && z.v != null && z.v >= 60],
    ];
    const byDate = new Map(); obs.forEach(z => { if (!byDate.has(z.date)) byDate.set(z.date, []); byDate.get(z.date).push(z); });
    const rows = groups.map(([id, label, f]) => {
      const out = { id, label, n: obs.filter(f).length, h: {} };
      H.forEach((h, k) => {
        const ex = []; let cnt = 0, win = 0, sumR = 0;
        for (const list of byDate.values()) {
          const all = list.filter(z => z.fw[k] != null); if (all.length < 3) continue;
          const sel = all.filter(f); if (!sel.length) continue;
          const avgAll = all.reduce((s, z) => s + z.fw[k], 0) / all.length, avgSel = sel.reduce((s, z) => s + z.fw[k], 0) / sel.length;
          ex.push(avgSel - avgAll); sel.forEach(z => { cnt++; sumR += z.fw[k]; if (z.fw[k] > 0) win++; });
        }
        const m = ex.length ? ex.reduce((s, v) => s + v, 0) / ex.length : null;
        const sd = ex.length > 1 ? Math.sqrt(ex.reduce((s, v) => s + (v - m) ** 2, 0) / (ex.length - 1)) : null;
        // 252-session windows overlap across quarterly dates: shrink the t-statistic by the overlap (about 4 dates per year)
        const eff = h === 252 ? ex.length / 4 : ex.length;
        out.h[h] = { n: cnt, dates: ex.length, avg: cnt ? sumR / cnt : null, win: cnt ? win / cnt : null, excess: m, t: m != null && sd > 0 && eff > 1 ? m / (sd / Math.sqrt(eff)) : null };
      });
      return out;
    });
    const dates = [...byDate.keys()].sort();
    return { rows, obs: obs.length, names: new Set(obs.map(z => z.sym)).size, from: dates[0] || null, to: dates[dates.length - 1] || null };
  }
  const Q = { merge, scoreAt, knownIndex, trendAt, decision, study, lin };
  if (typeof module !== "undefined" && module.exports) module.exports = Q; else root.Quality = Q;
})(typeof self !== "undefined" ? self : globalThis);
