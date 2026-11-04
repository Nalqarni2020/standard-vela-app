/**
 * Standard & Vela data proxy (Cloudflare Worker).
 *
 * Holds the market-data keys so they never ship inside the phone app.
 * Only answers requests that carry the app's access token, on a fixed set of read routes plus the Analyst.
 *
 * Secrets (set with `npx wrangler secret put NAME`, never committed):
 *   APP_TOKEN        long random string; the phone app sends it as "Authorization: Bearer <token>"
 *   ALPACA_KEY_ID    Alpaca market-data key id
 *   ALPACA_SECRET    Alpaca market-data secret
 *   SEC_USER_AGENT   "Your Name your@email" (the SEC requires a contact in every request)
 *   ANTHROPIC_API_KEY  for the Analyst
 *
 * Routes (GET, except POST /v1/analyst): /v1/bars, /v1/snapshots, /v1/news, /v1/vix, /v1/sec/filings, /v1/sec/facts, /v1/analyst
 *   /v1/bars?symbols=AAPL,SPY&tf=day|5min&days=N   -> { bars: { AAPL: [[tMs,o,h,l,c,v], ...] }, delayedMinutes }
 *   /v1/snapshots?symbols=AAPL,SPY                  -> { quotes: { AAPL: { last, lastTime, bid, ask, prevClose, ... } } }
 */

import { filings, facts, SecError } from "./sec.js";
import { analyst } from "./analyst.js";

const ALPACA = "https://data.alpaca.markets/v2";
const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const MAX_SYMBOLS = 10;
// Alpaca's free plan serves consolidated (SIP) history only when it ends at least 15 minutes ago.
const DELAY_MIN = 16;

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json({ error: "internal", message: "The proxy failed unexpectedly." }, 500);
    }
  },
};

