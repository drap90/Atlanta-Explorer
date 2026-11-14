// Build-time extraction keeps the published page as the only source of facts.
export function extractGuideFacts(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) throw new Error("The Atlanta guide has no main content.");
  const facts = main.split(/<section\b[^>]*\bid="ask-local"/i)[0]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z]+);/gi, (entity, name) => ({
      amp: "&", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
      middot: "·", deg: "°", lt: "<", gt: ">",
    })[name] ?? entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
  if (facts.length < 500) throw new Error("Atlanta guide facts are unexpectedly empty.");
  return facts;
}
