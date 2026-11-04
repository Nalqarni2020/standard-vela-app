import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, TextStyle } from "react-native";
import { Settings, saveSettings, forgetToken, checkProxyUrl } from "../settings";
import { fetchQuotes, ApiError } from "../api";
import { Theme, mono, px } from "../theme";
import { Card, Seg, Btn, Banner } from "../ui";

export function SettingsScreen({ theme, settings, onSaved }: { theme: Theme; settings: Settings; onSaved: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>(settings);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const field = (label: string, value: string, onChange: (v: string) => void, extra: object = {}) => (
    <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
      <Text style={{ color: theme.ink2, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} placeholderTextColor={theme.ink3}
        style={[{ borderWidth: 1, borderColor: theme.rule, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: theme.ink, backgroundColor: theme.paper }, mono as TextStyle]} {...extra} />
    </View>);

  const save = async () => {
    const origin = checkProxyUrl(s.proxyUrl);
    if (!origin) { setMsg({ text: "The proxy address must start with https://", bad: true }); return; }
    if (s.token.length < 32) { setMsg({ text: "The access token must be at least 32 characters, the same as APP_TOKEN on the proxy.", bad: true }); return; }
    const next = { ...s, proxyUrl: origin, account: Math.max(0, +s.account || 0), capPct: Math.min(100, Math.max(1, +s.capPct || 25)) };
    await saveSettings(next); setS(next); onSaved(next);
    setMsg({ text: "Saved to this phone's secure storage." });
  };
  const test = async () => {
    setMsg({ text: "Testing…" });
    try { const q = await fetchQuotes({ ...s, proxyUrl: checkProxyUrl(s.proxyUrl) || "" }, ["SPY"]); setMsg({ text: "Connected. SPY last trade " + px(q.SPY && q.SPY.last) + "." }); }
    catch (e: any) { setMsg({ text: e instanceof ApiError ? e.message : "The test failed.", bad: true }); }
  };
  const forget = async () => { await forgetToken(); const next = { ...s, token: "" }; setS(next); onSaved(next); setMsg({ text: "The token was removed from this phone." }); };

  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {msg ? <Banner theme={theme} text={msg.text} bad={msg.bad} /> : null}
      <Card theme={theme} title="Data proxy">
        {field("Proxy address", s.proxyUrl, v => setS({ ...s, proxyUrl: v }), { placeholder: "https://standard-vela-app.you.workers.dev", keyboardType: "url" })}
        {field("Access token", s.token, v => setS({ ...s, token: v }), { secureTextEntry: true, placeholder: "the APP_TOKEN you set on the proxy" })}
        <View style={{ flexDirection: "row", gap: 8, padding: 14 }}>
          <Btn theme={theme} label="Save" primary onPress={save} />
          <Btn theme={theme} label="Test connection" onPress={test} />
          <Btn theme={theme} label="Forget token" onPress={forget} />
        </View>
      </Card>
      <Card theme={theme} title="Watchlist">
        {field("Tickers, comma separated (up to 40)", s.watchlist, v => setS({ ...s, watchlist: v.toUpperCase() }), { placeholder: "NVDA, AMZN, IREN, CIFR", autoCapitalize: "characters", multiline: true })}
        <Text style={{ color: theme.ink3, fontSize: 12, paddingHorizontal: 14 }}>Used by Market breadth, Pairs, the Filings radar and Earnings.</Text>
        <View style={{ padding: 14 }}><Btn theme={theme} label="Save" primary onPress={save} /></View>
      </Card>
      <Card theme={theme} title="Size">
        {field("Account ($)", String(s.account), v => setS({ ...s, account: +v.replace(/[^0-9.]/g, "") || 0 }), { keyboardType: "decimal-pad" })}
        <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: theme.ink2, fontSize: 12, marginBottom: 4 }}>Bucket</Text>
          <Seg theme={theme} value={s.bucket} onChange={v => setS({ ...s, bucket: v })} options={[{ v: "core", label: "Core, 2% risk" }, { v: "spec", label: "Speculative, 1%" }]} />
        </View>
        {field("Position cap (% of account)", String(s.capPct), v => setS({ ...s, capPct: +v.replace(/[^0-9.]/g, "") || 0 }), { keyboardType: "number-pad" })}
        <View style={{ padding: 14 }}><Btn theme={theme} label="Save" primary onPress={save} /></View>
      </Card>
      <Text style={{ color: theme.ink3, fontSize: 12 }}>The token and settings are kept in the iPhone Keychain or Android Keystore, readable only while the phone is unlocked and never included in backups. The app never stores a broker login and never places an order.</Text>
    </ScrollView>
  );
}
