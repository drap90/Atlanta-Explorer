# Ask a Local browser regressions

Run from the workspace root:

```sh
pnpm --filter @workspace/atlanta-guide test:ui
```

Start the existing `artifacts/atlanta-guide: web` workflow first. Tests use the
shared preview proxy (`http://localhost:80`); the API workflow, database, secrets,
and Gemini are **not required**. To target another running copy of this guide,
set `ASK_LOCAL_TEST_BASE_URL` to its URL (include a trailing slash for a base path).
Never point this suite at a different product.

The suite runs the actual HTML, CSS and browser modules in desktop Chromium and
a 390×844 mobile Chromium viewport. Every API request must be explicitly mocked:
an unmatched API call is blocked and fails the test. Service workers are disabled,
third-party requests are blocked, and browser contexts/storage are fresh per test.
No live provider calls or server context/response-safeguard tests are included.

Coverage includes success and request shape, empty/whitespace validation, pending
accessibility state, duplicate submissions, server/busy/allowance errors, malformed
answers/JSON, network failure, native timeout abort, retained questions and retries,
literal text rendering, keyboard navigation and multiline entry, and horizontal
layout checks with long messages on both viewport sizes. The timeout test records
the production 35,000ms deadline but shortens the native signal to 100ms; it does
not wait 35 seconds or replace the application fetch implementation.

On Replit, the config uses the installed Chromium. Elsewhere, install it once:

```sh
pnpm --filter @workspace/atlanta-guide exec playwright install chromium
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible Chromium
binary. List cases without launching a browser with `test:ui:list`. Failures retain
screenshots and traces under `generated-artifacts/atlanta-guide-ui/` at the
workspace root (excluded from Git and publishing). Open a trace with:

```sh
pnpm --filter @workspace/atlanta-guide exec playwright show-trace /path/to/trace.zip
```
