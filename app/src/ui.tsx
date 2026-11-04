import React from "react";
import { View, Text, Pressable, TextStyle, ViewStyle } from "react-native";
import { Theme, mono } from "./theme";

export function Card({ theme, title, right, children }: { theme: Theme; title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: theme.sheet, borderColor: theme.rule, borderWidth: 1, borderRadius: 8, marginBottom: 14, overflow: "hidden" }}>
      {title ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.rule }}>
          <Text style={{ color: theme.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>{right}
        </View>) : null}
      {children}
    </View>
  );
}

export function Pill({ theme, ok, text }: { theme: Theme; ok: boolean | null; text: string }) {
  const bg = ok == null ? theme.amberWash : ok ? theme.upWash : theme.downWash, fg = ok == null ? theme.amber : ok ? theme.up : theme.down;
  return <Text style={{ backgroundColor: bg, color: fg, fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, overflow: "hidden", letterSpacing: 0.5 }}>{text.toUpperCase()}</Text>;
}

export function Seg<T extends string>({ theme, value, options, onChange }: { theme: Theme; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: theme.rule, borderRadius: 6, overflow: "hidden" }}>
      {options.map(o => (
        <Pressable key={o.v} onPress={() => onChange(o.v)} accessibilityRole="button" accessibilityState={{ selected: o.v === value }}
          style={{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: o.v === value ? theme.tealWash : "transparent" }}>
          <Text style={{ color: o.v === value ? theme.teal : theme.ink2, fontWeight: o.v === value ? "700" : "500" }}>{o.label}</Text>
        </Pressable>))}
    </View>
  );
}

export function Btn({ theme, label, onPress, primary, disabled, style }: { theme: Theme; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 6, borderWidth: 1, borderColor: primary ? theme.teal : theme.rule, backgroundColor: primary ? theme.teal : theme.sheet, opacity: disabled ? 0.5 : pressed ? 0.8 : 1, alignItems: "center" }, style]}>
      <Text style={{ color: primary ? theme.sheet : theme.ink, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function KV({ theme, items }: { theme: Theme; items: [string, string][] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {items.map(([k, v]) => (
        <View key={k} style={{ width: "50%", paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.rule }}>
          <Text style={{ color: theme.ink3, fontSize: 11, letterSpacing: 0.6 }}>{k.toUpperCase()}</Text>
          <Text style={[{ color: theme.ink, fontSize: 16, marginTop: 2 }, mono as TextStyle]}>{v}</Text>
        </View>))}
    </View>
  );
}

export function Banner({ theme, text, bad }: { theme: Theme; text: string; bad?: boolean }) {
  return <Text style={{ borderWidth: 1, borderColor: bad ? theme.down : theme.amber, backgroundColor: bad ? theme.downWash : theme.amberWash, color: theme.ink, padding: 10, borderRadius: 6, marginBottom: 12 }}>{text}</Text>;
}
