import React, { useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { Settings } from "../settings";
import { Theme } from "../theme";
import { MarketDesk } from "./desks/MarketDesk";
import { PairsDesk } from "./desks/PairsDesk";
import { FilingsDesk } from "./desks/FilingsDesk";
import { EarningsDesk } from "./desks/EarningsDesk";
import { AnalystDesk } from "./desks/AnalystDesk";
import { BookDesk } from "./desks/BookDesk";

type Desk = "book" | "market" | "pairs" | "analyst" | "filings" | "earnings";
const LIST: [Desk, string, string][] = [
  ["book", "Book", "Journal and risk from your Robinhood activity CSV"],
  ["market", "Market", "Regime, breadth, sectors and the VIX"],
  ["pairs", "Pairs", "Stocks that move together, tested out of sample"],
  ["analyst", "Analyst", "Ask Claude; every number cited"],
  ["filings", "Filings", "SEC offerings, activist stakes, insiders, figures"],
  ["earnings", "Earnings", "Past report reactions and drift"],
];

export function DesksScreen({ theme, settings }: { theme: Theme; settings: Settings }) {
  const [desk, setDesk] = useState<Desk | null>(null);
  if (desk) {
    const title = LIST.find(d => d[0] === desk)![1];
    return (
      <View style={{ flex: 1 }}>
        <Pressable onPress={() => setDesk(null)} accessibilityRole="button" accessibilityLabel="Back to desks" style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.rule, backgroundColor: theme.sheet }}>
          <Text style={{ color: theme.teal, fontWeight: "600" }}>‹ Desks  <Text style={{ color: theme.ink }}>{title}</Text></Text>
        </Pressable>
        {desk === "book" ? <BookDesk theme={theme} settings={settings} /> : desk === "market" ? <MarketDesk theme={theme} settings={settings} /> : desk === "pairs" ? <PairsDesk theme={theme} settings={settings} />
          : desk === "analyst" ? <AnalystDesk theme={theme} settings={settings} /> : desk === "filings" ? <FilingsDesk theme={theme} settings={settings} /> : <EarningsDesk theme={theme} settings={settings} />}
      </View>);
  }
  return (
    <ScrollView style={{ backgroundColor: theme.paper }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      {LIST.map(([k, t, d]) => (
        <Pressable key={k} onPress={() => setDesk(k)} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: theme.sheet, borderWidth: 1, borderColor: theme.rule, borderRadius: 8, padding: 14, opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ color: theme.ink, fontSize: 17, fontWeight: "700" }}>{t}</Text>
          <Text style={{ color: theme.ink2, marginTop: 2 }}>{d}</Text>
        </Pressable>))}
      <Text style={{ color: theme.ink3, fontSize: 12, marginTop: 6 }}>Congress trades are on the web desk only: there is no free official source for them. None of these desks recommends a trade or places an order.</Text>
    </ScrollView>
  );
}
