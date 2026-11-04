/* Standard rule engine. Pure functions, no DOM. */
(function (root) {
  "use strict";

  const RULES = {
    regimeFast: 8, regimeSlow: 20, slopeLookback: 3,
    shelfLookback: 12, swingSide: 2,
    bandLo: 0.01, bandHi: 0.02,
    rvolMin: 1.3, rvolAvgLen: 20,
    stopOffset: 0.02, minReward: 2,
    coreRisk: 0.02, specRisk: 0.01,
    lunchStart: 11 * 60, lunchEnd: 14 * 60,
    closeConfirm: 15 * 60 + 55,
    vwapReclaimBars: 3,
  };

  /* ---------- math ---------- */
  function sma(vals, n) {
    const out = new Array(vals.length).fill(null);
    let s = 0;
    for (let i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function ema(vals, n) {
    const out = new Array(vals.length).fill(null);
    if (vals.length < n) return out;
    const k = 2 / (n + 1);
    let e = 0;
    for (let i = 0; i < n; i++) e += vals[i];
    e /= n; out[n - 1] = e;
    for (let i = n; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }
  function rsi(vals, n) {
    const out = new Array(vals.length).fill(null);
    if (vals.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function stdev(vals, n) {
    const m = sma(vals, n);
    return vals.map((_, i) => {
      if (m[i] == null) return null;
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += (vals[j] - m[i]) ** 2;
      return Math.sqrt(s / n);
    });
  }
  function atr(bars, n) {
    const tr = bars.map((b, i) => i === 0 ? b.h - b.l :
      Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
    const out = new Array(bars.length).fill(null);
    if (bars.length < n) return out;
    let a = 0; for (let i = 0; i < n; i++) a += tr[i]; a /= n; out[n - 1] = a;
    for (let i = n; i < bars.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
    return out;
  }
  function macd(vals) {
    const f = ema(vals, 12), s = ema(vals, 26);
    const line = vals.map((_, i) => f[i] != null && s[i] != null ? f[i] - s[i] : null);
    const start = line.findIndex(v => v != null);
    const sig = new Array(vals.length).fill(null);
    if (start >= 0) {
      const sub = ema(line.slice(start), 9);
      sub.forEach((v, j) => { sig[start + j] = v; });
    }
    return { line, sig, hist: line.map((v, i) => v != null && sig[i] != null ? v - sig[i] : null) };
  }

  /* ---------- time (New York) ---------- */
  /* New York clock without Intl time zones (Hermes on phones may lack them).
     US daylight time: second Sunday of March 02:00 local to first Sunday of November 02:00 local (rules since 2007). */
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function nthSundayUTC(y, month, nth) { const d = new Date(Date.UTC(y, month, 1)); const first = (7 - d.getUTCDay()) % 7; return Date.UTC(y, month, 1 + first + (nth - 1) * 7); }
  function nyOffsetMin(ms) {
    const y = new Date(ms).getUTCFullYear();
    const start = nthSundayUTC(y, 2, 2) + 7 * 3600000;  // 02:00 EST = 07:00 UTC
    const end = nthSundayUTC(y, 10, 1) + 6 * 3600000;   // 02:00 EDT = 06:00 UTC
    return ms >= start && ms < end ? -240 : -300;
  }
  function ny(ms) {
    const d = new Date(ms + nyOffsetMin(ms) * 60000);
    const p2 = n => String(n).padStart(2, "0");
    return { date: d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()), min: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: WD[d.getUTCDay()] };
  }

  /* ---------- bar parsing ---------- */
  function parseBars(raw) {
    return (raw || []).filter(b => !b.interpolated).map(b => ({
      t: Date.parse(b.begins_at), d: b.begins_at.slice(0, 10),
      o: +b.open_price, h: +b.high_price, l: +b.low_price, c: +b.close_price, v: +b.volume || 0,
    })).filter(b => isFinite(b.o) && isFinite(b.c) && b.h >= b.l);
  }
  function aggregate(bars, minutes) {
    const out = []; let cur = null;
    for (const b of bars) {
      const n = ny(b.t);
      const key = n.date + ":" + Math.floor(n.min / minutes);
      if (!cur || cur.key !== key) { cur = { key, t: b.t, d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; out.push(cur); }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    }
    return out.map(({ key, ...b }) => b);
  }

  /* ---------- regime ---------- */
  function regime(bars) {
    const c = bars.map(b => b.c);
    const f = sma(c, RULES.regimeFast), s = sma(c, RULES.regimeSlow);
    const i = bars.length - 1, k = RULES.slopeLookback;
    if (i < RULES.regimeSlow - 1 + k) return { state: "Unknown", reason: "Not enough index history." };
    const fastUp = f[i] > f[i - k], slowUp = s[i] > s[i - k];
    const aboveF = c[i] > f[i], aboveS = c[i] > s[i], stack = f[i] > s[i];
    let state;
    if (aboveF && aboveS && fastUp && slowUp && stack) state = "Green";
    else if (c[i] < s[i] && !stack && !slowUp) state = "Red";
    else state = "Yellow";
    return { state, close: c[i], fast: f[i], slow: s[i], fastUp, slowUp, aboveF, aboveS, stack, date: bars[i].d };
  }

  /* ---------- shelf ---------- */
  function findShelf(bars) {
    const n = bars.length, w = RULES.swingSide, L = RULES.shelfLookback;
    if (n < L + w) return null;
    const a = atr(bars, 14);
    const vavg = sma(bars.map(b => b.v), 20);
    const from = n - L;
    let swing = null;
    for (let i = n - 1 - w; i >= from; i--) {
      let ok = true;
      for (let j = 1; j <= w; j++) if (!(bars[i].l < bars[i - j].l && bars[i].l < bars[i + j].l)) { ok = false; break; }
      if (ok) { swing = { i, kind: "Swing low" }; break; }
    }
    let flush = null;
    for (let i = n - 1; i >= from; i--) {
      const b = bars[i], rng = b.h - b.l;
      const prevVavg = i > 0 ? vavg[i - 1] : null;
      if (a[i - 1] && rng >= 1.5 * a[i - 1] && b.c <= b.l + rng / 3 && prevVavg && b.v >= 1.5 * prevVavg) { flush = { i, kind: "Flush low" }; break; }
    }
    let pick = swing;
    if (flush && (!swing || flush.i > swing.i)) pick = flush;
    if (!pick) return null;
    const lvl = bars[pick.i].l;
    const after = bars.slice(pick.i + 1);
    const undercut = after.some(b => b.c < lvl);
    const held = after.length >= 2 && !undercut;
    return { level: lvl, i: pick.i, date: bars[pick.i].d, kind: pick.kind, held, barsSince: after.length, undercut };
  }

  /* ---------- intraday helpers ---------- */
  function sessionVWAP(bars) {
    const out = []; let day = null, pv = 0, vv = 0;
    for (const b of bars) {
      const d = ny(b.t).date;
      if (d !== day) { day = d; pv = 0; vv = 0; }
      const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v;
      out.push(vv > 0 ? pv / vv : tp);
    }
    return out;
  }
  function intradayRvol(bars) {
    if (!bars.length) return null;
    const byDay = new Map();
    for (const b of bars) { const n = ny(b.t); if (!byDay.has(n.date)) byDay.set(n.date, []); byDay.get(n.date).push({ m: n.min, v: b.v, end: n.min }); }
    const days = [...byDay.keys()].sort();
    const today = days[days.length - 1];
    const tb = byDay.get(today);
    const lastMin = tb[tb.length - 1].m;
    const cum = arr => arr.filter(x => x.m <= lastMin).reduce((s, x) => s + x.v, 0);
    const prior = days.slice(0, -1).slice(-RULES.rvolAvgLen).map(d => cum(byDay.get(d))).filter(v => v > 0);
    if (!prior.length) return null;
    const avg = prior.reduce((s, v) => s + v, 0) / prior.length;
    return { rvol: cum(tb) / avg, todayVol: cum(tb), avg, days: prior.length, asOfMin: lastMin };
  }

  /* ---------- the Standard ---------- */
  function evaluate(o) {
    const { daily, spy, nowMs, live, mode, intraday, account, bucket, capPct, allowShelfException } = o;
    const R = RULES, checks = [], nowNY = ny(nowMs);
    const lastD = daily[daily.length - 1];
    const provisional = lastD && lastD.d === nowNY.date && nowNY.min < R.closeConfirm;
    const conf = provisional ? daily.slice(0, -1) : daily.slice();
    const spyConf = spy.length && spy[spy.length - 1].d === nowNY.date && nowNY.min < R.closeConfirm ? spy.slice(0, -1) : spy.slice();
    const out = { checks, provisional, confirmedDate: conf.length ? conf[conf.length - 1].d : null };
    if (conf.length < 30) { out.verdict = "NONE"; out.headline = "Not enough daily history to apply the standard."; return out; }

    const reg = regime(spyConf); out.regime = reg;
    const c = conf.map(b => b.c);
    const s8 = sma(c, 8), e20 = ema(c, 20), s20 = sma(c, 20);
    const i = conf.length - 1, bar = conf[i];
    out.ma = { s8: s8[i], e20: e20[i], s20: s20[i] };
    const shelf = findShelf(conf); out.shelf = shelf;

    const intra = mode !== "day";
    let ref, refLabel;
    if (intra) { ref = live && live.price ? live.price : (intraday && intraday.length ? intraday[intraday.length - 1].c : bar.c); refLabel = "Last price"; }
    else { ref = bar.c; refLabel = "Close " + bar.d; }
    out.ref = ref; out.refLabel = refLabel;

    let band = null, stop = null;
    if (shelf) { band = { lo: shelf.level * (1 + R.bandLo), hi: shelf.level * (1 + R.bandHi) }; stop = +(shelf.level - R.stopOffset).toFixed(4); }
    out.band = band; out.stop = stop;
    const inBand = !!band && ref >= band.lo && ref <= band.hi;
    const atShelf = !!band && ref >= shelf.level && ref <= band.hi;

    // 1 regime
    const regOk = reg.state === "Green" || (allowShelfException && atShelf && reg.state !== "Unknown");
    checks.push({ id: "regime", pass: regOk, value: reg.state,
      note: reg.state === "Green" ? "S&P above a rising 8-day and rising 20-day, 8 over 20."
        : (regOk ? "Tape is " + reg.state + ". Allowed only because price is at the shelf." : "Tape is " + reg.state + ". Stand aside.") });
    // 2 shelf is a base
    checks.push({ id: "shelf", pass: !!shelf && shelf.held, value: shelf ? shelf.level : null,
      note: !shelf ? "No swing low or flush low in the last 12 daily bars."
        : shelf.undercut ? "A close has broken below the shelf. Not a base."
        : shelf.held ? shelf.kind + " on " + shelf.date + ", held for " + shelf.barsSince + " closes."
        : shelf.kind + " on " + shelf.date + ". Needs two closes above it before it is a base." });
    // 3 band
    let bandNote = "No shelf, so no band.";
    if (band) bandNote = ref < shelf.level ? "Price is under the shelf." : ref < band.lo ? "Closer than 1%. Still on the low." : ref > band.hi ? "More than 2% above the shelf. Open air." : "Inside the 1 to 2 percent band.";
    checks.push({ id: "band", pass: inBand, value: ref, note: bandNote });

    // 4 trigger + 5 volume
    if (!intra) {
      const above8 = bar.c > s8[i];
      checks.push({ id: "trigger", pass: above8, value: s8[i], note: above8 ? "Close above the 8-day." : "Close is not above the 8-day." });
      const prior = conf.slice(i - R.rvolAvgLen, i).map(b => b.v);
      const avg = prior.reduce((s, v) => s + v, 0) / prior.length;
      const rv = avg > 0 ? bar.v / avg : 0;
      out.rvol = rv;
      checks.push({ id: "volume", pass: rv >= R.rvolMin, value: rv, note: "Volume " + fmtInt(bar.v) + " vs 20-day average " + fmtInt(avg) + "." });
    } else {
      const vw = sessionVWAP(intraday); out.vwap = vw;
      const n = intraday.length, today = ny(intraday[n - 1].t).date;
      let reclaim = false;
      for (let j = n - 1; j >= Math.max(1, n - R.vwapReclaimBars); j--) {
        if (ny(intraday[j - 1].t).date !== today) break;
        if (intraday[j - 1].c <= vw[j - 1] && intraday[j].c > vw[j]) { reclaim = true; break; }
      }
      const stillAbove = ref > vw[n - 1];
      const trig = reclaim && stillAbove && inBand;
      checks.push({ id: "trigger", pass: trig, value: vw[n - 1],
        note: trig ? "VWAP reclaimed inside the band." : !stillAbove ? "Price is below VWAP." : !reclaim ? "No VWAP reclaim in the last " + R.vwapReclaimBars + " bars." : "Reclaim happened outside the band." });
      const ir = intradayRvol(intraday); out.rvol = ir ? ir.rvol : null;
      checks.push({ id: "volume", pass: !!ir && ir.rvol >= R.rvolMin, value: ir ? ir.rvol : null,
        note: ir ? "Volume so far vs the same time of day, " + ir.days + "-session average." : "Not enough intraday history." });
    }

    // 6 reward
    const entry = inBand ? ref : (band ? band.hi : null);
    out.entry = entry;
    const t1 = e20[i], t2 = s20[i]; out.t1 = t1; out.t2 = t2;
    let rr = null;
    if (entry != null && stop != null && entry > stop) rr = (t1 - entry) / (entry - stop);
    out.rr = rr;
    checks.push({ id: "reward", pass: rr != null && rr >= R.minReward, value: rr,
      note: rr == null ? "No entry or stop to measure." : t1 <= entry ? "Target 1 is at or below the entry. No reward." : "Target 1 pays " + rr.toFixed(2) + " to 1 from " + (inBand ? "the price" : "the top of the band") + "." });

    // 7 clock
    const marketDay = !["Sat", "Sun"].includes(nowNY.wd);
    if (intra) {
      const lunch = marketDay && nowNY.min >= R.lunchStart && nowNY.min < R.lunchEnd;
      checks.push({ id: "clock", pass: !lunch, value: nowNY.min, note: lunch ? "Between 11:00 and 14:00 New York. No new momentum entry." : "Outside the 11:00 to 14:00 window." });
    } else {
      checks.push({ id: "clock", pass: true, value: nowNY.min, note: provisional ? "Today's bar is not closed. Reading the " + out.confirmedDate + " cash close." : "Reading the confirmed cash close of " + out.confirmedDate + "." });
    }

    // size
    const riskPct = bucket === "spec" ? R.specRisk : R.coreRisk;
    const riskBudget = account * riskPct;
    let shares = 0, perShare = null, capShares = null;
    if (entry != null && stop != null && entry > stop) {
      perShare = entry - stop;
      shares = Math.floor(riskBudget / perShare + 1e-9);
      capShares = Math.floor((account * capPct) / entry + 1e-9);
      shares = Math.max(0, Math.min(shares, capShares));
    }
    const allPass = checks.every(x => x.pass);
    out.size = { riskPct, riskBudget, perShare, capShares, shares: allPass ? shares : 0, wouldBe: shares,
      dollars: allPass ? shares * entry : 0, riskDollars: allPass && perShare ? shares * perShare : 0 };
    out.verdict = allPass && shares > 0 ? "BUY" : "NO";
    out.failed = checks.filter(x => !x.pass);
    return out;
  }

  /* ---------- gamma ---------- */
  // Dealer convention: dealers long call gamma, short put gamma. Dollar gamma per 1% move.
  function gammaProfile(rows, spot) {
    const by = new Map();
    for (const r of rows) {
      if (!isFinite(r.gamma) || !isFinite(r.oi)) continue;
      const g = r.gamma * r.oi * 100 * spot * spot * 0.01 * (r.type === "call" ? 1 : -1);
      const k = r.strike;
      if (!by.has(k)) by.set(k, { strike: k, call: 0, put: 0, net: 0, coi: 0, poi: 0 });
      const x = by.get(k);
      if (r.type === "call") { x.call += g; x.coi += r.oi; } else { x.put += g; x.poi += r.oi; }
      x.net += g;
    }
    const list = [...by.values()].sort((a, b) => a.strike - b.strike);
    const total = list.reduce((s, x) => s + x.net, 0);
    const callWall = list.reduce((m, x) => !m || x.call > m.call ? x : m, null);
    const putWall = list.reduce((m, x) => !m || x.put < m.put ? x : m, null);
    // Flip: the strike nearest spot where cumulative net gamma (low to high strike) changes sign.
    let flip = null, cum = 0, best = Infinity;
    for (let j = 0; j < list.length; j++) {
      const prev = cum; cum += list[j].net;
      if (j > 0 && ((prev < 0 && cum >= 0) || (prev > 0 && cum <= 0))) {
        const d = Math.abs(list[j].strike - spot);
        if (d < best) { best = d; flip = list[j].strike; }
      }
    }
    return { list, total, callWall: callWall && callWall.call > 0 ? callWall.strike : null, putWall: putWall && putWall.put < 0 ? putWall.strike : null, flip };
  }

  /* ---------- alerts ---------- */
  const ALIAS = { T1: "TE" };
  const STOP = new Set(["VIP", "NEW", "HIGH", "LOW", "PR", "RVOL", "VOL", "USD", "ET", "AM", "PM", "IPO", "HOD", "LOD", "SEC", "FDA", "CEO", "NYSE", "NASDAQ", "OTC", "THE", "AND", "FOR", "A", "I"]);
  function parseAlert(line, nowMs) {
    const text = (line || "").trim();
    if (!text) return { ok: false, reason: "The alert line is empty." };
    let sym = null;
    const dollar = text.match(/\$([A-Za-z][A-Za-z0-9.]{0,5})\b/);
    if (dollar) sym = dollar[1].toUpperCase();
    if (!sym) {
      const cands = text.match(/\b[A-Z][A-Z0-9.]{0,5}\b/g) || [];
      sym = cands.find(c => !STOP.has(c) && !/^\d/.test(c)) || null;
    }
    if (!sym) return { ok: false, reason: "No symbol in the line. A blank symbol is skipped." };
    sym = ALIAS[sym] || sym;
    const n = ny(nowMs);
    const midday = !["Sat", "Sun"].includes(n.wd) && n.min >= RULES.lunchStart && n.min < RULES.lunchEnd;
    const botRvol = (text.match(/(?:rvol|rel(?:ative)?\s*vol(?:ume)?)\D{0,3}(\d+(?:\.\d+)?)/i) || [])[1];
    return { ok: true, symbol: sym, midday, botRvol: botRvol ? +botRvol : null };
  }

  /* ---------- Candle break indicator (MetaStock formula, translated bar by bar) ----------
     VALUEWHEN(1,c,x): x on the latest bar where c is true, current bar included; null before the first.
     REF(x,-1): previous bar. Undefined (null) inputs give no signal, as in MetaStock.
     Options (all off = the formula exactly as published):
       falseSell: mirror rule for a false bearish breakdown
       atr: a strong candle's range must also be at least the prior ATR(14)
       vol: a buy also needs volume >= 1.3x the prior 20-bar average                       */
  function candleBreak(bars, o) {
    o = Object.assign({ body: 0.55, falseSell: false, atr: false, vol: false }, o || {});
    const n = bars.length, A = o.atr ? atr(bars, 14) : null;
    const vavg = sma(bars.map(b => b.v), 20);
    const z = () => new Array(n).fill(null);
    const bullLow = z(), bearHigh = z(), sig = new Array(n).fill(0), ev = new Array(n).fill(null);
    const buyBreak = [], sellBreak = [], falseBuy = [], falseSell = [];
    let vwBull = null, vwBear = null, brokenBear = null, brokenBull = null, mainDir = null, evDir = null;
    for (let i = 0; i < n; i++) {
      const b = bars[i], rng = b.h - b.l;
      const ratio = Math.abs(b.c - b.o) / Math.max(rng, 0.000001);
      const big = !o.atr || (i > 0 && A[i - 1] != null && rng >= A[i - 1]);
      const bull = b.c > b.o && ratio >= o.body && big;
      const bear = b.c < b.o && ratio >= o.body && big;
      // REF(VALUEWHEN(1,Bull,LOW),-1): the value as of the previous bar
      bullLow[i] = vwBull; bearHigh[i] = vwBear;
      if (bull) vwBull = b.l;
      if (bear) vwBear = b.h;
      const pc = i > 0 ? bars[i - 1].c : null;
      const BB = pc != null && bearHigh[i] != null && b.c > bearHigh[i] && pc <= bearHigh[i];
      const SB = pc != null && bullLow[i] != null && b.c < bullLow[i] && pc >= bullLow[i];
      if (BB) brokenBear = bearHigh[i];
      if (SB) brokenBull = bullLow[i];
      if (BB || SB) mainDir = BB ? 1 : -1;
      const FBB = mainDir === 1 && brokenBear != null && pc != null && b.c < brokenBear && pc >= brokenBear;
      const FSB = o.falseSell && mainDir === -1 && brokenBull != null && pc != null && b.c > brokenBull && pc <= brokenBull;
      const lastDir = evDir; // REF(...,-1)
      if (BB || SB || FBB || FSB) evDir = (BB || FSB) ? 1 : -1;
      ev[i] = evDir;
      const volOk = !o.vol || (i > 0 && vavg[i - 1] != null && b.v >= 1.3 * vavg[i - 1]);
      const buy = (BB || FSB) && lastDir != null && lastDir !== 1 && volOk;
      const sell = (SB || FBB) && lastDir != null && lastDir !== -1;
      sig[i] = buy ? 1 : sell ? -1 : 0;
      buyBreak.push(BB); sellBreak.push(SB); falseBuy.push(FBB); falseSell.push(FSB);
    }
    return { sig, bullLow, bearHigh, buyBreak, sellBreak, falseBuy, falseSell, ev, nextBullLow: vwBull, nextBearHigh: vwBear, mainDir, brokenBear, brokenBull };
  }

  /* Long-only test. A signal on a bar's close is acted on at the next bar's open (no look-ahead).
     Optional fixed stop = BullLow on the signal bar; it never moves; a gap through it fills at the open.
     cost = fraction per side.                                                                       */
  function backtest(bars, cb, o) {
    o = Object.assign({ stop: false, cost: 0.0005 }, o || {});
    const n = bars.length, sig = cb.sig, trades = [];
    let eq = 1, peak = 1, maxDD = 0, pos = null, inBars = 0, skipped = 0;
    const exit = (i, px, reason) => {
      const gross = px / pos.px; const r = gross * (1 - o.cost) / (1 + o.cost) - 1;
      eq = pos.eq0 * (1 + r);
      trades.push({ entryI: pos.i, entryD: bars[pos.i].d, entryT: bars[pos.i].t, entryPx: pos.px, exitI: i, exitD: bars[i].d, exitT: bars[i].t, exitPx: px, ret: r, bars: i - pos.i, reason, stop: pos.stop });
      pos = null;
    };
    for (let i = 1; i < n; i++) {
      const b = bars[i];
      if (pos && sig[i - 1] === -1) exit(i, b.o, "Sell signal");
      if (!pos && sig[i - 1] === 1) {
        const st = o.stop ? cb.bullLow[i - 1] : null;
        // The open is already at or under the stop: no valid risk, so the trade is not taken.
        if (st != null && b.o <= st) skipped++;
        else pos = { i, px: b.o, eq0: eq, stop: st };
      }
      if (pos && pos.stop != null && b.l <= pos.stop) exit(i, Math.min(b.o, pos.stop), "Stop");
      if (pos) inBars++;
      const mtm = pos ? pos.eq0 * (b.c / pos.px) * (1 - o.cost) : eq;
      peak = Math.max(peak, mtm); maxDD = Math.max(maxDD, 1 - mtm / peak);
    }
    let open = null;
    if (pos) { const last = bars[n - 1]; open = { entryI: pos.i, entryD: bars[pos.i].d, entryT: bars[pos.i].t, entryPx: pos.px, last: last.c, ret: last.c / pos.px - 1, bars: n - 1 - pos.i, stop: pos.stop }; eq = pos.eq0 * (last.c / pos.px) * (1 - o.cost); }
    return { trades, open, stats: tradeStats(trades), total: eq - 1, maxDD, exposure: n > 1 ? inBars / (n - 1) : 0, skipped, bh: n > 1 ? bars[n - 1].c / bars[1].o - 1 : 0, n };
  }
  function tradeStats(trades) {
    const w = trades.filter(t => t.ret > 0), l = trades.filter(t => t.ret <= 0);
    const sw = w.reduce((s, t) => s + t.ret, 0), sl = l.reduce((s, t) => s + t.ret, 0);
    return { count: trades.length, wins: w.length, winRate: trades.length ? w.length / trades.length : null,
      avgWin: w.length ? sw / w.length : null, avgLoss: l.length ? sl / l.length : null,
      payoff: w.length && l.length && sl !== 0 ? (sw / w.length) / Math.abs(sl / l.length) : null,
      pf: sl !== 0 ? sw / Math.abs(sl) : (sw > 0 ? Infinity : null),
      avgRet: trades.length ? (sw + sl) / trades.length : null,
      avgBars: trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : null };
  }

  /* ---------- filters from the Standard, per bar, no look-ahead ---------- */
  function spyIndexByDate(spy) { const m = new Map(); spy.forEach((b, i) => m.set(b.d, i)); return m; }
  function lastSpyIndex(spy, d) { let lo = 0, hi = spy.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (spy[m].d <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; }
  /* Regime state as of each SPY bar, computed once. */
  function regimeSeries(spy) {
    const c = spy.map(b => b.c), f = sma(c, RULES.regimeFast), s = sma(c, RULES.regimeSlow), k = RULES.slopeLookback;
    return spy.map((_, i) => {
      if (i < RULES.regimeSlow - 1 + k) return "Unknown";
      const fastUp = f[i] > f[i - k], slowUp = s[i] > s[i - k], stack = f[i] > s[i];
      if (c[i] > f[i] && c[i] > s[i] && fastUp && slowUp && stack) return "Green";
      if (c[i] < s[i] && !stack && !slowUp) return "Red";
      return "Yellow";
    });
  }
  /* Returns pass(i): may a buy on daily bar i be taken under the chosen filter? Memoized. */
  function makeFilter(daily, spy, mode) {
    if (!mode || mode === "none" || !spy || !spy.length) return null;
    const reg = regimeSeries(spy), memo = new Map();
    return i => {
      if (memo.has(i)) return memo.get(i);
      const si = lastSpyIndex(spy, daily[i].d);
      let ok = si >= 0 && reg[si] === "Green";
      if (ok && mode === "standard") {
        const r = evaluate({ daily: daily.slice(0, i + 1), spy: spy.slice(0, si + 1), nowMs: Date.parse(daily[i].d + "T23:00:00Z"), live: null, mode: "day", intraday: [], account: 100000, bucket: "core", capPct: 1, allowShelfException: false });
        ok = !!(r.checks && r.checks.length && r.checks.every(x => x.pass));
      }
      memo.set(i, ok); return ok;
    };
  }
  function applyFilter(cb, pass) {
    if (!pass) return cb;
    return Object.assign({}, cb, { sig: cb.sig.map((v, i) => v === 1 && !pass(i) ? 0 : v), filtered: cb.sig.filter((v, i) => v === 1 && !pass(i)).length });
  }

  /* ---------- trade resampling (bootstrap) ---------- */
  function monteCarlo(rets, runs, seed) {
    if (!rets.length) return null;
    runs = runs || 1000; let s = seed || 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const dds = [], finals = [], a = rets.slice();
    for (let r = 0; r < runs; r++) {
      // Bootstrap: draw the same number of trades with replacement, so both the order and the mix vary.
      for (let i = 0; i < a.length; i++) a[i] = rets[Math.floor(rnd() * rets.length)];
      let eq = 1, peak = 1, dd = 0;
      for (const x of a) { eq *= 1 + x; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
      dds.push(dd); finals.push(eq - 1);
    }
    const q = (arr, p) => { const v = arr.slice().sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
    return { runs, ddP50: q(dds, 0.5), ddP95: q(dds, 0.95), retP5: q(finals, 0.05), retP50: q(finals, 0.5), retP95: q(finals, 0.95), lossOdds: finals.filter(x => x < 0).length / runs };
  }

  /* ---------- robustness grid + walk-forward ----------
     sets: [{sym, bars, pass}] ; split: date string, trades entered before it are "train", on or after are "test". */
  const GRID_BODIES = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
  const GRID_SWITCHES = [];
  for (let m = 0; m < 16; m++) GRID_SWITCHES.push({ falseSell: !!(m & 1), stop: !!(m & 2), vol: !!(m & 4), atr: !!(m & 8) });
  function gridCell(sets, body, sw, cost, split) {
    const train = [], test = [], all = [];
    for (const st of sets) {
      const cb = applyFilter(candleBreak(st.bars, { body, falseSell: sw.falseSell, atr: sw.atr, vol: sw.vol }), st.pass);
      const bt = backtest(st.bars, cb, { stop: sw.stop, cost });
      for (const t of bt.trades) { all.push(t.ret); (split && t.entryD >= split ? test : train).push(t.ret); }
    }
    const sum = a => { const w = a.filter(x => x > 0).reduce((s, x) => s + x, 0), l = a.filter(x => x <= 0).reduce((s, x) => s + x, 0); return { n: a.length, pf: l !== 0 ? w / -l : (w > 0 ? Infinity : null), avg: a.length ? (w + l) / a.length : null, win: a.length ? a.filter(x => x > 0).length / a.length : null }; };
    return { body, sw, all: sum(all), train: sum(train), test: sum(test) };
  }

  /* ================= EDGE LAB ================= */

  /* Swing exits. Entries: next open after each buy signal in cb.sig. Each exit method is applied to the
     same entries. Initial stop: the strong bullish low on the signal bar if under the entry, else entry - 2 x ATR14.
     R = (exit - entry) / (entry - initial stop). When a stop and a target fall in the same bar, the stop is
     assumed first (conservative). Hold capped at maxHold bars; still open at the end = marked at the last close. */
  const EXIT_METHODS = [
    { id: "formula", label: "Formula's own sell signal" },
    { id: "t2r", label: "Fixed target at 2R" },
    { id: "trail", label: "Trailing stop, 3 × ATR under the high" },
    { id: "scale", label: "Half off at 1R, stop to breakeven, trail the rest" },
    { id: "time", label: "Time exit after 10 bars" },
  ];
  function exitLab(bars, cb, o) {
    o = Object.assign({ cost: 0.0005, maxHold: 60 }, o || {});
    const A = atr(bars, 14), n = bars.length, entries = [];
    for (let i = 0; i < n - 1; i++) if (cb.sig[i] === 1) {
      const e = i + 1, px = bars[e].o;
      let stop = cb.bullLow[i];
      if (stop == null || stop >= px) stop = A[i] != null ? px - 2 * A[i] : null;
      if (stop != null && stop < px) entries.push({ sigI: i, e, px, stop, risk: px - stop, atrAt: A[i] });
    }
    const res = {};
    for (const m of EXIT_METHODS) {
      res[m.id] = entries.map(en => {
        const { e, px, risk } = en; let stop = en.stop, hi = bars[e].h, half = false, banked = 0;
        const out = (j, p, why) => { const gross = half ? 0.5 * banked + 0.5 * (p - px) : (p - px); const costR = (2 * o.cost * px) / risk; return { e, x: j, R: gross / risk - costR, ret: gross / px - 2 * o.cost, bars: j - e, why, d: bars[e].d, t: bars[e].t }; };
        for (let j = e; j < n; j++) {
          const b = bars[j];
          if (j > e) { // a gap through the stop fills at the open
            if (b.o <= stop) return out(j, b.o, "Stop");
          }
          if (b.l <= stop) return out(j, j === e ? Math.min(stop, b.o) : stop, half ? "Trail after 1R" : "Stop");
          if (m.id === "t2r" && b.h >= px + 2 * risk) return out(j, Math.max(b.o, px + 2 * risk), "Target 2R");
          if (m.id === "scale" && !half && b.h >= px + risk) { half = true; banked = risk; stop = Math.max(stop, px); }
          if (m.id === "formula" && cb.sig[j] === -1 && j + 1 < n) return out(j + 1, bars[j + 1].o, "Sell signal");
          if (m.id === "time" && j - e + 1 >= 10) return out(j, b.c, "10 bars");
          hi = Math.max(hi, b.h);
          if ((m.id === "trail" || (m.id === "scale" && half)) && A[j] != null) stop = Math.max(stop, hi - 3 * A[j]);
          if (j - e + 1 >= o.maxHold) return out(j, b.c, "Max hold");
        }
        const r = out(n - 1, bars[n - 1].c, "Open, marked"); r.open = true; return r;
      });
    }
    return { entries: entries.length, res };
  }
  function rStats(trades) {
    if (!trades.length) return null;
    const R = trades.map(t => t.R), w = R.filter(x => x > 0), l = R.filter(x => x <= 0);
    const sw = w.reduce((s, x) => s + x, 0), sl = l.reduce((s, x) => s + x, 0);
    let streak = 0, worst = 0; for (const x of R) { streak = x <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
    const W = w.length / R.length, b = w.length && l.length ? (sw / w.length) / Math.abs(sl / l.length) : null;
    const kelly = b ? W - (1 - W) / b : null;
    return { n: R.length, win: W, expR: (sw + sl) / R.length, avgWinR: w.length ? sw / w.length : null, avgLossR: l.length ? sl / l.length : null,
      pf: sl !== 0 ? sw / -sl : (sw > 0 ? Infinity : null), avgBars: trades.reduce((s, t) => s + t.bars, 0) / trades.length, worstStreak: worst, kelly };
  }
  /* One trade at a time, in date order, risking fraction f of equity per trade: equity *= 1 + f x R. */
  function sizeSim(trades, f) {
    const tt = trades.slice().sort((a, b) => a.t - b.t);
    let eq = 1, peak = 1, dd = 0;
    for (const t of tt) { eq *= Math.max(0, 1 + f * t.R); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
    return { final: eq - 1, dd };
  }

  /* Event studies. sets: [{sym, bars}]. An event on bar i (known at its close) is measured from the next open
     to the close h bars later. Events on one name are not allowed to overlap. Baseline = every bar. */
  const EVENTS = [
    { id: "hi52", label: "Close within 2% of its 52-week high", cite: "George and Hwang (2004)", need: 252,
      test: (b, i, x) => b[i].c >= 0.98 * x.hi252[i] },
    { id: "rev5", label: "Fell 10% or more in 5 days", cite: "Jegadeesh (1990), Lehmann (1990)", need: 6,
      test: (b, i) => b[i].c / b[i - 5].c - 1 <= -0.10 },
    { id: "rsi2", label: "RSI(2) under 10 while above the 200-day", cite: "Connors and Alvarez (2008), practitioner", need: 200,
      test: (b, i, x) => x.rsi2[i] != null && x.rsi2[i] < 10 && x.s200[i] != null && b[i].c > x.s200[i] },
    { id: "volup", label: "Volume 3× its 20-day average on an up day", cite: "Gervais, Kaniel and Mingelgrin (2001)", need: 21,
      test: (b, i, x) => x.v20[i - 1] != null && b[i].v >= 3 * x.v20[i - 1] && b[i].c > b[i - 1].c },
    { id: "mom", label: "Up over 12 months, skipping the last month, and above the 200-day", cite: "Jegadeesh and Titman (1993), Moskowitz, Ooi and Pedersen (2012)", need: 253,
      test: (b, i, x) => b[i - 21].c / b[i - 252].c - 1 > 0.10 && x.s200[i] != null && b[i].c > x.s200[i] },
  ];
  function prepSeries(b) {
    const c = b.map(x => x.c), hi252 = b.map((_, i) => { if (i < 252) return null; let m = -Infinity; for (let k = i - 252; k < i; k++) m = Math.max(m, b[k].h); return m; });
    return { rsi2: rsi(c, 2), s200: sma(c, 200), v20: sma(b.map(x => x.v), 20), hi252 };
  }
  function eventStudy(sets, h, extra) {
    const prepped = sets.map(st => ({ b: st.bars, x: prepSeries(st.bars) }));
    const fwd = (b, i) => i + h < b.length && i + 1 < b.length ? b[i + h].c / b[i + 1].o - 1 : null;
    const base = []; prepped.forEach(({ b }) => { for (let i = 0; i < b.length; i++) { const r = fwd(b, i); if (r != null) base.push(r); } });
    const summ = a => { if (!a.length) return { n: 0 }; const m = a.reduce((s, x) => s + x, 0) / a.length; const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); const so = a.slice().sort((x, y) => x - y); return { n: a.length, mean: m, median: so[so.length >> 1], hit: a.filter(x => x > 0).length / a.length, t: sd > 0 ? m / (sd / Math.sqrt(a.length)) : null }; };
    const evs = EVENTS.concat(extra || []);
    const rows = evs.map(ev => {
      const r = [];
      prepped.forEach(({ b, x }, k) => { let next = 0; for (let i = Math.max(ev.need || 1, 1); i < b.length; i++) { if (i < next) continue; let hit = false; try { hit = ev.test(b, i, x, k); } catch (e) { hit = false; } if (hit) { const f = fwd(b, i); if (f != null) { r.push(f); next = i + h; } } } });
      return Object.assign({ id: ev.id, label: ev.label, cite: ev.cite }, summ(r));
    });
    return { base: summ(base), rows, h };
  }

  /* Overnight (prior close to open) versus intraday (open to close) share of each name's return. */
  function nightDay(bars) {
    let on = 0, id = 0, n = 0;
    for (let i = 1; i < bars.length; i++) { const a = bars[i].o / bars[i - 1].c, b = bars[i].c / bars[i].o; if (a > 0 && b > 0) { on += Math.log(a); id += Math.log(b); n++; } }
    return { overnight: Math.exp(on) - 1, intraday: Math.exp(id) - 1, n };
  }

  /* Day-trade studies on 5-minute bars of one name.
     ORB: Zarattini, Barbon and Aziz (2024). Direction of the first 5-minute bar; enter at the next bar's open;
     stop at the far end of the first bar; exit at the stop, at 10R, or at the last bar's close. Long and short.
     Intraday momentum: Gao, Han, Li and Zhou (2018). Sign of prior close -> 10:00 return; trade 15:30 -> close in that direction. */
  function dayStudies(bars, cost) {
    cost = cost == null ? 0.0005 : cost;
    const days = new Map(); for (const b of bars) { const n = ny(b.t); if (!days.has(n.date)) days.set(n.date, []); days.get(n.date).push(Object.assign({ m: n.min }, b)); }
    const keys = [...days.keys()].sort(); const orb = [], mom = [];
    let prevClose = null;
    for (const k of keys) {
      const d = days.get(k).sort((a, b) => a.t - b.t);
      const full = d.length >= 70 && d[0].m === 570;
      if (full) {
        const f = d[0], dir = f.c > f.o ? 1 : f.c < f.o ? -1 : 0;
        if (dir && d.length > 2) {
          const px = d[1].o, stop = dir > 0 ? f.l : f.h, risk = Math.abs(px - stop);
          if (risk > 0 && (dir > 0 ? px > stop : px < stop)) {
            let exit = null, why = "Close";
            for (let j = 1; j < d.length; j++) {
              const b = d[j];
              if (dir > 0 ? b.l <= stop : b.h >= stop) { exit = j === 1 ? stop : (dir > 0 ? Math.min(b.o, stop) : Math.max(b.o, stop)); why = "Stop"; break; }
              if (dir > 0 ? b.h >= px + 10 * risk : b.l <= px - 10 * risk) { exit = px + dir * 10 * risk; why = "10R"; break; }
            }
            if (exit == null) exit = d[d.length - 1].c;
            const R = dir * (exit - px) / risk - (2 * cost * px) / risk;
            orb.push({ d: k, dir, px, stop, exit, R, why });
          }
        }
        const at10 = d.find(b => b.m === 595), b1530 = d.find(b => b.m === 930), last = d[d.length - 1];
        if (prevClose && at10 && b1530 && last.m >= 955) {
          const sig = Math.sign(at10.c / prevClose - 1);
          if (sig) mom.push({ d: k, dir: sig, ret: sig * (last.c / b1530.o - 1) - 2 * cost });
        }
      }
      prevClose = d[d.length - 1].m >= 955 ? d[d.length - 1].c : null;
    }
    return { orb, mom, sessions: keys.length };
  }

  function fmtInt(v) { return Math.round(v).toLocaleString("en-US"); }

  const Engine = { RULES, sma, ema, rsi, stdev, atr, macd, ny, parseBars, aggregate, regime, findShelf, sessionVWAP, intradayRvol, evaluate, gammaProfile, parseAlert, ALIAS, candleBreak, backtest, tradeStats, regimeSeries, makeFilter, applyFilter, monteCarlo, gridCell, GRID_BODIES, GRID_SWITCHES, EXIT_METHODS, exitLab, rStats, sizeSim, EVENTS, eventStudy, nightDay, dayStudies };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof self !== "undefined" ? self : this);
