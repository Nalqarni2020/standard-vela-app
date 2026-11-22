/* Intraday READY scan (read-only). Builds today's partial bar from 5-minute bars, runs the desk's market gate
   and the 21-day EMA pullback setup (ema21), and grades accumulation on yesterday's completed bar.
   READY = ema21 setup + accumulation grade A + gate "go" or "half".
   usage: node tools/intraday-scan.js config.json
   config: { today, watchlist: [symbols, ema21 rule], market: [symbols, any setup + grade A, $1 to $20], dailyFiles: [raw Robinhood day-bar files] | dailyParsed: "map.json", fiveFiles: [raw 5-minute files],
             vixHistFile, vixNow, stateFile, skip: [symbols to leave out], account } */
const path = require('path'), fs = require('fs');
globalThis.Engine = require(path.join(__dirname, '../web/engine.js'));
const E = Engine, P = require(path.join(__dirname, '../web/apps/playbook-core.js'));
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), TODAY = cfg.today;
const raw = f => JSON.parse(fs.readFileSync(f, 'utf8')).data.results;
const bars = {};
if (cfg.dailyParsed) for (const [s, b] of Object.entries(JSON.parse(fs.readFileSync(cfg.dailyParsed, 'utf8')))) bars[s] = b.filter(x => x.d < TODAY);
for (const f of cfg.dailyFiles || []) for (const r of raw(f)) if (!bars[r.symbol]) bars[r.symbol] = E.parseBars((r.bars || []).filter(z => !z.interpolated)).filter(x => x.d < TODAY);
const five = (cfg.fiveFiles || []).flatMap(raw), live = {};
for (const s of Object.keys(bars)) {
  const f = five.find(x => x.symbol === s), fb = f ? f.bars.filter(x => !x.interpolated && x.begins_at.slice(0, 10) === TODAY) : [];
  if (fb.length < 1) continue;
  bars[s].push({ t: Date.parse(TODAY + 'T00:00:00Z'), d: TODAY, o: +fb[0].open_price, c: +fb[fb.length - 1].close_price, h: Math.max(...fb.map(x => +x.high_price)), l: Math.min(...fb.map(x => +x.low_price)), v: fb.reduce((a, x) => a + +x.volume, 0) });
  live[s] = { last: +fb[fb.length - 1].close_price, at: fb[fb.length - 1].begins_at };
}
const vix = raw(cfg.vixHistFile)[0].bars.filter(x => !x.interpolated && x.begins_at.slice(0, 10) < TODAY).map(x => ({ d: x.begins_at.slice(0, 10), c: +x.close_value }));
if (cfg.vixNow != null) vix.push({ d: TODAY, c: +cfg.vixNow });
const spy = bars.SPY, skip = new Set(['SPY', 'QQQ', ...(cfg.skip || [])]);
const syms = Object.keys(bars).filter(s => !skip.has(s) && live[s]);
const sets = syms.filter(s => bars[s].length >= 60).map(s => ({ sym: s, bars: bars[s], x: P.prep(bars[s]) }));
P.rsRankSeries(sets);
/* Groups: the watchlist uses the ema21-only rule; the market list ($1 to $20, most traded) uses any setup with grade A.
   cfg.market: symbols of the market list (optional). Breadth for the gate comes from the watchlist only, as in the daily report. */