export async function handle(request, env, now = Date.now(), fetchImpl = fetch) {
  const path = new URL(request.url).pathname;
  const isPost = path === "/v1/analyst";
  if (request.method !== (isPost ? "POST" : "GET")) return json({ error: "method", message: (isPost ? "POST" : "GET") + " is the only method for this route." }, 405);
  if (!env.APP_TOKEN || env.APP_TOKEN.length < 32) return json({ error: "config", message: "APP_TOKEN is missing or shorter than 32 characters." }, 500);
  if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET) return json({ error: "config", message: "Alpaca keys are not set." }, 500);

  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!(await sameSecret(token, env.APP_TOKEN))) return json({ error: "unauthorized", message: "Missing or wrong access token." }, 401);

  const url = new URL(request.url);

  if (url.pathname === "/v1/analyst") { const r = await analyst(request, env, fetchImpl); return json(r.body, r.status); }

  if (url.pathname === "/v1/vix") {
    // VIX daily closes from the St. Louis Fed (FRED, public, no key). Missing days are written as "." and skipped.
    const r = await fetchImpl("https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS&cosd=" + new Date(now - 400 * 86400000).toISOString().slice(0, 10));
    if (!r.ok) return json({ error: "provider", message: "FRED answered with status " + r.status + "." }, 502);
    const rows = (await r.text()).trim().split(/\r?\n/).slice(1).map(l => l.split(",")).filter(x => x.length === 2 && x[1] !== "." && isFinite(+x[1])).map(([d, v]) => [d, +v]);
    return json({ vix: rows, source: "FRED VIXCLS" });
  }

  if (url.pathname.startsWith("/v1/sec/")) {
    if (!env.SEC_USER_AGENT || !/@/.test(env.SEC_USER_AGENT)) return json({ error: "not_configured", message: "SEC data needs SEC_USER_AGENT on the proxy: a name and a contact email, as the SEC requires." }, 501);
    const one = parseSymbols(url.searchParams.get("symbol"));
    if (!one || one.length !== 1) return json({ error: "bad_request", message: "symbol must be one US ticker." }, 400);
    try {
      const d = url.pathname === "/v1/sec/filings" ? await filings(one[0], env.SEC_USER_AGENT, fetchImpl, 730, now) : url.pathname === "/v1/sec/facts" ? await facts(one[0], env.SEC_USER_AGENT, fetchImpl) : undefined;
      if (d === undefined) return json({ error: "not_found", message: "Unknown route." }, 404);
      if (d === null) return json({ error: "not_found", message: one[0] + " is not in the SEC's company list. Funds and foreign listings often are not." }, 404);
      return json(d);
    } catch (e) { return json({ error: "provider", message: e instanceof SecError ? e.message + "." : "Could not reach the SEC." }, 502); }
  }

  const symbols = parseSymbols(url.searchParams.get("symbols"));
  if (!symbols) return json({ error: "bad_request", message: "symbols must be 1 to " + MAX_SYMBOLS + " US tickers, comma separated." }, 400);

  const headers = { "APCA-API-KEY-ID": env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": env.ALPACA_SECRET, Accept: "application/json" };

  if (url.pathname === "/v1/bars") {
    const tf = url.searchParams.get("tf");
    const days = Number(url.searchParams.get("days"));
    const limits = { day: 1830, "5min": 60 };
    if (!(tf in limits)) return json({ error: "bad_request", message: "tf must be day or 5min." }, 400);
    if (!Number.isInteger(days) || days < 1 || days > limits[tf]) return json({ error: "bad_request", message: "days must be a whole number from 1 to " + limits[tf] + " for " + tf + "." }, 400);
    const end = new Date(now - DELAY_MIN * 60000).toISOString();
    const start = new Date(now - days * 86400000).toISOString();
    const out = {};
    symbols.forEach(s => { out[s] = []; });
    let pageToken = null, pages = 0;
    do {
      const q = new URLSearchParams({ symbols: symbols.join(","), timeframe: tf === "day" ? "1Day" : "5Min", start, end, adjustment: "split", feed: "sip", limit: "10000", sort: "asc" });
      if (pageToken) q.set("page_token", pageToken);
      const r = await fetchImpl(ALPACA + "/stocks/bars?" + q, { headers });
      if (!r.ok) return upstream(r.status);
      const d = await r.json();
      for (const [sym, arr] of Object.entries(d.bars || {})) {
        if (!out[sym]) continue;
        for (const b of arr) out[sym].push([Date.parse(b.t), b.o, b.h, b.l, b.c, b.v]);
      }
      pageToken = d.next_page_token || null;
      pages++;
    } while (pageToken && pages < 25);
    return json({ bars: out, delayedMinutes: DELAY_MIN, truncated: !!pageToken });
  }

  if (url.pathname === "/v1/news") {
    const q = new URLSearchParams({ symbols: symbols.join(","), limit: "20", sort: "desc" });
    const r = await fetchImpl("https://data.alpaca.markets/v1beta1/news?" + q, { headers });
    if (!r.ok) return upstream(r.status);
    const d = await r.json();
    return json({ news: (d.news || []).map(n => ({ t: Date.parse(n.created_at), headline: n.headline, summary: String(n.summary || "").slice(0, 400), source: n.source, url: n.url, symbols: n.symbols })), source: "Benzinga via Alpaca" });
  }

  if (url.pathname === "/v1/snapshots") {
    const q = new URLSearchParams({ symbols: symbols.join(","), feed: "iex" });
    const r = await fetchImpl(ALPACA + "/stocks/snapshots?" + q, { headers });
    if (!r.ok) return upstream(r.status);
    const d = await r.json();
    const quotes = {};
    for (const s of symbols) {
      const x = d[s];
      if (!x) continue;
      quotes[s] = {
        last: x.latestTrade ? x.latestTrade.p : null,
        lastTime: x.latestTrade ? Date.parse(x.latestTrade.t) : null,
        bid: x.latestQuote ? x.latestQuote.bp : null,
        ask: x.latestQuote ? x.latestQuote.ap : null,
        prevClose: x.prevDailyBar ? x.prevDailyBar.c : null,
        prevDate: x.prevDailyBar ? x.prevDailyBar.t : null,
        day: x.dailyBar ? [Date.parse(x.dailyBar.t), x.dailyBar.o, x.dailyBar.h, x.dailyBar.l, x.dailyBar.c, x.dailyBar.v] : null,
      };
    }
    return json({ quotes, feed: "iex" });
  }

  return json({ error: "not_found", message: "Unknown route." }, 404);
}

export function parseSymbols(raw) {
  if (!raw) return null;
  const list = [...new Set(raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (!list.length || list.length > MAX_SYMBOLS || !list.every(s => SYMBOL.test(s))) return null;
  return list;
}

/* Compare SHA-256 digests in constant time, so response timing does not leak the token. */
export async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0 && a.length > 0;
}

function upstream(status) {
  if (status === 401 || status === 403) return json({ error: "provider_auth", message: "Alpaca rejected the keys stored in the proxy." }, 502);
  if (status === 429) return json({ error: "rate_limited", message: "Alpaca's rate limit was hit. Wait a minute." }, 429);
  return json({ error: "provider", message: "Alpaca answered with status " + status + "." }, 502);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
