import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, TextStyle } from "react-native";
import Analytics from "../../engine/analytics";
import { dailyMany, resolveSymbol, ApiError } from "../../api";
import { Settings, watchlistSymbols } from "../../settings";
import { Theme, mono, pct } from "../../theme";
import { Card, Btn, Banner, Seg, KV } from "../../ui";
import { earningsFor } from "../../research";

/* Past earnings reactions, dated from SEC 8-K item 2.02 filings. Free official sources give no EPS estimates or future dates. */
export function EarningsDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [mode, setMode] = useState<"stock" | "list">("stock"), [input, setInput] = useState(settings.lastSymbol);
  const [one, setOne] = useState<any>(null), [list, setList] = useState<any[] | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState("");
  const runOne = async () => {
    const sym = resolveSymbol(input); if (!sym) { setErr("Type a US ticker."); return; }
    setErr(null); setBusy("Reading filings and prices…");
    try { setOne(await earningsFor(settings, sym)); } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read earnings."); } finally { setBusy(""); }
  };
  const runList = async () => {
    const syms = watchlistSymbols(settings); if (!syms.length) { setErr("Add tickers to your watchlist in Settings."); return; }
    setErr(null);
    try {
      setBusy("Reading prices…"); const bars = await dailyMany(settings, syms.concat(["SPY"]), 760);
      const rows: any[] = [];
      for (let i = 0; i < syms.length; i++) { setBusy(`Reading filings ${i + 1} of ${syms.length}…`); try { const e = await earningsFor(settings, syms[i], bars); rows.push({ sym: syms[i], last: e.reports.length ? e.reports[e.reports.length - 1].filed : null, n: e.reports.length, avg: e.avgAbsoluteReaction }); } catch (x: any) { if (x instanceof ApiError && x.code === "not_found") rows.push({ sym: syms[i], last: null, n: 0, avg: null }); else throw x; } }
      // A rough next date: last report + 91 days. Marked as an estimate everywhere it shows.
      rows.forEach(r => { r.next = r.last ? new Date(Date.parse(r.last) + 91 * 86400000).toISOString().slice(0, 10) : null; });
      rows.sort((a, b) => (a.next || "9999").localeCompare(b.next || "9999"));
      setList(rows);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read earnings."); } finally { setBusy(""); }
  };
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ marginBottom: 10, alignSelf: "flex-start" }}><Seg theme={theme} value={mode} onChange={setMode} options={[{ v: "stock", label: "One stock" }, { v: "list", label: "Watchlist" }]} /></View>
      {mode === "stock" ? <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TextInput value={input} onChangeText={setInput} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={runOne} style={[{ flex: 1, borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.sheet }, mono as TextStyle]} />
        <Btn theme={theme} label={busy ? "…" : "Read"} primary onPress={runOne} disabled={!!busy} /></View>
        : <Btn theme={theme} label={busy || "Check my watchlist"} primary onPress={runList} disabled={!!busy} style={{ marginBottom: 12, alignSelf: "flex-start" }} />}
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {busy && mode === "stock" ? <Text style={{ color: theme.ink3 }}>{busy}</Text> : null}
      {mode === "stock" && one ? (() => {
        const up = one.reports.filter((r: any) => r.reactionTwoDay > 0), dn = one.reports.filter((r: any) => r.reactionTwoDay < 0);
        const dU = Analytics.summarize(up.map((r: any) => r.next20SessionsVsSpy)), dD = Analytics.summarize(dn.map((r: any) => r.next20SessionsVsSpy));
        return <>
          <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "600", marginBottom: 12 }}>{one.company}: {one.reports.length} reports in 2 years, moving {one.avgAbsoluteReaction == null ? "—" : "±" + (one.avgAbsoluteReaction * 100).toFixed(1) + "%"} on average over the two days around each.{dU.n && dD.n ? ` After up reactions it went on ${pct(dU.mean)} vs SPY in 20 sessions; after down reactions ${pct(dD.mean)}.` : ""}</Text>
          <Card theme={theme} title="Reports" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>SEC 8-K ITEM 2.02</Text>}>
            {one.reports.slice().reverse().map((r: any) => <View key={r.filed} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}>
              <Text style={[{ color: theme.ink, flex: 1 }, mono as TextStyle]}>{r.filed}</Text>
              <Text style={[{ color: r.reactionTwoDay >= 0 ? theme.up : theme.down, width: 80, textAlign: "right" }, mono as TextStyle]}>{pct(r.reactionTwoDay)}</Text>
              <Text style={[{ color: (r.next20SessionsVsSpy ?? 0) >= 0 ? theme.up : theme.down, width: 90, textAlign: "right" }, mono as TextStyle]}>{r.next20SessionsVsSpy == null ? "—" : pct(r.next20SessionsVsSpy)}</Text>
            </View>)}
            <Text style={{ color: theme.ink3, fontSize: 11, padding: 14 }}>Columns: filing date, move from the close before to the close after (catches before-open and after-close releases), then the next 20 sessions against SPY. Post-earnings drift: Bernard and Thomas (1989).</Text>
          </Card></>; })() : null}
      {mode === "list" && list ? <Card theme={theme} title="Watchlist">{list.map(r => <View key={r.sym} style={{ paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.rule }}>
        <Text style={{ color: theme.ink, fontWeight: "600" }}>{r.sym}  <Text style={{ color: theme.ink2, fontWeight: "400" }}>{r.next ? "around " + r.next + " (estimate)" : "no 8-K results filings"}</Text></Text>
        <Text style={{ color: theme.ink3, fontSize: 12 }}>Last report {r.last || "—"} · usual two-day move {r.avg == null ? "—" : "±" + (r.avg * 100).toFixed(1) + "%"} over {r.n} reports</Text>
      </View>)}<Text style={{ color: theme.ink3, fontSize: 11, padding: 14 }}>Next dates are estimates: the last report plus 91 days. Confirm with the company before relying on one.</Text></Card> : null}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>The web desk adds EPS estimates, confirmed dates and options-implied moves from Robinhood.</Text>
    </ScrollView>
  );
}
