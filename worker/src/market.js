/* Market-wide movers and option-chain exposure inputs, read-only, from Alpaca.
   /v1/movers  -> { gainers: [{ symbol, pct, price }], losers: [...], actives: [{ symbol, volume, trades }], asOf }
   /v1/options?symbol=SPY&spot=736.5&from=YYYY-MM-DD&to=YYYY-MM-DD
               -> { rows: [[strike, "c"|"p", "YYYY-MM-DD", openInterest, iv|null, mark|null], ...], oiDate, feed, truncated }
   Open interest comes from Alpaca's option contracts list (updated once a day); implied volatility and prices from its
   option snapshots (the free "indicative" feed, about 15 minutes delayed). */

const DATA = "https://data.alpaca.markets";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ProviderError extends Error { constructor(status) { super("status " + status); this.status = status; } }

async function getJson(fetchImpl, url, headers) {
  const r = await fetchImpl(url, { headers });
  if (!r.ok) throw new ProviderError(r.status);
  return r.json();
}

export async function movers(headers, fetchImpl) {
  const [mv, ac] = await Promise.all([
    getJson(fetchImpl, DATA + "/v1beta1/screener/stocks/movers?top=50", headers),
    getJson(fetchImpl, DATA + "/v1beta1/screener/stocks/most-actives?by=volume&top=100", headers),
  ]);
  const ok = s => typeof s === "string" && /^[A-Z][A-Z0-9.]{0,9}$/.test(s);
  const mov = a => (a || []).filter(x => ok(x.symbol)).map(x => ({ symbol: x.symbol, pct: x.percent_change == null ? null : +x.percent_change / 100, price: x.price == null ? null : +x.price }));
  return {
    gainers: mov(mv.gainers), losers: mov(mv.losers),
    actives: (ac.most_actives || []).filter(x => ok(x.symbol)).map(x => ({ symbol: x.symbol, volume: +x.volume || 0, trades: +x.trade_count || 0 })),
    asOf: mv.last_updated || ac.last_updated || null,
  };
}

/* Contracts with open interest, within 20% of the price, between two expiration dates (at most 45 days apart). */
export async function options(params, env, headers, fetchImpl, now) {
  const { symbol, spot, from, to } = params;
  if (!(spot > 0) || !DATE.test(from) || !DATE.test(to) || to < from) return { error: "bad_request", message: "spot, from and to (YYYY-MM-DD) are required, with to on or after from." };
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 45) return { error: "bad_request", message: "from and to can be at most 45 days apart." };
  const lo = (spot * 0.8).toFixed(2), hi = (spot * 1.2).toFixed(2);
  // contracts (trading API reference data): paper keys answer on paper-api, live keys on api; try the configured one first
  const bases = [env.ALPACA_TRADING_URL, "https://paper-api.alpaca.markets", "https://api.alpaca.markets"].filter(Boolean);
  const contracts = [];
  let got = false, lastStatus = 0, truncated = false;
  for (const base of bases) {
    try {
      let token = null, pages = 0; contracts.length = 0;
      do {
        const q = new URLSearchParams({ underlying_symbols: symbol, status: "active", expiration_date_gte: from, expiration_date_lte: to, strike_price_gte: lo, strike_price_lte: hi, limit: "10000" });
        if (token) q.set("page_token", token);
        const d = await getJson(fetchImpl, base + "/v2/options/contracts?" + q, headers);
        for (const c of d.option_contracts || []) contracts.push(c);
        token = d.next_page_token || null; pages++;
      } while (token && pages < 5);
      truncated = !!token; got = true; break;
    } catch (e) { if (!(e instanceof ProviderError) || (e.status !== 401 && e.status !== 403)) throw e; lastStatus = e.status; }
  }
  if (!got) throw new ProviderError(lastStatus || 403);
  // snapshots: implied volatility and quotes
  const snaps = {};
  let token = null, pages = 0;
  do {
    const q = new URLSearchParams({ feed: "indicative", limit: "1000", expiration_date_gte: from, expiration_date_lte: to, strike_price_gte: lo, strike_price_lte: hi });
    if (token) q.set("page_token", token);
    const d = await getJson(fetchImpl, DATA + "/v1beta1/options/snapshots/" + encodeURIComponent(symbol) + "?" + q, headers);
    Object.assign(snaps, d.snapshots || {});
    token = d.next_page_token || null; pages++;
  } while (token && pages < 15);
  if (token) truncated = true;
  let oiDate = null;
  const rows = [];
  for (const c of contracts) {
    const oi = +c.open_interest || 0; if (!oi) continue;
    if (c.open_interest_date && (!oiDate || c.open_interest_date > oiDate)) oiDate = c.open_interest_date;
    const s = snaps[c.symbol] || {}, qt = s.latestQuote || {};
    const mark = qt.bp > 0 && qt.ap > 0 ? (qt.bp + qt.ap) / 2 : s.latestTrade && s.latestTrade.p > 0 ? s.latestTrade.p : c.close_price != null ? +c.close_price : null;
    const iv = s.impliedVolatility > 0 ? +s.impliedVolatility : null;
    rows.push([+c.strike_price, c.type === "put" ? "p" : "c", c.expiration_date, oi, iv, mark]);
  }
  return { rows, oiDate, feed: "indicative", truncated, asOf: new Date(now).toISOString() };
}
