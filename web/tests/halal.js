const H = require(require('path').join(__dirname, '../apps/halal-core.js'));
const assert = require('assert');
const near = (a, b, e = 1e-9) => assert(Math.abs(a - b) < e, a + ' != ' + b);
let n = 0; const ok = () => n++;
{
  assert.equal(H.business({ industry: 'Banks - Regional' }).key, 'fail');
  assert.equal(H.business({ industry: 'Insurance - Life' }).key, 'fail');
  assert.equal(H.business({ industry: 'Beverages - Brewers' }).key, 'fail');
  assert.equal(H.business({ industry: 'Resorts & Casinos' }).key, 'fail');
  assert.equal(H.business({ industry: 'Semiconductors', description: 'GPUs for gaming and data centers' }).key, 'ok', 'gaming chips are not gambling');
  assert.equal(H.business({ industry: 'Consumer Electronics', description: 'iPhone, Apple Music and services' }).key, 'ok', 'a music service in the description does not condemn');
  assert.equal(H.business({ industry: 'Blockchain & Cryptocurrency' }).key, 'doubt');
  assert.equal(H.business({ industry: 'Information Technology Services', description: 'data centers that support GPUs and ASICs for bitcoin mining' }).key, 'doubt');
  assert.equal(H.business({ industry: 'Software', name: 'Defiance Daily Target 2X Long IREN ETF' }).key, 'fund');
  assert.equal(H.business({ industry: 'Software', description: 'raises capital to fund its growth' }).key, 'ok', 'the verb "fund" is not a fund');
  ok();
}
{
  const bs = { total_debt: '80111000000', cash: '32686000000', cash_equiv: '3619000000', st_invest: '20417000000', lt_invest: '80213000000', common_shares_out: '14532259000', end_date: '2026-09-26' };
  const is = { total_revenue: '416000000000', inter_inc_expse_net_non_oper: '-300000000', end_date: '2026-09-26' };
  const s = H.screen({ biz: { industry: 'Consumer Electronics' }, bs, is, price: 268.47 });   // about $3.9T market value
  assert.equal(s.key, 'pass', s.why.join('; ')); near(s.ratios.debtRatio, 80111000000 / (14532259000 * 268.47)); assert.equal(s.ratios.impure, 0);
  const lev = H.screen({ biz: { industry: 'Software' }, bs: Object.assign({}, bs, { total_debt: String(0.4 * 14532259000 * 10) }), is, price: 10 });
  assert.equal(lev.key, 'fail'); assert(lev.why.some(w => /debt/.test(w)));
  const intr = H.screen({ biz: { industry: 'Software' }, bs: { total_debt: '0', cash: '1000', common_shares_out: '1000', end_date: 'x' }, is: { total_revenue: '100', inter_inc_expse_net_non_oper: '50' }, price: 100 });
  near(intr.ratios.impure, 0.5, 1e-12); assert.equal(intr.key, 'fail', 'interest income over 5% (capped at 6% of 1000 = 60 > 50)');
  assert.equal(H.screen({ biz: { industry: 'Banks - Diversified' }, bs, is, price: 268.47 }).key, 'fail');
  assert.equal(H.screen({ biz: { industry: 'Software' }, bs: null, is: null, price: 10 }).key, 'unknown');
  ok();
}
console.log('halal tests passed:', n);
