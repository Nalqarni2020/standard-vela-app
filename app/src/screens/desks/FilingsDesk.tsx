import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, Linking, Pressable, TextStyle } from "react-native";
import Analytics from "../../engine/analytics";
import { dailyMany, fetchFilings, fetchFacts, resolveSymbol, ApiError, Filing, Fact } from "../../api";
import { Settings, watchlistSymbols } from "../../settings";
import { Theme, mono, pct } from "../../theme";
import { Card, Btn, Banner, Seg, Pill } from "../../ui";
import { kindOf, KIND_LABEL } from "../../research";

const big = (v: number) => { const a = Math.abs(v), s = v < 0 ? "-" : ""; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? s + (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? s + (a / 1e3).toFixed(0) + "K" : s + a.toFixed(0); };

/* SEC EDGAR: offerings, activist stakes, insider filings, 8-K events and reported figures. */
export function FilingsDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [mode, setMode] = useState<"stock" | "radar">("stock"), [input, setInput] = useState(settings.lastSymbol);
  const [one, setOne] = useState<any>(null), [radar, setRadar] = useState<any[] | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState("");
  const runOne = async () => {
    const sym = resolveSymbol(input); if (!sym) { setErr("Type a US ticker."); return; }
    setErr(null); setBusy("Reading SEC filings…");
    try {
      const [f, fx, bars] = await Promise.all([fetchFilings(settings, sym), fetchFacts(settings, sym).catch(() => null), dailyMany(settings, [sym, "SPY"], 760)]);
      const b = bars[sym] || [], spy = bars.SPY || [], groups: Record<string, number[]> = {};
      f.filings.forEach((x: Filing) => { const e = Analytics.eventReturn(b, spy, x.date, 5); const k = kindOf(x.form); (groups[k] = groups[k] || []); if (e && e.excess != null) groups[k].push(e.excess); });
      setOne({ sym, f, fx, groups });
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read the filings."); }
    finally { setBusy(""); }
  };
  const runRadar = async () => {
    const syms = watchlistSymbols(settings); if (!syms.length) { setErr("Add tickers to your watchlist in Settings."); return; }
    setErr(null); const cut = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), rows: any[] = [];
    try {
      for (let i = 0; i < syms.length; i++) { setBusy(`Reading ${i + 1} of ${syms.length}…`); try { const f = await fetchFilings(settings, syms[i]); rows.push({ sym: syms[i], fl: f.filings.filter(x => x.date >= cut) }); } catch (e: any) { if (e instanceof ApiError && e.code === "not_found") rows.push({ sym: syms[i], fl: [], none: true }); else throw e; } }
      const c = (r: any, k: string) => r.fl.filter((x: Filing) => kindOf(x.form) === k).length;
      rows.sort((a, b) => (c(b, "offering") * 100 + c(b, "activist") * 50 + b.fl.length) - (c(a, "offering") * 100 + c(a, "activist") * 50 + a.fl.length));
      setRadar(rows.map(r => ({ ...r, off: c(r, "offering"), act: c(r, "activist"), ins: c(r, "insider"), ev: c(r, "event") })));
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "Could not read the filings."); }
    finally { setBusy(""); }
  };
  const cut90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ marginBottom: 10, alignSelf: "flex-start" }}><Seg theme={theme} value={mode} onChange={setMode} options={[{ v: "stock", label: "One stock" }, { v: "radar", label: "Watchlist radar" }]} /></View>
      {mode === "stock" ? <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TextInput value={input} onChangeText={setInput} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={runOne} style={[{ flex: 1, borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.sheet }, mono as TextStyle]} />
        <Btn theme={theme} label={busy ? "…" : "Read"} primary onPress={runOne} disabled={!!busy} /></View>
        : <Btn theme={theme} label={busy || "Scan the last 30 days"} primary onPress={runRadar} disabled={!!busy} style={{ marginBottom: 12, alignSelf: "flex-start" }} />}
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {busy && mode === "stock" ? <Text style={{ color: theme.ink3 }}>{busy}</Text> : null}
      {mode === "stock" && one ? (() => {
        const recent = one.f.filings.filter((x: Filing) => x.date >= cut90), n = (k: string) => recent.filter((x: Filing) => kindOf(x.form) === k).length;
        const sh = one.fx && one.fx.items.find((x: Fact) => x.label === "Diluted shares");
        const dil = sh && sh.prior ? sh.latest / sh.prior - 1 : null;
        return <>
          <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "600", marginBottom: 12 }}>{one.f.name}: {recent.length} filings in 90 days{n("offering") ? `, ${n("offering")} offering or shelf (possible new shares)` : ""}{n("activist") ? ", an activist 13D" : ""}{n("insider") ? `, ${n("insider")} insider Form 4` : ""}.{dil != null ? ` Diluted shares ${dil >= 0 ? "up" : "down"} ${(Math.abs(dil) * 100).toFixed(1)}% in a year.` : ""}</Text>
          {one.fx && one.fx.items.length ? <Card theme={theme} title="Reported figures" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{one.fx.items[0].latestForm} · {one.fx.items[0].latestEnd}</Text>}>
            {one.fx.items.map((x: Fact) => <View key={x.label} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}><Text style={{ color: theme.ink, flex: 1 }}>{x.label}</Text><Text style={[{ color: theme.ink }, mono as TextStyle]}>{x.unit === "USD" ? "$" : ""}{big(x.latest)}</Text><Text style={[{ color: x.prior && x.latest >= x.prior ? theme.up : theme.down, width: 80, textAlign: "right" }, mono as TextStyle]}>{x.prior ? pct(x.latest / x.prior - 1) : "—"}</Text></View>)}
            <Text style={{ color: theme.ink3, fontSize: 11, padding: 14 }}>Latest quarter against the same quarter a year earlier; balance-sheet items against a year earlier.</Text></Card> : null}
          <Card theme={theme} title="Next 5 sessions vs SPY, by filing type">{Object.entries(one.groups).map(([k, xs]: any) => { const s = Analytics.summarize(xs); return <View key={k} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule }}><Text style={{ color: theme.ink, flex: 1 }}>{KIND_LABEL[k]} <Text style={{ color: theme.ink3 }}>({xs.length})</Text></Text><Text style={{ color: (s.mean ?? 0) >= 0 ? theme.up : theme.down }}>{s.n ? pct(s.mean) : "—"}</Text></View>; })}</Card>
          <Card theme={theme} title="Filings, newest first">{one.f.filings.slice(0, 60).map((x: Filing, i: number) => <Pressable key={i} onPress={() => Linking.openURL(x.url)} style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.rule, alignItems: "center" }}>
            <Text style={[{ color: theme.ink3, width: 86 }, mono as TextStyle]}>{x.date}</Text><Text style={{ color: theme.ink, fontWeight: "600", width: 60 }}>{x.form}</Text>
            {kindOf(x.form) === "offering" ? <Pill theme={theme} ok={false} text="Dilution" /> : kindOf(x.form) === "activist" ? <Pill theme={theme} ok text="Activist" /> : <Text style={{ color: theme.ink3, flex: 1, fontSize: 12 }}>{x.items.length ? "Items " + x.items.join(", ") : ""}</Text>}
          </Pressable>)}<Text style={{ color: theme.ink3, fontSize: 11, padding: 14 }}>Tap a filing to open it on sec.gov.</Text></Card>
        </>; })() : null}
      {mode === "radar" && radar ? <Card theme={theme} title="Last 30 days">{radar.map(r => <View key={r.sym} style={{ flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.rule, alignItems: "center" }}>
        <Text style={{ color: theme.ink, fontWeight: "600", width: 60 }}>{r.sym}</Text>
        <Text style={{ color: theme.ink2, flex: 1, fontSize: 12 }}>{r.none ? "Not in SEC list" : `${r.fl.length} filings · ${r.ins} Form 4 · ${r.ev} 8-K`}</Text>
        {r.off ? <Pill theme={theme} ok={false} text={"Offering " + r.off} /> : null}{r.act ? <Pill theme={theme} ok text="13D" /> : null}
      </View>)}</Card> : null}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>Source: SEC EDGAR. Form 4 covers insider buys and sells alike. Research: Lakonishok and Lee (2001) on insider buying; Brav, Jiang, Partnoy and Thomas (2008) on activist stakes.</Text>
    </ScrollView>
  );
}
