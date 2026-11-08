const Q = require(require('path').join(__dirname, '../apps/quality-core.js'));
const assert = require('assert');
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, a + ' != ' + b);
let n = 0; const ok = () => n++;
const mkFin = (k, f) => Array.from({ length: k }, (_, i) => { const y = 2022 + Math.floor(i / 4), q = (i % 4) + 1, m = q * 3; return Object.assign({ fiscal_year: y, fiscal_quarter: q, period_end_date: `${y}-${String(m).padStart(2, '0')}-28` }, f(i)); });
const mkInd = (fin, f) => { const out = { roe: [], roa: [], debt_to_assets: [], diluted_eps_incl_extra: [], ocf_ps: [], naps: [] }; fin.forEach((r, i) => { const v = f(i); for (const k of Object.keys(out)) out[k].push({ fiscal_year: r.fiscal_year, fiscal_period: r.fiscal_quarter, value: String(v[k]) }); }); return out; };
// a strong compounder and a weak, indebted loss-maker
const finA = mkFin(12, i => ({ revenue: String(100 * 1.05 ** i), gross_profit: String(60 * 1.05 ** i), net_income: String(25 * 1.05 ** i) }));
const indA = mkInd(finA, i => ({ roe: 0.07, roa: 0.035, debt_to_assets: 0.35, diluted_eps_incl_extra: 1 + 0.05 * i, ocf_ps: 1.3 + 0.05 * i, naps: 20 }));
const finB = mkFin(12, i => ({ revenue: String(100 * 0.97 ** i), gross_profit: String(8), net_income: String(i % 2 ? -5 : 1) }));
const indB = mkInd(finB, i => ({ roe: -0.02, roa: -0.005, debt_to_assets: 0.92, diluted_eps_incl_extra: i % 2 ? -0.2 : 0.05, ocf_ps: -0.1, naps: 2 }));
{
  const qa = Q.merge(finA, indA);
  assert.equal(qa.length, 12); assert.equal(qa[0].avail, '2022-05-12'); assert.equal(qa[3].avail, '2023-03-13');   // Q1 +45 days, Q4 +75 days
  assert.equal(qa[11].eps, 1.55); assert.equal(Q.knownIndex(qa, '2022-05-11'), -1); assert.equal(Q.knownIndex(qa, '2022-05-12'), 0);
  const a = Q.scoreAt(qa, 11, 100), b = Q.scoreAt(Q.merge(finB, indB), 11, 10);
  assert(a.quality >= 80, 'strong ' + a.quality); assert(b.quality <= 20, 'weak ' + b.quality);
  near(a.m.roe, 0.28); near(a.m.gm, 0.6); near(a.m.growth, 1.05 ** 4 - 1, 1e-9); assert.equal(a.m.consistency, 1);
  near(a.pe, 100 / (1.4 + 1.45 + 1.5 + 1.55)); near(a.graham, Math.sqrt(22.5 * 5.9 * 20));
  assert.equal(Q.scoreAt(qa, 2, 100), null, 'needs four quarters');
  assert.equal(Q.decision(a, 'up').key, 'cand'); assert.equal(Q.decision(a, 'down').key, 'watch'); assert.equal(Q.decision(b, 'down').key, 'avoid');
  ok();
}
// study: the strong stock rises after each report, the weak one falls; quality 70+ beats the cross-section
{
  const day = i => new Date(Date.UTC(2021, 0, 4) + i * 864e5).toISOString().slice(0, 10);
  const mkBars = drift => Array.from({ length: 1400 }, (_, i) => { const p = 50 * Math.exp(drift * i); return { d: day(i), o: p, h: p * 1.01, l: p * 0.99, c: p, v: 1e6 }; });
  const flat = { sym: 'C', qs: Q.merge(finA.map(r => Object.assign({}, r, { net_income: '0', gross_profit: '30' })), mkInd(finA, () => ({ roe: 0.01, roa: 0.005, debt_to_assets: 0.6, diluted_eps_incl_extra: 0.1, ocf_ps: 0.1, naps: 10 }))), bars: mkBars(0) };
  const st = Q.study([{ sym: 'A', qs: Q.merge(finA, indA), bars: mkBars(0.0008) }, { sym: 'B', qs: Q.merge(finB, indB), bars: mkBars(-0.0008) }, flat]);
  const hi = st.rows.find(r => r.id === 'qhi'), lo = st.rows.find(r => r.id === 'qlo');
  assert(hi.h[63].excess > 0 && lo.h[63].excess < 0, 'quality spread');
  assert.equal(st.names, 3); assert(hi.h[252].dates > 0);
  ok();
}
console.log('quality tests passed:', n);
