import { Router, type IRouter } from "express";
import { AskLocalBody, AskLocalResponse } from "@workspace/api-zod";
import { askGemini } from "../lib/ask-local";

const router: IRouter = Router();
const FRIENDLY_ERROR = "Sorry, our AI guide is taking a little break. Please try again in a moment, or check the official site for the place you’re visiting.";
// A bounded, per-instance cost guard. No questions or conversation data are retained.
let windowStart = Date.now();
let requestCount = 0;
let activeRequests = 0;

router.post("/ask-local", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = AskLocalBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.question.trim()) {
    res.status(400).json({ error: "Please enter an Atlanta question between 1 and 1,000 characters." });
    return;
  }
  // Block browser calls coming from other sites without trusting forwarded IPs.
  if (req.get("sec-fetch-site") === "cross-site") {
    res.status(400).json({ error: "Please ask your question from the Atlanta guide." });
    return;
  }
  if (Date.now() - windowStart >= 60000) {
    windowStart = Date.now();
    requestCount = 0;
  }
  if (requestCount >= 30 || activeRequests >= 3) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "A few visitors are chatting right now. Please give us a minute and try again." });
    return;
  }
  requestCount += 1;
  activeRequests += 1;
  try {
    const answer = await askGemini(parsed.data.question.trim(), parsed.data.language);
    res.json(AskLocalResponse.parse({ answer }));
  } catch (error) {
    const code = error instanceof Error && /^AI_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "AI_NETWORK_ERROR";
    req.log.warn({ code }, "Ask a Local could not complete an AI request");
    res.status(503).json({ error: FRIENDLY_ERROR });
  } finally {
    activeRequests -= 1;
  }
});

export default router;
