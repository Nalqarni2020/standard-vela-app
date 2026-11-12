/* Playbook core: the market gate, position sizing, the setup rules, their backtest, the deflated Sharpe ratio,
   day-trade plans and the personal edge report. Pure functions, no DOM, tested in Node (tests_playbook.js). */
(function (root) {
  "use strict";
  // The web desk sets a global Engine; the phone app (React Native) and Node load it from the module next to this file.
  let EngineMod = null;
  const En = () => root.Engine || EngineMod || (EngineMod = require("./engine.js"));

  /* ---------- statistics ---------- */
  // Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7) and inverse (Acklam's algorithm).
  function normCdf(x) {
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function moments(xs) {
    const a = xs.filter(v => v != null && isFinite(v)), n = a.length;
    if (n < 2) return { n, mean: n ? a[0] : null, sd: null, sr: null, skew: 0, kurt: 3 };
    const m = a.reduce((s, x) => s + x, 0) / n;
    let m2 = 0, m3 = 0, m4 = 0; for (const x of a) { const d = x - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
    m2 /= n; m3 /= n; m4 /= n;
    const sd = Math.sqrt(m2 * n / (n - 1));
    return { n, mean: m, sd, sr: sd > 0 ? m / sd : null, skew: m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0, kurt: m2 > 0 ? m4 / (m2 * m2) : 3 };
  }
  /* Deflated Sharpe ratio (Bailey and Lopez de Prado, 2014). sr is per trade, not annualized; n trades; skew and
     kurt (not excess) of the trade returns; trials = how many versions were tried; srVar = variance of the Sharpe
     ratios across those versions. Returns the probability that the true Sharpe is above zero after allowing for
     the best-of-many selection. With one trial it is the probabilistic Sharpe ratio. */
  function deflatedSharpe(o) {
    const { sr, n } = o; if (sr == null || !(n > 2)) return null;
    const N = Math.max(1, Math.round(o.trials || 1)), skew = o.skew || 0, kurt = o.kurt || 3, g = 0.5772156649;
    const sr0 = N > 1 && o.srVar > 0 ? Math.sqrt(o.srVar) * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E))) : 0;
    const den = 1 - skew * sr + (kurt - 1) / 4 * sr * sr;
    if (!(den > 0)) return null;
    return { dsr: normCdf((sr - sr0) * Math.sqrt(n - 1) / Math.sqrt(den)), sr0, trials: N };
  }
  const variance = a => { const v = a.filter(x => x != null && isFinite(x)); if (v.length < 2) return 0; const m = v.reduce((s, x) => s + x, 0) / v.length; return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1); };

  /* ---------- the market gate ----------
     spy, vix: daily bars (closed). pct50: share of the chosen list above its 50-day average, or null.
     Five parts, each +1, 0 or -1. Go: score 2 or more, S&P above its 200-day and VIX at most 30.
     Stand aside: score -1 or lower, or VIX above 35. Otherwise half size. */
  function gate(spy, vix, pct50) {
    const E = En(), parts = [], c = spy.map(b => b.c), i = c.length - 1;
    const s200 = E.sma(c, 200)[i], above200 = s200 != null && c[i] > s200;
    parts.push({ id: "trend", label: "S&P 500 above its 200-day average", value: s200 == null ? "—" : (c[i] / s200 - 1), pts: s200 == null ? 0 : above200 ? 1 : -1, how: "Above = +1, below = −1. Trend-following studies found most large losses came below it (Faber, 2007; Moskowitz, Ooi and Pedersen, 2012)." });
    const reg = spy.length > 30 ? E.regime(spy).state : "Unknown";
    parts.push({ id: "regime", label: "S&P short-term regime", value: reg, pts: reg === "Green" ? 1 : reg === "Red" ? -1 : 0, how: "Green (above a rising 8 and 20-day) = +1, Red = −1." });
    parts.push({ id: "breadth", label: "Your list above its 50-day average", value: pct50, pts: pct50 == null ? 0 : pct50 > 0.6 ? 1 : pct50 < 0.4 ? -1 : 0, how: "Over 60% = +1, under 40% = −1. Most stocks rising makes a long setup easier." });
    const vc = vix.map(b => b.c), vNow = vc.length ? vc[vc.length - 1] : null, v20 = vc.length >= 20 ? E.sma(vc, 20)[vc.length - 1] : null;
    parts.push({ id: "vix", label: "VIX against its 20-day average", value: vNow, v20, pts: vNow == null || v20 == null ? 0 : vNow < v20 && vNow < 20 ? 1 : vNow > v20 && vNow > 25 ? -1 : 0, how: "Under its average and under 20 = +1; over its average and over 25 = −1." });
    parts.push({ id: "stress", label: "VIX above 30", value: vNow, pts: vNow != null && vNow > 30 ? -1 : 0, how: "Above 30 = −1. Stress days have wide ranges and gaps through stops." });
    const score = parts.reduce((s, p) => s + p.pts, 0);
    let verdict = "half";
    if (score <= -1 || (vNow != null && vNow > 35)) verdict = "aside";
    else if (score >= 2 && above200 && (vNow == null || vNow <= 30)) verdict = "go";
    const mult = verdict === "go" ? 1 : verdict === "half" ? 0.5 : 0;
    // Volatility scaling (Moreira and Muir, 2017): when the VIX is above its one-year median, size down in proportion, to half at most.
    const yr = vc.slice(-252).slice().sort((a, b) => a - b), med = yr.length ? yr[yr.length >> 1] : null;
    const volScale = vNow != null && med != null && vNow > med ? Math.max(0.5, med / vNow) : 1;
    return { parts, score, verdict, mult, volScale, sizeMult: mult * volScale, vix: vNow, vixMedian: med, above200 };
  }

  /* ---------- position size ----------
     Risk riskPct of the account times the gate's multiplier between entry and stop; no position above capPct of the account. */
  function sizePlan(o) {
    const per = Math.abs(o.entry - o.stop), side = o.stop < o.entry ? 1 : -1;
    if (!(o.account > 0) || !(per > 0) || !(o.entry > 0)) return { shares: 0, why: "Entry and stop must differ and the account must be above zero." };
    const budget = o.account * o.riskPct * (o.mult == null ? 1 : o.mult);
    const byRisk = Math.floor(budget / per), byCap = Math.floor(o.account * (o.capPct || 1) / o.entry);
    const shares = Math.max(0, Math.min(byRisk, byCap));
    return { shares, side, perShare: per, riskDollars: shares * per, budget, value: shares * o.entry, pctOfAccount: shares * o.entry / o.account,
      limitedBy: shares === 0 ? (budget <= 0 ? "gate" : "price") : byCap < byRisk ? "cap" : "risk",
      t1: o.entry + side * per, t2: o.entry + side * 2 * per, t3: o.entry + side * 3 * per, stopPct: per / o.entry };
  }

  /* ---------- Hodrick-Prescott filter (Kakushadze and Serur, 2018, section 8.1) ----------
     The trend tau minimises sum (y - tau)^2 + lambda * sum (second difference of tau)^2, which is the linear system
     (I + lambda K) tau = y with K = D'D, D the second-difference matrix. The matrix is symmetric, positive definite and
     pentadiagonal, so a banded Cholesky factor (bandwidth 2) solves it in O(n). The factor depends only on n and lambda,
     so it is built once per window and reused. The filter is two-sided: run over a whole history it uses the future.
     Here it is one-sided: for every day it is run on the trailing window only and only its last point is kept. */
  const hpCache = new Map();
  function hpFactor(n, lam) {
    const key = n + ":" + lam; if (hpCache.has(key)) return hpCache.get(key);
    const kd0 = i => (i === 0 || i === n - 1) ? 1 : (i === 1 || i === n - 2) ? 5 : 6, kd1 = i => (i === 0 || i === n - 2) ? -2 : -4;   // K's diagonals (n >= 4)
    const l0 = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n);   // L[i][i], L[i][i-1], L[i][i-2]
    for (let i = 0; i < n; i++) {
      l2[i] = i >= 2 ? lam / l0[i - 2] : 0;
      l1[i] = i >= 1 ? (lam * kd1(i - 1) - (i >= 2 ? l2[i] * l1[i - 1] : 0)) / l0[i - 1] : 0;
      l0[i] = Math.sqrt(1 + lam * kd0(i) - l1[i] * l1[i] - l2[i] * l2[i]);
    }
    const f = { n, l0, l1, l2 }; hpCache.set(key, f); return f;
  }
  // Full trend over y (for tests and charts).
  function hpTrend(y, lam) {
    const n = y.length; if (n < 4 || !(lam > 0)) return Array.from(y);
    const { l0, l1, l2 } = hpFactor(n, lam), z = new Float64Array(n), x = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = (y[i] - (i >= 1 ? l1[i] * z[i - 1] : 0) - (i >= 2 ? l2[i] * z[i - 2] : 0)) / l0[i];
    for (let i = n - 1; i >= 0; i--) x[i] = (z[i] - (i + 1 < n ? l1[i + 1] * x[i + 1] : 0) - (i + 2 < n ? l2[i + 2] * x[i + 2] : 0)) / l0[i];
    return Array.from(x);
  }
  // Last point of the trend only: the forward pass gives it directly (back substitution starts at the end).
  function hpLast(y, from, n, f) {
    let z1 = 0, z2 = 0, z = 0;
    for (let i = 0; i < n; i++) { z = (y[from + i] - (i >= 1 ? f.l1[i] * z1 : 0) - (i >= 2 ? f.l2[i] * z2 : 0)) / f.l0[i]; z2 = z1; z1 = z; }
    return z / f.l0[n - 1];
  }
  const HP = { window: 252, lambda: 100 * 252 * 252, fast: 10, slow: 50 };   // lambda = 100 x (observations a year)^2, the book's rule
  /* One-sided HP trend for every bar (null until a full window), and its fast and slow moving averages. */
  function hpSeries(c) {
    const n = c.length, W = HP.window, T = new Array(n).fill(null), fa = new Array(n).fill(null), sl = new Array(n).fill(null);
    if (n < W) return { T, fast: fa, slow: sl };
    const f = hpFactor(W, HP.lambda);
    for (let i = W - 1; i < n; i++) T[i] = hpLast(c, i - W + 1, W, f);
    const ma = (k, len) => { if (k < W - 1 + len - 1) return null; let s0 = 0; for (let j = k - len + 1; j <= k; j++) s0 += T[j]; return s0 / len; };
    for (let i = W - 1; i < n; i++) { fa[i] = ma(i, HP.fast); sl[i] = ma(i, HP.slow); }
    return { T, fast: fa, slow: sl };
  }

  /* ---------- swing setups on daily bars ---------- */
  function prep(b) {
    const E = En(), c = b.map(x => x.c), v = b.map(x => x.v);
    const hi252 = new Array(b.length).fill(null), hi20 = new Array(b.length).fill(null), lo5 = new Array(b.length).fill(null);
    for (let i = 0; i < b.length; i++) {
      if (i >= 251) { let m = -Infinity; for (let k = i - 251; k <= i; k++) m = Math.max(m, b[k].h); hi252[i] = m; }
      if (i >= 19) { let m = -Infinity; for (let k = i - 19; k <= i; k++) m = Math.max(m, b[k].h); hi20[i] = m; }
      if (i >= 4) { let m = Infinity; for (let k = i - 4; k <= i; k++) m = Math.min(m, b[k].l); lo5[i] = m; }
    }
    const hp = hpSeries(c);
    return { s20: E.sma(c, 20), s50: E.sma(c, 50), s200: E.sma(c, 200), rsi2: E.rsi(c, 2), atr: E.atr(b, 14), v50: E.sma(v, 50), v20: E.sma(v, 20), dv20: E.sma(b.map(x => x.c * x.v), 20), hi252, hi20, lo5, hpT: hp.T, hpF: hp.fast, hpS: hp.slow };
  }
  const SETUPS = [
    { id: "pullback", label: "Pullback in an uptrend", short: "Pullback", cite: "Short-term reversal (Jegadeesh, 1990; Lehmann, 1990) inside a trend (Moskowitz, Ooi and Pedersen, 2012)",
      rule: "Above a rising 200-day with the 50-day over the 200-day; RSI(2) under 10 or three lower closes; still within 5% of the 50-day. Buy above the day's high; stop under the 5-day low." },
    { id: "high52", label: "Near its 52-week high", short: "52-week high", cite: "George and Hwang (2004)",
      rule: "Uptrend as above and the close within 5% of the 52-week high. Buy above the high; stop 2 ATR under the entry." },
    { id: "gap", label: "Gap on heavy volume that held", short: "Gap held", cite: "Post-earnings drift (Bernard and Thomas, 1989) and news gaps",
      rule: "In the last 10 sessions, an opening gap of 4% or more on twice the 50-day volume; no close since under that day's low and the price still over the pre-gap close. Buy above the day's high; stop under the gap day's low. Often an earnings day." },
    { id: "volume", label: "Volume shock on an up day", short: "Volume shock", cite: "Gervais, Kaniel and Mingelgrin (2001)",
      rule: "Volume at least twice the 50-day average, an up close, closing in the upper half of the day's range. Buy above the high; stop under the low." },
    { id: "base", label: "Base breakout after a decline", short: "Base breakout", cite: "Accumulation and breakout (Wyckoff; Weinstein, 1988); measured-move target; tested here, not assumed",
      rule: "The stock fell at least 30% (the base's low against the highest price in the year before the base), then spent 30 sessions inside a range no wider than 25%; today is the first close above the top of that range, on at least 1.5 times the 50-day volume. Buy above the day's high; stop under the base low; target the base top plus the base height." },
    { id: "rbr", label: "Rally-base-rally retest", short: "Base retest", cite: "Demand-zone retest (practitioner); a pullback entry after a confirmed breakout, tested here",
      rule: "Within the last 5 to 30 sessions, a 15-session base no wider than 15% broke out on at least 1.5 times the 50-day volume and then rallied at least one base height; today the price has come back to the top of that base (low within 1% of it) without any close below the base, on light volume (last 3 sessions under 0.8 times the 50-day average). Buy above the day's high; stop under the base low; target the rally's high." },
    { id: "pead", label: "Earnings surprise drift", short: "Earnings drift", cite: "Post-earnings announcement drift (Bernard and Thomas, 1989; Chan, Jegadeesh and Lakonishok, 1996)", noTarget: true, hold: 40,
      rule: "Reported earnings per share beat the estimate by 5% or more and the stock rose 2% or more on the reaction day on at least 1.5 times the 50-day volume; 1 to 5 sessions later, no close under the reaction day's low and the price still over the pre-report close. Buy above the day's high; stop under the reaction day's low; no target: exit after 40 sessions or at the stop." },
    { id: "fvg", label: "Fair value gap retest", short: "FVG retest", cite: "Practitioner pattern (ICT, 'fair value gap'); no published evidence, tested here",
      rule: "A bullish fair value gap in the last 20 sessions: a day whose low is above the high two days earlier, the gap at least 1 ATR wide, closing above the 50-day average. Today is the first day back into the gap (low at or under its top) and the close held above its bottom. Buy above today's high; stop under the gap's bottom; target 2R; 10-day time exit." },
    { id: "hp", label: "HP-filter trend turn", short: "HP trend", cite: "Kakushadze and Serur (2018), section 8.1; Hodrick and Prescott (1997)", trend: true, maxHold: 60,
      rule: "The Hodrick-Prescott trend of the closes, recomputed each day on the past 252 sessions only (lambda 6,350,400), has its 10-day average cross above its 50-day average. Buy above the high; stop 2 ATR under the entry; no target: exit at the next open after the averages cross back down, or after 60 sessions." },
  ];
  // Stops are kept between 0.75 and 2.5 ATR from the entry, so a tiny or huge range cannot make the size absurd.
  function clampStop(entry, stop, a) { const d = Math.min(Math.max(entry - stop, 0.75 * a), 2.5 * a); return entry - d; }
  /* liq: {minPrice, minDollarVol} — a setup needs the close at or above minPrice and a 20-day average dollar volume
     at or above minDollarVol on the signal day, so thin names are skipped in the scanner and the backtest alike. */
  function liquid(b, x, i, liq) { if (!liq) return true; return b[i].c >= (liq.minPrice || 0) && (x.dv20[i] == null ? false : x.dv20[i] >= (liq.minDollarVol || 0)); }
  function setupsAt(b, x, i, liq) {
    const out = []; if (i < 252 || i >= b.length) return out;
    const c = b[i].c, a = x.atr[i]; if (!a || !(a > 0)) return out;
    if (!liquid(b, x, i, liq)) return out;
    const trend = x.s200[i] != null && x.s200[i - 20] != null && c > x.s200[i] && x.s50[i] > x.s200[i] && x.s200[i] >= x.s200[i - 20];
    const mk = (id, entry, stop, target) => {
      const s = SETUPS.find(z => z.id === id); stop = clampStop(entry, stop, a); const risk = entry - stop;
      if (s.trend || s.noTarget) { out.push({ id, label: s.label, entry, stop, target: Infinity, risk, rr: null, trend: !!s.trend, maxHold: s.maxHold, hold: s.hold }); return; }   // trend setups ride until the trend turns; drift setups until their time limit
      if (!(target > entry + 0.5 * risk)) target = entry + 2 * risk; out.push({ id, label: s.label, entry, stop, target, risk, rr: (target - entry) / risk });
    };
    if (trend && ((x.rsi2[i] != null && x.rsi2[i] < 10) || (c < b[i - 1].c && b[i - 1].c < b[i - 2].c && b[i - 2].c < b[i - 3].c)) && c > x.s50[i] * 0.95) {
      const entry = b[i].h + 0.01; mk("pullback", entry, x.lo5[i] - 0.01, x.hi20[i]);
    }
    if (trend && x.hi252[i] != null && c >= 0.95 * x.hi252[i]) { const entry = Math.max(x.hi252[i], b[i].h) + 0.01; mk("high52", entry, entry - 2 * a, null); }
    for (let j = i; j >= Math.max(1, i - 9); j--) {
      if (x.v50[j - 1] == null || !(b[j].o >= 1.04 * b[j - 1].c) || !(b[j].v >= 2 * x.v50[j - 1])) continue;
      let held = c > b[j - 1].c; for (let k = j; k <= i && held; k++) if (b[k].c < b[j].l) held = false;
      if (held) { const entry = b[i].h + 0.01; mk("gap", entry, b[j].l - 0.01, null); }
      break;   // only the most recent qualifying gap counts
    }
    if (x.v50[i - 1] != null && b[i].v >= 2 * x.v50[i - 1] && c > b[i - 1].c && b[i].h > b[i].l && (c - b[i].l) >= 0.5 * (b[i].h - b[i].l)) { const entry = b[i].h + 0.01; mk("volume", entry, b[i].l - 0.01, null); }
    // rally-base-rally retest: breakout from a tight base, a rally away, then a quiet pullback to the top of the base
    if (i >= 60 && x.v50[i] != null) {
      for (let j = i - 5; j >= Math.max(16, i - 30); j--) {
        if (x.v50[j - 1] == null) continue;
        let bh = -Infinity, bl = Infinity; for (let k = j - 15; k <= j - 1; k++) { bh = Math.max(bh, b[k].h); bl = Math.min(bl, b[k].l); }
        if (!(bl > 0) || (bh - bl) / bl > 0.15 || !(b[j].c > bh && b[j - 1].c <= bh && b[j].v >= 1.5 * x.v50[j - 1])) continue;
        let peak = -Infinity, broke = false; for (let k = j; k < i; k++) { peak = Math.max(peak, b[k].h); if (b[k].c < bl) broke = true; }
        const quiet = (b[i].v + b[i - 1].v + b[i - 2].v) / 3 <= 0.8 * x.v50[i];
        if (!broke && peak >= bh + (bh - bl) && b[i].l <= bh * 1.01 && c >= bl && quiet) { const entry = b[i].h + 0.01; mk("rbr", entry, bl - 0.01, peak); }
        break;   // only the most recent breakout counts
      }
    }
    // base breakout: a decline, a 30-session rectangle, and the first close above it on heavy volume
    if (i >= 282 && x.v50[i - 1] != null) {
      let H = -Infinity, bh = -Infinity, bl = Infinity;
      for (let k = i - 282; k <= i - 31; k++) H = Math.max(H, b[k].h);
      for (let k = i - 30; k <= i - 1; k++) { bh = Math.max(bh, b[k].h); bl = Math.min(bl, b[k].l); }
      if (bl > 0 && bl <= 0.7 * H && (bh - bl) / bl <= 0.25 && c > bh && b[i - 1].c <= bh && b[i].v >= 1.5 * x.v50[i - 1]) { const entry = b[i].h + 0.01; mk("base", entry, bl - 0.01, bh + (bh - bl)); }
    }
    // fair value gap retest: the most recent qualifying bullish gap in the last 20 sessions, first touched today and held
    for (let f = i - 1; f >= Math.max(2, i - 20); f--) {
      const top = b[f].l, bot = b[f - 2].h, af = x.atr[f];
      if (!(top > bot) || !(af > 0) || top - bot < af || !(x.s50[f] != null && b[f].c > x.s50[f])) continue;
      let first = true; for (let k = f + 1; k < i; k++) if (b[k].l <= top) { first = false; break; }
      if (first && b[i].l <= top && c >= bot) { const entry = b[i].h + 0.01; mk("fvg", entry, bot - 0.01, null); }
      break;   // only the most recent qualifying gap counts
    }
    // earnings surprise drift: needs x.earn from earnEvents (reported EPS against the estimate, mapped to the reaction day)
    if (x.earn && x.earn.length) {
      for (const ev of x.earn) {
        const r = ev.i, since = i - r; if (since < 1 || since > 5 || r < 1 || x.v50[r - 1] == null) continue;
        if (!(ev.surprise >= 0.05 && b[r].c / b[r - 1].c - 1 >= 0.02 && b[r].v >= 1.5 * x.v50[r - 1])) continue;
        let held = c > b[r - 1].c; for (let k = r + 1; k <= i && held; k++) if (b[k].c < b[r].l) held = false;
        if (held) { const entry = b[i].h + 0.01; mk("pead", entry, b[r].l - 0.01, null); }
        break;
      }
    }
    if (x.hpF && x.hpF[i] != null && x.hpF[i - 1] != null && x.hpF[i] > x.hpS[i] && x.hpF[i - 1] <= x.hpS[i - 1]) { const entry = b[i].h + 0.01; mk("hp", entry, entry - 2 * a, null); }
    return out;
  }

  /* Backtest of exactly the rules above. A setup on day i's close places a buy-stop for day i+1 only. Inside each
     daily bar the price is assumed to travel open, low, high, close on an up day and open, high, low, close on a
     down day (a common convention; the true order is unknown). The buy-stop fills at the entry, or at the open when
     the open gaps above it. Exit: the stop (at the open when it gaps through), the target, or the close after `hold`
     bars. Costs: cost per side. One open trade per setup per name. Returns trades in R and in percent. */
  const pathOf = bar => bar.c >= bar.o ? [bar.o, bar.l, bar.h, bar.c] : [bar.o, bar.h, bar.l, bar.c];
  function simulate(b, x, o) {
    o = Object.assign({ hold: 10, cost: 0.0005, from: 252 }, o || {});
    const trades = [], next = {};
    for (let i = o.from; i < b.length - 1; i++) {
      for (const s of setupsAt(b, x, i, o.liq)) {
        if ((next[s.id] || 0) > i) continue;
        const k = i + 1; if (!(b[k].h >= s.entry)) continue;
        let filled = false, fill = null, exit = null, why = "", j = k;
        for (; j < b.length; j++) {
          const pts = pathOf(b[j]);
          for (let p = 0; p < pts.length && exit == null; p++) {
            const q = pts[p], a = p ? pts[p - 1] : null;
            if (!filled) {
              if (p === 0) { if (q >= s.entry) { filled = true; fill = q; } continue; }
              if (!(a < s.entry && q >= s.entry)) continue;
              filled = true; fill = s.entry;
              if (q >= s.target) { exit = s.target; why = "Target"; }
              continue;
            }
            if (p === 0) { if (q <= s.stop) { exit = q; why = "Stop"; } else if (q >= s.target) { exit = q; why = "Target"; } continue; }
            if (q <= s.stop && a > s.stop) { exit = s.stop; why = "Stop"; }
            else if (q >= s.target && a < s.target) { exit = s.target; why = "Target"; }
          }
          if (exit != null || !filled) break;
          // a trend setup leaves at the next open once its averages cross back down (known at this close)
          if (s.trend && x.hpF[j] != null && x.hpS[j] != null && x.hpF[j] < x.hpS[j] && j + 1 < b.length) { j = j + 1; exit = b[j].o; why = "Trend turned"; break; }
          if (j - k + 1 >= (s.trend ? s.maxHold : s.hold || o.hold)) { exit = b[j].c; why = "Time"; break; }
        }
        if (!filled) continue;
        const risk = fill - s.stop; if (!(risk > 0)) continue;
        let open = false; if (exit == null) { j = b.length - 1; exit = b[j].c; why = "Open"; open = true; }
        const R = (exit - fill) / risk - (2 * o.cost * fill) / risk;
        const volUp = x.v20 && x.v20[i] != null && x.v20[i - 20] != null ? x.v20[i] > x.v20[i - 20] : null;   // 20-day average volume higher than 20 sessions earlier
        trades.push({ id: s.id, d: b[k].d, t: b[k].t, fill, stop: s.stop, target: s.target, exit, R, volUp, ret: exit / fill - 1 - 2 * o.cost, bars: j - k + 1, why, open });
        next[s.id] = j + 1;
      }
    }
    return trades;
  }
  function rSummary(trades) {
    const R = trades.map(t => t.R), m = moments(R), w = R.filter(r => r > 0), l = R.filter(r => r <= 0);
    const sw = w.reduce((s, r) => s + r, 0), sl = l.reduce((s, r) => s + r, 0);
    return { n: R.length, win: R.length ? w.length / R.length : null, expR: m.mean, pf: sl < 0 ? sw / -sl : (sw > 0 ? Infinity : null), sr: m.sr, skew: m.skew, kurt: m.kurt,
      t: m.sr != null ? m.sr * Math.sqrt(R.length) : null, avgBars: trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : null };
  }
  /* sets: [{sym, bars}]. Splits by entry date at `split` (first 70% of the period by default) and deflates each
     setup's Sharpe for every version tried: trials and priorSrs carry earlier runs with other settings. */
  function evidence(sets, o) {
    o = Object.assign({ hold: 10, cost: 0.0005, trainShare: 0.7, trials: 0, priorSrs: [] }, o || {});
    let t0 = Infinity, t1 = -Infinity; sets.forEach(s => { if (s.bars.length) { t0 = Math.min(t0, s.bars[0].t); t1 = Math.max(t1, s.bars[s.bars.length - 1].t); } });
    const split = isFinite(t0) ? new Date(t0 + (t1 - t0) * o.trainShare).toISOString().slice(0, 10) : null;
    const all = []; const bySym = {};
    for (const s of sets) { if (s.bars.length < 270) continue; const tr = simulate(s.bars, s.x || prep(s.bars), o); tr.forEach(t => { t.sym = s.sym; all.push(t); }); bySym[s.sym] = tr; }
    const rows = SETUPS.map(s => { const tr = all.filter(t => t.id === s.id); return Object.assign({ id: s.id, label: s.label, cite: s.cite }, rSummary(tr), { train: rSummary(tr.filter(t => t.d < split)), test: rSummary(tr.filter(t => t.d >= split)), volUp: rSummary(tr.filter(t => t.volUp === true)), volDown: rSummary(tr.filter(t => t.volUp === false)) }); });
    const srs = rows.map(r => r.sr).filter(v => v != null).concat(o.priorSrs || []);
    const trials = Math.max(rows.length, o.trials || 0), srVar = variance(srs);
    rows.forEach(r => { r.deflated = deflatedSharpe({ sr: r.sr, n: r.n, skew: r.skew, kurt: r.kurt, trials, srVar }); r.verdict = verdictOf(r); });
    return { rows, split, trials, srVar, trades: all, bySym, names: Object.keys(bySym).length };
  }
  function verdictOf(r) {
    if (r.n < 30) return { key: "thin", text: "Too few trades to judge" };
    const d = r.deflated ? r.deflated.dsr : 0;
    if (r.expR > 0 && r.test.n >= 10 && r.test.expR > 0 && d >= 0.95) return { key: "holds", text: "Held up, including on later data" };
    if (r.expR > 0 && r.test.expR > 0) return { key: "maybe", text: "Positive, but could be luck" };
    return { key: "no", text: "Did not pay on this list" };
  }

  /* ---------- day-trade plans ---------- */
  // Approximate share of a US session's volume done by each minute after the open (a U shape: heavy at both ends).
  const VOL_CURVE = [[0, 0], [5, 0.05], [30, 0.17], [60, 0.27], [90, 0.35], [120, 0.42], [150, 0.48], [180, 0.53], [210, 0.58], [240, 0.63], [270, 0.68], [300, 0.74], [330, 0.80], [360, 0.88], [390, 1]];
  function volShare(minAfterOpen) {
    const m = Math.max(0, Math.min(390, minAfterOpen));
    for (let k = 1; k < VOL_CURVE.length; k++) { const [m1, s1] = VOL_CURVE[k], [m0, s0] = VOL_CURVE[k - 1]; if (m <= m1) return s0 + (s1 - s0) * (m - m0) / (m1 - m0); }
    return 1;
  }
  // Projected relative volume: today's volume so far, scaled up to a full day by the volume curve, over the average.
  function projRvol(volToday, avgVol, nyMin) { if (!(avgVol > 0) || volToday == null) return null; const sh = volShare(nyMin - 570); return sh > 0.02 ? volToday / sh / avgVol : null; }
  /* 5-minute opening-range breakout (Zarattini, Barbon and Aziz, 2024; the desk's lab version): the first bar's
     direction sets the side; enter beyond its far end; stop at its other end; exit at the stop or the close. */
  function orbPlan(bars5, nyMinNow) {
    const E = En(), d = bars5.map(b => Object.assign({ m: E.ny(b.t).min }, b)).sort((a, b) => a.t - b.t);
    const f = d.find(b => b.m === 570);
    if (!f) return { state: nyMinNow < 575 ? "forming" : "nodata" };
    if (nyMinNow < 575) return { state: "forming" };
    const dir = f.c > f.o ? 1 : f.c < f.o ? -1 : 0;
    if (!dir) return { state: "flat", first: f };
    const entry = dir > 0 ? f.h + 0.01 : f.l - 0.01, stop = dir > 0 ? f.l - 0.01 : f.h + 0.01;
    let state = "waiting", hitAt = null;
    for (const b of d) { if (b.m <= 570) continue; if (!hitAt && (dir > 0 ? b.h >= entry : b.l <= entry)) { hitAt = b.m; state = "triggered"; } if (hitAt && (dir > 0 ? b.l <= stop : b.h >= stop)) { state = "stopped"; break; } }
    return { state, dir, entry, stop, first: f, last: d[d.length - 1].c };
  }
  /* Intraday momentum (Gao, Han, Li and Zhou, 2018): the return from yesterday's close to 10:00 sets the side for 15:30 to the close. */
  function halfHour(bars5, prevClose, nyMinNow) {
    const E = En(), b10 = bars5.find(b => E.ny(b.t).min === 595);
    if (nyMinNow < 600 || !b10 || !(prevClose > 0)) return { state: "forming" };
    const r = b10.c / prevClose - 1;
    return { state: nyMinNow < 930 ? "waiting" : nyMinNow < 960 ? "window" : "done", dir: Math.sign(r), r };
  }

  /* ---------- your edge ----------
     trips: from Analytics.roundTrips, each optionally annotated with entryMin (NY minute), gate ("go"|"half"|"aside"),
     setups (ids true on the close before entry). Groups compare like with like; lessons need 5 trades a side. */
  function edgeReport(trips) {
    const E = En(), T = trips.slice().sort((a, b) => a.entryT - b.entryT);
    const st = g => { if (!g.length) return null; const w = g.filter(t => t.pnl > 0), l = g.filter(t => t.pnl <= 0), gw = w.reduce((s, t) => s + t.pnl, 0), gl = l.reduce((s, t) => s + t.pnl, 0);
      return { n: g.length, win: w.length / g.length, pnl: gw + gl, exp: (gw + gl) / g.length, avgRet: g.reduce((s, t) => s + t.ret, 0) / g.length, pf: gl < 0 ? gw / -gl : (gw > 0 ? Infinity : null), avgWin: w.length ? gw / w.length : null, avgLoss: l.length ? gl / l.length : null }; };
    // order by exit for the running result, losing streaks and the drawdown
    const byExit = T.slice().sort((a, b) => a.exitT - b.exitT); let cum = 0, peak = 0, dd = 0, streak = 0, worst = 0; const curve = [];
    for (const t of byExit) { cum += t.pnl; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); streak = t.pnl <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); curve.push({ d: E.ny(t.exitT).date, v: cum }); }
    // what came just before each entry: the last trade closed before it
    T.forEach(t => { const prev = byExit.filter(p => p.exitT < t.entryT).pop(); t.afterLoss = prev ? prev.pnl <= 0 : null; t.entryDay = t.entryDay || E.ny(t.entryT).date; t.sameDay = E.ny(t.exitT).date === t.entryDay; });
    const perDay = {}; T.forEach(t => { perDay[t.entryDay] = (perDay[t.entryDay] || 0) + 1; });
    const sizes = T.map(t => t.entryPx * t.qty).sort((a, b) => a - b), bigCut = sizes[Math.floor(sizes.length * 2 / 3)] || Infinity;
    const groups = [
      ["How long you held", [["Same day", t => t.sameDay], ["1 to 5 days", t => !t.sameDay && t.holdDays <= 5], ["6 to 20 days", t => t.holdDays > 5 && t.holdDays <= 20], ["Over 20 days", t => t.holdDays > 20]]],
      ["When you bought", [["Extended hours", t => t.entryExt], ["9:30 to 10:00", t => !t.entryExt && t.entryMin < 600], ["10:00 to 11:00", t => !t.entryExt && t.entryMin >= 600 && t.entryMin < 660], ["11:00 to 14:00", t => !t.entryExt && t.entryMin >= 660 && t.entryMin < 840], ["14:00 to 16:00", t => !t.entryExt && t.entryMin >= 840]]],
      ["The market gate when you bought", [["Go", t => t.gate === "go"], ["Half size", t => t.gate === "half"], ["Stand aside", t => t.gate === "aside"]]],
      ["Setup on the close before you bought", SETUPS.map(s => [s.label, t => !!(t.setups && t.setups.includes(s.id))]).concat([["None of the four", t => Array.isArray(t.setups) && !t.setups.length]])],
      ["Your state of mind", [["Right after a loss", t => t.afterLoss === true], ["Right after a win", t => t.afterLoss === false]]],
      ["How busy you were", [["Days with 4 or more buys", t => perDay[t.entryDay] >= 4], ["Days with 1 to 3 buys", t => perDay[t.entryDay] < 4]]],
      ["How big the position was", [["Your largest third", t => t.entryPx * t.qty >= bigCut], ["The rest", t => t.entryPx * t.qty < bigCut]]],
      ["Planning", [["With a saved plan", t => !!t.plan], ["Without a plan", t => t.plan === null]]],
    ].concat(T.some(t => t.broker === "wb") ? [["Broker", [["Robinhood", t => t.broker !== "wb"], ["Webull", t => t.broker === "wb"]]]] : []).map(([title, defs]) => ({ title, rows: defs.map(([label, f]) => ({ label, s: st(T.filter(f)) })) }));
    const all = st(T), lessons = [], money = v => (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(0);
    const cmp = (gTitle, a, b, say) => { const g = groups.find(x => x.title === gTitle); const A = g.rows.find(r => r.label === a).s, B = g.rows.find(r => r.label === b).s; if (A && B && A.n >= 5 && B.n >= 5 && Math.abs(A.exp - B.exp) > Math.max(5, Math.abs(all.exp) * 0.25)) lessons.push({ w: Math.abs(A.exp - B.exp) * Math.min(A.n, B.n), text: say(A, B) }); };
    cmp("Your state of mind", "Right after a loss", "Right after a win", (A, B) => A.exp < B.exp ? `Trades right after a loss made ${money(A.exp)} each, against ${money(B.exp)} after a win. Consider a pause after a loss.` : `You traded better right after a loss (${money(A.exp)} each) than after a win (${money(B.exp)}). Watch for overconfidence after wins.`);
    cmp("How busy you were", "Days with 4 or more buys", "Days with 1 to 3 buys", (A, B) => A.exp < B.exp ? `On busy days (4 or more buys) each trade made ${money(A.exp)}, against ${money(B.exp)} on quieter days. More trades did not mean more profit (Barber and Odean, 2000).` : `Your busy days did better (${money(A.exp)} a trade) than quiet ones (${money(B.exp)}).`);
    cmp("The market gate when you bought", "Go", "Half size", (A, B) => `Buys on Go days made ${money(A.exp)} each; on Half-size days ${money(B.exp)}.`);
    cmp("The market gate when you bought", "Go", "Stand aside", (A, B) => `Buys on Go days made ${money(A.exp)} each; on Stand-aside days ${money(B.exp)}.`);
    cmp("How long you held", "Same day", "1 to 5 days", (A, B) => `Same-day trades made ${money(A.exp)} each; 1 to 5 day swings ${money(B.exp)}.`);
    cmp("How big the position was", "Your largest third", "The rest", (A, B) => A.exp < B.exp ? `Your biggest positions did worse per dollar of result (${money(A.exp)} a trade against ${money(B.exp)}). Size is best set by the stop, not by conviction.` : `Your biggest positions made ${money(A.exp)} a trade, the rest ${money(B.exp)}.`);
    if (groups.some(g => g.title === "Broker")) cmp("Broker", "Robinhood", "Webull", (A, B) => `Your Robinhood trades made ${money(A.exp)} each; your Webull trades ${money(B.exp)}.`);
    cmp("Planning", "With a saved plan", "Without a plan", (A, B) => `Trades with a saved plan made ${money(A.exp)} each; trades without one made ${money(B.exp)}.`);
    const setupG = groups.find(g => g.title.startsWith("Setup")).rows, none = setupG[setupG.length - 1].s, anyS = st(T.filter(t => t.setups && t.setups.length));
    if (anyS && none && anyS.n >= 5 && none.n >= 5) lessons.push({ w: Math.abs(anyS.exp - none.exp) * Math.min(anyS.n, none.n), text: `Buys that matched one of the four setups made ${money(anyS.exp)} each; buys that matched none made ${money(none.exp)}.` });
    const timeG = groups.find(g => g.title === "When you bought").rows.filter(r => r.s && r.s.n >= 5).sort((a, b) => a.s.exp - b.s.exp);
    if (timeG.length >= 2 && timeG[0].s.exp < 0) lessons.push({ w: Math.abs(timeG[0].s.exp) * timeG[0].s.n, text: `Your weakest buying time is ${timeG[0].label}: ${money(timeG[0].s.exp)} a trade over ${timeG[0].s.n} trades. Your best is ${timeG[timeG.length - 1].label} (${money(timeG[timeG.length - 1].s.exp)}).` });
    if (all && all.avgWin != null && all.avgLoss != null && Math.abs(all.avgLoss) > all.avgWin && all.win < 0.6) lessons.push({ w: 1e9, text: `Your average loss (${money(all.avgLoss)}) is bigger than your average win (${money(all.avgWin)}) and you win ${(all.win * 100).toFixed(0)}% of the time. A stop set at entry, at most 1R, fixes the first half of that.` });
    lessons.sort((a, b) => b.w - a.w);
    return { all, groups, lessons: lessons.map(l => l.text), curve, maxDD: dd, worstStreak: worst };
  }

  /* ---------- earnings ----------
     Weekday sessions from `from` (YYYY-MM-DD, exclusive) to `to` (inclusive). Holidays are not removed, so this can
     count one session too many around a holiday; the warning errs early, never late. */
  function sessionsUntil(from, to) {
    if (!from || !to || to < from) return to === from ? 0 : null;
    let n = 0, t = Date.parse(from + "T12:00:00Z"); const end = Date.parse(to + "T12:00:00Z");
    while (t < end) { t += 86400000; const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
    return n;
  }
  /* reports: [{date, timing}] from Robinhood. The next report on or after today; an "am" report today has already happened once the session opened. */
  function nextReport(reports, today, nyMin) {
    const up = (reports || []).filter(r => r.date && (r.date > today || (r.date === today && !(r.timing === "am" && nyMin >= 570)))).sort((a, b) => a.date < b.date ? -1 : 1)[0];
    if (!up) return null;
    const sess = sessionsUntil(today, up.date);
    // the gap risk lands on the first session after the report: the same day for "am", the next day for "pm"
    return Object.assign({}, up, { sessions: sess, gapIn: up.timing === "pm" ? sess + 1 : sess });
  }
  /* A holding through earnings: true when the report's gap would land within `hold` sessions. */
  const earningsInside = (rep, hold) => !!(rep && rep.gapIn != null && rep.gapIn <= hold);

  /* ---------- plans against trades ----------
     plans: [{id, sym, side, entry, stop, date (YYYY-MM-DD), hold}]. A round trip uses the latest long plan for the same
     symbol made on or up to 7 calendar days before its entry day. Adds plan, R (on the plan's risk), slip (entry
     against the planned entry), keptStop (exit no worse than the stop by more than a quarter of the risk) and overHold. */
  function matchPlans(trips, plans) {
    const E = En();
    trips.forEach(t => {
      const day = t.entryDay || E.ny(t.entryT).date, lim = new Date(Date.parse(day + "T12:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
      const p = (plans || []).filter(q => q.sym === t.symbol && (q.side || "long") === "long" && q.date <= day && q.date >= lim && q.entry > q.stop).sort((a, b) => a.date < b.date ? 1 : -1)[0];
      if (!p) { t.plan = null; return; }
      const risk = p.entry - p.stop;
      t.plan = p; t.R = (t.exitPx - t.entryPx) / risk; t.slip = t.entryPx / p.entry - 1;
      t.keptStop = t.exitPx >= p.stop - 0.25 * risk; t.overHold = p.hold ? sessionsUntil(day, E.ny(t.exitT).date) > p.hold : false;
    });
    const planned = trips.filter(t => t.plan);
    if (!planned.length) return { n: 0 };
    const R = planned.map(t => t.R), m = moments(R);
    // by the pre-trade checklist's verdict when the plan was saved (go / wait / no)
    const byCheck = {}; ["go", "wait", "no"].forEach(k => { const z = planned.filter(t => t.plan.check === k).map(t => t.R); if (z.length) byCheck[k] = { n: z.length, expR: z.reduce((a, b) => a + b, 0) / z.length, win: z.filter(r => r > 0).length / z.length }; });
    return { n: planned.length, expR: m.mean, win: R.filter(r => r > 0).length / R.length, brokeStop: planned.filter(t => !t.keptStop).length, overHold: planned.filter(t => t.overHold).length,
      avgSlip: planned.reduce((s, t) => s + t.slip, 0) / planned.length, worstR: Math.min(...R), byCheck };
  }

  /* ---------- managing an open position ----------
     pos: {entry, stop (initial), date (entry day), hold, halfTaken}. bars: daily, closed. Trailing stop: the highest
     high since entry minus 3 ATR (the Edge lab's trail), never under the initial stop; after half is taken at 1R the
     stop is at least break-even. Returns R now, the active stop and what to do. */
  function manage(pos, bars, last, today) {
    const E = En(), risk = pos.entry - pos.stop; if (!(risk > 0)) return null;
    const A = E.atr(bars, 14), a = A[A.length - 1];
    const since = bars.filter(b => b.d >= pos.date), hi = since.length ? Math.max(...since.map(b => b.h)) : pos.entry;
    let stop = pos.stop; if (a != null) stop = Math.max(stop, hi - 3 * a);
    if (pos.halfTaken) stop = Math.max(stop, pos.entry);
    const R = (last - pos.entry) / risk, held = sessionsUntil(pos.date, today);
    const todo = [];
    if (last <= stop) todo.push({ k: "exit", text: "At or under the stop: exit" });
    if (!pos.halfTaken && R >= 1) todo.push({ k: "half", text: "Up 1R: take half, move the stop to break-even" });
    if (pos.hold && held != null && held >= pos.hold) todo.push({ k: "time", text: `Held ${held} sessions, plan was ${pos.hold}: exit or re-plan` });
    return { R, stop, stopR: (stop - pos.entry) / risk, hi, atr: a, held, todo };
  }

  /* ---------- Bottom watch: you don't predict bottoms, you confirm them ----------
     idx: daily bars of an index fund (SPY or QQQ); vix: [{d, c}]; leaders: [{bars}] (optional, e.g. the list's stocks).
     1 Capitulation: in the last 25 sessions, a day down 2.5% or more on at least 2x the 50-day volume (the latest one).
     2 Fear spike: the VIX's highest close within 2 sessions of that day is at least 40% above its close 5 sessions before.
     3 Selling slows: the last 3 sessions' average range is at most 60% of the capitulation day's, and their average
       volume at most 70% of its volume (needs 3 sessions after it).
     4 Leaders hold up: of the list's stocks that beat the index over the 63 sessions before capitulation (top third),
       at least 60% have not traded below their capitulation-day low since.
     5 Follow-through day (O'Neil): the low is the lowest low since capitulation. Day 1 of a rally attempt is the first
       up close after that low. On day 4 or later, a close up 1.25% or more on higher volume than the day before
       confirms. A trade below the low resets the count ("undercut = start over"). */
  function bottomWatch(idx, vix, leaders) {
    const n = idx.length, E = En(); if (n < 80) return null;
    const v50 = E.sma(idx.map(b => b.v), 50), out = { signs: [] };
    let C = -1; for (let i = n - 1; i >= Math.max(1, n - 25); i--) { if (v50[i - 1] != null && idx[i].c / idx[i - 1].c - 1 <= -0.025 && idx[i].v >= 2 * v50[i - 1]) { C = i; break; } }
    if (C < 0) { out.capitulation = null; out.signs = [false, false, false, false, false]; out.state = "none"; return out; }
    const cb = idx[C];
    out.capitulation = { d: cb.d, ret: cb.c / idx[C - 1].c - 1, volX: cb.v / v50[C - 1], low: cb.l };
    // 2 fear
    const vi = new Map(vix.map((x, k) => [x.d, k])), kC = vi.get(cb.d);
    let fear = null;
    if (kC != null && kC >= 5) { let hi = -Infinity; for (let k = kC - 2; k <= Math.min(vix.length - 1, kC + 2); k++) hi = Math.max(hi, vix[k].c); fear = { from: vix[kC - 5].c, peak: hi, chg: hi / vix[kC - 5].c - 1 }; }
    out.fear = fear;
    // 3 selling slows
    let slows = null;
    if (n - 1 - C >= 3) { const last = idx.slice(n - 3), rng = b => b.h - b.l; slows = { rangeRatio: last.reduce((s0, b) => s0 + rng(b), 0) / 3 / rng(cb), volRatio: last.reduce((s0, b) => s0 + b.v, 0) / 3 / cb.v }; slows.ok = slows.rangeRatio <= 0.6 && slows.volRatio <= 0.7; }
    out.slows = slows;
    // 4 leaders
    let lead = null;
    if (leaders && leaders.length && C >= 63) {
      const ir = idx[C].c / idx[C - 63].c - 1;
      const rs = leaders.map(L => { const k = L.bars.findIndex(b => b.d === cb.d); if (k < 63) return null; return { L, k, rs: L.bars[k].c / L.bars[k - 63].c - 1 - ir }; }).filter(Boolean).sort((a, b) => b.rs - a.rs);
      const top = rs.slice(0, Math.max(1, Math.round(rs.length / 3)));
      if (top.length >= 3) { const held = top.filter(z => z.L.bars.slice(z.k + 1).every(b => b.l >= z.L.bars[z.k].l)).length; lead = { n: top.length, held, share: held / top.length, ok: held / top.length >= 0.6 }; }
    }
    out.leaders = lead;
    // 5 rally attempt and follow-through
    let low = C; for (let i = C + 1; i < n; i++) if (idx[i].l < idx[low].l) low = i;
    let day1 = -1; for (let i = low + 1; i < n; i++) if (idx[i].c > idx[i - 1].c) { day1 = i; break; }
    let ftd = null;
    if (day1 > 0) for (let i = day1 + 3; i < n; i++) { if (idx[i].c / idx[i - 1].c - 1 >= 0.0125 && idx[i].v > idx[i - 1].v) { ftd = { d: idx[i].d, ret: idx[i].c / idx[i - 1].c - 1, day: i - day1 + 1 }; break; } }
    out.rally = { lowD: idx[low].d, low: idx[low].l, day1: day1 > 0 ? idx[day1].d : null, dayCount: day1 > 0 ? n - day1 : 0, earliestFtdIn: day1 > 0 ? Math.max(0, 4 - (n - day1)) : null, ftd };
    out.signs = [true, !!(fear && fear.chg >= 0.4), !!(slows && slows.ok), !!(lead && lead.ok), !!ftd];
    out.state = ftd ? "confirmed" : out.signs.slice(0, 4).filter(Boolean).length >= 2 ? "forming" : "early";
    return out;
  }

  /* ---------- Movers: check a ranking's numbers, grade liquidity, and test what such moves did next ---------- */
  /* Does the broker's reported move match the price history? `k` sessions back from `price`; `todayInBars` says whether
     the last daily bar is the same session as `price`. Reverse splits, ticker changes and new listings fail this. */
  function checkMove(b, price, reported, k, todayInBars) {
    const n = b.length, ref = todayInBars ? n - 1 - k : n - k;
    if (!(price > 0) || reported == null || !isFinite(reported) || ref < 0 || !(b[ref] && b[ref].c > 0)) return { ok: null, hist: null };
    const hist = price / b[ref].c - 1;
    return { ok: Math.abs(hist - reported) <= Math.max(0.03, 0.25 * Math.abs(reported)), hist };
  }
  /* Trading liquidity: price, 20-day dollar volume and the live spread against your limits, and how big your position
     would be next to a day's trading. Deep: $100M+ a day and a spread of 0.1% or less; good: $20M+ and 0.3% or less. */
  function liquidityGrade(o) {
    const why = [];
    if (o.price != null && o.price < (o.minPrice || 0)) why.push("under $" + o.minPrice);
    if (o.dv20 == null) why.push("no volume history");
    else if (o.dv20 < (o.minDollarVol || 0)) why.push("under $" + Math.round(o.minDollarVol / 1e6) + "M a day");
    if (o.spread != null && o.maxSpread != null && o.spread > o.maxSpread) why.push("spread " + (o.spread * 100).toFixed(2) + "%");
    const share = o.position > 0 && o.dv20 > 0 ? o.position / o.dv20 : null;
    if (share != null && share > 0.01) why.push("your size is " + (share * 100).toFixed(1) + "% of a day's trading");
    const sp = o.spread == null ? 0 : o.spread;
    const key = why.length ? (share != null && share > 0.01 && why.length === 1 ? "thin" : "no") : o.dv20 >= 1e8 && sp <= 0.001 ? "deep" : o.dv20 >= 2e7 && sp <= 0.003 ? "good" : "thin";
    return { key, label: { deep: "Deep", good: "Good", thin: "Thin", no: "Avoid" }[key], why, share };
  }
  const MOVES = [
    { id: "g5", label: "5-day gainer (+15% or more)", dir: 1 },
    { id: "l5", label: "5-day loser (−15% or worse)", dir: -1 },
    { id: "gu", label: "Gap up (opens 4%+ above the close)", dir: 1 },
    { id: "gd", label: "Gap down (opens 4%+ below the close)", dir: -1 },
    { id: "vu", label: "Volume leader, up day (3× volume)", dir: 1 },
    { id: "vd", label: "Volume leader, down day (3× volume)", dir: -1 },
  ];
  /* Event study on the list's history: after each kind of move (counted at most once a week per stock), buy the next
     open and measure the return to the close 1, 5 and 10 sessions later, net of costs, against the same stocks' average
     5-day return over all liquid days. Each kind is split in two: on heavy volume or not (5-day moves); held or faded
     (gaps, by the gap day's close against its open); and for volume leaders, closing in the top or bottom half of the range. */
  function moverStudy(sets, o) {
    o = o || {}; const cost = o.cost == null ? 0.0005 : o.cost, H = [1, 5, 10];
    const ev = {}; MOVES.forEach(m => { ev[m.id] = []; });
    let baseSum = 0, baseN = 0;
    for (const s of sets) {
      const b = s.bars, x = s.x || prep(b), last = {};
      for (let i = 55; i < b.length - 11; i++) {
        if (x.v50[i - 1] == null || !liquid(b, x, i, o.liq)) continue;
        const e = b[i + 1].o; if (!(e > 0)) continue;
        const fw = H.map(h => b[i + h].c / e - 1 - 2 * cost);
        baseSum += fw[1]; baseN++;
        const r5 = b[i].c / b[i - 5].c - 1, gap = b[i].o / b[i - 1].c - 1, vx = b[i].v / x.v50[i - 1];
        const v5 = (b[i].v + b[i - 1].v + b[i - 2].v + b[i - 3].v + b[i - 4].v) / 5 >= 1.5 * x.v50[i - 1];
        const upper = b[i].h > b[i].l ? (b[i].c - b[i].l) / (b[i].h - b[i].l) >= 0.5 : true;
        const hit = (id, split) => { if (last[id] != null && i - last[id] < 5) return; last[id] = i; ev[id].push({ fw, split, sym: s.sym, d: b[i].d }); };
        if (r5 >= 0.15) hit("g5", v5); else if (r5 <= -0.15) hit("l5", v5);
        if (gap >= 0.04) hit("gu", b[i].c >= b[i].o); else if (gap <= -0.04) hit("gd", b[i].c <= b[i].o);
        if (vx >= 3) { if (b[i].c > b[i - 1].c) hit("vu", upper); else if (b[i].c < b[i - 1].c) hit("vd", !upper); }
      }
    }
    const base = baseN ? baseSum / baseN : 0;
    const stat = a => { const n = a.length; if (!n) return { n: 0, mean: null, win: null, t: null }; const m = a.reduce((s, v) => s + v, 0) / n; const sd = n > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0; return { n, mean: m, win: a.filter(v => v > 0).length / n, t: sd > 0 ? m / (sd / Math.sqrt(n)) : null }; };
    const SPLIT = { g5: ["On heavy volume", "On light volume"], l5: ["On heavy volume", "On light volume"], gu: ["Gap held (closed above the open)", "Gap faded"], gd: ["Kept falling (closed below the open)", "Recovered from the open"], vu: ["Closed near the high", "Closed near the low"], vd: ["Closed near the low", "Closed near the high"] };
    const rows = MOVES.map(m => {
      const a = ev[m.id], h = {}; H.forEach((hh, k) => { h[hh] = stat(a.map(z => z.fw[k])); });
      const ex = stat(a.map(z => z.fw[1] - base));
      const sp = [true, false].map((v, k) => { const z = a.filter(q => q.split === v); const st = stat(z.map(q => q.fw[1] - base)); return { label: SPLIT[m.id][k], n: st.n, excess5: st.mean, win5: z.length ? z.filter(q => q.fw[1] > 0).length / z.length : null, t: st.t }; });
      let verdict;
      if (ex.n < 30) verdict = { key: "thin", text: "Too few cases on this list to say." };
      else if (ex.t != null && Math.abs(ex.t) >= 2 && Math.abs(ex.mean) >= 0.005) verdict = Math.sign(ex.mean) === m.dir ? { key: "cont", text: "Kept going: the next week beat a normal week in the same direction." } : { key: "rev", text: "Reversed: the next week went against the move." };
      else verdict = { key: "none", text: "No reliable edge: the next week looked like a normal week." };
      return { id: m.id, label: m.label, dir: m.dir, n: a.length, h, excess5: ex.mean, t: ex.t, split: sp, verdict, recent: a.slice().sort((p, q) => q.d < p.d ? -1 : 1).slice(0, 3).map(z => z.sym + " " + z.d) };
    });
    return { rows, base, days: baseN, names: sets.length };
  }

  /* ---------- Earnings events for the drift setup ---------- */
  /* results: Robinhood earnings rows [{eps: {estimate, actual}, report: {date, timing}}]. The reaction day is the report
     date for a report before the open ("am") and the next session otherwise. surprise = (actual - estimate) / |estimate|,
     with the estimate floored at 5 cents so tiny estimates don't explode it. */
  function earnEvents(b, results) {
    const out = [];
    for (const r of results || []) {
      const e = r && r.eps, rep = r && r.report; if (!e || !rep || !rep.date || e.actual == null || e.estimate == null) continue;
      const a = +e.actual, est = +e.estimate; if (!isFinite(a) || !isFinite(est)) continue;
      const i = b.findIndex(x => rep.timing === "am" ? x.d >= rep.date : x.d > rep.date); if (i < 1) continue;
      out.push({ i, d: b[i].d, report: rep.date, surprise: (a - est) / Math.max(Math.abs(est), 0.05), actual: a, estimate: est });
    }
    return out.sort((p, q) => q.i - p.i);   // newest first, so setupsAt checks the latest report
  }

  /* ---------- Forward record: how a logged signal actually went, on sessions after it was logged ---------- */
  /* sig: {date (the close the signal came from), entry, stop, target (null or Infinity for none), hold}. The buy-stop is
     good for the next session only. Same price-path rules as the backtest. */
  function resolveSignal(b, sig) {
    const k = b.findIndex(x => x.d > sig.date); if (k < 0) return { status: "pending" };
    const entry = +sig.entry, stop = +sig.stop, target = sig.target == null || !isFinite(+sig.target) ? Infinity : +sig.target, hold = sig.hold || 10;
    if (!(b[k].h >= entry)) return { status: "not filled", d: b[k].d };
    let filled = false, fill = null, exit = null, why = "", j = k;
    for (; j < b.length; j++) {
      const pts = pathOf(b[j]);
      for (let p = 0; p < pts.length && exit == null; p++) {
        const q = pts[p], a = p ? pts[p - 1] : null;
        if (!filled) { if (p === 0) { if (q >= entry) { filled = true; fill = q; } continue; } if (!(a < entry && q >= entry)) continue; filled = true; fill = entry; if (q >= target) { exit = target; why = "Target"; } continue; }
        if (p === 0) { if (q <= stop) { exit = q; why = "Stop"; } else if (q >= target) { exit = q; why = "Target"; } continue; }
        if (q <= stop && a > stop) { exit = stop; why = "Stop"; } else if (q >= target && a < target) { exit = target; why = "Target"; }
      }
      if (exit != null || !filled) break;
      if (j - k + 1 >= hold) { exit = b[j].c; why = "Time"; break; }
    }
    if (!filled) return { status: "not filled", d: b[k].d };
    const risk = fill - stop; if (!(risk > 0)) return { status: "bad stop" };
    const open = exit == null; if (open) { j = b.length - 1; exit = b[j].c; why = "Open"; }
    return { status: open ? "open" : "closed", fill, exit, R: (exit - fill) / risk, why, filledD: b[k].d, exitD: b[Math.min(j, b.length - 1)].d, bars: Math.min(j, b.length - 1) - k + 1 };
  }

  /* ---------- Insider buying clusters ---------- */
  /* tx: Webull insider rows [{insider_name, transaction_date, price, shares, side}]. Only open-market buys count (side BUY
     with a price above zero: grants and option awards come through at price 0). A cluster: 2 or more different insiders
     buying within 30 days. */
  const insiderKey = n => { const m = String(n || "").toLowerCase().match(/^([^(]+?)\s*\(([^)\s]+)/); return m ? m[1].trim() + "|" + m[2] : String(n || "").toLowerCase().trim(); };
  function insiderClusters(tx, o) {
    o = Object.assign({ days: 30, min: 2 }, o || {});
    const buys = (tx || []).filter(t => String(t.side).toUpperCase() === "BUY" && +t.price > 0 && +t.shares > 0 && t.transaction_date).map(t => ({ d: t.transaction_date, who: insiderKey(t.insider_name), value: +t.price * +t.shares })).sort((a, b) => a.d < b.d ? -1 : 1);
    const out = [];
    for (let i = 0; i < buys.length; i++) {
      const t0 = Date.parse(buys[i].d) - o.days * 864e5, win = buys.filter((z, k) => k <= i && Date.parse(z.d) >= t0), who = new Set(win.map(z => z.who));
      if (who.size < o.min) continue;
      const last = out[out.length - 1], c = { d: buys[i].d, insiders: who.size, value: win.reduce((s, z) => s + z.value, 0) };
      if (last && Date.parse(c.d) - Date.parse(last.d) <= o.days * 864e5) Object.assign(last, { end: c.d, insiders: Math.max(last.insiders, c.insiders), value: Math.max(last.value, c.value) });
      else out.push(Object.assign(c, { end: c.d }));
    }
    return { buys: buys.length, clusters: out, latest: out.length ? out[out.length - 1] : null };
  }

  /* ---------- Wash sales ---------- */
  /* sales: Robinhood realized trades [{symbol, timestamp, realized_gain, side}]. Buying a stock within 30 days after
     selling it at a loss defers that loss (IRS wash-sale rule). Shows the loss sales in the last 30 days and when the
     window closes. It cannot judge "substantially identical" securities (for example two funds on the same stock). */
  function washSale(sales, sym, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs, cut = now - 30 * 864e5;
    const hits = (sales || []).filter(t => t.symbol === sym && String(t.side || "sell").toLowerCase() === "sell" && +t.realized_gain < 0 && Date.parse(t.timestamp) >= cut);
    if (!hits.length) return { risk: false };
    const last = Math.max(...hits.map(t => Date.parse(t.timestamp)));
    return { risk: true, loss: hits.reduce((s, t) => s + +t.realized_gain, 0), lastSale: new Date(last).toISOString().slice(0, 10), clearAfter: new Date(last + 31 * 864e5).toISOString().slice(0, 10), n: hits.length };
  }

  /* ---------- Relative strength: the 12-month return skipping the latest month (Jegadeesh and Titman, 1993) ---------- */
  function momentum12_1(b) { const n = b.length; return n >= 253 && b[n - 253].c > 0 ? b[n - 22].c / b[n - 253].c - 1 : null; }
  function rsRanks(sets) {
    const vals = sets.map(z => ({ sym: z.sym, m: momentum12_1(z.bars) })).filter(z => z.m != null).sort((a, b) => a.m - b.m), out = {};
    vals.forEach((z, k) => { out[z.sym] = { m: z.m, rank: vals.length > 1 ? Math.round(1 + 98 * k / (vals.length - 1)) : 50 }; });
    return out;
  }

  /* After each insider buying cluster (known 2 sessions after its last buy, the Form 4 deadline), the return from the next
     open over 63 and 126 sessions, minus SPY's over the same days. items: [{sym, clusters, bars}] */
  function insiderStudy(items, spy) {
    const H = [63, 126], ev = [], si = new Map((spy || []).map((b, k) => [b.d, k]));
    for (const it of items) {
      const b = it.bars || []; for (const c of it.clusters || []) {
        const j0 = b.findIndex(x => x.d > c.end); if (j0 < 0) continue; const j = j0 + 1; if (j + 1 >= b.length) continue;   // 2 sessions after the last buy
        const e = b[j + 1].o, ks = si.get(b[j + 1].d); if (!(e > 0)) continue;
        const fw = H.map(h => { if (j + h >= b.length) return null; const r = b[j + h].c / e - 1; const k2 = ks != null ? si.get(b[j + h].d) : null; return ks != null && k2 != null ? r - (spy[k2].c / spy[ks].o - 1) : null; });
        ev.push({ sym: it.sym, d: c.end, insiders: c.insiders, value: c.value, fw });
      }
    }
    const st = k => { const a = ev.map(z => z.fw[k]).filter(v => v != null); if (!a.length) return { n: 0 }; const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = a.length > 1 ? Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / (a.length - 1)) : 0; return { n: a.length, excess: m, beat: a.filter(v => v > 0).length / a.length, t: sd > 0 ? m / (sd / Math.sqrt(a.length)) : null }; };
    return { events: ev.sort((a, b) => a.d < b.d ? 1 : -1), h63: st(0), h126: st(1) };
  }

  /* ---------- Indicators at a support test: RSI(14), MACD(12,26,9) and the short averages ---------- */
  /* At bar i: RSI(14) and its zone; the MACD histogram's sign and direction over 2 bars (momentum building or fading);
     the last MACD line/signal cross; EMA 8 against EMA 21 and SMA 20 against SMA 50, with the date of their last cross;
     and bullish divergence: a lower low than the lowest low 4 to 30 bars earlier while RSI or the MACD histogram is higher. */
  function indicatorsAt(b, i) {
    const E = En(); if (!b || i < 35 || i >= b.length) return null;
    const c = b.map(x => x.c), rsi = E.rsi(c, 14), m = E.macd(c), e8 = E.ema(c, 8), e21 = E.ema(c, 21), s20 = E.sma(c, 20), s50 = E.sma(c, 50);
    const lastCross = (a, z) => { for (let k = i; k > Math.max(1, i - 150); k--) { if (a[k] == null || z[k] == null || a[k - 1] == null || z[k - 1] == null) break; if ((a[k] > z[k]) !== (a[k - 1] > z[k - 1])) return { d: b[k].d, up: a[k] > z[k], ago: i - k }; } return null; };
    const h = m.hist[i], h2 = m.hist[i - 2];
    const mom = h == null || h2 == null ? null : h < 0 ? (h < h2 ? "bearish building" : "bearish fading") : (h > h2 ? "bullish building" : "bullish fading");
    let pj = -1; for (let k = Math.max(0, i - 30); k <= i - 4; k++) if (pj < 0 || b[k].l < b[pj].l) pj = k;
    const lowerLow = pj >= 0 && b[i].l < b[pj].l;
    return {
      d: b[i].d, close: c[i],
      rsi: rsi[i], rsiZone: rsi[i] == null ? null : rsi[i] <= 30 ? "oversold" : rsi[i] >= 70 ? "overbought" : "neutral",
      macd: m.line[i], signal: m.sig[i], hist: h, momentum: mom, macdCross: lastCross(m.line, m.sig),
      ema8: e8[i], ema21: e21[i], emaUp: e8[i] != null && e21[i] != null ? e8[i] > e21[i] : null, emaCross: lastCross(e8, e21),
      sma20: s20[i], sma50: s50[i], smaUp: s20[i] != null && s50[i] != null ? s20[i] > s50[i] : null, smaCross: lastCross(s20, s50),
      prevLow: pj >= 0 ? { d: b[pj].d, low: b[pj].l, rsi: rsi[pj], hist: m.hist[pj] } : null,
      rsiDivergence: !!(lowerLow && rsi[i] != null && rsi[pj] != null && rsi[i] > rsi[pj]),
      macdDivergence: !!(lowerLow && h != null && m.hist[pj] != null && h > m.hist[pj]),
    };
  }

  const PB = { normCdf, normInv, moments, deflatedSharpe, variance, gate, sizePlan, prep, SETUPS, setupsAt, simulate, rSummary, evidence, volShare, projRvol, orbPlan, halfHour, edgeReport, hpTrend, hpSeries, HP, bottomWatch, liquid, sessionsUntil, nextReport, earningsInside, matchPlans, manage, checkMove, liquidityGrade, MOVES, moverStudy, earnEvents, resolveSignal, insiderClusters, washSale, momentum12_1, rsRanks, insiderStudy, indicatorsAt };
  if (typeof module !== "undefined" && module.exports) module.exports = PB; else root.Playbook = PB;
})(typeof self !== "undefined" ? self : globalThis);
