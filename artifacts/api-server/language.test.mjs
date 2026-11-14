import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const frontend = new URL("../atlanta-guide/", import.meta.url);
const dictionarySource = await readFile(new URL("src/translations.js", frontend), "utf8");
const { spanish } = await import(`data:text/javascript;base64,${Buffer.from(dictionarySource).toString("base64")}`);
const html = await readFile(new URL("index.html", frontend), "utf8");
const bundle = await build({
  entryPoints: [new URL("src/language.js", frontend).pathname],
  bundle: true, write: false, format: "iife", globalName: "GuideLanguage",
});

function mount(savedLanguage, storageBlocked = false) {
  const attributes = new Map([["aria-label", "Switch to Spanish"]]);
  const toggle = {
    hasAttribute: (key) => attributes.has(key),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    addEventListener() {},
  };
  const strings = [
    "Local Food", "Piedmont Park", "Spring (Mar–May):",
    "MARTA trains run straight from the airport to Downtown, Midtown, and Decatur. A one-way ride is $2.50.",
    "AI guide. It can make mistakes. Don't share personal info.",
  ];
  const nodes = strings.map((textContent) => ({ textContent, parentElement: { closest: () => null } }));
  const root = { lang: "en", className: "dark" };
  const store = new Map([["atlanta-guide-language", savedLanguage]]);
  const document = {
    documentElement: root,
    createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] }; },
    querySelectorAll: () => [toggle],
    getElementById: () => toggle,
    dispatchEvent() {},
  };
  const context = {
    document, NodeFilter: { SHOW_TEXT: 4 },
    localStorage: {
      getItem: (key) => { if (storageBlocked) throw new Error("blocked"); return store.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw new Error("blocked"); store.set(key, value); },
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
  };
  runInNewContext(bundle.outputFiles[0].text, context);
  return { api: context.GuideLanguage, root, nodes, store, attributes };
}

test("saved Spanish restores lang, text, and accessibility without changing dark mode", () => {
  const { root, nodes, attributes } = mount("es");
  assert.equal(root.lang, "es");
  assert.equal(root.className, "dark");
  assert.equal(nodes[0].textContent, "Comida local");
  assert.equal(nodes[1].textContent, "Piedmont Park");
  assert.match(nodes[2].textContent, /Mar–May/);
  assert.match(nodes[3].textContent, /MARTA.*Downtown.*Midtown.*Decatur.*\$2\.50/);
  assert.equal(attributes.get("aria-pressed"), "true");
});

test("both directions translate and persist, retaining protected names and prices", () => {
  const { api, root, nodes, store } = mount("en");
  api.setLanguage("es");
  assert.equal(store.get("atlanta-guide-language"), "es");
  api.setLanguage("en");
  assert.equal(root.lang, "en");
  assert.equal(nodes[0].textContent, "Local Food");
  assert.match(nodes[3].textContent, /\$2\.50/);
  assert.equal(store.get("atlanta-guide-language"), "en");
});

test("language still switches when localStorage is blocked", () => {
  const { api, root } = mount("en", true);
  api.setLanguage("es");
  assert.equal(root.lang, "es");
});

test("every non-proper-name page text node has a Spanish translation", () => {
  const protectedText = new Set([
    "ATL", "English", "/", "Español", "Atlanta", "01", "02", "03", "04", "05",
    "Martin Luther King Jr. National Historical Park", "The BeltLine Eastside Trail",
    "Piedmont Park", "Centennial Olympic Park", "No. 1", "No. 2", "No. 3",
    "Mary Mac's Tea Room (Ponce de Leon Ave) · Busy Bee Cafe (Westside)",
    "Paschal's (Castleberry Hill) · Busy Bee Cafe", "Little Five Points", "Inman Park",
    "West End", "Decatur", "Apr", "May", "Jul", "Sep", "Oct", "CC BY 2.0",
    "Martin Luther King Jr. Birth Home", ")", "CC BY-SA 4.0",
  ]);
  const entities = { amp: "&", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", middot: "·", deg: "°" };
  const texts = html.replace(/<[^>]*>/g, "\0").split("\0")
    .map((s) => s.replace(/&([a-z]+);/g, (a, b) => entities[b] ?? a).trim().replace(/\s+/g, " "))
    .filter(Boolean);
  assert.deepEqual([...new Set(texts.filter((text) => !spanish[text] && !protectedText.has(text)))], []);
});
