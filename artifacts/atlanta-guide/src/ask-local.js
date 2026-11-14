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
  speaker.textContent = role === "question" ? "You" : "Your AI Atlanta guide";
  const body = document.createElement("p");
  // Never render visitor input or model output as HTML.
  body.textContent = text;
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
    questionInput.setCustomValidity("Please type a question first.");
    questionInput.reportValidity();
    return;
  }
  errorMessage.hidden = true;
  submitButton.disabled = true;
  questionInput.readOnly = true;
  submitButton.textContent = "Asking…";
  form.setAttribute("aria-busy", "true");
  status.textContent = "Your guide is thinking…";
  addMessage(question, "question");
  try {
    // Same-origin Express endpoint; no provider credentials exist in this module.
    const response = await fetch(`${import.meta.env.BASE_URL}api/ask-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(35000),
    });
    const data = await response.json();
    if (!response.ok || typeof data.answer !== "string" || !data.answer.trim()) {
      throw new Error(response.status === 429 ? "BUSY" : "UNAVAILABLE");
    }
    addMessage(data.answer, "answer");
    questionInput.value = "";
  } catch (error) {
    errorMessage.textContent = error.message === "BUSY"
      ? "A few visitors are chatting right now. Please give us a minute and try again."
      : "Sorry, our AI guide is taking a little break. Please try again in a moment, or check the official site for the place you’re visiting.";
    errorMessage.hidden = false;
  } finally {
    status.textContent = "";
    submitButton.disabled = false;
    questionInput.readOnly = false;
    submitButton.textContent = "Ask the guide";
    form.removeAttribute("aria-busy");
    questionInput.focus({ preventScroll: true });
  }
});

questionInput.addEventListener("input", () => questionInput.setCustomValidity(""));
