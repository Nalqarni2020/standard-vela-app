import React, { useRef, useState } from "react";
import { ScrollView, View, Text, TextInput, Pressable, TextStyle } from "react-native";
import Engine from "../../engine/engine";
import { analystStep, resolveSymbol, ApiError } from "../../api";
import { Settings } from "../../settings";
import { Theme, mono } from "../../theme";
import { Card, Btn, Banner } from "../../ui";
import { priceSummary, marketBackdrop, newsFor, secSummary, earningsFor } from "../../research";

const CHIPS = ["Why did it move recently, and what does the app's Standard say now?", "Give the bull case and the bear case from the data, with the level that would prove each wrong.", "What would have to change for the Standard to say yes?", "Anything unusual in the news, filings or volume?"];
const MAX_ROUNDS = 8;

/* The phone runs the tool loop with its own data; the proxy adds the model, instructions and tools. */
export function AnalystDesk({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [sym, setSym] = useState(settings.lastSymbol), [q, setQ] = useState(CHIPS[0]);
  const [answer, setAnswer] = useState(""), [log, setLog] = useState<string[]>([]), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const add = (m: string) => setLog(l => l.concat(new Date().toLocaleTimeString() + " · " + m));

  const runTool = async (name: string, input: any): Promise<string> => {
    const s = resolveSymbol(String((input && input.symbol) || ""));
    const need = () => { if (!s) throw new Error("Invalid ticker"); return s; };
    const label: Record<string, string> = { price_summary: "price history", market_backdrop: "market backdrop", news: "news", sec_filings: "SEC filings", earnings_history: "earnings history" };
    add("Reading " + (label[name] || name) + (s ? " for " + s : "") + "…");
    let r: any;
    if (name === "price_summary") r = await priceSummary(settings, need());
    else if (name === "market_backdrop") r = await marketBackdrop(settings);
    else if (name === "news") r = await newsFor(settings, need());
    else if (name === "sec_filings") r = await secSummary(settings, need());
    else if (name === "earnings_history") r = await earningsFor(settings, need());
    else throw new Error("Unknown tool " + name);
    return JSON.stringify(r).slice(0, 30000);
  };

  const ask = async () => {
    const s = resolveSymbol(sym); if (!s) { setErr("Type a US ticker."); return; }
    if (!q.trim()) { setErr("Type a question."); return; }
    setErr(null); setAnswer(""); setLog([]); setBusy(true); stop.current = false;
    const n = Engine.ny(Date.now());
    const messages: any[] = [{ role: "user", content: `Today is ${n.date}, ${String(Math.floor(n.min / 60)).padStart(2, "0")}:${String(n.min % 60).padStart(2, "0")} New York time.\nStock: ${s}\nQuestion: ${q.trim().slice(0, 1000)}` }];
    const texts: string[] = [];
    try {
      for (let round = 0; round < MAX_ROUNDS && !stop.current; round++) {
        add(round === 0 ? "Asking Claude…" : "Claude is reading the results…");
        const r = await analystStep(settings, messages);
        messages.push({ role: "assistant", content: r.content }); // whole content, thinking and fallback blocks included
        r.content.filter((b: any) => b.type === "text" && b.text).forEach((b: any) => texts.push(b.text));
        setAnswer(texts.join("\n\n"));
        if (r.stop_reason === "refusal") { setErr("Claude declined this question. Try rephrasing it."); break; }
        if (r.stop_reason === "pause_turn") continue;
        if (r.stop_reason !== "tool_use") { if (r.stop_reason === "max_tokens") add("The answer was cut short. Ask a narrower question."); break; }
        const uses = r.content.filter((b: any) => b.type === "tool_use");
        const results = await Promise.all(uses.map(async (u: any) => {
          try { return { type: "tool_result", tool_use_id: u.id, content: await runTool(u.name, u.input) }; }
          catch (e: any) { add("Could not read: " + (e.message || "error")); return { type: "tool_result", tool_use_id: u.id, content: "Error: " + (e.message || "failed"), is_error: true }; }
        }));
        messages.push({ role: "user", content: results }); // all results in one message
        if (round === MAX_ROUNDS - 1) add("Stopped after " + MAX_ROUNDS + " rounds.");
      }
      if (stop.current) add("Stopped.");
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : "The Analyst failed. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Card theme={theme} title="Ask">
        <View style={{ padding: 14, gap: 10 }}>
          <TextInput value={sym} onChangeText={setSym} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Ticker" style={[{ borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.paper }, mono as TextStyle]} />
          <TextInput value={q} onChangeText={setQ} multiline accessibilityLabel="Question" style={{ borderWidth: 1, borderColor: theme.rule, borderRadius: 6, padding: 10, minHeight: 70, color: theme.ink, backgroundColor: theme.paper, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{CHIPS.map((c, i) => <Pressable key={i} onPress={() => setQ(c)} style={{ borderWidth: 1, borderColor: theme.rule, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ color: theme.ink2, fontSize: 12 }}>{["Why did it move?", "Bull and bear", "What makes it a yes?", "Anything unusual?"][i]}</Text></Pressable>)}</View>
          <View style={{ flexDirection: "row", gap: 8 }}><Btn theme={theme} label={busy ? "Working…" : "Ask"} primary onPress={ask} disabled={busy} />{busy ? <Btn theme={theme} label="Stop" onPress={() => { stop.current = true; }} /> : null}</View>
        </View>
      </Card>
      {err ? <Banner theme={theme} text={err} bad /> : null}
      <Card theme={theme} title="Answer"><Text selectable style={{ color: answer ? theme.ink : theme.ink3, padding: 14, lineHeight: 21 }}>{answer || (busy ? "Thinking…" : "Each answer reads fresh data and uses your Claude API credit.")}</Text>
        {log.length ? <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>{log.map((l, i) => <Text key={i} style={[{ color: theme.ink3, fontSize: 11 }, mono as TextStyle]}>{l}</Text>)}</View> : null}</Card>
      <Text style={{ color: theme.ink3, fontSize: 11, marginBottom: 24 }}>Claude sees only what the app reads: prices, news headlines, SEC filings and past earnings windows. It cites its sources and never recommends trades. Stop takes effect after the current step.</Text>
    </ScrollView>
  );
}
