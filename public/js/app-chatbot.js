(function () {
  const root = document.getElementById("medilink-assistant-root");
  if (!root) return;

  const state = {
    open: false,
    loading: false,
  };

  const quickPrompts = [
    "Explain current page",
    "Summarize my record",
    "Show my latest vital signs",
  ];

  const shell = document.createElement("div");
  shell.className = "assistant-shell";
  shell.innerHTML = `
    <button type="button" class="assistant-launcher" aria-expanded="false" aria-controls="assistant-panel">
      <span class="assistant-launcher-icon">AI</span>
      <span class="assistant-launcher-label">Assistant</span>
    </button>
    <section class="assistant-panel" id="assistant-panel" hidden>
      <header class="assistant-panel-header">
        <div>
          <strong>MediLink Assistant</strong>
          <p>Patient record helper</p>
        </div>
        <button type="button" class="assistant-close" aria-label="Close assistant">×</button>
      </header>
      <div class="assistant-messages" aria-live="polite"></div>
      <div class="assistant-quick-prompts"></div>
      <form class="assistant-form">
        <textarea class="assistant-input" rows="2" placeholder="Ask about your record, this page, recent updates, or important information..."></textarea>
        <div class="assistant-form-actions">
          <span class="assistant-status"></span>
          <button type="submit" class="assistant-send">Send</button>
        </div>
      </form>
    </section>
  `;

  root.appendChild(shell);

  const launcher = shell.querySelector(".assistant-launcher");
  const panel = shell.querySelector(".assistant-panel");
  const closeBtn = shell.querySelector(".assistant-close");
  const messages = shell.querySelector(".assistant-messages");
  const promptsWrap = shell.querySelector(".assistant-quick-prompts");
  const form = shell.querySelector(".assistant-form");
  const input = shell.querySelector(".assistant-input");
  const sendBtn = shell.querySelector(".assistant-send");
  const statusText = shell.querySelector(".assistant-status");

  function setLoading(nextLoading) {
    state.loading = nextLoading;
    sendBtn.disabled = nextLoading;
    input.disabled = nextLoading;
    statusText.textContent = nextLoading ? "Thinking..." : "";
  }

  function appendMessage(role, text) {
    const message = document.createElement("div");
    message.className = `assistant-message assistant-message-${role}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderSuggestions(items) {
    promptsWrap.innerHTML = "";

    (items || []).slice(0, 3).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-quick-prompt";
      button.textContent = item;
      button.addEventListener("click", function () {
        input.value = item;
        form.requestSubmit();
      });
      promptsWrap.appendChild(button);
    });
  }

  async function sendMessage(messageText) {
    const message = String(messageText || "").trim();
    if (!message || state.loading) return;

    appendMessage("user", message);
    input.value = "";
    setLoading(true);

    try {
      const response = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          pathname: window.location.pathname,
          pageTitle: document.title,
        }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = await response.json();
      appendMessage("assistant", data.reply || "I could not generate a response right now.");
      renderSuggestions(data.suggestions && data.suggestions.length ? data.suggestions : quickPrompts);
    } catch (error) {
      appendMessage(
        "assistant",
        "I could not reach the assistant service right now. Please try again from the current page."
      );
      renderSuggestions(quickPrompts);
    } finally {
      setLoading(false);
      input.focus();
    }
  }

  function openPanel() {
    state.open = true;
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closePanel() {
    state.open = false;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
  }

  launcher.addEventListener("click", function () {
    if (state.open) {
      closePanel();
    } else {
      openPanel();
    }
  });

  closeBtn.addEventListener("click", closePanel);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  appendMessage(
    "assistant",
    "Hello — I can help you search your record, summarize available information, explain fields and statuses, guide you through the portal, highlight important or missing details, and show your latest vital signs when they are available."
  );
  renderSuggestions(quickPrompts);
})();
