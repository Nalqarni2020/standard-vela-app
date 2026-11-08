import React, { useCallback, useState } from "react";
import { ScrollView, View, Text, TextInput, TextStyle } from "react-native";
import Engine from "../../engine/engine";
import Exposure from "../../engine/exposure";
import { fetchOptions, fetchQuotes, resolveSymbol, ApiError } from "../../api";
import { Settings } from "../../settings";
import { Theme, px, pct, mono } from "../../theme";
import { Card, Pill, KV, Banner, Seg, Btn } from "../../ui";

/* Gamma: options exposure (GEX, VEX, DEX, charm) by strike and expiration from open interest and implied volatility,
   with the King strike, call and put walls, the zero-gamma level and the expected move. Same math as the web desk's
   Vela → Gamma (engine/exposure.js). Read-only. */
type Scope = "near" | "week" | "month";
type Meas = "gex" | "vex" | "dex" | "cex";
const MEAS: { v: Meas; label: string }[] = [{ v: "gex", label: "GEX" }, { v: "vex", label: "VEX" }, { v: "dex", label: "DEX" }, { v: "cex", label: "Charm" }];
const MLONG: Record<Meas, string> = { gex: "Gamma: hedging per 1% move", vex: "Vanna: per 1 point of volatility", dex: "Delta of the open interest", cex: "Charm: delta drift per day" };
const big = (v: number | null | undefined) => { if (v == null || !isFinite(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return s + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0)); };
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export function GammaDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [symTxt, setSymTxt] = useState("SPY"), [scope, setScope] = useState<Scope>("week"), [meas, setMeas] = useState<Meas>("gex");
  const [res, setRes] = useState<any>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    const sym = resolveSymbol(symTxt); if (!sym) { setErr("Enter a US ticker."); return; }
    setBusy(true); setErr(null);
    try {
      const q = (await fetchQuotes(settings, [sym]))[sym];
      const spot = q ? (q.last || q.prevClose) : null; if (!(spot && spot > 0)) throw new Error("No price for " + sym + ".");
      const n = Engine.ny(Date.now()), today = n.date, wd = new Date(today + "T12:00:00Z").getUTCDay();
      const to = scope === "month" ? addDays(today, 30) : scope === "week" ? addDays(today, wd === 6 ? 6 : wd === 0 ? 5 : 5 - wd) : addDays(today, 7);
      const o = await fetchOptions(settings, sym, spot, today, to);
      let rows = o.rows;
      if (scope === "near" && rows.length) { const first = rows.map(r => r.exp).sort()[0]; rows = rows.filter(r => r.exp === first); }
      if (!rows.length) throw new Error("No option contracts with open interest came back for " + sym + " in these dates.");
      const x = Exposure.exposures(rows, spot, Date.now());
      setRes({ sym, x, oiDate: o.oiDate, truncated: o.truncated });
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : e?.message || "Could not build the profile."); }
    finally { setBusy(false); }
  }, [symTxt, scope, settings]);

  let body = null;
  if (res) {
    const x = res.x, pos = x.regime === "positive";
    const strikes = x.strikes.slice().sort((a: any, b: any) => Math.abs(a.k - x.spot) - Math.abs(b.k - x.spot)).slice(0, 21).sort((a: any, b: any) => b.k - a.k);
    const cols: string[] = x.exps.slice(0, 6);
    let mx = 0; strikes.forEach((r: any) => cols.forEach(e => { const c = x.cell[e + "|" + r.k]; if (c) mx = Math.max(mx, Math.abs(c[meas])); })); mx = mx || 1;
    const mt = Math.max(...strikes.map((r: any) => Math.abs(r[meas])), 1);
    const alpha = (v: number) => { const a = Math.round(Math.min(1, Math.sqrt(Math.abs(v) / mx)) * 180); return (v > 0 ? theme.up : theme.down) + a.toString(16).padStart(2, "0"); };
    const W = 62;
    let spotShown = false;
    body = (<>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <Pill theme={theme} ok={pos} text={pos ? "Positive gamma" : "Negative gamma"} />
        <Text style={{ color: theme.ink, flex: 1, fontWeight: "600" }}>{pos ? "Hedging leans against moves: calmer days, pinning near big strikes." : "Hedging chases moves: wider days, late moves carry on."}</Text>
      </View>
      <Card theme={theme} title={res.sym + " levels"} right={<Text style={{ color: theme.ink3, fontSize: 11 }}>{x.used} CONTRACTS</Text>}>
        <KV theme={theme} items={[["Price", px(x.spot)], ["Net GEX per 1%", "$" + big(x.total.gex)], ["King strike", x.king ? px(x.king.k) + (x.contested ? " (contested)" : "") : "—"], ["Call wall", x.callWall ? px(x.callWall.k) : "—"], ["Put wall", x.putWall ? px(x.putWall.k) : "—"],
          ["Zero gamma", x.flip ? px(x.flip) + " (" + pct(x.flip / x.spot - 1) + ")" : "none within 15%"], ["Expected move", x.em ? "±" + px(x.em.straddle) + " to " + x.em.exp.slice(5) : "—"], ["One day", x.em && x.em.day ? "±" + px(x.em.day) : "—"], ["Net VEX", "$" + big(x.total.vex)], ["Net DEX", "$" + big(x.total.dex)], ["Charm per day", "$" + big(x.total.cex)]]} />
      </Card>
      <Text style={{ color: theme.ink, fontWeight: "700", marginBottom: 6 }}>{MLONG[meas]}</Text>
      <ScrollView horizontal style={{ marginBottom: 12, borderWidth: 1, borderColor: theme.rule, borderRadius: 8, backgroundColor: theme.sheet }}>
        <View>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.rule }}>
            <Text style={{ width: 92, padding: 6, color: theme.ink3, fontSize: 11 }}>STRIKE</Text>
            {cols.map(e => <Text key={e} style={{ width: W, padding: 6, color: theme.ink3, fontSize: 11, textAlign: "right" }}>{e.slice(5)}</Text>)}
            <Text style={{ width: 120, padding: 6, color: theme.ink3, fontSize: 11 }}>TOTAL</Text>
          </View>
          {strikes.map((r: any) => {
            const tag = [x.king && r.k === x.king.k ? "K" : "", x.callWall && r.k === x.callWall.k ? "CW" : "", x.putWall && r.k === x.putWall.k ? "PW" : ""].filter(Boolean).join(" ");
            const spotLine = !spotShown && r.k < x.spot ? (spotShown = true) : false;
            return (<View key={r.k}>
              {spotLine ? <Text style={{ paddingHorizontal: 6, fontSize: 10, color: theme.ink, borderTopWidth: 1, borderTopColor: theme.ink, borderStyle: "dashed" }}>Price {px(x.spot)}</Text> : null}
              <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.rule }}>
                <Text style={[{ width: 92, padding: 6, color: theme.ink, fontWeight: "600" }, mono as TextStyle]}>{px(r.k)} <Text style={{ color: theme.amber, fontSize: 10 }}>{tag}</Text></Text>
                {cols.map(e => { const c = x.cell[e + "|" + r.k], v = c ? c[meas] : 0; return <Text key={e} style={[{ width: W, padding: 6, fontSize: 11, textAlign: "right", color: theme.ink, backgroundColor: Math.abs(v) >= 0.5 ? alpha(v) : "transparent", borderWidth: x.king && r.k === x.king.k ? 1 : 0, borderColor: theme.amber }, mono as TextStyle]}>{Math.abs(v) >= 0.5 ? big(v) : "·"}</Text>; })}
                <View style={{ width: 120, padding: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ flex: 1, height: 8, backgroundColor: theme.rule, flexDirection: "row" }}>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>{r[meas] < 0 ? <View style={{ width: `${Math.abs(r[meas]) / mt * 100}%`, height: 8, backgroundColor: theme.down }} /> : null}</View>
                    <View style={{ flex: 1 }}>{r[meas] > 0 ? <View style={{ width: `${r[meas] / mt * 100}%`, height: 8, backgroundColor: theme.up }} /> : null}</View>
                  </View>
                  <Text style={[{ fontSize: 10, color: theme.ink2, width: 44, textAlign: "right" }, mono as TextStyle]}>{big(r[meas])}</Text>
                </View>
              </View>
            </View>);
          })}
        </View>
      </ScrollView>
      <Text style={{ color: theme.ink3, fontSize: 12, marginBottom: 12 }}>Swipe the table sideways for more expirations{x.exps.length > cols.length ? ` (showing ${cols.length} of ${x.exps.length}; totals use all)` : ""}. K = King (largest net GEX), CW/PW = call and put walls (most call and put gamma). Open interest as of {res.oiDate || "the last report"}; prices and volatility from Alpaca's free options feed, about 15 minutes delayed{x.filled ? `; ${x.filled} contracts without a volatility used the nearest strike's` : ""}{res.truncated ? "; the chain was too long and was cut short" : ""}. GEX and VEX assume dealers are long the calls and short the puts customers trade, which nobody can verify, so colors can be backwards for a given stock. Dealer gamma is linked to calmer or wilder index days and late-day momentum (Baltussen et al., 2021) and to expiration-day pinning (Ni, Pearson and Poteshman, 2005); the King and walls as everyday support or magnets are not well tested. The web desk logs each day's levels and checks them.</Text>
    </>);
  }
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <TextInput value={symTxt} onChangeText={setSymTxt} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={run} accessibilityLabel="Ticker" style={[{ flex: 1, borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.sheet }, mono as TextStyle]} />
        <Btn theme={theme} label={busy ? "Building…" : "Build"} onPress={run} disabled={busy} primary />
      </View>
      <View style={{ marginBottom: 8 }}><Seg theme={theme} value={scope} onChange={setScope} options={[{ v: "near", label: "Nearest" }, { v: "week", label: "This week" }, { v: "month", label: "30 days" }]} /></View>
      <View style={{ marginBottom: 12 }}><Seg theme={theme} value={meas} onChange={setMeas} options={MEAS} /></View>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      {body || <Text style={{ color: theme.ink3, marginBottom: 12 }}>{busy ? "Reading the option chain…" : "Enter a ticker and press Build."}</Text>}
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>A model of options positioning, not a recommendation. Read-only: nothing here places an order.</Text>
    </ScrollView>
  );
}
