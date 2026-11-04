import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, parseSymbols, sameSecret } from "../src/index.js";

const env = { APP_TOKEN: "t".repeat(40), ALPACA_KEY_ID: "kid", ALPACA_SECRET: "sec" };
const req = (path, token = env.APP_TOKEN, method = "GET") =>
  new Request("https://proxy.example" + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
const NOW = Date.parse("2026-11-04T18:00:00Z");

test("rejects missing and wrong tokens", async () => {
  assert.equal((await handle(req("/v1/snapshots?symbols=AAPL", null), env, NOW, () => { throw new Error("must not call"); })).status, 401);
  assert.equal((await handle(req("/v1/snapshots?symbols=AAPL", "x".repeat(40)), env, NOW, () => { throw new Error("must not call"); })).status, 401);
});

test("refuses a short configured token and non-GET methods", async () => {
  assert.equal((await handle(req("/v1/snapshots?symbols=AAPL"), { ...env, APP_TOKEN: "short" }, NOW)).status, 500);
  assert.equal((await handle(req("/v1/snapshots?symbols=AAPL", env.APP_TOKEN, "POST"), env, NOW)).status, 405);
});

test("validates symbols and ranges", async () => {
  assert.equal(parseSymbols("aapl, spy,AAPL").join(","), "AAPL,SPY");
  assert.equal(parseSymbols("AAPL;DROP"), null);
  assert.equal(parseSymbols(Array.from({ length: 11 }, (_, i) => "A" + i).join(",")), null);
  assert.equal((await handle(req("/v1/bars?symbols=AAPL&tf=day&days=5000"), env, NOW)).status, 400);
  assert.equal((await handle(req("/v1/bars?symbols=AAPL&tf=1min&days=5"), env, NOW)).status, 400);
});

test("bars: sends keys upstream, ends 16 minutes ago, follows pages, compacts output", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const page = calls.length === 1
      ? { bars: { AAPL: [{ t: "2026-11-02T05:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }] }, next_page_token: "p2" }
      : { bars: { AAPL: [{ t: "2026-11-03T05:00:00Z", o: 1.5, h: 2.5, l: 1, c: 2, v: 200 }], ZZZ: [] }, next_page_token: null };
    return new Response(JSON.stringify(page), { status: 200 });
  };
  const r = await handle(req("/v1/bars?symbols=AAPL&tf=day&days=30"), env, NOW, fake);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.bars.AAPL, [[Date.parse("2026-11-02T05:00:00Z"), 1, 2, 0.5, 1.5, 100], [Date.parse("2026-11-03T05:00:00Z"), 1.5, 2.5, 1, 2, 200]]);
  assert.equal(d.bars.ZZZ, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get("page_token"), "p2");
  assert.equal(calls[0].url.searchParams.get("end"), new Date(NOW - 16 * 60000).toISOString());
  assert.equal(calls[0].url.searchParams.get("feed"), "sip");
  assert.equal(calls[0].init.headers["APCA-API-KEY-ID"], "kid");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});

test("maps provider errors without leaking details", async () => {
  const r = await handle(req("/v1/snapshots?symbols=AAPL"), env, NOW, async () => new Response("nope", { status: 403 }));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "provider_auth");
});

test("snapshots: normalizes fields", async () => {
  const fake = async () => new Response(JSON.stringify({ AAPL: { latestTrade: { p: 10, t: "2026-11-04T17:59:00Z" }, latestQuote: { bp: 9.9, ap: 10.1 }, prevDailyBar: { c: 9.5, t: "2026-11-03T05:00:00Z" }, dailyBar: { t: "2026-11-04T05:00:00Z", o: 9.6, h: 10.2, l: 9.4, c: 10, v: 1000 } } }), { status: 200 });
  const d = await (await handle(req("/v1/snapshots?symbols=AAPL"), env, NOW, fake)).json();
  assert.equal(d.quotes.AAPL.last, 10);
  assert.equal(d.quotes.AAPL.prevClose, 9.5);
  assert.equal(d.quotes.AAPL.day[4], 10);
});

test("constant-time compare", async () => {
  assert.equal(await sameSecret("abc", "abc"), true);
  assert.equal(await sameSecret("abc", "abd"), false);
  assert.equal(await sameSecret("", ""), false);
});
