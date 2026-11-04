import Engine from "./engine/engine";
import { Bar, Quote, confirmedDaily, marketOpen } from "./api";
import { Settings } from "./settings";
import { px, int, money } from "./theme";

const R = Engine.RULES;
export type Tf = "day" | "5m" | "15m";

export const LABEL: Record<string, string> = { regime: "Regime", shelf: "Shelf is a base", band: "Inside the band", trigger: "Trigger", volume: "Relative volume", reward: "Reward to Target 1", clock: "Clock" };

export function nextAction(r: any, tf: Tf): string {
  if (r.verdict === "BUY") return "Place the stop at " + px(r.stop) + " with the entry. Do not widen it.";
  const id = r.failed[0].id;
  switch (id) {
    case "regime": return "Stand aside until the S&P turns Green. It reads " + r.regime.state + " today.";
    case "shelf": return !r.shelf ? "Wait for a swing low or flush low to print." : r.shelf.undercut ? "The shelf broke. Wait for a new one." : "Wait for two closes above " + px(r.shelf.level) + ".";
    case "band": return !r.band ? "No band without a shelf." : r.ref > r.band.hi ? "Do not chase. Wait for price to come back to " + px(r.band.hi) + " to " + px(r.band.lo) + "." : r.ref < r.shelf.level ? "Price is under the shelf. The setup is void." : "Wait for price to lift into " + px(r.band.lo) + " to " + px(r.band.hi) + ".";
    case "trigger": return tf === "day" ? "Needs a cash close above the 8-day (" + px(r.ma.s8) + ") inside the band." : "Needs a 5-minute close back above VWAP inside the band.";
    case "volume": return "Needs at least " + R.rvolMin + "× relative volume. It reads " + (r.rvol == null ? "—" : r.rvol.toFixed(2) + "×") + ".";
    case "reward": return r.t1 != null && r.entry != null && r.t1 <= r.entry ? "Target 1 (" + px(r.t1) + ") sits at or under the entry." : "Reward is under 2 to 1. Wait for a lower entry closer to the shelf.";
    default: return "Wait until 14:00 New York for a new momentum entry.";
  }
}

export function planText(r: any, sym: string): string {
  if (r.verdict === "BUY") return "Buy " + int(r.size.shares) + " shares of " + sym + " at " + px(r.entry) + " or better. Stop " + px(r.stop) + ". Target 1 " + px(r.t1) + ", Target 2 " + px(r.t2) + ". Risk " + money(r.size.riskDollars) + ".";
  return "Buy none of " + sym + ".";
}

/* Intraday bars the proxy returns end 16 minutes ago; drop any bar whose period is not over. */
export function closedIntraday(bars: Bar[], mins: number, nowMs: number): Bar[] {
  const end = nowMs - 16 * 60000;
  return bars.filter(b => b.t + mins * 60000 <= end);
}

export function evaluate(o: { daily: Bar[]; spy: Bar[]; i5: Bar[]; quote?: Quote; tf: Tf; settings: Settings; nowMs: number }) {
  const daily = confirmedDaily(o.daily, o.nowMs), spy = confirmedDaily(o.spy, o.nowMs);
  const open = marketOpen(o.quote, o.nowMs);
  const live = o.quote && o.quote.last != null ? { price: open ? o.quote.last : daily.length ? daily[daily.length - 1].c : o.quote.last } : null;
  let intraday: Bar[] = [];
  if (o.tf !== "day") {
    const c5 = closedIntraday(o.i5, 5, o.nowMs);
    intraday = o.tf === "15m" ? closedIntraday(Engine.aggregate(c5, 15), 15, o.nowMs) : c5;
    if (intraday.length < 2) return { verdict: "NONE", headline: "No intraday bars yet. Switch to Daily.", checks: [] };
  }
  return Engine.evaluate({ daily, spy, nowMs: o.nowMs, live, mode: o.tf, intraday, account: o.settings.account, bucket: o.settings.bucket, capPct: o.settings.capPct / 100, allowShelfException: false });
}
