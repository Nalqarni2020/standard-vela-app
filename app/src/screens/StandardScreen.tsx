import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View, Text, TextInput, RefreshControl, TextStyle, AppState } from "react-native";
import Engine from "../engine/engine";
import { Bar, Quote, fetchBars, fetchQuotes, marketOpen, resolveSymbol, ApiError, confirmedDaily } from "../api";
import { Settings } from "../settings";
import { Theme, mono, px, pct, int, money } from "../theme";
import { Chart } from "../Chart";
import { Card, Pill, Seg, Btn, KV, Banner } from "../ui";
import { LABEL, Tf, evaluate, nextAction, planText, closedIntraday } from "../desk";

type Data = { sym: string; daily: Bar[]; spy: Bar[]; i5: Bar[]; quote?: Quote; at: number };

export function StandardScreen({ theme, settings, onSymbol }: { theme: Theme; settings: Settings; onSymbol: (s: string) => void }) {
  const [input, setInput] = useState(settings.lastSymbol);
  const [tf, setTf] = useState<Tf>("day");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (text: string) => {
    const sym = resolveSymbol(text);
    if (!sym) { setErr("Type a US ticker such as CIFR."); return; }
    setBusy(true); setErr(null);
    try {
      const [d, q, i] = await Promise.all([
        fetchBars(settings, sym === "SPY" ? ["SPY"] : [sym, "SPY"], "day", 430),
        fetchQuotes(settings, [sym]),
        fetchBars(settings, [sym], "5min", 24).catch(() => null),
      ]);
      if (!d.bars[sym] || !d.bars[sym].length) throw new ApiError("not_found", "No daily history came back for " + sym + ".");
      setData({ sym, daily: d.bars[sym], spy: d.bars.SPY || [], i5: i ? i.bars[sym] : [], quote: q[sym], at: Date.now() });
      setInput(sym); onSymbol(sym);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong reading the data.");
    } finally { setBusy(false); }
  }, [settings, onSymbol]);

  useEffect(() => { if (settings.token && settings.proxyUrl) load(settings.lastSymbol); }, [settings.token, settings.proxyUrl]);
  // Refresh when the app comes back to the foreground.
  useEffect(() => { const sub = AppState.addEventListener("change", st => { if (st === "active" && data) load(data.sym); }); return () => sub.remove(); }, [data, load]);

  const now = data ? data.at : Date.now();
  const r = useMemo(() => data ? evaluate({ daily: data.daily, spy: data.spy, i5: data.i5, quote: data.quote, tf, settings, nowMs: now }) : null, [data, tf, settings, now]);

  const chartBars = useMemo((): Bar[] => {
    if (!data) return [];
    if (tf === "day") {
      const conf = confirmedDaily(data.daily, now), q = data.quote;
      const today = Engine.ny(now).date;
      if (q && q.day && marketOpen(q, now) && (!conf.length || conf[conf.length - 1].d !== today))
        return conf.concat([{ t: q.day[0], d: today, o: q.day[1], h: q.day[2], l: q.day[3], c: q.last ?? q.day[4], v: 0, provisional: true }]);
      return conf;
    }
    const c5 = closedIntraday(data.i5, 5, now);
    return tf === "15m" ? Engine.aggregate(c5, 15) : c5;
  }, [data, tf, now]);

  const lines = useMemo(() => {
    const c = chartBars.map((b: Bar) => b.c);
    return tf === "day"
      ? [{ vals: Engine.sma(c, 8), color: theme.amber }, { vals: Engine.ema(c, 20), color: theme.teal }, { vals: Engine.sma(c, 20), color: theme.ink3, dash: "4,3" }]
      : [{ vals: Engine.sessionVWAP(chartBars), color: theme.amber }];
  }, [chartBars, tf, theme]);

  const q = data && data.quote, open = q ? marketOpen(q, now) : false;
  const conf = data ? confirmedDaily(data.daily, now) : [];
  const shown = q && open && q.last != null ? q.last : conf.length ? conf[conf.length - 1].c : null;
  const prior = conf.length > 1 ? conf[conf.length - 2].c : null;
  // Official consolidated close from the daily bars. The snapshot's prevClose is from IEX alone and can differ.
  // While the market is open, today's bar is not in `conf`, so its last bar is the prior session's close.
  const base = open ? (conf.length ? conf[conf.length - 1].c : q?.prevClose ?? null) : prior;
  const buy = r && r.verdict === "BUY";

  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { if (data) load(data.sym); }} tintColor={theme.teal} />}>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
        <TextInput value={input} onChangeText={setInput} autoCapitalize="characters" autoCorrect={false} placeholder="CIFR" placeholderTextColor={theme.ink3}
          onSubmitEditing={() => load(input)} returnKeyType="go" accessibilityLabel="Ticker"
          style={[{ flex: 1, borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.sheet }, mono as TextStyle]} />
        <Btn theme={theme} label={busy ? "…" : "Load"} primary onPress={() => load(input)} disabled={busy} />
      </View>
      <View style={{ marginBottom: 12, alignSelf: "flex-start" }}>
        <Seg theme={theme} value={tf} onChange={setTf} options={[{ v: "day", label: "Daily" }, { v: "5m", label: "5m" }, { v: "15m", label: "15m" }]} />
      </View>
      {err ? <Banner theme={theme} text={err} bad /> : null}

      {r && data ? (
        <>
          <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
            <Text style={{ color: r.verdict === "NONE" ? theme.ink3 : buy ? theme.up : theme.down, borderColor: r.verdict === "NONE" ? theme.ink3 : buy ? theme.up : theme.down, borderWidth: 2, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 6, fontSize: 26, fontWeight: "800", transform: [{ rotate: "-2deg" }] }}>
              {r.verdict === "NONE" ? "—" : buy ? "BUY" : "NO"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.ink, fontSize: 19, fontWeight: "600", lineHeight: 24 }}>{r.verdict === "NONE" ? r.headline : planText(r, data.sym)}</Text>
              {r.verdict === "NO" ? <Text style={{ color: theme.ink2, marginTop: 4 }}>Why: {r.failed.map((c: any) => LABEL[c.id].toLowerCase()).join(", ")}.</Text> : null}
              {r.verdict !== "NONE" ? <Text style={{ color: theme.ink, marginTop: 6 }}><Text style={{ color: theme.teal, fontWeight: "700", fontSize: 11 }}>NEXT ACTION  </Text>{nextAction(r, tf)}</Text> : null}
            </View>
          </View>

          <Card theme={theme} title={data.sym + (open ? " · live" : " · cash close")} right={r.regime ? <Pill theme={theme} ok={r.regime.state === "Green" ? true : r.regime.state === "Red" ? false : null} text={"S&P " + r.regime.state} /> : null}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: 14, paddingTop: 10 }}>
              <Text style={[{ color: theme.ink, fontSize: 24 }, mono as TextStyle]}>{px(shown)}</Text>
              <Text style={[{ color: shown != null && base ? (shown >= base ? theme.up : theme.down) : theme.ink3 }, mono as TextStyle]}>{shown != null && base ? pct(shown / base - 1) : ""}</Text>
            </View>
            <Chart theme={theme} bars={chartBars} lines={lines} band={r.band} count={tf === "day" ? 80 : 120}
              levels={[r.shelf && { y: r.shelf.level, color: theme.teal, label: "Shelf " + px(r.shelf.level) }, r.shelf && { y: r.stop, color: theme.down, label: "Stop " + px(r.stop), dash: "5,4" }, { y: r.t1, color: theme.up, label: "T1 " + px(r.t1), dash: "2,3" }, { y: r.t2, color: theme.up, label: "T2 " + px(r.t2), dash: "8,4" }].filter(Boolean) as any} />
            <KV theme={theme} items={[["Shelf", px(r.shelf && r.shelf.level)], ["Band", r.band ? px(r.band.lo) + "–" + px(r.band.hi) : "—"], ["Entry", px(r.entry)], ["Stop", px(r.stop)], ["Target 1", px(r.t1)], ["Target 2", px(r.t2)]]} />
          </Card>

          <Card theme={theme} title="Execution table" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{tf === "day" ? "CLOSE " + (r.confirmedDate || "") : tf.toUpperCase() + " BARS"}</Text>}>
            {(r.checks || []).map((c: any) => (
              <View key={c.id} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule, gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.ink, fontWeight: "600" }}>{LABEL[c.id]}</Text>
                  <Text style={{ color: theme.ink2, fontSize: 12 }}>{c.note}</Text>
                </View>
                <Pill theme={theme} ok={c.pass} text={c.pass ? "Pass" : "Fail"} />
              </View>))}
          </Card>

          {r.size ? (
            <Card theme={theme} title="Size">
              <Text style={[{ color: theme.ink2, padding: 14, fontSize: 13 }, mono as TextStyle]}>
                {(settings.bucket === "spec" ? "Speculative" : "Core") + " risk " + r.size.riskPct * 100 + "% = " + money(r.size.riskBudget) + ". Risk per share " + px(r.size.perShare) + ". Cap allows " + int(r.size.capShares) + " shares. "}
                {buy ? int(r.size.shares) + " shares, " + money(r.size.dollars) + "." : "0 shares. The table says no."}
              </Text>
            </Card>) : null}
          <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>History ends 16 minutes ago (free data plan). The live price is from IEX. Today's daily bar counts as the cash close from 16:16 New York. Not a recommendation to buy or sell. Trading can lose money.</Text>
        </>
      ) : !err ? <Text style={{ color: theme.ink3 }}>{busy ? "Reading the tape…" : "Add the proxy in Settings, then load a ticker."}</Text> : null}
    </ScrollView>
  );
}
