import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { extractGuideFacts } from "./guide-facts.mjs";

const html = await readFile(new URL("../atlanta-guide/index.html", import.meta.url), "utf8");
const facts = extractGuideFacts(html);
const bundle = await build({
  entryPoints: [new URL("./src/lib/ask-local.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
  define: { __ATLANTA_GUIDE_FACTS__: JSON.stringify(facts) },
});
const { askGemini, limitAnswer, LOCAL_SYSTEM_PROMPT } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("facts come from the existing page, not chat or visitor instructions", () => {
  assert.match(facts, /MARTA/);
  assert.match(facts, /lemon pepper/i);
  assert.doesNotMatch(facts, /Your Atlanta question|AI guide\. It can make mistakes/);
  assert.match(LOCAL_SYSTEM_PROMPT, /Say you are an AI if asked/);
  assert.match(LOCAL_SYSTEM_PROMPT, /suggest checking the official site/);
});

test("answer length is strictly less than 120 words", () => {
  for (const count of [1, 119, 120, 300]) {
    assert.ok(limitAnswer(Array(count).fill("Atlanta").join(" ")).split(/\s+/).length < 120);
  }
});

test("Gemini uses a server header, authoritative facts, and untrusted question", async () => {
  process.env.GEMINI_API_KEY = "test-only-not-a-real-key";
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).search, "");
    assert.equal(options.headers["x-goog-api-key"], "test-only-not-a-real-key");
    const body = JSON.parse(options.body);
    assert.match(body.systemInstruction.parts[0].text, /<page-facts>/);
    assert.equal(body.contents[0].parts[0].text, "Where can I walk?");
    return new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Try the BeltLine Eastside Trail." }] } }],
    }));
  };
  assert.equal(await askGemini("Where can I walk?"), "Try the BeltLine Eastside Trail.");
});

test("upstream failures never reveal provider payloads", async () => {
  globalThis.fetch = async () => new Response("sensitive upstream detail", { status: 429 });
  await assert.rejects(askGemini("Where to eat?"), /^Error: AI_HTTP_429$/);
});

test("blocked or empty Gemini output is an explicit failure", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [] }));
  await assert.rejects(askGemini("Anything"), /AI_NO_COMPLETE_ANSWER/);
});

test("missing credentials fail the request, not server startup", async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(askGemini("Anything"), /AI_UNAVAILABLE/);
});

test("only the requested section and script were added to the HTML", async () => {
  const { execFileSync } = await import("node:child_process");
  const original = execFileSync("git", ["show", "HEAD:artifacts/atlanta-guide/index.html"], { encoding: "utf8" });
  const withoutAdditions = html
    .replace(/      <section class="section ask-local"[\s\S]*?      <\/section>\n\n/, "")
    .replace('    <script type="module" src="/src/ask-local.js"></script>\n', "");
  assert.equal(withoutAdditions, original);
});
