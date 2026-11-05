import React, { useEffect, useRef } from "react";
import { BackHandler } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView, WebViewMessageEvent } from "react-native-webview";
import * as Speech from "expo-speech";
import { GAME_HTML } from "./src/game";

// react-native-webview 14's declared types do not resolve under React 19's JSX types (props become "never").
// The component itself is fine at runtime; this cast only affects type checking.
const WebView = RNWebView as unknown as React.ComponentType<any>;
type WebViewHandle = { injectJavaScript: (js: string) => void };

/* Android's web view has no built-in voice, so the game's speechSynthesis calls are routed to expo-speech. */
const BRIDGE = `
(function () {
  function send(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  function Utterance(text) { this.text = String(text || ""); this.lang = "en-US"; this.rate = 1; this.pitch = 1; this.voice = null; }
  var synth = {
    speak: function (u) { send({ type: "say", text: u.text, lang: u.lang, rate: u.rate, pitch: u.pitch }); },
    cancel: function () { send({ type: "stop" }); },
    getVoices: function () { return []; },
    speaking: false, pending: false, paused: false
  };
  try { Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true }); } catch (e) { window.speechSynthesis = synth; }
  try { Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true }); } catch (e) { window.SpeechSynthesisUtterance = Utterance; }
})();
true;`;

/* Android back button: inside a game it goes back to the home screen; on the home screen it leaves the app. */
const BACK = `
(function () {
  var b = document.getElementById("back");
  if (b && !b.hidden) b.click(); else window.ReactNativeWebView.postMessage(JSON.stringify({ type: "exit" }));
})();
true;`;

export default function App() {
  const web = useRef<WebViewHandle>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { web.current?.injectJavaScript(BACK); return true; });
    return () => { sub.remove(); Speech.stop(); };
  }, []);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === "say" && typeof m.text === "string") { Speech.stop(); Speech.speak(m.text.slice(0, 400), { language: m.lang === "ar-SA" ? "ar-SA" : "en-US", rate: Number(m.rate) || 1, pitch: Number(m.pitch) || 1 }); }
    else if (m.type === "stop") Speech.stop();
    else if (m.type === "exit") BackHandler.exitApp();
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1033" }}>
        <StatusBar style="light" />
        <WebView
          ref={web}
          source={{ html: GAME_HTML, baseUrl: "https://number-galaxy.local/" }}
          originWhitelist={["https://number-galaxy.local", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "about:blank"]}
          injectedJavaScriptBeforeContentLoaded={BRIDGE}
          onMessage={onMessage}
          domStorageEnabled
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
          overScrollMode="never"
          bounces={false}
          style={{ flex: 1, backgroundColor: "#0b1033" }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
