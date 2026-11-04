import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "./src/theme";
import { Settings, DEFAULTS, loadSettings, saveSettings } from "./src/settings";
import { StandardScreen } from "./src/screens/StandardScreen";
import { SignalsScreen } from "./src/screens/SignalsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

type Tab = "standard" | "signals" | "settings";

export default function App() {
  const theme = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("standard");

  useEffect(() => {
    loadSettings().then(s => { setSettings(s); if (!s.token || !s.proxyUrl) setTab("settings"); }).catch(() => setSettings(DEFAULTS));
  }, []);
  const onSymbol = useCallback((sym: string) => {
    setSettings(prev => { if (!prev || prev.lastSymbol === sym) return prev; const next = { ...prev, lastSymbol: sym }; saveSettings(next).catch(() => {}); return next; });
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.sheet }} edges={["top", "left", "right"]}>
        <StatusBar style="auto" />
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.rule, flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Text style={{ color: theme.ink, fontSize: 20, fontWeight: "700" }}>Standard</Text>
          <Text style={{ color: theme.teal, fontSize: 20, fontWeight: "700" }}>{"&"}</Text>
          <Text style={{ color: theme.ink, fontSize: 20, fontWeight: "700" }}>Vela</Text>
        </View>
        <View style={{ flex: 1 }}>
          {!settings ? null
            : tab === "standard" ? <StandardScreen theme={theme} settings={settings} onSymbol={onSymbol} />
            : tab === "signals" ? <SignalsScreen theme={theme} settings={settings} symbol={settings.lastSymbol} />
            : <SettingsScreen theme={theme} settings={settings} onSaved={s => { setSettings(s); if (s.token) setTab("standard"); }} />}
        </View>
        <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.sheet, borderTopWidth: 1, borderTopColor: theme.rule }}>
          <View style={{ flexDirection: "row" }}>
            {([["standard", "Standard"], ["signals", "Candle break"], ["settings", "Settings"]] as [Tab, string][]).map(([k, l]) => (
              <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={{ flex: 1, paddingVertical: 12, alignItems: "center" }}>
                <Text style={{ color: tab === k ? theme.teal : theme.ink3, fontWeight: tab === k ? "700" : "500" }}>{l}</Text>
              </Pressable>))}
          </View>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
