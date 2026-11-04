#!/usr/bin/env bash
# One-time setup for the Standard & Vela data proxy.
# Run it on your own computer from the worker folder:  bash setup.sh
# It signs you in to Cloudflare, deploys the proxy, creates the app's access token, and asks for each key.
# Keys are typed into wrangler's own hidden prompt and go straight to Cloudflare; nothing is saved in this folder.
set -euo pipefail
cd "$(dirname "$0")"

echo "1/5  Installing and testing the proxy…"
npm install --silent
npm test

echo "2/5  Signing in to Cloudflare (a browser window opens)…"
npx wrangler login

echo "3/5  Deploying…"
npx wrangler deploy

echo "4/5  Creating the app's access token…"
TOKEN="$(openssl rand -base64 48 | tr -d '\n')"
printf '%s' "$TOKEN" | npx wrangler secret put APP_TOKEN
echo
echo "    Your access token (paste it into the app's Settings, and keep a copy in a password manager):"
echo
echo "    $TOKEN"
echo

echo "5/5  Keys. Paste each one when wrangler asks; the text stays hidden."
echo "    Alpaca key id and secret (alpaca.markets → API keys):"
npx wrangler secret put ALPACA_KEY_ID
npx wrangler secret put ALPACA_SECRET

read -r -p "    Set up Filings and Earnings (SEC data)? [y/N] " a
if [[ "${a:-}" =~ ^[Yy] ]]; then
  echo "    Enter your name and email, e.g. 'Your Name you@example.com' (the SEC requires a contact):"
  npx wrangler secret put SEC_USER_AGENT
fi

read -r -p "    Set up the Analyst (Claude API key from platform.claude.com; each question is billed to it)? [y/N] " b
if [[ "${b:-}" =~ ^[Yy] ]]; then
  npx wrangler secret put ANTHROPIC_API_KEY
fi

echo
echo "Done. The proxy address is the workers.dev URL wrangler printed in step 3."
echo "In the app: Settings → paste the address and the token → Save → Test connection."
