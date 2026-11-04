import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, Pressable, TextStyle } from "react-native";
import Analytics from "../../engine/analytics";
import { dailyMany, ApiError } from "../../api";
import { Settings, watchlistSymbols } from "../../settings";
import { Theme, mono, pct } from "../../theme";
import { Card, Btn, Banner } from "../../ui";
import { LineChart } from "../../Chart";

/* Pairs that move together, tested on the last 6 months without refitting (Gatev, Goetzmann and Rouwenhorst, 2006). */
export function PairsDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [typed, setTyped] = useState(""), [res, setRes] = useState<any[] | null>(null), [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(""), [line, setLine] = useState("");
  const run = async () => {
    const t = typed.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(x => /^[A-Z][A-Z0-9.]{0,9}$/.test(x));
    const syms = t.length >= 2 ? [...new Set(t)].slice(0, 40) : watchlistSymbols(settings);
    if (syms.length < 2) { setErr("Type at least two tickers, or add a watchlist in Settings."); return; }
    setErr(null); setBusy("Reading prices…");
    try {
      const bars = await dailyMany(settings, syms, 800, (i, n) => setBusy(`Reading prices ${i} of ${n}…`));
      setBusy("Testing pairs…"); await new Promise(r => setTimeout(r, 0));
      const out = Analytics.scanPairs(bars, { top: 12, form: 252, trade: 126, open: 2, cost: 0.0005 });
      if (!out.length) { setErr("No pair had the 18 months of shared history the test needs."); setRes(null); return; }
      const st = Analytics.summarize(out.flatMap((p: any) => p.hist.trades.map((x: any) => x.ret)));
      const co = out.filter((p: any) => p.adfT != null && p.adfT < -3.34).length;
      setLine(`${co} of ${out.length} closest pairs pass the cointegration test. On the last 6 months the trades ${st.n ? `averaged ${pct(st.mean)}, ${(st.hit * 100).toFixed(0)}% winners (${st.n})` : "did not trigger"}.`);
      setRes(out); setSel(0);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "The pair test failed."); }
    finally { setBusy(""); }
  };
  const p = res && res[sel];
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TextInput value={typed} onChangeText={setTyped} placeholder="Blank = watchlist, or KO, PEP, XOM" placeholderTextColor={theme.ink3} autoCapitalize="characters" autoCorrect={false}
          style={[{ flex: 1, borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.sheet }, mono as TextStyle]} />
        <Btn theme={theme} label={busy ? "…" : "Find pairs"} primary onPress={run} disabled={!!busy} />
      </View>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {busy ? <Text style={{ color: theme.ink3 }}>{busy}</Text> : null}
      {res ? (
        <>
          <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "600", marginBottom: 12 }}>{line}</Text>
          <Card theme={theme} title="Closest pairs">
            {res.map((x: any, i: number) => { const s = Analytics.summarize(x.hist.trades.map((t: any) => t.ret)); return (
              <Pressable key={x.a + x.b} onPress={() => setSel(i)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule, backgroundColor: i === sel ? theme.tealWash : "transparent" }}>
                <Text style={{ color: theme.ink, fontWeight: "600" }}>{x.a} / {x.b}  <Text style={{ color: Math.abs(x.zNow) >= 2 ? theme.amber : theme.ink3 }}>{x.zNow >= 0 ? "+" : ""}{x.zNow.toFixed(2)}σ</Text></Text>
                <Text style={{ color: theme.ink2, fontSize: 12 }}>Coint t {x.adfT == null ? "—" : x.adfT.toFixed(2)}{x.adfT < -3.34 ? " ✓" : ""} · half-life {x.halfLife == null ? "—" : x.halfLife.toFixed(1) + "d"} · test {s.n} trades {s.n ? pct(s.mean) : ""}</Text>
              </Pressable>); })}
          </Card>
          {p ? <Card theme={theme} title={p.a + " / " + p.b + " stretch"}>
            <LineChart theme={theme} series={[{ vals: p.zSeries, color: theme.teal }]} guides={[{ y: 2, color: theme.down, label: "+2" }, { y: -2, color: theme.up, label: "−2" }, { y: 0, color: theme.ink3 }]} fmt={v => v.toFixed(1)} />
            <Text style={{ color: theme.ink2, padding: 14, fontSize: 13 }}>{p.zNow >= 2 ? `Stretched: ${p.a} rich against ${p.b}.` : p.zNow <= -2 ? `Stretched: ${p.a} cheap against ${p.b}.` : "Not stretched today."} A pair trade buys one and shorts the other; check the news before trusting a stretch.</Text>
          </Card> : null}
        </>) : null}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>Cointegration t below −3.34 means the gap has reliably closed (5% level). Test: open at 2 deviations, close when the gap crosses zero, equal dollars per leg, costs on all four fills. For study: the app never places orders.</Text>
    </ScrollView>
  );
}
