# Standard & Vela, phone app

A personal iPhone and Android version of the Standard & Vela desk. It applies the same written rule (the Standard) and the same candle-break formula, on live market data, and never places an order.

```
app/      Expo (React Native) app for iOS and Android
  src/engine/engine.js   the rule engine, shared with the web desk
worker/   Cloudflare Worker that holds the market-data keys
tests/    engine tests (run with npm test at the root)
```

## How it stays secure

- **No keys in the app.** The Alpaca keys live only on the Worker, as Cloudflare secrets. The phone holds a separate access token for the Worker.
- **Secure storage on the phone.** The token and settings are kept in the iPhone Keychain or Android Keystore, readable only while the phone is unlocked, and excluded from backups.
- **A locked-down Worker.** It accepts only `GET` requests that carry the token. The token is checked in constant time. The Worker has two read routes, validates every symbol and range, never returns provider error details, and sends `Cache-Control: no-store`.
- **HTTPS only.** The app refuses a proxy address that is not `https://`.
- **Read-only.** There is no broker login and no order path.

## Setup, about 20 minutes

### 1. Market data (Alpaca, free plan)
Create an account at alpaca.markets and generate API keys. The free plan gives consolidated (all exchanges) history that ends 15 minutes ago, plus a live IEX price. The app is built around that 16-minute delay.

### 2. The Worker (Cloudflare, free plan)
The quickest way is the setup script, which signs you in, deploys, creates the access token and asks for each key:
```bash
cd worker && bash setup.sh
```
Or do the same steps by hand:
```bash
cd worker
npm test
npx wrangler login
npx wrangler deploy
```
Generate a long random access token. Keep it in a password manager, not in this repo:
```bash
openssl rand -base64 48
```
Set the three secrets. Wrangler prompts for each value, so nothing lands in your shell history:
```bash
npx wrangler secret put APP_TOKEN
```
```bash
npx wrangler secret put ALPACA_KEY_ID
```
```bash
npx wrangler secret put ALPACA_SECRET
```
Wrangler prints the Worker address, for example `https://standard-vela-app.<you>.workers.dev`.

Two more secrets switch on the extra desks. Each is optional; a desk whose secret is missing says so.

- **Filings and Earnings** read SEC EDGAR, which requires every client to name itself with a contact address. Enter something like `Your Name you@example.com`:
```bash
npx wrangler secret put SEC_USER_AGENT
```
- **Analyst** calls Claude. Create an API key at platform.claude.com. Each question is billed to that key: it uses Claude Opus 5.5 at medium effort, with Claude's server-side fallback turned on so a declined request is retried on another model.
```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

### 3. The app on your phone
The quickest way is Expo Go, a free app from the App Store and Google Play:
```bash
cd app
npm install
npx expo start
```
Scan the QR code with your phone. In the app, open **Settings**, paste the Worker address and the token, press **Save**, then **Test connection**.

To install it as a real app that runs without your computer, use EAS Build:
- **Android:** builds an APK you install directly. Needs a free Expo account.
```bash
npx eas-cli@latest build -p android --profile preview
```
- **iPhone:** needs an Apple Developer account ($99 a year) to install outside Expo Go.
```bash
npx eas-cli@latest build -p ios --profile preview
```
The Android app ID is `com.nalqarni2020.standardvela`; Little Astronaut is `com.nalqarni2020.littleastronaut`.

## Desks

The Desks tab holds six more screens. Their data sources differ from the web desk, which reads Robinhood:

| Desk | Phone data |
|---|---|
| Book | A Robinhood account activity CSV you open on the phone. The file never leaves it; only tickers go to your proxy. |
| Market | Alpaca prices for index and sector funds, your watchlist for breadth, the VIX from the St. Louis Fed |
| Pairs | Alpaca daily prices for your watchlist or typed tickers |
| Analyst | Claude through your proxy, which fixes the model, instructions and tools; the phone supplies prices, Alpaca news, SEC filings and earnings windows |
| Filings | SEC EDGAR |
| Earnings | Past reports dated from SEC 8-K item 2.02 filings. No EPS estimates or confirmed future dates. |

Congress trades are on the web desk only. Set your watchlist in Settings.

## Checks
```bash
npm test
```
```bash
cd app && npx tsc --noEmit
```

## Notes
- Today's daily bar counts as the cash close from 16:16 New York, because history ends 16 minutes ago on the free plan.
- The New York clock is computed from US daylight-saving rules, because phones' JavaScript engine may lack time-zone data. It is tested against the system time zone from 2008 to 2035.
- This app reports a written rule. It is not a recommendation to buy or sell. Trading can lose money.