const mkt = new Set(cfg.market || []), watchSyms = new Set(cfg.watchlist ? cfg.watchlist : syms.filter(s => !mkt.has(s)));
const ok50 = sets.filter(z => watchSyms.has(z.sym) && z.x.s50[z.bars.length - 1] != null);
const pct50 = ok50.length >= 10 ? ok50.filter(z => z.bars[z.bars.length - 1].c > z.x.s50[z.bars.length - 1]).length / ok50.length : null;
const g = P.gate(spy, vix, pct50); if (cfg.testGate) g.verdict = cfg.testGate;   // testGate: tests only
const open = g.verdict === 'go' || g.verdict === 'half';
const LIQ = { watchlist: { minPrice: 5, minDollarVol: 5e6 }, market: { minPrice: cfg.mktMin ?? 1, minDollarVol: 5e6 } }, mktMax = cfg.mktMax ?? 20;
const ready = [], watch = [], thin = [];
for (const z of sets) {
  const b = z.bars, i = b.length - 1; if (b.length < 253) continue;
  const groups = []; if (watchSyms.has(z.sym)) groups.push('watchlist'); if (mkt.has(z.sym) && b[i].c <= mktMax) groups.push('market');
  let row = null;
  for (const grp of groups) {
    const liq = LIQ[grp]; if (!P.liquid(b, z.x, i, liq)) continue;
    const hits = P.setupsAt(b, z.x, i, liq).filter(h => grp === 'market' || h.id === 'ema21'); if (!hits.length) continue;
    const a = P.accumulation(b, i - 1);   // yesterday's completed bar: today's volume is still partial
    if (grp === 'market' && !(a && a.grade === 'A')) continue;   // market list: only grade-A setups are worth a line
    const h = grp === 'watchlist' ? hits[0] : hits.slice().sort((p, q) => (q.rr || 0) - (p.rr || 0))[0];
    const pl = P.sizePlan({ account: cfg.account || 0, riskPct: 0.01, mult: g.sizeMult, entry: h.entry, stop: h.stop, capPct: 0.25 });
    const r = { sym: z.sym, list: grp, setups: hits.map(q => q.id), last: live[z.sym].last, entry: +h.entry.toFixed(2), stop: +h.stop.toFixed(2), target: isFinite(h.target) ? +h.target.toFixed(2) : null,
      away: +((h.entry / live[z.sym].last - 1) * 100).toFixed(1), grade: a && a.grade, score: a && a.score, rs: z.x.rsr ? z.x.rsr[i] : null, shares: pl.shares };
    if (!row || (r.grade === 'A' && row.grade !== 'A')) row = r;
  }
  if (!row) { if (groups.length && groups.every(grp => !P.liquid(b, z.x, i, LIQ[grp]))) thin.push(z.sym); continue; }
  if (row.grade === 'A' && open) ready.push(row); else watch.push(Object.assign(row, { why: row.grade !== 'A' ? 'grade ' + row.grade : 'gate ' + g.verdict }));
}
ready.sort((p, q) => q.score - p.score); watch.sort((p, q) => (q.score || 0) - (p.score || 0));
let state = { date: TODAY, alerted: [] };
try { const s = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); if (s.date === TODAY) state = s; } catch (e) {}
const fresh = ready.filter(r => !state.alerted.includes(r.sym));
state.alerted.push(...fresh.map(r => r.sym));
/* Levels watch: cfg.levelsText is the user's pasted day-trading plan. Uses completed 5-minute bars only; any price. */
const nowMs = cfg.nowMs || Date.now(), alertable = e => (e.k === 'brk' && e.state === 'held') || (e.k.startsWith('pb') && e.state === 'held') || e.k === 'lost' || e.k.startsWith('tgt');
const levels = P.parseLevels(cfg.levelsText || '').map(lv => {
  const f = five.find(x => x.symbol === lv.sym);
  const b = f ? E.parseBars(f.bars.filter(x => !x.interpolated && x.begins_at.slice(0, 10) === TODAY)).filter(x => x.t + 300000 <= nowMs) : [];
  const st = P.levelState(b, lv); return { sym: lv.sym, brk: lv.brk, last: st.last, events: st.events };
});
state.levels = state.levels || [];
const newLevels = [];
for (const l of levels) for (const e of l.events.filter(alertable)) { const key = l.sym + '|' + e.k + '|' + e.state; if (!state.levels.includes(key)) { state.levels.push(key); newLevels.push(Object.assign({ sym: l.sym }, e)); } }
if (cfg.stateFile) fs.writeFileSync(cfg.stateFile, JSON.stringify(state));
const sb = spy[spy.length - 1], sp = spy[spy.length - 2];
console.log(JSON.stringify({ today: TODAY, asOf: live.SPY && live.SPY.at, gate: { verdict: g.verdict, score: g.score, sizeMult: +g.sizeMult.toFixed(2) }, vix: cfg.vixNow,
  spy: { last: sb.c, chg: +((sb.c / sp.c - 1) * 100).toFixed(2) }, ready, newReady: fresh.map(r => r.sym), watch, levels, newLevels, scanned: sets.length, thin: thin.length }, null, 1));
