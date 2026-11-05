# Web desk source

The Standard & Vela web desk runs as a private claude.ai page that reads your Robinhood account through the Robinhood connector. This folder is its source, kept here as a backup and for review.

```
page.src.html        the page: Standard, Vela and the desk shell (engine.js is inlined at build time)
engine.js            the rule engine (Standard, candle break, backtests, Edge lab)
apps/                one file per desk: playbook, book, market, congress, pairs, analyst, filings, earnings
apps/playbook-core.js  Playbook rules, pure functions; the phone app uses the same file
tests/               node web/tests/playbook.js and node web/tests/analytics.js
build.js             writes index.html
```

## Playbook

| Tab | What it does |
|---|---|
| Today | The market gate (S&P against its 200-day, the short-term regime, breadth of your list, the VIX) gives Go, Half size or Stand aside, plus volatility scaling. Your limits: risk per trade, largest position, a daily loss limit that sets every size to zero once reached, and liquidity limits. |
| Scanner | Four swing setups with buy-above, stop, target, shares and their record; earnings inside the hold and wide spreads are flagged; thin names are skipped. During the session: 5-minute opening-range breakouts on stocks in play, and the SPY and QQQ last-half-hour signal. Save plan stores the trade. |
| Size a trade | Shares from account × risk × gate ÷ (entry − stop), capped. Earnings warning, liquidity, and a check for holdings that move with it (correlation 0.7 or more over 60 sessions). Saved plans are listed here. |
| Manage | Each holding in R, its trailing stop (highest high since entry − 3 ATR, break-even after half at 1R), what is due (exit, take half, time, earnings). |
| My edge | Your round trips by hold time, time of day, the gate, the setup, after a loss, busy days, size and planning, with lessons; trades matched to saved plans in R, with broken stops and overstayed holds. |
| Evidence | The scanner's exact rules backtested on the list, early and late periods, and a deflated Sharpe ratio that counts every setting you have tried. |

Saved plans are kept in the page's private database (`data/users/<you>`): only you can read them. Where that is not available they are kept in the browser.

## Publish
```bash
node web/build.js
```
Then publish `web/index.html` with `web/apps/*.js` as its files, to the existing artifact, keeping its capabilities (Robinhood read tools, sample, db, user).
