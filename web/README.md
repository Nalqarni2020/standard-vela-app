# Web desk source

The Standard & Vela web desk runs as a private claude.ai page that reads your Robinhood account through the Robinhood connector. This folder is its source, kept here as a backup and for review.

```
page.src.html        the page: Standard, Vela and the desk shell (engine.js is inlined at build time)
engine.js            the rule engine (Standard, candle break, backtests, Edge lab)
apps/                one file per desk: playbook, book, market, congress, pairs, analyst, filings, earnings
apps/playbook-core.js  Playbook rules, pure functions; the phone app uses the same file
apps/brokers.js      Webull (accounts, positions, fills, watchlists, analysts, money flow, unusual activity) and Robinhood extras (analyst ratings, saved screeners, technical indicators)
tests/               node web/tests/playbook.js and node web/tests/analytics.js
build.js             writes index.html
```

## Playbook

| Tab | What it does |
|---|---|
| Today | The Bottom watch scores the five signs of a market bottom on SPY and QQQ (capitulation, fear spike, selling slows, leaders hold up, follow-through day with its day count and undercut reset). The market gate (S&P against its 200-day, the short-term regime, breadth of your list, the VIX) gives Go, Half size or Stand aside, plus volatility scaling. Your limits: risk per trade, largest position, a daily loss limit that sets every size to zero once reached, and liquidity limits. |
| Scanner | Four swing setups with buy-above, stop, target, shares and their record; earnings inside the hold and wide spreads are flagged; thin names are skipped. During the session: 5-minute opening-range breakouts on stocks in play, and the SPY and QQQ last-half-hour signal. Save plan stores the trade. |
| Movers | Webull's market-wide boards (1-day, 5-day and 1-month gainers and losers, volume leaders by dollars traded, unusual volume, gap up and gap down, pre-market gaps before 9:30), each name checked against Robinhood's split-adjusted history (reverse splits and bad data are filtered out) and graded for trading liquidity (20-day dollar volume, live spread, your position as a share of a day's trading). Plus trend, volume trend, live setups and earnings, and a test of what such moves did next on your list. |
| Size a trade | Shares from account × risk × gate ÷ (entry − stop), capped. Earnings warning, liquidity, and a check for holdings that move with it (correlation 0.7 or more over 60 sessions). Saved plans are listed here. |
| Manage | Each holding in R, its trailing stop (highest high since entry − 3 ATR, break-even after half at 1R), what is due (exit, take half, time, earnings). |
| My edge | Your round trips by hold time, time of day, the gate, the setup, after a loss, busy days, size and planning, with lessons; trades matched to saved plans in R, with broken stops and overstayed holds. |
| Evidence | The scanner's exact rules backtested on the list, early and late periods, and a deflated Sharpe ratio that counts every setting you have tried, and each setup's results split by rising or falling 20-day volume at the signal. Seven setups: pullback, 52-week high, gap held, volume shock, rally-base-rally retest (quiet pullback to a broken-out base), base breakout after a decline (30% fall, 30-session base no wider than 25%, first close above it on 1.5x volume, measured-move target), and the Hodrick-Prescott trend turn (one-sided filter, no look-ahead). |

Saved plans are kept in the page's private database (`data/users/<you>`): only you can read them. Where that is not available they are kept in the browser.

## Webull and research sources

With the Webull connector allowed for the page (read-only tools only):

- Today shows the Webull account; sizing and the daily loss limit can use Robinhood, Webull or both.
- Manage lists Webull holdings next to Robinhood's, with entry dates from Webull fills, and flags a price that differs between the brokers by over 10%.
- My edge adds Webull round trips and compares the two brokers.
- The list picker offers Webull watchlists and your saved Robinhood screeners (run live).
- The Scanner shows Robinhood's analyst consensus for each setup. Size a trade shows both brokers' analyst ratings and targets, Webull's large-order money flow and unusual-activity alerts, and checks the desk's ATR against Robinhood's own indicator. These are context; no rule uses them.

Without Webull the desk works as before and says Webull is unavailable.

## Publish
```bash
node web/build.js
```
Then publish `web/index.html` with `web/apps/*.js` as its files, to the existing artifact, keeping its capabilities (Robinhood and Webull read tools, sample, db, user).

## Vela → Gamma (options exposure)

`apps/exposure-core.js` (pure, tested in `tests/exposure.js`) and `apps/gamma.js` (the view). From Robinhood's option chain
(open interest and implied volatility per contract) it builds GEX, VEX, DEX and charm by strike and expiration with
Black-Scholes greeks, for the nearest expiration, this week, the next 30 days or one expiration. It shows a heatmap, the
King strike, call and put walls, the zero-gamma level (where total GEX changes sign as the price moves) and the expected
move from the at-the-money straddle. GEX and VEX use the common "dealers long calls, short puts" sign, which is an
assumption. Each build is logged to the page's database (`gexlog`), and builds made outside market hours are tested
against the next session: range against the expected move by gamma regime, walls reached and held, and closes nearer
the King. Read-only.
