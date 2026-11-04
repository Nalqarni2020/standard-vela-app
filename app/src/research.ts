/* Research functions shared by the desks and the Analyst. Every result carries a "source" stamp. */
import Engine from "./engine/engine";
import Analytics from "./engine/analytics";
import Phone from "./engine/phone";
import { Bar, dailyMany, fetchQuotes, fetchVix, fetchNews, fetchFilings, fetchFacts, marketOpen } from "./api";
import { Settings } from "./settings";

const r4 = (v: number | null | undefined) => v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000;
const ret = (b: Bar[], n: number) => b.length > n ? r4(b[b.length - 1].c / b[b.length - 1 - n].c - 1) : null;

export const INDEXES: [string, string][] = [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["IWM", "Russell 2000"], ["DIA", "Dow 30"]];
export const SECTORS: [string, string][] = [["XLK", "Technology"], ["XLC", "Communication"], ["XLY", "Consumer discretionary"], ["XLF", "Financials"], ["XLI", "Industrials"], ["XLE", "Energy"], ["XLB", "Materials"], ["XLV", "Health care"], ["XLP", "Consumer staples"], ["XLU", "Utilities"], ["XLRE", "Real estate"]];

/* SEC form -> kind, the same grouping as the web desk. */
export function kindOf(form: string): string {
  const t = String(form || "").toUpperCase();
  if (/^(S-1|S-3|F-1|F-3)|^424B/.test(t)) return "offering";
  if (/13D/.test(t)) return "activist"; if (/13G/.test(t)) return "passive";
  if (t === "4" || t === "4/A") return "insider"; if (/^8-K/.test(t)) return "event";
  if (/^10-Q/.test(t)) return "quarterly"; if (/^10-K/.test(t)) return "annual"; return "other";
}
export const KIND_LABEL: Record<string, string> = { offering: "Share offering or shelf", activist: "Activist stake (13D)", passive: "Passive 5% stake (13G)", insider: "Insider transaction (Form 4)", event: "Material event (8-K)", quarterly: "Quarterly report (10-Q)", annual: "Annual report (10-K)", other: "Other" };

export async function priceSummary(s: Settings, sym: string) {
  const [bars, q] = await Promise.all([dailyMany(s, [sym, "SPY"], 430), fetchQuotes(s, [sym])]);
  const b = bars[sym] || [], spy = bars.SPY || [];
  if (b.length < 30) throw new Error("No daily history for " + sym);
  const c = b.map(x => x.c), i = b.length - 1, qt = q[sym], now = Date.now();
  let hi = -Infinity, lo = Infinity; for (let k = Math.max(0, i - 251); k <= i; k++) { hi = Math.max(hi, b[k].h); lo = Math.min(lo, b[k].l); }
  const vavg = b.slice(-21, -1).reduce((t, x) => t + x.v, 0) / 20;
  const r = Engine.evaluate({ daily: b, spy, nowMs: now, live: null, mode: "day", intraday: [], account: 100000, bucket: "core", capPct: 1, allowShelfException: false });
  const cb = Engine.candleBreak(b), bt = Engine.backtest(b, cb, {});
  let last: string | null = null; for (let k = cb.sig.length - 1; k >= 0; k--) if (cb.sig[k]) { last = (cb.sig[k] > 0 ? "buy " : "sell ") + b[k].d; break; }
  const open = marketOpen(qt, now);
  return {
    source: "daily bars through the " + b[i].d + " close" + (qt && qt.lastTime ? "; IEX quote " + new Date(qt.lastTime).toISOString().slice(0, 16).replace("T", " ") + " UTC" : ""),
    symbol: sym, lastClose: r4(b[i].c), livePrice: open && qt ? r4(qt.last) : null, marketOpenNow: open,
    return5d: ret(b, 5), return1m: ret(b, 21), return3m: ret(b, 63), return1y: ret(b, 252),
    vsSpy3m: ret(b, 63) != null && ret(spy, 63) != null ? r4((ret(b, 63) as number) - (ret(spy, 63) as number)) : null,
    high52w: r4(hi), low52w: r4(lo), pctFrom52wHigh: r4(b[i].c / hi - 1),
    sma20: r4(Engine.sma(c, 20)[i]), sma50: r4(Engine.sma(c, 50)[i]), sma200: b.length >= 200 ? r4(Engine.sma(c, 200)[i]) : null,
    rsi14: r4(Engine.rsi(c, 14)[i]), atr14Pct: r4(Engine.atr(b, 14)[i] / b[i].c), relVolume20d: vavg ? r4(b[i].v / vavg) : null,
    standard: { verdict: r.verdict, failed: (r.failed || []).map((f: any) => f.id), regimeSP500: r.regime ? r.regime.state : null, stop: r4(r.stop), target1: r4(r.t1) },
    candleBreak: { state: bt.open ? "long since " + b[bt.open.entryI].d : "flat", lastSignal: last, exitBelow: r4(cb.nextBullLow), buyAbove: r4(cb.nextBearHigh) },
  };
}

