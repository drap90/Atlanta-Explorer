---
name: Guide implementation constraints
description: User requirements for the Atlanta tourist guide's implementation format.
---

Keep the Atlanta guide in plain HTML and CSS with `<!DOCTYPE html>`, lowercase tags, double-quoted attributes, and clean indentation.

**Why:** The user explicitly requested this format while selecting a web artifact.

**How to apply:** Preserve the static page format when updating the guide; the artifact scaffold is not permission to convert its content to React.

The user subsequently requested an interactive "Ask a Local" section. Keep its browser code minimal, call Gemini only from Express using `GEMINI_API_KEY`, and restrict answers to the page's facts.

**Why:** The user explicitly required a server-only key, page-grounded answers under 120 words, AI disclosure when asked, and no changes to the other sections.

**How to apply:** Keep the existing guide sections in HTML/CSS; do not turn the chatbot addition into a React migration or a general-purpose assistant.
