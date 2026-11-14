import { spanish } from "./translations.js";

export const LANGUAGE_STORAGE_KEY = "atlanta-guide-language";
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
const englishBySpanish = new Map(Object.entries(spanish).map(([en, es]) => [es, en]));
const normalize = (text) => text.trim().replace(/\s+/g, " ");
const toEnglish = (text) => englishBySpanish.get(normalize(text)) ?? normalize(text);
let language = "en";
try {
  if (localStorage.getItem(LANGUAGE_STORAGE_KEY) === "es") language = "es";
} catch {
  // Language switching still works when browser storage is unavailable.
}

export const getLanguage = () => language;
export const translate = (english) => language === "es" ? spanish[english] ?? english : english;

export function applyLanguage() {
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style, [data-language-label], [data-chat-content]")) continue;
    if (!originalText.has(node)) {
      const source = node.textContent;
      originalText.set(node, { source, english: toEnglish(source) });
    }
    const { source, english } = originalText.get(node);
    const translated = translate(english);
    if (spanish[english]) {
      node.textContent = source.replace(/\S[\s\S]*\S|\S/, translated);
    }
  }
  for (const element of document.querySelectorAll("[alt], [aria-label], [placeholder], meta[content]")) {
    let originals = originalAttributes.get(element);
    if (!originals) {
      originals = {};
      for (const attr of ["alt", "aria-label", "placeholder", "content"]) {
        if (element.hasAttribute(attr)) originals[attr] = toEnglish(element.getAttribute(attr));
      }
      originalAttributes.set(element, originals);
    }
    for (const [attr, english] of Object.entries(originals)) {
      if (spanish[english]) element.setAttribute(attr, translate(english));
    }
  }
  const toggle = document.getElementById("language-toggle");
  toggle.setAttribute("aria-pressed", String(language === "es"));
  toggle.setAttribute("aria-label", translate(language === "es" ? "Switch to English" : "Switch to Spanish"));
}

export function setLanguage(nextLanguage) {
  language = nextLanguage === "es" ? "es" : "en";
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Optional storage. */ }
  applyLanguage();
  document.dispatchEvent(new CustomEvent("guide-language-change"));
}

document.getElementById("language-toggle").addEventListener("click", () => {
  setLanguage(language === "es" ? "en" : "es");
});
applyLanguage();
