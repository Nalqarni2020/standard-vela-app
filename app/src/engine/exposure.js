/* Options exposure: gamma (GEX), vanna (VEX), delta (DEX) and charm by strike and expiration, from open interest and
   implied volatility, with Black-Scholes greeks (no rates or dividends). Pure functions, shared by the page and tests.
   Sign convention for GEX and VEX: calls +, puts − (the common "dealers long calls, short puts" model; nobody can see the
   real dealer book, so the sign is an assumption). DEX and charm are the open interest's own delta and its daily drift. */
(function (root) {
  "use strict";
  const SQ2PI = Math.sqrt(2 * Math.PI);
  const pdf = x => Math.exp(-0.5 * x * x) / SQ2PI;
  function cdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = pdf(x); const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; }
  const YEAR_MS = 365 * 864e5, MIN_TAU = 1 / (365 * 24);   // at least one hour left, so 0DTE does not blow up

  /* US daylight time: from the second Sunday of March to the first Sunday of November. */
  function nySummer(y, m, d) {
    if (m < 3 || m > 11) return false; if (m > 3 && m < 11) return true;
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), sun = 1 + (7 - first) % 7;
    return m === 3 ? d >= sun + 7 : d < sun;
  }
  /* 4:00 pm New York on an expiration date, in ms. */
  function expiryMs(date) { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d, nySummer(y, m, d) ? 20 : 21); }
  function tauOf(date, nowMs) { return Math.max(MIN_TAU, (expiryMs(date) - nowMs) / YEAR_MS); }

  function greeks(S, K, tau, iv, type) {
    if (!(S > 0 && K > 0 && tau > 0 && iv > 0)) return null;
    const st = iv * Math.sqrt(tau), d1 = (Math.log(S / K) + 0.5 * iv * iv * tau) / st, d2 = d1 - st, n1 = pdf(d1);
    return { delta: type === "call" ? cdf(d1) : cdf(d1) - 1, gamma: n1 / (S * st), vanna: -n1 * d2 / iv, charm: n1 * d2 / (2 * tau) / 365 };
  }
  /* Contracts without an implied volatility (deep in the money, often) borrow the nearest strike's in the same expiration. */
  function fillIv(cs) {
    const byExp = new Map(); cs.forEach(c => { if (!byExp.has(c.exp)) byExp.set(c.exp, []); byExp.get(c.exp).push(c); });
    for (const list of byExp.values()) {
      const ok = list.filter(c => c.iv > 0 && c.iv < 5);
      for (const c of list) if (!(c.iv > 0 && c.iv < 5)) { let b = null; for (const o of ok) if (!b || Math.abs(o.k - c.k) < Math.abs(b.k - c.k)) b = o; c.ivUsed = b ? b.iv : null; c.ivFilled = !!b; } else c.ivUsed = c.iv;
    }
    return cs;
  }
  const blank = () => ({ gex: 0, vex: 0, dex: 0, cex: 0, cg: 0, pg: 0, oi: 0 });
  function add(t, c, g, S) {
    const sgn = c.type === "call" ? 1 : -1, n = c.oi * 100;
    t.gex += sgn * g.gamma * n * S * S * 0.01; t.vex += sgn * g.vanna * n * S * 0.01; t.dex += g.delta * n * S; t.cex += g.charm * n * S; t.oi += c.oi;
    if (sgn > 0) t.cg += g.gamma * n * S * S * 0.01; else t.pg += g.gamma * n * S * S * 0.01;   // wall sizes, both positive
  }
  /* Total GEX if the stock were at S (same volatilities and times), for the zero-gamma level. */
  function gexAt(cs, S, now) { let s = 0; for (const c of cs) { if (!c.ivUsed || !(c.oi > 0)) continue; const g = greeks(S, c.k, tauOf(c.exp, now), c.ivUsed, c.type); if (g) s += (c.type === "call" ? 1 : -1) * g.gamma * c.oi * 100 * S * S * 0.01; } return s; }

  /* contracts: [{k, type: "call"|"put", exp: "YYYY-MM-DD", oi, iv, mark}] */
  function exposures(contracts, spot, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs, cs = fillIv(contracts.filter(c => c.k > 0 && (c.type === "call" || c.type === "put")).map(c => Object.assign({}, c)));
    const exps = [...new Set(cs.map(c => c.exp))].sort(), cell = {}, byStrike = new Map(), tot = blank();
    let used = 0, filled = 0;
    for (const c of cs) {
      if (!(c.oi > 0) || !c.ivUsed) continue;
      const g = greeks(spot, c.k, tauOf(c.exp, now), c.ivUsed, c.type); if (!g) continue;
      used++; if (c.ivFilled) filled++;
      const key = c.exp + "|" + c.k; if (!cell[key]) cell[key] = blank(); add(cell[key], c, g, spot);
      if (!byStrike.has(c.k)) byStrike.set(c.k, Object.assign(blank(), { k: c.k })); add(byStrike.get(c.k), c, g, spot); add(tot, c, g, spot);
    }
    const strikes = [...byStrike.values()].sort((a, b) => a.k - b.k);
    const pick = f => strikes.reduce((m, x) => m == null || f(x) > f(m) ? x : m, null);
    const king = pick(x => Math.abs(x.gex)), callWall = pick(x => x.cg), putWall = pick(x => x.pg);
    // runner-up within 10% of the King makes it "contested"
    const second = strikes.filter(x => x !== king).reduce((m, x) => m == null || Math.abs(x.gex) > Math.abs(m.gex) ? x : m, null);
    // zero-gamma level: where total GEX changes sign as the stock moves, nearest the current price
    let flip = null;
    if (used) {
      const step = spot * 0.0025, grid = []; for (let s = spot * 0.85; s <= spot * 1.15 + 1e-9; s += step) grid.push([s, gexAt(cs, s, now)]);
      let best = Infinity;
      for (let i = 1; i < grid.length; i++) { const [s0, g0] = grid[i - 1], [s1, g1] = grid[i]; if ((g0 < 0) !== (g1 < 0)) { const z = s0 + (s1 - s0) * (g0 / (g0 - g1)); if (Math.abs(z - spot) < best) { best = Math.abs(z - spot); flip = z; } } }
    }
    // expected move: the nearest expiration's at-the-money straddle, and a one-day move from the ATM volatility
    let em = null;
    for (const e of exps) {
      const atE = cs.filter(c => c.exp === e && c.mark > 0);
      const ks = [...new Set(atE.map(c => c.k))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
      const k = ks.find(k0 => atE.some(c => c.k === k0 && c.type === "call") && atE.some(c => c.k === k0 && c.type === "put")); if (k == null) continue;
      const call = atE.find(c => c.k === k && c.type === "call"), put = atE.find(c => c.k === k && c.type === "put"), iv = ((call.ivUsed || 0) + (put.ivUsed || 0)) / 2;
      em = { exp: e, strike: k, straddle: call.mark + put.mark, iv, day: iv > 0 ? spot * iv / Math.sqrt(252) : null }; break;
    }
    return { spot, exps, cell, strikes, total: tot, king, contested: !!(king && second && Math.abs(second.gex) >= 0.9 * Math.abs(king.gex)), second, callWall, putWall, flip, em, used, filled, regime: tot.gex >= 0 ? "positive" : "negative" };
  }
  const snapshot = (x, t, scope) => ({ t, scope, spot: x.spot, net: x.total.gex, vex: x.total.vex, king: x.king && x.king.k, callWall: x.callWall && x.callWall.k, putWall: x.putWall && x.putWall.k, flip: x.flip, emDay: x.em && x.em.day, regime: x.regime });

  /* Do the levels work? Each snapshot taken outside the regular session is matched with the next session's daily bar.
     - Range: that session's high-low range against the expected one-day move, split by positive and negative gamma
       (the dealer-hedging story says positive gamma calms the day).
     - Walls: of the sessions that reached the call wall from below, the share that closed back under it; the same for the
       put wall from above. Many closes back inside would mean the walls acted as resistance and support.
     - King: the share of sessions that closed nearer the King strike than they started (the "magnet" story); about half
       would happen by chance. */
  function levelTest(snaps, bars) {
    const rows = [];
    for (const s of snaps) {
      if (!s || !(s.spot > 0) || !s.t) continue;
      const n = nyParts(s.t); if (n.min >= 570 && n.min < 960 && n.wd >= 1 && n.wd <= 5) continue;   // taken during the session
      const target = n.wd >= 1 && n.wd <= 5 && n.min < 570 ? bars.find(b => b.d >= n.date) : bars.find(b => b.d > n.date);
      if (!target) continue;
      rows.push({ s, b: target });
    }
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const rr = g => rows.filter(r => r.s.regime === g && r.s.emDay > 0).map(r => (r.b.h - r.b.l) / r.s.emDay);
    const cw = rows.filter(r => r.s.callWall > r.s.spot && r.b.h >= r.s.callWall), pw = rows.filter(r => r.s.putWall < r.s.spot && r.b.l <= r.s.putWall);
    const kg = rows.filter(r => r.s.king != null && Math.abs(r.s.spot - r.s.king) > 1e-9);
    const pos = rr("positive"), neg = rr("negative");
    return {
      n: rows.length, from: rows.length ? rows[0].b.d : null, to: rows.length ? rows[rows.length - 1].b.d : null,
      range: { posN: pos.length, pos: mean(pos), negN: neg.length, neg: mean(neg) },
      callWall: { touched: cw.length, heldShare: cw.length ? cw.filter(r => r.b.c < r.s.callWall).length / cw.length : null },
      putWall: { touched: pw.length, heldShare: pw.length ? pw.filter(r => r.b.c > r.s.putWall).length / pw.length : null },
      king: { n: kg.length, towardShare: kg.length ? kg.filter(r => Math.abs(r.b.c - r.s.king) < Math.abs(r.s.spot - r.s.king)).length / kg.length : null },
      insideEm: (() => { const z = rows.filter(r => r.s.emDay > 0); return z.length ? z.filter(r => Math.abs(r.b.c - r.s.spot) <= r.s.emDay).length / z.length : null; })(),
    };
  }
  /* New York date, weekday (0 = Sunday) and minutes after midnight for a time in ms. */
  function nyParts(ms) {
    const u = new Date(ms), y = u.getUTCFullYear(), m = u.getUTCMonth() + 1, d = u.getUTCDate();
    const off = nySummer(y, m, d) ? 4 : 5, t = new Date(ms - off * 3600000);
    return { date: t.toISOString().slice(0, 10), wd: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
  }
  const X = { greeks, cdf, pdf, expiryMs, tauOf, nySummer, nyParts, fillIv, exposures, gexAt, snapshot, levelTest };
  if (typeof module !== "undefined" && module.exports) module.exports = X; else root.Exposure = X;
})(typeof self !== "undefined" ? self : globalThis);
