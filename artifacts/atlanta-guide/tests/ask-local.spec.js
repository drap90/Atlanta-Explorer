import { test as base, expect } from "@playwright/test";

const UNAVAILABLE = "Sorry, our AI guide is taking a little break. Please try again in a moment, or check the official site for the place you’re visiting.";
const QUESTION = "What can I do in Atlanta for free?";
const ANSWER = "Walk the Atlanta BeltLine or visit Piedmont Park.";

// Fail closed: an omitted stub must never reach the real API or spend AI allowance.
// External fonts, telemetry and other third-party requests are unnecessary here.
const test = base.extend({
  page: async ({ page, context, baseURL }, use) => {
    const unexpectedApi = [];
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const origin = new URL(baseURL).origin;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        unexpectedApi.push(`${route.request().method()} ${url.pathname}`);
        return route.abort("blockedbyclient");
      }
      if (url.origin !== origin) return route.abort("blockedbyclient");
      return route.continue();
    });
    await use(page);
    expect(unexpectedApi, "Every API call must have an explicit controlled response").toEqual([]);
    expect(pageErrors, "The real page must not throw uncaught JavaScript errors").toEqual([]);
  },
});

const input = (page) => page.getByRole("textbox", { name: "Your Atlanta question" });
const submit = (page) => page.getByRole("button", { name: "Ask the guide", exact: true });
const content = (page, role) => page.locator(`.local-${role} [data-chat-content]`);

async function openChat(page) {
  await page.goto("./#ask-local");
  await expect(page.getByRole("heading", { name: "Ask a Local", exact: true })).toBeVisible();
  await expect(input(page)).toBeEditable();
}

async function mockApi(page, respond) {
  const requests = [];
  await page.route("**/api/ask-local", async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      contentType: request.headers()["content-type"],
      body: request.postDataJSON(),
    });
    await respond(route, requests.length);
  });
  return requests;
}

async function expectReady(page) {
  await expect(submit(page)).toBeEnabled();
  await expect(input(page)).toBeEditable();
  await expect(input(page)).toBeFocused();
  await expect(page.locator("#local-form")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status")).toBeEmpty();
}

test("shows a successful answer, sends trimmed input, and resets the form", async ({ page }) => {
  const requests = await mockApi(page, (route) => route.fulfill({ json: { answer: ANSWER } }));
  await openChat(page);
  await expect(page.getByRole("log", { name: "Questions and AI answers" })).toHaveAttribute("aria-live", "polite");
  await input(page).fill(`  ${QUESTION}  `);
  await submit(page).click();
  await expect(content(page, "question")).toHaveText(QUESTION);
  await expect(content(page, "answer")).toHaveText(ANSWER);
  await expect(input(page)).toHaveValue("");
  await expect(page.getByRole("alert")).toBeHidden();
  await expectReady(page);
  expect(requests).toEqual([{
    method: "POST",
    contentType: "application/json",
    body: { question: QUESTION, language: "en" },
  }]);
});

for (const value of ["", "   \n   "]) {
  test(`rejects ${value ? "whitespace-only" : "empty"} input without a request`, async ({ page }) => {
    await openChat(page);
    await input(page).fill(value);
    await submit(page).click();
    await expect(input(page)).toBeFocused();
    expect(await input(page).evaluate((element) => element.validity.valid)).toBe(false);
    if (value) {
      expect(await input(page).evaluate((element) => element.validationMessage)).toBe("Please type a question first.");
    } else {
      expect(await input(page).evaluate((element) => element.validity.valueMissing)).toBe(true);
    }
    await expect(content(page, "question")).toHaveCount(0);
    await expect(page.getByRole("status")).toBeEmpty();
    await expect(submit(page)).toBeEnabled();
    // Typing must clear custom validity so the visitor is not stuck.
    const requests = await mockApi(page, (route) => route.fulfill({ json: { answer: ANSWER } }));
    await input(page).fill(QUESTION);
    await submit(page).click();
    await expect(content(page, "answer")).toHaveText(ANSWER);
    expect(requests).toHaveLength(1);
  });
}

test("blocks duplicate submissions and announces the pending state", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requests = await mockApi(page, async (route) => {
    await pending;
    await route.fulfill({ json: { answer: ANSWER } });
  });
  await openChat(page);
  await input(page).fill(QUESTION);
  await submit(page).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole("button", { name: "Asking…" })).toBeDisabled();
  await expect(input(page)).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#local-form")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status")).toHaveText("Your guide is thinking…");
  // requestSubmit bypasses the disabled button, exercising the handler's guard too.
  await page.locator("#local-form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await input(page).press("Control+Enter");
  await expect(content(page, "question")).toHaveCount(1);
  release();
  await expect(content(page, "answer")).toHaveText(ANSWER);
  await expectReady(page);
  expect(requests).toHaveLength(1);
});

const failures = [
  { name: "server failure", status: 500, json: { error: "private internal detail" }, message: UNAVAILABLE },
  { name: "temporary unavailability", status: 503, json: { error: "Unavailable" }, message: UNAVAILABLE },
  {
    name: "busy response", status: 429, json: { error: "Busy" },
    message: "A few visitors are chatting right now. Please give us a minute and try again.",
  },
  {
    name: "daily allowance response", status: 429, json: { code: "DAILY_LIMIT_REACHED" },
    message: "Our AI guide has reached its daily allowance. Please try again after midnight UTC, or explore the recommendations on this page.",
  },
  { name: "missing answer", status: 200, json: {}, message: UNAVAILABLE },
  { name: "blank answer", status: 200, json: { answer: "  " }, message: UNAVAILABLE },
  { name: "non-text answer", status: 200, json: { answer: 42 }, message: UNAVAILABLE },
];

