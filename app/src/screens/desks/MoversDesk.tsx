import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, View, Text, Pressable, RefreshControl, TextStyle } from "react-native";
import Engine from "../../engine/engine";
import Playbook from "../../engine/playbook";
import { fetchMovers, fetchBars, dailyMany, ApiError, Bar } from "../../api";
import { Settings, watchlistSymbols } from "../../settings";
import { Theme, px, pct, mono } from "../../theme";
import { Card, Pill, Banner, Btn } from "../../ui";

/* Movers: today's market-wide gainers, losers, most active and gaps (Alpaca's screener), and your watchlist's 5-day and
   1-month movers. Every name is checked against its split-adjusted daily history (a reverse split or bad print fails)
   and graded for trading liquidity. Plus a test of what such moves did next on your watchlist. Read-only. */
type Board = "g1" | "l1" | "act" | "gu" | "gd" | "w5" | "w21";
const BOARDS: [Board, string][] = [["g1", "Gainers"], ["l1", "Losers"], ["act", "Most active"], ["gu", "Gap up"], ["gd", "Gap down"], ["w5", "Watchlist 5-day"], ["w21", "Watchlist 1-month"]];
const LIQ = { minPrice: 5, minDollarVol: 5e6 };
const LQ: Record<string, boolean | null> = { deep: true, good: true, thin: null, no: false };
const bigN = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + (v / 1e3).toFixed(0) + "K";

type Row = { sym: string; move: number | null; price: number | null; gap?: number | null; held?: boolean | null; rv?: number | null; dv20?: number | null; trend?: number | null; liq?: any; why: string[] };

function describe(sym: string, raw: Bar[], reported: number | null, price: number | null, k: number, settings: Settings): Row {
  const r: Row = { sym, move: reported, price, why: [] };
  const today = Engine.ny(Date.now()).date;
  const last = raw[raw.length - 1], done = last && last.d === today ? raw.slice(0, -1) : raw, cur = last && last.d === today ? last : done[done.length - 1];
  if (done.length < 25 || !cur) { r.why.push("no price history"); return r; }
  const base = cur === last && last.d === today ? done[done.length - k] : done[done.length - 1 - k];
  const p = price != null ? price : cur.c; r.price = p;
  if (base && base.c > 0) {
    const hist = p / base.c - 1;
    if (reported != null && Math.abs(hist - reported) > Math.max(0.03, 0.25 * Math.abs(reported))) r.why.push(`reported ${pct(reported)}, history says ${pct(hist)}: a split or bad data`);
    if (reported == null) r.move = hist;
  }
  const prev = cur === last && last.d === today ? done[done.length - 1] : done[done.length - 2];
  if (prev) { r.gap = cur.o / prev.c - 1; r.held = r.gap >= 0 ? cur.c >= cur.o : cur.c <= cur.o; }
  const tail = done.slice(-20); r.dv20 = tail.reduce((s, b) => s + b.c * b.v, 0) / tail.length;
  const vAvg = done.slice(-21, -1).reduce((s, b) => s + b.v, 0) / 20; r.rv = vAvg > 0 ? cur.v / vAvg : null;
  if (done.length >= 50) { const s50 = done.slice(-50).reduce((s, b) => s + b.c, 0) / 50; r.trend = p > s50 ? 1 : 0; }
  const atrA = Engine.atr(done, 14), atr = atrA[atrA.length - 1];
  const plan = atr > 0 ? Playbook.sizePlan({ account: settings.account, riskPct: 0.01, mult: 1, entry: p, stop: p - 1.5 * atr, capPct: settings.capPct / 100 }) : null;
  r.liq = Playbook.liquidityGrade({ price: p, dv20: r.dv20, spread: null, minPrice: LIQ.minPrice, minDollarVol: LIQ.minDollarVol, maxSpread: 0.005, position: plan && plan.shares ? plan.shares * p : null });
  if (r.liq.key === "no") r.why.push(...r.liq.why);
  return r;
}

