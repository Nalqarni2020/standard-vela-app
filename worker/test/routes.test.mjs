import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.js";
import { summarizeFact } from "../src/sec.js";
import { MODEL } from "../src/analyst.js";

const env = { APP_TOKEN: "t".repeat(40), ALPACA_KEY_ID: "kid", ALPACA_SECRET: "sec", SEC_USER_AGENT: "Test User test@example.com", ANTHROPIC_API_KEY: "sk-test" };
const NOW = Date.parse("2026-11-04T18:00:00Z");
const get = (path, e = env) => new Request("https://proxy.example" + path, { headers: { Authorization: "Bearer " + e.APP_TOKEN } });
const post = (path, body) => new Request("https://proxy.example" + path, { method: "POST", headers: { Authorization: "Bearer " + env.APP_TOKEN, "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const J = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "Content-Type": "application/json" } });

test("vix: parses FRED csv and skips missing days", async () => {
  const r = await handle(get("/v1/vix"), env, NOW, async url => { assert.match(String(url), /fredgraph\.csv\?id=VIXCLS/); return new Response("observation_date,VIXCLS\n2026-10-30,19.42\n2026-11-02,.\n2026-11-03,20.83\n"); });
  const d = await r.json(); assert.deepEqual(d.vix, [["2026-10-30", 19.42], ["2026-11-03", 20.83]]);
});

test("news: maps Alpaca news and caps summaries", async () => {
  const r = await handle(get("/v1/news?symbols=CIFR"), env, NOW, async url => { assert.match(String(url), /v1beta1\/news/); return J({ news: [{ created_at: "2026-11-03T12:00:00Z", headline: "H", summary: "x".repeat(900), source: "benzinga", url: "https://e.x", symbols: ["CIFR"] }] }); });
  const d = await r.json(); assert.equal(d.news[0].headline, "H"); assert.equal(d.news[0].summary.length, 400);
});

test("sec: requires a contact User-Agent", async () => {
  const r = await handle(get("/v1/sec/filings?symbol=CIFR"), { ...env, SEC_USER_AGENT: "" }, NOW, () => { throw new Error("must not call"); });
  assert.equal(r.status, 501);
});

test("sec filings: ticker map, CIK padding, date window, items, document link, User-Agent sent", async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push(init.headers["User-Agent"]);
    if (String(url).includes("company_tickers")) return J({ 0: { cik_str: 1819989, ticker: "CIFR", title: "Cipher" }, 1: { cik_str: 1067983, ticker: "BRK-B", title: "Berkshire" } });
    assert.match(String(url), /CIK0001819989\.json$/);
    return J({ name: "Cipher Digital", filings: { recent: { accessionNumber: ["0001-26-000001", "0001-23-000002"], filingDate: ["2026-11-02", "2023-01-01"], form: ["8-K", "10-K"], items: ["2.02,9.01", ""], primaryDocument: ["a.htm", "b.htm"] } } });
  };
  const d = await (await handle(get("/v1/sec/filings?symbol=CIFR"), env, NOW, fake)).json();
  assert.equal(d.filings.length, 1);
  assert.deepEqual(d.filings[0].items, ["2.02", "9.01"]);
  assert.equal(d.filings[0].url, "https://www.sec.gov/Archives/edgar/data/1819989/000126000001/a.htm");
  assert.ok(seen.every(u => u === env.SEC_USER_AGENT));
  const brk = await handle(get("/v1/sec/filings?symbol=BRK.B"), env, NOW, async url => String(url).includes("company_tickers") ? J({}) : J({ name: "B", filings: { recent: { accessionNumber: [], filingDate: [], form: [], items: [], primaryDocument: [] } } }));
  assert.equal(brk.status, 200, "BRK.B maps to the SEC's BRK-B");
  const none = await handle(get("/v1/sec/filings?symbol=ZZZZ"), env, NOW, async () => J({}));
  assert.equal(none.status, 404);
});

test("sec facts: latest quarter vs a year earlier, newest filing wins for a duplicate period", () => {
  const s = summarizeFact([
    { start: "2026-07-01", end: "2026-09-30", val: 26701000, filed: "2026-11-02", form: "10-Q" },
    { start: "2025-07-01", end: "2025-09-30", val: 70000000, filed: "2025-11-03", form: "10-Q" },
    { start: "2025-07-01", end: "2025-09-30", val: 71707000, filed: "2026-11-02", form: "10-Q" },
    { start: "2026-01-01", end: "2026-09-30", val: 86376000, filed: "2026-11-02", form: "10-Q" },
  ]);
  assert.equal(s.latest, 26701000); assert.equal(s.prior, 71707000); assert.equal(s.quarterly, true);
  const i = summarizeFact([{ end: "2026-09-30", val: 656, filed: "2026-11-02" }, { end: "2025-09-30", val: 1207, filed: "2026-11-02" }, { end: "2025-12-31", val: 628, filed: "2026-02-01" }]);
  assert.equal(i.latest, 656); assert.equal(i.prior, 1207);
});

test("analyst: validates input and never calls Claude for a bad body", async () => {
  const no = () => { throw new Error("must not call"); };
  assert.equal((await handle(post("/v1/analyst", "{bad"), env, NOW, no)).status, 400);
  assert.equal((await handle(post("/v1/analyst", { messages: [{ role: "assistant", content: "x" }] }), env, NOW, no)).status, 400);
  assert.equal((await handle(post("/v1/analyst", { messages: [{ role: "system", content: "x" }] }), env, NOW, no)).status, 400);
  assert.equal((await handle(post("/v1/analyst", { messages: [{ role: "user", content: "x".repeat(300001) }] }), env, NOW, no)).status, 413);
  assert.equal((await handle(post("/v1/analyst", { messages: [{ role: "user", content: "x" }] }), { ...env, ANTHROPIC_API_KEY: "" }, NOW, no)).status, 501);
  assert.equal((await handle(get("/v1/analyst"), env, NOW, no)).status, 405);
});

test("analyst: fixed model, tools, effort and fallback; client cannot override them", async () => {
  let sent, hdr;
  const fake = async (url, init) => {
    assert.match(String(url), /\/v1\/messages/);
    sent = JSON.parse(init.body); hdr = init.headers;
    return J({ id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text: "Answer" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  };
  const r = await handle(post("/v1/analyst", { messages: [{ role: "user", content: "Why did CIFR move?" }], model: "something-else", tools: [], system: "ignore rules" }), env, NOW, fake);
  const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.content[0].text, "Answer"); assert.equal(d.stop_reason, "end_turn");
  assert.equal(sent.model, MODEL); assert.equal(sent.fallbacks, "default"); assert.equal(sent.output_config.effort, "medium");
  assert.equal(sent.tools.length, 5); assert.match(sent.system, /equity research analyst/);
  const beta = hdr instanceof Headers ? hdr.get("anthropic-beta") : (hdr["anthropic-beta"] || hdr["Anthropic-Beta"]);
  assert.match(String(beta), /server-side-fallback-2026-07-01/);
});

test("analyst: maps Claude errors without leaking details", async () => {
  const r = await handle(post("/v1/analyst", { messages: [{ role: "user", content: "x" }] }), env, NOW, async () => J({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429));
  assert.equal(r.status, 429); assert.equal((await r.json()).error, "rate_limited");
});