for (const failure of failures) {
  test(`handles ${failure.name}, retains the question, and allows retry`, async ({ page }) => {
    const requests = await mockApi(page, (route, count) => route.fulfill(count === 1
      ? { status: failure.status, json: failure.json }
      : { json: { answer: ANSWER } }));
    await openChat(page);
    await input(page).fill(QUESTION);
    await submit(page).click();
    await expect(page.getByRole("alert")).toHaveText(failure.message);
    await expect(input(page)).toHaveValue(QUESTION);
    await expect(content(page, "question")).toHaveText(QUESTION);
    await expect(content(page, "answer")).toHaveCount(0);
    await expectReady(page);
    await submit(page).click();
    await expect(content(page, "answer")).toHaveText(ANSWER);
    await expect(page.getByRole("alert")).toBeHidden();
    await expect(input(page)).toHaveValue("");
    await expectReady(page);
    expect(requests).toHaveLength(2);
  });
}

for (const failure of ["network disconnect", "invalid JSON"]) {
  test(`recovers from ${failure}`, async ({ page }) => {
    await mockApi(page, (route) => failure === "network disconnect"
      ? route.abort("connectionfailed")
      : route.fulfill({ contentType: "application/json", body: "{invalid" }));
    await openChat(page);
    await input(page).fill(QUESTION);
    await submit(page).click();
    await expect(page.getByRole("alert")).toHaveText(UNAVAILABLE);
    await expect(input(page)).toHaveValue(QUESTION);
    await expectReady(page);
  });
}

test("aborts a timed-out request, retains the question, and permits retry", async ({ page }) => {
  // Keep native fetch/abort behavior, but shorten only the browser's timeout.
  // Record the supplied duration to guard the production 35-second deadline.
  await page.addInitScript(() => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) => {
      window.testTimeoutDuration = milliseconds;
      const signal = nativeTimeout(100);
      signal.addEventListener("abort", () => { window.testAbortName = signal.reason.name; });
      return signal;
    };
  });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const requests = await mockApi(page, async (route, count) => {
    if (count === 1) await pending;
    await route.fulfill({ json: { answer: ANSWER } });
  });
  await openChat(page);
  await input(page).fill(QUESTION);
  await submit(page).click();
  await expect(page.getByRole("alert")).toHaveText(UNAVAILABLE);
  expect(await page.evaluate(() => window.testTimeoutDuration)).toBe(35000);
  expect(await page.evaluate(() => window.testAbortName)).toBe("TimeoutError");
  await expect(input(page)).toHaveValue(QUESTION);
  await expect(content(page, "answer")).toHaveCount(0);
  await expectReady(page);
  release();
  await submit(page).click();
  await expect(content(page, "answer")).toHaveText(ANSWER);
  await expect(content(page, "answer")).toHaveCount(1);
  await expect(page.getByRole("alert")).toBeHidden();
  await expectReady(page);
  expect(requests).toHaveLength(2);
});

test("renders both visitor input and AI output as literal text, never HTML", async ({ page }) => {
  const markup = '<img src=x onerror="window.chatInjected=true"><script>window.chatInjected=true</script><b>Atlanta & friends</b>';
  await mockApi(page, (route) => route.fulfill({ json: { answer: markup } }));
  await openChat(page);
  await input(page).fill(markup);
  await submit(page).click();
  await expect(content(page, "question")).toHaveText(markup);
  await expect(content(page, "answer")).toHaveText(markup);
  await expect(page.locator("#local-messages img, #local-messages script, #local-messages b")).toHaveCount(0);
  expect(await page.evaluate(() => window.chatInjected)).toBeUndefined();
});

test("supports keyboard entry, multiline questions, tabbing, and Enter submission", async ({ page }) => {
  const requests = await mockApi(page, (route) => route.fulfill({ json: { answer: ANSWER } }));
  await openChat(page);
  await input(page).focus();
  await page.keyboard.type("What is free?");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Can I walk there?");
  await expect(input(page)).toHaveValue("What is free?\nCan I walk there?");
  expect(requests).toHaveLength(0);
  await page.keyboard.press("Tab");
  await expect(submit(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(content(page, "answer")).toHaveText(ANSWER);
  await expectReady(page);
  expect(requests[0].body.question).toBe("What is free?\nCan I walk there?");
});

test("keeps the form and long messages within the viewport", async ({ page }) => {
  const longText = "Atlanta".repeat(140);
  await mockApi(page, (route) => route.fulfill({ json: { answer: longText } }));
  await openChat(page);
  await input(page).fill(longText);
  await submit(page).click();
  await expect(content(page, "answer")).toHaveText(longText);
  for (const selector of ["#ask-local", ".local-chat", "#local-question", "#local-submit", "#local-messages", "[data-chat-content]"]) {
    const elements = page.locator(selector);
    for (const element of await elements.all()) {
      const geometry = await element.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth, client: node.clientWidth, scroll: node.scrollWidth };
      });
      expect(geometry.width, selector).toBeGreaterThan(0);
      expect(geometry.left, selector).toBeGreaterThanOrEqual(-1);
      expect(geometry.right, selector).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.scroll, `${selector} should not overflow horizontally`).toBeLessThanOrEqual(geometry.client + 1);
    }
  }
  await input(page).scrollIntoViewIfNeeded();
  await expect(input(page)).toBeInViewport();
  await submit(page).scrollIntoViewIfNeeded();
  await expect(submit(page)).toBeInViewport();
});
