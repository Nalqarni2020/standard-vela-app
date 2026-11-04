import * as SecureStore from "expo-secure-store";

/* Everything is kept in the Keychain (iOS) or Keystore (Android), readable only while the phone is
   unlocked and never copied to another device or a backup. */
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type Settings = {
  proxyUrl: string;     // https://<name>.<account>.workers.dev
  token: string;        // the APP_TOKEN set on the proxy
  account: number;
  bucket: "core" | "spec";
  capPct: number;       // position cap, percent of account
  lastSymbol: string;
  watchlist: string;    // comma-separated tickers used by Market, Pairs, Filings and Earnings
};

export const DEFAULTS: Settings = { proxyUrl: "", token: "", account: 25000, bucket: "core", capPct: 25, lastSymbol: "CIFR", watchlist: "" };

const KEY_TOKEN = "sv.token";
const KEY_PREFS = "sv.prefs";

export async function loadSettings(): Promise<Settings> {
  const [token, prefs] = await Promise.all([SecureStore.getItemAsync(KEY_TOKEN, OPTS), SecureStore.getItemAsync(KEY_PREFS, OPTS)]);
  let p: Partial<Settings> = {};
  try { p = prefs ? JSON.parse(prefs) : {}; } catch { p = {}; }
  return { ...DEFAULTS, ...p, token: token || "" };
}

export async function saveSettings(s: Settings): Promise<void> {
  const { token, ...prefs } = s;
  await SecureStore.setItemAsync(KEY_TOKEN, token, OPTS);
  await SecureStore.setItemAsync(KEY_PREFS, JSON.stringify(prefs), OPTS);
}

export async function forgetToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_TOKEN, OPTS);
}

/* Only https addresses are accepted, so the token never travels in clear text. */
export function checkProxyUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function watchlistSymbols(s: Settings): string[] {
  return [...new Set(s.watchlist.split(/[\s,]+/).map(x => x.trim().toUpperCase().replace(/^\$/, "")).filter(x => /^[A-Z][A-Z0-9.]{0,9}$/.test(x)))].slice(0, 40);
}
