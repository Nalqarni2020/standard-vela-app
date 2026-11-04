import React, { useState } from "react";
import { ScrollView, View, Text, TextStyle } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import Engine from "../../engine/engine";
import Analytics from "../../engine/analytics";
import Phone from "../../engine/phone";
import { dailyMany, fetchQuotes, marketOpen, ApiError } from "../../api";
import { Settings } from "../../settings";
import { Theme, mono, px, pct, money } from "../../theme";
import { Card, Btn, Banner, KV } from "../../ui";
import { LABEL } from "../../desk";

/* Journal and risk from a Robinhood account-activity CSV. The file is read on the phone and never uploaded. */
export function BookDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [res, setRes] = useState<any>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState("");
  const pick = async () => {
    setErr(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain", "public.comma-separated-values-text"], copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets || !r.assets[0]) return;
      setBusy("Reading the file…");
      const text = await new File(r.assets[0].uri).text();
      const act = Phone.robinhoodActivity(text);
      if (!act.ok) { setErr(act.reason); return; }
      const { trips, unmatched, open } = Analytics.roundTrips(act.orders);
      const syms = [...new Set<string>(trips.map((t: any) => t.symbol).concat(open.map((o: any) => o.symbol)))];
      const days = Math.min(1830, Math.ceil((Date.now() - Date.parse(act.from)) / 86400000) + 200);
      const bars = await dailyMany(settings, syms.concat(["SPY"]), days, (i, n) => setBusy(`Reading prices ${i} of ${n}…`));
      const spy = bars.SPY || [];
      for (const t of trips) {
        const day = new Date(t.entryT).toISOString().slice(0, 10), b = (bars[t.symbol] || []).filter(x => x.d < day), sp = spy.filter(x => x.d < day);
        t.entryDay = day; t.exitDay = new Date(t.exitT).toISOString().slice(0, 10);
        if (b.length >= 30 && sp.length >= 30) {
          const r = Engine.evaluate({ daily: b, spy: sp, nowMs: Date.parse(b[b.length - 1].d + "T23:00:00Z"), live: null, mode: "day", intraday: [], account: 100000, bucket: "core", capPct: 1, allowShelfException: false });
          t.std = r.checks && r.checks.length ? r.checks.every((c: any) => c.pass) : null; t.stdFail = r.failed && r.failed[0] ? r.failed[0].id : null; t.tape = r.regime ? r.regime.state : null;
          const s20 = Engine.sma(b.map(x => x.c), 20); t.chase = s20[s20.length - 1] ? t.entryPx / s20[s20.length - 1] - 1 : null;
        }
      }
      // Holdings rebuilt from the file: right only if the file covers every purchase since you opened them.
      const posMap = new Map<string, { qty: number; cost: number }>();
      open.forEach((o: any) => { const p = posMap.get(o.symbol) || { qty: 0, cost: 0 }; p.qty += o.qty; p.cost += o.qty * o.px; posMap.set(o.symbol, p); });
      const q = posMap.size ? await fetchQuotes(settings, [...posMap.keys()]) : {};
      const now = Date.now();
      const pos = [...posMap.entries()].map(([sym, p]) => { const qt = q[sym]; const b = bars[sym] || []; const last = qt && marketOpen(qt, now) && qt.last != null ? qt.last : b.length ? b[b.length - 1].c : null; return { sym, qty: p.qty, avg: p.cost / p.qty, last, value: last != null ? last * p.qty : null }; }).sort((a, b) => (b.value || 0) - (a.value || 0));
      const total = pos.reduce((t, x) => t + (x.value || 0), 0);
      const wb = pos.filter(x => x.value && (bars[x.sym] || []).length > 30);
      const risk = total > 0 ? Analytics.portfolioRisk(wb.map(x => (x.value as number) / total), wb.map(x => bars[x.sym]), 60) : null;
      setRes({ act, trips, unmatched, pos, total, risk, wb });
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read that file: " + (e && e.message ? e.message : "unknown error")); }
    finally { setBusy(""); }
  };

  let body = null;
  if (res) {
    const { act, trips, unmatched, pos, total, risk, wb } = res, all = Analytics.groupStats(trips);
    const groups: [string, any][] = [["All round trips", trips], ["Standard passed at entry", trips.filter((t: any) => t.std === true)], ["Standard failed at entry", trips.filter((t: any) => t.std === false)], ["Green S&P tape", trips.filter((t: any) => t.tape === "Green")], ["Yellow or Red tape", trips.filter((t: any) => t.tape && t.tape !== "Green")], ["Bought >5% above 20-day", trips.filter((t: any) => t.chase != null && t.chase > 0.05)], ["Bought within 5% of 20-day", trips.filter((t: any) => t.chase != null && t.chase <= 0.05)]].map(([l, g]: any) => [l, Analytics.groupStats(g)]);
    const corr = risk ? risk.corrPairs.filter((c: any) => c.c >= 0.7) : [];
    body = <>
      {all ? <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "600", marginBottom: 12 }}>{all.n} round trips from {act.from} to {act.to}: {(all.win * 100).toFixed(0)}% winners, {money(all.pnl)}, profit factor {all.pf == null ? "—" : all.pf === Infinity ? "no losses" : all.pf.toFixed(2)}.{all.holdLoss != null && all.holdWin != null && all.holdLoss > all.holdWin * 1.5 ? ` You held losers ${all.holdLoss.toFixed(1)} days and winners ${all.holdWin.toFixed(1)}.` : ""}</Text> : <Text style={{ color: theme.ink3, marginBottom: 12 }}>No completed round trips in this file.</Text>}
      {all ? <Card theme={theme} title="Habits">{groups.map(([l, g]) => <View key={l} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}>
        <Text style={{ color: theme.ink, flex: 1 }}>{l} <Text style={{ color: theme.ink3 }}>({g ? g.n : 0})</Text></Text>
        <Text style={[{ color: g && g.avgRet >= 0 ? theme.up : theme.down, width: 72, textAlign: "right" }, mono as TextStyle]}>{g ? pct(g.avgRet) : "—"}</Text>
        <Text style={[{ color: theme.ink2, width: 46, textAlign: "right" }, mono as TextStyle]}>{g ? (g.win * 100).toFixed(0) + "%" : ""}</Text></View>)}
        <Text style={{ color: theme.ink3, fontSize: 11, padding: 14 }}>Average return per trip and win rate. The Standard is read on the close before each purchase.</Text></Card> : null}
      {pos.length ? <Card theme={theme} title="Holdings rebuilt from the file">
        <KV theme={theme} items={[["Value", money(total)], ["Bad-day loss (95%)", risk && risk.var95 != null ? money(risk.var95 * total) : "—"]]} />
        {pos.map((x: any) => <View key={x.sym} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}>
          <Text style={{ color: theme.ink, fontWeight: "600", width: 64 }}>{x.sym}</Text><Text style={[{ color: theme.ink2, flex: 1 }, mono as TextStyle]}>{x.qty % 1 ? x.qty.toFixed(3) : x.qty} @ {px(x.avg)}</Text>
          <Text style={[{ color: x.last != null && x.last >= x.avg ? theme.up : theme.down }, mono as TextStyle]}>{x.last != null ? pct(x.last / x.avg - 1) : "—"}</Text></View>)}
        {corr.length ? <Text style={{ color: theme.ink2, padding: 14, fontSize: 13 }}>Move together: {corr.slice(0, 4).map((c: any) => wb[c.i].sym + " and " + wb[c.j].sym + " (" + c.c.toFixed(2) + ")").join("; ")}.</Text> : null}
        <Text style={{ color: theme.ink3, fontSize: 11, padding: 14 }}>Right only if the file includes every purchase of what you still hold. Bad-day loss: 1.645 × daily volatility of these holdings together, last 60 sessions.</Text></Card> : null}
      {trips.length ? <Card theme={theme} title="Round trips, newest first">{trips.slice().sort((a: any, b: any) => b.exitT - a.exitT).slice(0, 80).map((t: any, i: number) => <View key={i} style={{ paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}>
        <Text style={{ color: theme.ink }}><Text style={{ fontWeight: "600" }}>{t.symbol}</Text>  {t.entryDay} → {t.exitDay}  <Text style={{ color: t.pnl >= 0 ? theme.up : theme.down }}>{money(t.pnl)} ({pct(t.ret)})</Text></Text>
        <Text style={{ color: theme.ink3, fontSize: 12 }}>{px(t.entryPx)} → {px(t.exitPx)} · Standard {t.std == null ? "—" : t.std ? "passed" : "failed: " + (LABEL[t.stdFail] || t.stdFail)} · tape {t.tape || "—"}</Text></View>)}</Card> : null}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 12 }}>{Object.entries(act.skipped).map(([k, v]) => v + " " + k).join(", ") || "No"} rows skipped (dividends, transfers, options and the like). {unmatched.length ? unmatched.length + " sells could not be matched to a purchase in the file." : ""} The file shows dates without times, so same-day trades keep the file's order.</Text>
    </>;
  }
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }}>
      <Card theme={theme} title="Import">
        <Text style={{ color: theme.ink2, padding: 14, paddingBottom: 6 }}>In Robinhood, find Reports and statements and generate an account activity report as a CSV file. Open it here. The file stays on this phone; only ticker symbols are sent to your proxy for prices.</Text>
        <View style={{ padding: 14 }}><Btn theme={theme} label={busy || "Choose the CSV file"} primary onPress={pick} disabled={!!busy} /></View>
      </Card>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {body}
    </ScrollView>
  );
}
