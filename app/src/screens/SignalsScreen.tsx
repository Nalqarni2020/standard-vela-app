import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View, Text, Switch, RefreshControl } from "react-native";
import Engine from "../engine/engine";
import { Bar, fetchBars, confirmedDaily, ApiError } from "../api";
import { Settings } from "../settings";
import { Theme, px, pct } from "../theme";
import { Chart } from "../Chart";
import { Card, Pill, Seg, KV, Banner } from "../ui";

type Opts = { body: number; falseSell: boolean; atr: boolean; vol: boolean; stop: boolean; years: 1 | 3 | 5 };

/* The candle-break formula on daily closes, with the backtest from the desk. */
export function SignalsScreen({ theme, settings, symbol }: { theme: Theme; settings: Settings; symbol: string }) {
  const [o, setO] = useState<Opts>({ body: 0.55, falseSell: false, atr: false, vol: false, stop: false, years: 3 });
  const [bars, setBars] = useState<Bar[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(Date.now());

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { const d = await fetchBars(settings, [symbol], "day", Math.round(o.years * 365.25)); setBars(d.bars[symbol] || []); setAt(Date.now()); }
    catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read history."); }
    finally { setBusy(false); }
  }, [settings, symbol, o.years]);
  useEffect(() => { if (settings.token && settings.proxyUrl && symbol) load(); }, [load]);

  const res = useMemo(() => {
    const b = confirmedDaily(bars, at);
    if (b.length < 30) return null;
    const cb = Engine.candleBreak(b, { body: o.body, falseSell: o.falseSell, atr: o.atr, vol: o.vol });
    const bt = Engine.backtest(b, cb, { stop: o.stop, cost: 0.0005 });
    let li = -1; for (let i = cb.sig.length - 1; i >= 0; i--) if (cb.sig[i]) { li = i; break; }
    return { b, cb, bt, li };
  }, [bars, at, o]);

  const sw = (k: keyof Opts, label: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 6 }}>
      <Text style={{ color: theme.ink, flex: 1 }}>{label}</Text>
      <Switch value={!!o[k]} onValueChange={v => setO({ ...o, [k]: v })} trackColor={{ true: theme.teal, false: theme.rule }} />
    </View>);

  let state = "";
  if (res) {
    const { b, cb, bt } = res, n = b.length - 1, last = b[n];
    if (cb.sig[n] === 1 && !bt.open) state = "Buy signal on the last close (" + px(last.c) + "). The entry is at the next open.";
    else if (cb.sig[n] === -1 && bt.open) state = "Sell signal on the last close. The trade closes at the next open.";
    else if (bt.open) state = "In a trade since " + b[bt.open.entryI].d + " at " + px(bt.open.entryPx) + ", now " + pct(bt.open.ret) + ". Exit on a close under " + px(cb.nextBullLow) + (cb.mainDir === 1 && cb.brokenBear != null ? " or under " + px(cb.brokenBear) : "") + ".";
    else state = "Flat. A buy needs a close above " + px(cb.nextBearHigh) + ".";
  }
  const st = res && res.bt.stats;

  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.teal} />}>
      <Text style={{ color: theme.ink, fontSize: 20, fontWeight: "700", marginBottom: 4 }}>Candle break · {symbol}</Text>
      <Text style={{ color: theme.ink3, marginBottom: 12 }}>Daily closes only. Load another ticker on the Standard tab.</Text>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      <Card theme={theme} title="Settings" right={<Seg theme={theme} value={String(o.years) as "1" | "3" | "5"} onChange={v => setO({ ...o, years: +v as 1 | 3 | 5 })} options={[{ v: "1", label: "1y" }, { v: "3", label: "3y" }, { v: "5", label: "5y" }]} />}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: theme.ink }}>Strong body ≥ {o.body.toFixed(2)}</Text>
          <Seg theme={theme} value={o.body.toFixed(2)} onChange={v => setO({ ...o, body: +v })} options={["0.45", "0.55", "0.65"].map(v => ({ v, label: v }))} />
        </View>
        {sw("falseSell", "False breakdown counts as a buy")}
        {sw("stop", "Fixed stop at the strong bullish low")}
        {sw("vol", "Buy needs 1.3× volume")}
        {sw("atr", "Strong candle range ≥ ATR 14")}
        <Text style={{ color: theme.ink3, fontSize: 12, paddingHorizontal: 14, paddingBottom: 10 }}>All switches off and 0.55 is the formula exactly as published.</Text>
      </Card>
      {res ? (
        <>
          <Card theme={theme} title="Now" right={<Pill theme={theme} ok={res.bt.open ? true : res.cb.sig[res.b.length - 1] === 1 ? true : false} text={res.bt.open ? "In trade" : res.cb.sig[res.b.length - 1] === 1 ? "Buy signal" : "Flat"} />}>
            <Text style={{ color: theme.ink, padding: 14 }}>{state}{res.li >= 0 ? "\nLast signal: " + (res.cb.sig[res.li] > 0 ? "buy" : "sell") + " on " + res.b[res.li].d + ", " + (res.b.length - 1 - res.li) + " bars ago." : ""}</Text>
            <Chart theme={theme} bars={res.b} count={120} marks={res.cb.sig.map((v: number, i: number) => ({ i, dir: v })).filter((m: any) => m.dir)}
              lines={[{ vals: res.cb.bearHigh, color: theme.down, dash: "4,3" }, { vals: res.cb.bullLow, color: theme.up, dash: "4,3" }]} />
          </Card>
          <Card theme={theme} title="Backtest">
            <KV theme={theme} items={[["Closed trades", String(st.count)], ["Win rate", st.winRate == null ? "—" : (st.winRate * 100).toFixed(0) + "%"], ["Profit factor", st.pf == null ? "—" : st.pf === Infinity ? "no losses" : st.pf.toFixed(2)], ["Average trade", pct(st.avgRet)], ["Strategy", pct(res.bt.total)], ["Buy and hold", pct(res.bt.bh)], ["Worst drawdown", pct(-res.bt.maxDD)], ["Time in market", (res.bt.exposure * 100).toFixed(0) + "%"]]} />
            <Text style={{ color: theme.ink3, fontSize: 12, padding: 14 }}>Long only. Signals on a close fill at the next open. 5 basis points per side. Past results do not predict future ones.</Text>
          </Card>
        </>
      ) : !err ? <Text style={{ color: theme.ink3 }}>{busy ? "Reading history…" : "Not enough history."}</Text> : null}
    </ScrollView>
  );
}
