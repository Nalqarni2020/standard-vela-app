import Engine from "./engine/engine";
import { Settings, checkProxyUrl } from "./settings";

export type Bar = { t: number; d: string; o: number; h: number; l: number; c: number; v: number; provisional?: boolean };
export type Quote = { last: number | null; lastTime: number | null; bid: number | null; ask: number | null; prevClose: number | null; day: number[] | null };

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  unauthorized: "The proxy refused the access token. Check it in Settings.",
  provider_auth: "Alpaca rejected the keys stored on the proxy. Reset them with wrangler.",
  rate_limited: "Alpaca's rate limit was hit. Wait a minute and pull to refresh.",
  config: "The proxy is missing a secret. Set APP_TOKEN, ALPACA_KEY_ID and ALPACA_SECRET.",
};

async function get(s: Settings, path: string): Promise<any> {
  const base = checkProxyUrl(s.proxyUrl);
  if (!base || !s.token) throw new ApiError("setup", "Add your proxy address and access token in Settings.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r: Response;
  try {
    r = await fetch(base + path, { headers: { Authorization: "Bearer " + s.token }, signal: ctrl.signal });
  } catch {
    throw new ApiError("network", "Could not reach the proxy. Check the connection and the address in Settings.");
  } finally {
    clearTimeout(timer);
  }
  let body: any = null;
  try { body = await r.json(); } catch { body = null; }
  if (!r.ok) {
    const code = (body && body.error) || "http_" + r.status;
    throw new ApiError(code, MESSAGES[code] || (body && body.message) || "The proxy answered " + r.status + ".");
  }
  return body;
}

/* Daily bars carry the New York session date; intraday bars keep their timestamps. */
function toBars(rows: number[][] | undefined): Bar[] {
  return (rows || []).map(([t, o, h, l, c, v]) => ({ t, d: Engine.ny(t).date, o, h, l, c, v }))
    .filter(b => isFinite(b.o) && isFinite(b.c) && b.h >= b.l);
}

export async function fetchBars(s: Settings, symbols: string[], tf: "day" | "5min", days: number) {
  const q = "/v1/bars?symbols=" + encodeURIComponent(symbols.join(",")) + "&tf=" + tf + "&days=" + days;
  const d = await get(s, q);
  const out: Record<string, Bar[]> = {};
  for (const sym of symbols) out[sym] = toBars(d.bars && d.bars[sym]);
  return { bars: out, delayedMinutes: d.delayedMinutes as number, truncated: !!d.truncated };
}

export async function fetchQuotes(s: Settings, symbols: string[]): Promise<Record<string, Quote>> {
  const d = await get(s, "/v1/snapshots?symbols=" + encodeURIComponent(symbols.join(",")));
  return d.quotes || {};
}

/* The proxy's history ends 16 minutes ago (free data plan). A daily bar for today is only treated as the
   cash close once that window has passed 16:00 New York, i.e. from 16:16. Before that it is dropped. */
export function confirmedDaily(bars: Bar[], nowMs: number): Bar[] {
  const n = Engine.ny(nowMs);
  const last = bars[bars.length - 1];
  if (last && last.d === n.date && n.min < 16 * 60 + 16) return bars.slice(0, -1);
  return bars;
}

export function marketOpen(q: Quote | undefined, nowMs: number): boolean {
  const n = Engine.ny(nowMs);
  if (n.wd === "Sat" || n.wd === "Sun" || n.min < 570 || n.min >= 960) return false;
  return !!(q && q.lastTime && nowMs - q.lastTime < 20 * 60000);
}

export function resolveSymbol(text: string): string | null {
  const up = text.trim().toUpperCase().replace(/^\$/, "");
  if (Engine.ALIAS[up]) return Engine.ALIAS[up];
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(up) ? up : null;
}
