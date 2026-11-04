import { useColorScheme } from "react-native";

const light = { paper: "#F5F5F0", sheet: "#FCFCF9", ink: "#18211F", ink2: "#4A5552", ink3: "#7D8784", rule: "#D9DCD4", teal: "#0D6556", tealWash: "#E3EFEB", up: "#1C7436", upWash: "#E4F1E6", down: "#B0281F", downWash: "#F7E6E3", amber: "#8A5A00", amberWash: "#F6EDD9" };
const dark = { paper: "#0F1514", sheet: "#151D1B", ink: "#E3EAE7", ink2: "#A9B5B1", ink3: "#75817D", rule: "#26312E", teal: "#4FB4A0", tealWash: "#16302A", up: "#4FC27C", upWash: "#15301F", down: "#F07068", downWash: "#3A1A18", amber: "#E2B04F", amberWash: "#33280F" };

export type Theme = typeof light;
export function useTheme(): Theme { return useColorScheme() === "dark" ? dark : light; }

export const mono = { fontFamily: "Menlo", fontVariant: ["tabular-nums" as const] };
export const px = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
export const pct = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
export const int = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");
export const money = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
