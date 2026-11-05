import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View, Text, TextInput, RefreshControl, TextStyle } from "react-native";
import Playbook from "../../engine/playbook";
import { dailyMany, fetchVix, ApiError, Bar } from "../../api";
import { Settings, watchlistSymbols } from "../../settings";
import { Theme, px, pct, int, money, mono } from "../../theme";
import { Card, Pill, KV, Banner, Seg } from "../../ui";

/* The swing parts of the web desk's Playbook: the market gate, the four setups on your watchlist with entries,
   stops and risk-based sizes, and how each setup did on your watchlist's last three years. The phone's prices end
   16 minutes ago, so day setups stay on the web desk. Same rules and code as the web desk. */
const VERD: Record<string, [string, boolean | null, string]> = {
  go: ["Go", true, "Full size."], half: ["Half size", null, "Trade smaller: the market is mixed."], aside: ["Stand aside", false, "No new longs: the market is against them."],
};
const LIQ = { minPrice: 5, minDollarVol: 5e6 };
const R = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "R";

type Data = { gate: any; sets: { sym: string; bars: Bar[]; x: any }[]; ev: any; asOf: string };

export function PlaybookDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [prog, setProg] = useState("");
  const [riskTxt, setRiskTxt] = useState("1"), [view, setView] = useState<"scan" | "gate" | "evidence">("scan");
  const uni = watchlistSymbols(settings).slice(0, 60);
  const riskPct = Math.min(5, Math.max(0.1, Number(riskTxt) || 1));

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [m, vix] = await Promise.all([dailyMany(settings, ["SPY"], 1100), fetchVix(settings).catch(() => [])]);
      const bars = uni.length ? await dailyMany(settings, uni, 1100, (i, n) => setProg(`History ${i} of ${n}`)) : {};
      setProg("Testing the setups…");
      await new Promise(r => setTimeout(r, 0));
      const sets = uni.map(sym => ({ sym, bars: bars[sym] || [] })).filter(s => s.bars.length >= 60).map(s => ({ ...s, x: Playbook.prep(s.bars) }));
      const ok = sets.filter(s => s.x.s50[s.bars.length - 1] != null);
      const pct50 = ok.length >= 10 ? ok.filter(s => s.bars[s.bars.length - 1].c > s.x.s50[s.bars.length - 1]).length / ok.length : null;
      const spy = m.SPY || [];
      if (spy.length < 210) throw new Error("Not enough S&P history came back.");
      const gate = Playbook.gate(spy, vix, pct50);
      const ev = sets.length ? Playbook.evidence(sets, { hold: 10, cost: 0.0005, liq: LIQ, trials: 4 }) : null;
      setData({ gate, sets, ev, asOf: spy[spy.length - 1].d });
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : e?.message || "Could not read the data."); }
    finally { setBusy(false); setProg(""); }
  }, [settings]);
  useEffect(() => { run(); }, [run]);

  const hits = useMemo(() => {
    if (!data) return [];
    const evRows: Record<string, any> = {}; (data.ev ? data.ev.rows : []).forEach((r: any) => { evRows[r.id] = r; });
    const out: any[] = [];
    data.sets.forEach(s => {
      const i = s.bars.length - 1;
      Playbook.setupsAt(s.bars, s.x, i, LIQ).forEach((h: any) => {
        const plan = Playbook.sizePlan({ account: settings.account, riskPct: riskPct / 100, mult: data.gate.sizeMult, entry: h.entry, stop: h.stop, capPct: settings.capPct / 100 });
        out.push({ ...h, sym: s.sym, last: s.bars[i].c, atr: s.x.atr[i], plan, list: evRows[h.id] });
      });
    });
    return out.sort((a, b) => ((b.list && b.list.expR) ?? -9) - ((a.list && a.list.expR) ?? -9));
  }, [data, riskPct, settings.account, settings.capPct]);

  let body = null;
  if (data) {
    const g = data.gate, [gname, gok, gline] = VERD[g.verdict];
    const head = (
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <Pill theme={theme} ok={gok} text={gname} />
        <Text style={{ color: theme.ink, flex: 1, fontWeight: "600" }}>{gline} Size × {g.sizeMult.toFixed(2)}.</Text>
      </View>);
    if (view === "gate") body = (<>{head}
      <Card theme={theme} title="The market gate" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>TO {data.asOf}</Text>}>
        {g.parts.map((p: any) => (
          <View key={p.id} style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ color: theme.ink, flex: 1, fontWeight: "600" }}>{p.label}</Text>
              <Text style={[{ color: theme.ink2 }, mono as TextStyle]}>{p.id === "trend" ? (p.value === "—" ? "—" : pct(p.value)) : p.id === "breadth" ? (p.value == null ? "add tickers" : (p.value * 100).toFixed(0) + "%") : p.id === "vix" || p.id === "stress" ? px(p.value) : String(p.value)}</Text>
              <Pill theme={theme} ok={p.pts > 0 ? true : p.pts < 0 ? false : null} text={p.pts > 0 ? "+1" : p.pts < 0 ? "−1" : "0"} />
            </View>
            <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 2 }}>{p.how}</Text>
          </View>))}
        <Text style={{ color: theme.ink3, fontSize: 12, padding: 14 }}>Score {g.score > 0 ? "+" : ""}{g.score}. Go needs +2 or better with the S&P above its 200-day and the VIX at 30 or lower; stand aside at −1 or worse or with the VIX above 35; otherwise half size.{g.volScale < 1 ? ` Sizes are also scaled by ${g.volScale.toFixed(2)} because the VIX is above its one-year median.` : ""} The VIX here is the St. Louis Fed's daily close and can lag a day.</Text>
      </Card></>);
    else if (view === "evidence") body = (<>{head}
      {data.ev ? <Card theme={theme} title="How the setups did" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{data.ev.names} NAMES</Text>}>
        {data.ev.rows.map((r: any) => (
          <View key={r.id} style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ color: theme.ink, flex: 1, fontWeight: "600" }}>{r.label}</Text>
              <Pill theme={theme} ok={r.verdict.key === "holds" ? true : r.verdict.key === "no" ? false : null} text={r.verdict.key === "holds" ? "Held up" : r.verdict.key === "no" ? "Did not pay" : r.verdict.key === "thin" ? "Too few" : "Unproven"} />
            </View>
            <Text style={[{ color: theme.ink2, fontSize: 13, marginTop: 3 }, mono as TextStyle]}>{r.n} trades · avg {R(r.expR)} · first 70% {R(r.train.expR)} · last 30% {R(r.test.expR)} · deflated Sharpe {r.deflated ? (r.deflated.dsr * 100).toFixed(0) + "%" : "—"}</Text>
          </View>))}
        <Text style={{ color: theme.ink3, fontSize: 12, padding: 14 }}>The exact scanner rules on about three years of your watchlist: buy-stop next session, stop as planned, target or a 10-day time exit, 5 basis points a side. Above +0.1R a trade is useful; the deflated Sharpe is the chance the edge is real after allowing for trying several setups. The web desk's Evidence tab counts every setting you try.</Text>
      </Card> : <Text style={{ color: theme.ink3 }}>Add tickers to your watchlist in Settings.</Text>}</>);
    else body = (<>{head}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Text style={{ color: theme.ink2 }}>Risk per trade %</Text>
        <TextInput value={riskTxt} onChangeText={setRiskTxt} keyboardType="decimal-pad" accessibilityLabel="Risk per trade in percent" style={[{ width: 70, borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, color: theme.ink, backgroundColor: theme.sheet }, mono as TextStyle]} />
        <Text style={{ color: theme.ink3, flex: 1, fontSize: 12 }}>of {money(settings.account)} (Settings)</Text>
      </View>
      {hits.length ? hits.map((h, k) => (
        <Card key={h.sym + h.id + k} theme={theme} title={h.sym} right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{(Playbook.SETUPS.find((z: any) => z.id === h.id) || {}).short?.toUpperCase()}</Text>}>
          <KV theme={theme} items={[["Buy above", px(h.entry)], ["Stop", px(h.stop) + " · " + (h.risk / h.atr).toFixed(1) + " ATR"], ["Target", px(h.target)], ["Shares", h.plan.shares ? int(h.plan.shares) : g.verdict === "aside" ? "Stand aside" : "—"], ["At risk", h.plan.shares ? money(h.plan.riskDollars) : "—"], ["Setup on your list", h.list && h.list.n ? R(h.list.expR) + " · " + h.list.n : "—"]]} />
        </Card>)) : <Text style={{ color: theme.ink3, marginBottom: 12 }}>No setups on the last close{uni.length ? "" : ": add tickers to your watchlist in Settings"}.</Text>}
      <Text style={{ color: theme.ink3, fontSize: 12, marginBottom: 12 }}>Buy-stop orders for the next session; an order not filled that day is cancelled. Names under $5 or trading under $5 million a day are skipped. Check earnings dates before holding a swing trade. The web desk's Playbook flags them, trails your stops on its Manage tab and checks saved plans against your fills.</Text>
    </>);
  }
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={run} tintColor={theme.teal} />}>
      <View style={{ marginBottom: 12 }}><Seg theme={theme} value={view} onChange={setView} options={[{ v: "scan", label: "Setups" }, { v: "gate", label: "Gate" }, { v: "evidence", label: "Evidence" }]} /></View>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {body || <Text style={{ color: theme.ink3 }}>{busy ? (prog || "Reading…") : ""}</Text>}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>Daily closes; the free data plan ends 16 minutes ago. A report of written rules, not a recommendation. Read-only: nothing here places an order.</Text>
    </ScrollView>
  );
}
