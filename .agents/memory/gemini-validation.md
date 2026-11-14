---
name: Gemini availability validation
description: Validate an actual generation call rather than treating model discovery as proof of readiness.
---

Validate a real generation request with the app's configured credentials before declaring Gemini ready. A model appearing in discovery does not prove that generation requests will succeed.

**Why:** During this project's setup, listed models returned model-not-found or temporary-overload errors; a different listed model successfully generated answers.

**How to apply:** Distinguish provider availability errors from application errors, keep bounded retries and friendly failure messages, and never print credentials or raw provider error payloads during diagnosis.
