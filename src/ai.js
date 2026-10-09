import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-ai.js";

const MODEL_NAME = "gemini-2.5-flash";
const SYSTEM_INSTRUCTION = [
  "Ты NOVA AI — дружелюбный, полезный ИИ-помощник внутри NOVA Messenger.",
  "Отвечай на языке пользователя. Помогай с вопросами, учёбой, программированием, идеями и написанием текстов.",
  "Если не уверен в факте, честно скажи об этом. Не утверждай, что выполнял действия вне чата.",
  "Не проси у пользователя пароли, коды входа или секретные ключи.",
  "Соблюдай безопасность подростков: не создавай откровенный сексуальный контент и не помогай с опасными действиями.",
  "Используй понятное форматирование и не делай ответ длиннее, чем нужно."
].join("\n");

function storageKey(uid) { return "nova-ai-history-v1:" + uid; }

function readHistory(uid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(uid)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && (item.role === "user" || item.role === "model") && typeof item.text === "string")
      .slice(-40).map(item => ({role:item.role, text:item.text}));
  } catch (_) { return []; }
}

function saveHistory(uid, history) {
  try { localStorage.setItem(storageKey(uid), JSON.stringify(history.slice(-40))); }
  catch (_) {}
}

export function renderAIPage({firebaseApp, user, toast}) {
  const content = document.querySelector("#content");
  if (!content) return;
  let history = readHistory(user.uid);
  let model = null;
  let busy = false;

  content.innerHTML = `
    <div class="ai-page">
      <div class="ai-heading">
        <div class="ai-title-wrap">
          <div class="ai-mark">✦</div>
          <div><h3>NOVA AI</h3><p>Твой помощник для идей, вопросов и кода</p></div>
        </div>
        <button class="ai-clear" id="aiNewChat" type="button">＋ Новый чат</button>
      </div>
      <div class="ai-chat-panel" id="aiMessages" aria-live="polite"></div>
      <div class="ai-status" id="aiStatus" role="status"></div>
      <form class="ai-composer" id="aiForm">
        <textarea id="aiInput" maxlength="6000" rows="2" placeholder="Спроси что-нибудь у NOVA AI…" aria-label="Сообщение для NOVA AI"></textarea>
        <button class="ai-send" id="aiSend" type="submit" aria-label="Отправить сообщение">➤</button>
      </form>
      <p class="ai-footnote">Ответы создаются ИИ и могут содержать ошибки. История этого чата хранится локально на этом устройстве.</p>
    </div>`;

  const messages = content.querySelector("#aiMessages");
  const form = content.querySelector("#aiForm");
  const input = content.querySelector("#aiInput");
  const sendButton = content.querySelector("#aiSend");
  const status = content.querySelector("#aiStatus");

  function renderHistory() {
    messages.replaceChildren();
    if (!history.length) {
      const welcome = document.createElement("div");
      welcome.className = "ai-welcome";
      welcome.innerHTML = '<div class="ai-welcome-mark">✦</div><h4>Привет! Я NOVA AI</h4><p>Могу помочь разобраться в сложной теме, придумать проект, написать или объяснить код. С чего начнём?</p><div class="ai-suggestions"><button class="ai-suggestion" type="button">Помоги создать игру в Roblox Studio</button><button class="ai-suggestion" type="button">Объясни сложную тему простыми словами</button><button class="ai-suggestion" type="button">Придумай новые функции для NOVA</button><button class="ai-suggestion" type="button">Помоги найти ошибку в коде</button></div>';
      messages.append(welcome);
      welcome.querySelectorAll(".ai-suggestion").forEach(button => button.addEventListener("click", () => {
        input.value = button.textContent;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }));
      return;
    }
    history.forEach(item => {
      const row = document.createElement("div");
      row.className = "ai-message " + (item.role === "user" ? "user" : "assistant");
      const label = document.createElement("div");
      label.className = "ai-message-label";
      label.textContent = item.role === "user" ? "Ты" : "NOVA AI";
      const body = document.createElement("div");
      body.className = "ai-message-body";
      body.textContent = item.text;
      row.append(label, body);
      messages.append(row);
    });
    messages.scrollTop = messages.scrollHeight;
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    input.disabled = value;
    sendButton.textContent = value ? "…" : "➤";
  }

  async function getModel() {
    if (!model) {
      const ai = getAI(firebaseApp, {backend:new GoogleAIBackend()});
      model = getGenerativeModel(ai, {
        model:MODEL_NAME,
        systemInstruction:SYSTEM_INSTRUCTION,
        generationConfig:{temperature:0.7, maxOutputTokens:1200}
      });
    }
    return model;
  }

  async function sendMessage(value) {
    const prompt = String(value || "").trim();
    if (!prompt || busy) return;
    history.push({role:"user", text:prompt});
    history = history.slice(-40);
    saveHistory(user.uid, history);
    renderHistory();
    input.value = "";
    status.textContent = "";
    setBusy(true);

    const pending = document.createElement("div");
    pending.className = "ai-message assistant pending";
    const pendingLabel = document.createElement("div");
    pendingLabel.className = "ai-message-label";
    pendingLabel.textContent = "NOVA AI";
    const pendingBody = document.createElement("div");
    pendingBody.className = "ai-message-body";
    pendingBody.textContent = "Думаю над ответом…";
    pending.append(pendingLabel, pendingBody);
    messages.append(pending);
    messages.scrollTop = messages.scrollHeight;

    try {
      const activeModel = await getModel();
      const conversation = history.slice(-20).map(item => ({role:item.role, parts:[{text:item.text}]}));
      const result = await activeModel.generateContent(conversation);
      const answer = result.response.text().trim();
      if (!answer) throw new Error("ИИ вернул пустой ответ. Попробуй ещё раз.");
      history.push({role:"model", text:answer});
      history = history.slice(-40);
      saveHistory(user.uid, history);
      renderHistory();
    } catch (error) {
      pending.remove();
      if (history.length && history[history.length - 1].role === "user" && history[history.length - 1].text === prompt) {
        history.pop();
        saveHistory(user.uid, history);
      }
      renderHistory();
      input.value = prompt;
      const raw = String(error && (error.message || error) || "");
      if (/API key|API_KEY|not been used|disabled|enable.*API|permission|403|404/i.test(raw)) {
        status.textContent = "ИИ пока не подключён к проекту Firebase. Выполни настройку из docs/NOVA-AI-SETUP.md.";
      } else if (/quota|429|resource.exhausted/i.test(raw)) {
        status.textContent = "Достигнут временный лимит запросов ИИ. Подожди немного и попробуй снова.";
      } else if (/network|fetch|offline|failed to fetch/i.test(raw)) {
        status.textContent = "Не удалось подключиться к ИИ. Проверь интернет и попробуй ещё раз.";
      } else {
        status.textContent = "Не удалось получить ответ. Попробуй ещё раз. " + raw.slice(0,180);
      }
      if (typeof toast === "function") toast("NOVA AI не смог ответить.", true);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  content.querySelector("#aiNewChat").addEventListener("click", () => {
    history = [];
    saveHistory(user.uid, history);
    status.textContent = "";
    renderHistory();
    input.focus();
  });
  renderHistory();
}
