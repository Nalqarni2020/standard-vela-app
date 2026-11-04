import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, View, Text, RefreshControl } from "react-native";
import Engine from "../../engine/engine";
import Analytics from "../../engine/analytics";
import { dailyMany, fetchVix, ApiError } from "../../api";
import { Settings, watchlistSymbols } from "../../settings";
import { Theme, px, pct } from "../../theme";
import { Card, Pill, KV, Banner } from "../../ui";
import { LineChart } from "../../Chart";
import { INDEXES, SECTORS } from "../../research";

const ret = (b: any[], n: number) => b.length > n ? b[b.length - 1].c / b[b.length - 1 - n].c - 1 : null;

/* Regime, breadth, sector rotation and the VIX, scored the same way as the web desk. */
export function MarketDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [res, setRes] = useState<any>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [prog, setProg] = useState("");
  const uni = watchlistSymbols(settings);
  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const etfs = INDEXES.concat(SECTORS).map(x => x[0]);
      const [eb, vix] = await Promise.all([dailyMany(settings, etfs, 430), fetchVix(settings).catch(() => [])]);
      const ub = uni.length ? await dailyMany(settings, uni, 430, (i, n) => setProg(`Breadth ${i} of ${n}`)) : {};
      setProg("");
      setRes({ eb, vix, br: Analytics.breadth(ub, 120) });
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read the market."); }
    finally { setBusy(false); }
  }, [settings]);
  useEffect(() => { run(); }, [run]);

  let body = null;
  if (res) {
    const { eb, vix, br } = res, spy = eb.SPY || [];
    const reg = spy.length > 30 ? Engine.regime(spy).state : "Unknown";
    const p50 = br.now.n ? br.now.a50 / br.now.n : null;
    const vNow = vix.length ? vix[vix.length - 1].c : null, v20 = vix.length >= 20 ? vix.slice(-20).reduce((t: number, x: any) => t + x.c, 0) / 20 : null;
    const parts: [string, string, number][] = [
      ["S&P regime", reg, reg === "Green" ? 1 : reg === "Red" ? -1 : 0],
      ["Watchlist above 50-day", p50 == null ? "add a watchlist" : (p50 * 100).toFixed(0) + "%", p50 == null ? 0 : p50 > 0.6 ? 1 : p50 < 0.4 ? -1 : 0],
      ["New 52-week highs vs lows", br.now.n252 ? br.now.hi + " vs " + br.now.lo : "—", br.now.hi > br.now.lo ? 1 : br.now.lo > br.now.hi ? -1 : 0],
      ["VIX vs 20-day", vNow == null ? "—" : px(vNow) + " vs " + px(v20), vNow == null || v20 == null ? 0 : vNow < v20 && vNow < 20 ? 1 : vNow > v20 && vNow > 25 ? -1 : 0],
    ];
    const score = parts.reduce((t, p) => t + p[2], 0), verdict = score >= 2 ? "Risk-on" : score <= -2 ? "Risk-off" : "Mixed";
    const sect = SECTORS.map(([sym, name]) => { const b = eb[sym] || []; const r3 = ret(b, 63), s3 = ret(spy, 63); return { sym, name, m: ret(b, 21), rs: r3 != null && s3 != null ? r3 - s3 : null }; }).sort((a, b) => (b.rs ?? -9) - (a.rs ?? -9));
    body = (
      <>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 12 }}><Pill theme={theme} ok={score >= 2 ? true : score <= -2 ? false : null} text={verdict} /><Text style={{ color: theme.ink, flex: 1, fontWeight: "600" }}>Score {score > 0 ? "+" : ""}{score} of ±4. Leading: {sect.slice(0, 2).map(x => x.name).join(", ")}.</Text></View>
        <Card theme={theme} title="How it is scored">{parts.map(p => <View key={p[0]} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.rule }}><Text style={{ color: theme.ink, flex: 1 }}>{p[0]}</Text><Text style={{ color: theme.ink2, marginRight: 10 }}>{p[1]}</Text><Pill theme={theme} ok={p[2] > 0 ? true : p[2] < 0 ? false : null} text={p[2] > 0 ? "+1" : p[2] < 0 ? "−1" : "0"} /></View>)}</Card>
        <Card theme={theme} title="Indexes"><KV theme={theme} items={INDEXES.map(([sym, n]) => { const b = eb[sym] || []; return [n, pct(ret(b, 21)) + " 1m · " + (b.length > 30 ? Engine.regime(b).state : "—")] as [string, string]; })} /></Card>
        <Card theme={theme} title="Breadth" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{br.now.n} NAMES</Text>}>
          {br.now.n ? <><KV theme={theme} items={[["Above 20-day", (br.now.a20 / br.now.n * 100).toFixed(0) + "%"], ["Above 50-day", (p50! * 100).toFixed(0) + "%"], ["New highs / lows", br.now.hi + " / " + br.now.lo], ["Up / down", br.now.adv + " / " + br.now.dec]]} />
            <LineChart theme={theme} series={[{ vals: br.series.map((v: number | null) => v == null ? null : v * 100), color: theme.teal }]} guides={[{ y: 60, color: theme.up, label: "60%" }, { y: 40, color: theme.down, label: "40%" }]} fmt={v => v.toFixed(0) + "%"} /></>
            : <Text style={{ color: theme.ink3, padding: 14 }}>Add tickers to your watchlist in Settings to measure breadth.</Text>}
        </Card>
        <Card theme={theme} title="Sectors vs SPY, 3 months">{sect.map(x => <View key={x.sym} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}><Text style={{ color: theme.ink, flex: 1 }}>{x.sym} <Text style={{ color: theme.ink3 }}>{x.name}</Text></Text><Text style={{ color: (x.rs ?? 0) >= 0 ? theme.up : theme.down }}>{pct(x.rs)}</Text></View>)}</Card>
        <Card theme={theme} title="VIX" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>FRED</Text>}>
          <KV theme={theme} items={[["VIX", px(vNow)], ["20-day average", px(v20)]]} />
          {vix.length > 20 ? <LineChart theme={theme} series={[{ vals: vix.slice(-252).map((x: any) => x.c), color: theme.amber }]} guides={[{ y: 20, color: theme.ink3, label: "20" }]} /> : null}
        </Card>
      </>);
  }
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={run} tintColor={theme.teal} />}>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {body || <Text style={{ color: theme.ink3 }}>{busy ? (prog || "Reading the market…") : ""}</Text>}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>Breadth uses your watchlist from Settings. The VIX is the St. Louis Fed's daily close series and can lag a day.</Text>
    </ScrollView>
  );
}
