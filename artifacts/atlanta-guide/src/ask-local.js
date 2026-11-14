import { getLanguage, translate } from "./language.js";

const form = document.getElementById("local-form");
const questionInput = document.getElementById("local-question");
const submitButton = document.getElementById("local-submit");
const messages = document.getElementById("local-messages");
const status = document.getElementById("local-status");
const errorMessage = document.getElementById("local-error");

function addMessage(text, role) {
  const message = document.createElement("div");
  message.className = `local-message local-${role}`;
  const speaker = document.createElement("p");
  speaker.className = "local-speaker";
  speaker.textContent = translate(role === "question" ? "You" : "Your AI Atlanta guide");
  const body = document.createElement("p");
  // Never render visitor input or model output as HTML.
  body.textContent = text;
  body.setAttribute("data-chat-content", "");
  body.lang = getLanguage();
  message.append(speaker, body);
  messages.append(message);
  while (messages.children.length > 12) messages.firstElementChild.remove();
  messages.scrollTop = messages.scrollHeight;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  const question = questionInput.value.trim();
  if (!question) {
    questionInput.setCustomValidity(translate("Please type a question first."));
    questionInput.reportValidity();
    return;
  }
  errorMessage.hidden = true;
  submitButton.disabled = true;
  questionInput.readOnly = true;
  submitButton.textContent = translate("Asking…");
  form.setAttribute("aria-busy", "true");
  status.textContent = translate("Your guide is thinking…");
  addMessage(question, "question");
  try {
    // Same-origin Express endpoint; no provider credentials exist in this module.
    const response = await fetch(`${import.meta.env.BASE_URL}api/ask-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, language: getLanguage() }),
      signal: AbortSignal.timeout(35000),
    });
    const data = await response.json();
    if (!response.ok || typeof data.answer !== "string" || !data.answer.trim()) {
      if (response.status === 429 && data.code === "DAILY_LIMIT_REACHED") {
        throw new Error("DAILY_LIMIT_REACHED");
      }
      throw new Error(response.status === 429 ? "BUSY" : "UNAVAILABLE");
    }
    addMessage(data.answer, "answer");
    questionInput.value = "";
  } catch (error) {
    errorMessage.textContent = translate(error.message === "DAILY_LIMIT_REACHED"
      ? "Our AI guide has reached its daily allowance. Please try again after midnight UTC, or explore the recommendations on this page."
      : error.message === "BUSY"
      ? "A few visitors are chatting right now. Please give us a minute and try again."
      : "Sorry, our AI guide is taking a little break. Please try again in a moment, or check the official site for the place you’re visiting.");
    errorMessage.hidden = false;
  } finally {
    status.textContent = "";
    submitButton.disabled = false;
    questionInput.readOnly = false;
    submitButton.textContent = translate("Ask the guide");
    form.removeAttribute("aria-busy");
    questionInput.focus({ preventScroll: true });
  }
});

questionInput.addEventListener("input", () => questionInput.setCustomValidity(""));
document.addEventListener("guide-language-change", () => {
  questionInput.setCustomValidity("");
  submitButton.textContent = translate(submitButton.disabled ? "Asking…" : "Ask the guide");
  status.textContent = submitButton.disabled ? translate("Your guide is thinking…") : "";
});