export async function marketBackdrop(s: Settings) {
  const bars = await dailyMany(s, ["SPY", "QQQ", "IWM"], 430);
  const out: any = { source: "daily bars through the " + ((bars.SPY || []).slice(-1)[0] || { d: "?" }).d + " close; VIX from FRED" };
  for (const k of ["SPY", "QQQ", "IWM"]) { const b = bars[k] || []; out[k] = { regime: b.length > 30 ? Engine.regime(b).state : null, return1m: ret(b, 21), return3m: ret(b, 63) }; }
  try { const v = await fetchVix(s); if (v.length) out.VIX = { last: v[v.length - 1].c, date: v[v.length - 1].d, avg20: r4(v.slice(-20).reduce((t, x) => t + x.c, 0) / Math.min(20, v.length)) }; } catch { out.VIX = null; }
  return out;
}

export async function newsFor(s: Settings, sym: string) {
  const n = await fetchNews(s, sym);
  return { source: "Benzinga via Alpaca", symbol: sym, headlines: n.slice(0, 12).map(x => ({ time: new Date(x.t).toISOString().slice(0, 16).replace("T", " ") + " UTC", headline: x.headline, summary: x.summary.slice(0, 240), source: x.source })) };
}

export async function secSummary(s: Settings, sym: string) {
  const [f, fx] = await Promise.all([fetchFilings(s, sym), fetchFacts(s, sym).catch(() => null)]);
  const cut = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  f.filings.filter(x => x.date >= cut).forEach(x => { const k = KIND_LABEL[kindOf(x.form)]; counts[k] = (counts[k] || 0) + 1; });
  return { source: "SEC EDGAR" + (fx && fx.items[0] ? "; figures from the " + fx.items[0].latestForm + " period ending " + fx.items[0].latestEnd : ""), symbol: sym, company: f.name, last90DaysByType: counts,
    latest: f.filings.slice(0, 10).map(x => ({ form: x.form, filed: x.date, items: x.items })),
    reportedFigures: fx ? fx.items.map(x => ({ item: x.label, latest: x.latest, periodEnd: x.latestEnd, yearEarlier: x.prior, change: x.prior ? r4(x.latest / x.prior - 1) : null })) : null };
}

/* Earnings dates from SEC 8-K filings that list item 2.02 (results of operations). */
export async function earningsFor(s: Settings, sym: string, bars?: Record<string, Bar[]>) {
  const f = await fetchFilings(s, sym);
  const dates = [...new Set(f.filings.filter(x => /^8-K/.test(x.form) && x.items.includes("2.02")).map(x => x.date))].sort();
  const b = bars || await dailyMany(s, [sym, "SPY"], 760);
  const rows = dates.map(d => Phone.filingWindow(b[sym] || [], b.SPY || [], d, 20)).filter(Boolean);
  return { source: "SEC 8-K item 2.02 filings and daily bars", symbol: sym, company: f.name, reports: rows.map((x: any) => ({ filed: x.date, reactionTwoDay: r4(x.reaction), next20SessionsVsSpy: r4(x.driftEx) })),
    avgAbsoluteReaction: rows.length ? r4(Analytics.mean(rows.map((x: any) => Math.abs(x.reaction)))) : null, note: "No EPS estimates or future report dates are available from free official sources." };
}
