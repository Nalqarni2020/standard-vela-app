/* Intraday READY scan (read-only). Builds today's partial bar from 5-minute bars, runs the desk's market gate
   and the 21-day EMA pullback setup (ema21), and grades accumulation on yesterday's completed bar.
   READY = ema21 setup + accumulation grade A + gate "go" or "half".
   usage: node tools/intraday-scan.js config.json
   config: { today, dailyFiles: [raw Robinhood day-bar files] | dailyParsed: "map.json", fiveFiles: [raw 5-minute files],
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
const ok50 = sets.filter(z => z.x.s50[z.bars.length - 1] != null);
const pct50 = ok50.length >= 10 ? ok50.filter(z => z.bars[z.bars.length - 1].c > z.x.s50[z.bars.length - 1]).length / ok50.length : null;
const g = P.gate(spy, vix, pct50); if (cfg.testGate) g.verdict = cfg.testGate;   // testGate: tests only
const open = g.verdict === 'go' || g.verdict === 'half', liq = { minPrice: 5, minDollarVol: 5e6 };
const ready = [], watch = [], thin = [];
for (const z of sets) {
  const b = z.bars, i = b.length - 1; if (b.length < 253) continue;
  if (!P.liquid(b, z.x, i, liq)) { thin.push(z.sym); continue; }
  const hit = P.setupsAt(b, z.x, i, liq).find(h => h.id === 'ema21'); if (!hit) continue;
  const a = P.accumulation(b, i - 1);   // yesterday's completed bar: today's volume is still partial
  const pl = P.sizePlan({ account: cfg.account || 0, riskPct: 0.01, mult: g.sizeMult, entry: hit.entry, stop: hit.stop, capPct: 0.25 });
  const row = { sym: z.sym, last: live[z.sym].last, ema21: +z.x.e21[i].toFixed(2), entry: +hit.entry.toFixed(2), stop: +hit.stop.toFixed(2), target: +hit.target.toFixed(2),
    away: +((hit.entry / live[z.sym].last - 1) * 100).toFixed(1), grade: a && a.grade, score: a && a.score, rs: z.x.rsr ? z.x.rsr[i] : null, shares: pl.shares };
  if (row.grade === 'A' && open) ready.push(row); else watch.push(Object.assign(row, { why: row.grade !== 'A' ? 'grade ' + row.grade : 'gate ' + g.verdict }));
}
ready.sort((p, q) => q.score - p.score); watch.sort((p, q) => (q.score || 0) - (p.score || 0));
let state = { date: TODAY, alerted: [] };
try { const s = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); if (s.date === TODAY) state = s; } catch (e) {}
const fresh = ready.filter(r => !state.alerted.includes(r.sym));
state.alerted.push(...fresh.map(r => r.sym)); if (cfg.stateFile) fs.writeFileSync(cfg.stateFile, JSON.stringify(state));
const sb = spy[spy.length - 1], sp = spy[spy.length - 2];
console.log(JSON.stringify({ today: TODAY, asOf: live.SPY && live.SPY.at, gate: { verdict: g.verdict, score: g.score, sizeMult: +g.sizeMult.toFixed(2) }, vix: cfg.vixNow,
  spy: { last: sb.c, chg: +((sb.c / sp.c - 1) * 100).toFixed(2) }, ready, newReady: fresh.map(r => r.sym), watch, scanned: sets.length, thin: thin.length }, null, 1));