export function MoversDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [board, setBoard] = useState<Board>("g1"), [rows, setRows] = useState<Row[] | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [prog, setProg] = useState("");
  const [showOut, setShowOut] = useState(false), [study, setStudy] = useState<any>(null), [studyBusy, setStudyBusy] = useState(false), [asOf, setAsOf] = useState<string | null>(null);
  const watch = watchlistSymbols(settings).slice(0, 60);

  const run = useCallback(async (b: Board) => {
    setBusy(true); setErr(null); setRows(null);
    try {
      let out: Row[] = [];
      if (b === "w5" || b === "w21") {
        if (!watch.length) throw new Error("Add tickers to your watchlist in Settings.");
        const k = b === "w5" ? 5 : 21;
        const bars = await dailyMany(settings, watch, 120, (i, n) => setProg(`History ${i} of ${n}`));
        out = watch.map(s => { const bb = bars[s] || []; return describe(s, bb, null, null, k, settings); }).filter(r => r.move != null).sort((a, c) => (c.move as number) - (a.move as number));
        setAsOf(null);
      } else {
        const m = await fetchMovers(settings); setAsOf(m.asOf);
        let cand: { symbol: string; pct: number | null; price: number | null }[] = b === "g1" ? m.gainers : b === "l1" ? m.losers : b === "act" ? m.actives.map(a => ({ symbol: a.symbol, pct: null, price: null })) : [...m.gainers, ...m.losers, ...m.actives.map(a => ({ symbol: a.symbol, pct: null, price: null }))];
        const seen = new Set<string>(); cand = cand.filter(c => !seen.has(c.symbol) && (seen.add(c.symbol), true));
        const pre = cand.map(c => ({ c, out: c.price != null && c.price < LIQ.minPrice }));
        const check = pre.filter(z => !z.out).slice(0, b === "gu" || b === "gd" ? 50 : 30).map(z => z.c);
        const raw: Record<string, Bar[]> = {};
        for (let i = 0; i < check.length; i += 10) { const chunk = check.slice(i, i + 10).map(c => c.symbol); const d = await fetchBars(settings, chunk, "day", 110); Object.assign(raw, d.bars); setProg(`Checking ${Math.min(i + 10, check.length)} of ${check.length} against history`); }
        out = check.map(c => describe(c.symbol, raw[c.symbol] || [], c.pct, c.price, 1, settings));
        pre.filter(z => z.out).forEach(z => out.push({ sym: z.c.symbol, move: z.c.pct, price: z.c.price, why: ["under $5"] }));
        if (b === "gu") out = out.filter(r => r.gap != null && r.gap >= 0.02).sort((a, c) => (c.gap as number) - (a.gap as number));
        if (b === "gd") out = out.filter(r => r.gap != null && r.gap <= -0.02).sort((a, c) => (a.gap as number) - (c.gap as number));
      }
      setRows(out);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : e?.message || "Could not read the movers."); }
    finally { setBusy(false); setProg(""); }
  }, [settings]);
  useEffect(() => { run(board); }, [board, run]);

  const runStudy = async () => {
    setStudyBusy(true);
    try {
      const bars = await dailyMany(settings, watch, 1100, (i, n) => setProg(`Study: history ${i} of ${n}`));
      const sets = watch.map(s => ({ sym: s, bars: bars[s] || [] })).filter(z => z.bars.length >= 120).map(z => ({ ...z, x: Playbook.prep(z.bars) }));
      setStudy(Playbook.moverStudy(sets, { cost: 0.0005, liq: LIQ }));
    } catch (e: any) { setErr(e?.message || "The study failed."); }
    finally { setStudyBusy(false); setProg(""); }
  };

  const keep = (rows || []).filter(r => !r.why.length), out = (rows || []).filter(r => r.why.length);
  const isGap = board === "gu" || board === "gd";
  const line = (r: Row, rejected: boolean) => (
    <View key={r.sym + (rejected ? "x" : "")} style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: theme.ink, fontWeight: "700", width: 64 }}>{r.sym}</Text>
        <Text style={[{ color: ((isGap ? r.gap : r.move) ?? 0) >= 0 ? theme.up : theme.down, width: 78 }, mono as TextStyle]}>{pct(isGap ? r.gap : r.move)}</Text>
        <Text style={[{ color: theme.ink2, flex: 1 }, mono as TextStyle]}>{px(r.price)}</Text>
        {rejected ? <Pill theme={theme} ok={false} text="Out" /> : r.liq ? <Pill theme={theme} ok={LQ[r.liq.key]} text={r.liq.label} /> : null}
      </View>
      <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 2 }}>{rejected ? r.why.join("; ") : [
        r.gap != null && isGap ? (r.held ? "gap held" : "gap faded") : r.gap != null && Math.abs(r.gap) >= 0.02 ? "gap " + pct(r.gap) : "",
        r.rv != null ? r.rv.toFixed(1) + "× volume" : "", r.dv20 != null ? bigN(r.dv20) + "/day" : "", r.trend == null ? "" : r.trend ? "above 50-day" : "below 50-day"].filter(Boolean).join(" · ")}</Text>
    </View>);

  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => run(board)} tintColor={theme.teal} />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6 }}>
        {BOARDS.map(([k, l]) => (
          <Pressable key={k} onPress={() => setBoard(k)} accessibilityRole="button" accessibilityState={{ selected: board === k }} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: board === k ? theme.teal : theme.rule, backgroundColor: board === k ? theme.tealWash : theme.sheet }}>
            <Text style={{ color: board === k ? theme.teal : theme.ink2, fontWeight: board === k ? "700" : "500" }}>{l}</Text>
          </Pressable>))}
      </ScrollView>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {rows ? (<>
        <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "600", marginBottom: 10 }}>{keep.length} of {rows.length} are tradable by the desk's rules.</Text>
        <Card theme={theme} title={BOARDS.find(z => z[0] === board)![1]} right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{board === "w5" || board === "w21" ? "YOUR WATCHLIST" : "WHOLE MARKET · TODAY"}</Text>}>
          {keep.length ? keep.map(r => line(r, false)) : <Text style={{ color: theme.ink3, padding: 14 }}>Nothing on this board passes the $5 and $5 million a day limits.</Text>}
          {out.length ? <Pressable onPress={() => setShowOut(!showOut)} style={{ padding: 14, borderTopWidth: 1, borderTopColor: theme.rule }}><Text style={{ color: theme.teal, fontWeight: "600" }}>{showOut ? "Hide" : "Show"} the {out.length} filtered out</Text></Pressable> : null}
          {showOut ? out.map(r => line(r, true)) : null}
        </Card>
        <Text style={{ color: theme.ink3, fontSize: 12, marginBottom: 12 }}>{board === "w5" || board === "w21" ? "Your watchlist's moves over 5 or 21 sessions to the last close." : "Alpaca's market-wide screener" + (asOf ? ", updated " + new Date(asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "") + "; gaps are found among its top gainers, losers and most active, 2% or more."} Each name is checked against its split-adjusted daily history: a move that doesn't match (a reverse split or bad data) is filtered out. Liquidity: Deep is $100 million or more traded a day; Good, $20 million; Thin passes the limits but costs more to trade; Out fails them (under $5, under $5 million a day, or a 1%-risk position over 1% of a day's trading). Today's volume is partial until the close. A list of what already moved, not a buy list.</Text>
      </>) : <Text style={{ color: theme.ink3, marginBottom: 12 }}>{busy ? prog || "Reading the movers…" : ""}</Text>}

      <Card theme={theme} title="What such moves did next" right={<Text style={{ color: theme.ink3, fontSize: 11 }}>YOUR WATCHLIST</Text>}>
        {study ? study.rows.map((r: any) => (
          <View key={r.id} style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: theme.ink, flex: 1, fontWeight: "600" }}>{r.label}</Text>
              <Pill theme={theme} ok={r.verdict.key === "cont" ? true : r.verdict.key === "rev" ? false : null} text={r.verdict.key === "cont" ? "Kept going" : r.verdict.key === "rev" ? "Reversed" : r.verdict.key === "thin" ? "Too few" : "No edge"} />
            </View>
            <Text style={[{ color: theme.ink2, fontSize: 13, marginTop: 3 }, mono as TextStyle]}>{r.n} cases · 5 days {pct(r.h[5].mean)} · vs a normal week {pct(r.excess5)}{r.t != null ? " · t " + r.t.toFixed(1) : ""}</Text>
          </View>)) : <View style={{ padding: 14, gap: 8 }}>
            <Text style={{ color: theme.ink3 }}>Tests each kind of move on about three years of your watchlist: buy the next open, sell 1, 5 or 10 sessions later, against a normal week.</Text>
            <Btn theme={theme} label={studyBusy ? (prog || "Testing…") : "Run the test"} onPress={runStudy} disabled={studyBusy || !watch.length} primary />
          </View>}
      </Card>
      {study ? <Text style={{ color: theme.ink3, fontSize: 12, marginBottom: 12 }}>Kept going or Reversed needs 30 or more cases, a t-statistic of 2 or more and half a percent or more. Studies of US stocks find last week's biggest winners and losers tend to partly reverse the next week (Jegadeesh 1990; Lehmann 1990), less so after heavy volume.</Text> : null}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>Market data from Alpaca through your proxy; history ends 16 minutes ago. Read-only: nothing here places an order.</Text>
    </ScrollView>
  );
}
