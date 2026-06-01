const state = {
  participant_id: localStorage.getItem("participant_id") || null,
  session_id: localStorage.getItem("session_id") || null,
  group_condition: localStorage.getItem("group_condition") || null,
  startTime: Date.now(),
  currentStep: 0,
  chatMessages: [],
  turn: 0,
  lastAssistantText: "",
  eventBuffer: [],
  activeAois: new Map(),
  hoverStarts: new Map(),
  maxScrollDepth: 0,
  selectedChoice: null
};

const screens = [
  "login",
  "consent",
  "pretest",
  "task",
  "cognitive",
  "scales",
  "review",
  "end"
];

const scaleItems = [
  ["perceived_usefulness_1", "这个AI产品对完成任务有帮助。"],
  ["perceived_usefulness_2", "这个AI产品能提高我的效率。"],
  ["cognitive_load_1", "完成这个任务让我感到费力。"],
  ["cognitive_load_2", "我需要投入较多精力理解页面信息。"],
  ["trust_1", "我认为这个AI产品的输出是可信的。"],
  ["personalization_1", "我觉得这个AI产品能够理解我的需求。"],
  ["satisfaction_1", "总体而言，我对刚才的体验感到满意。"],
  ["continuance_1", "未来我愿意继续使用类似AI产品。"],
  ["willingness_to_pay_1", "如果价格合适，我愿意为类似AI产品付费。"]
];

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function showScreen(name) {
  $all(".screen").forEach(s => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
  state.currentStep = screens.indexOf(name);
  $("#progressText").textContent = `Step ${state.currentStep} / ${screens.length - 1}`;
  logEvent("screen_view", name, { screen: name });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateSessionBadge() {
  const badge = $("#sessionBadge");
  if (!state.participant_id) {
    badge.textContent = "未登录";
  } else {
    badge.textContent = `${state.participant_id.slice(0, 8)} / ${state.group_condition || ""}`;
  }
}

async function api(path, body, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function basePayload() {
  return {
    participant_id: state.participant_id,
    session_id: state.session_id
  };
}

function enqueueEvent(event_type, event_target, payload = {}, event_value = null) {
  if (!state.participant_id || !state.session_id) return;
  state.eventBuffer.push({
    event_type,
    event_target,
    event_value,
    payload,
    page: location.pathname,
    timestamp_client: new Date().toISOString()
  });
  if (state.eventBuffer.length >= 10) flushEvents();
}

function logEvent(event_type, event_target, payload = {}, event_value = null) {
  enqueueEvent(event_type, event_target, payload, event_value);
}

async function flushEvents() {
  if (!state.participant_id || !state.session_id || state.eventBuffer.length === 0) return;
  const events = state.eventBuffer.splice(0, state.eventBuffer.length);
  try {
    await api("/api/batch-events", { ...basePayload(), events });
  } catch (err) {
    console.warn("Failed to flush events", err);
    state.eventBuffer.unshift(...events);
  }
}

setInterval(flushEvents, 3000);

window.addEventListener("beforeunload", () => {
  const events = state.eventBuffer.splice(0, state.eventBuffer.length);
  if (events.length && state.participant_id && state.session_id) {
    const blob = new Blob([JSON.stringify({ ...basePayload(), events })], { type: "application/json" });
    navigator.sendBeacon("/api/batch-events", blob);
  }
});

document.addEventListener("visibilitychange", () => {
  logEvent(document.hidden ? "tab_blur" : "tab_focus", "document", { hidden: document.hidden });
});

document.addEventListener("click", (e) => {
  const target = e.target.closest("button, a, input, select, textarea, [data-aoi]");
  if (!target) return;
  const desc = target.id || target.dataset?.aoi || target.dataset?.choice || target.name || target.tagName;
  logEvent("click", desc, {
    tag: target.tagName,
    text: (target.innerText || target.value || "").slice(0, 120)
  });
});

window.addEventListener("scroll", throttle(() => {
  const doc = document.documentElement;
  const depth = (window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight);
  if (depth > state.maxScrollDepth + 0.05) {
    state.maxScrollDepth = depth;
    logEvent("scroll_depth", "window", { depth: Number(depth.toFixed(3)) });
  }
}, 800));

function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

function setupAoiTracking() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.aoi;
      if (!id) continue;
      if (entry.isIntersecting) {
        if (!state.activeAois.has(id)) {
          state.activeAois.set(id, Date.now());
          logEvent("aoi_enter", id, { ratio: entry.intersectionRatio });
        }
      } else {
        const start = state.activeAois.get(id);
        if (start) {
          const dwell_ms = Date.now() - start;
          state.activeAois.delete(id);
          logEvent("aoi_leave", id, { dwell_ms, ratio: entry.intersectionRatio });
        }
      }
    }
  }, { threshold: [0.25, 0.5, 0.75] });

  $all("[data-aoi]").forEach(el => {
    observer.observe(el);
    el.addEventListener("mouseenter", () => {
      state.hoverStarts.set(el.dataset.aoi, Date.now());
      logEvent("hover_enter", el.dataset.aoi);
    });
    el.addEventListener("mouseleave", () => {
      const start = state.hoverStarts.get(el.dataset.aoi);
      if (start) {
        logEvent("hover_leave", el.dataset.aoi, { hover_ms: Date.now() - start });
        state.hoverStarts.delete(el.dataset.aoi);
      }
    });
  });
}

function renderScaleItems() {
  const container = $("#scaleItems");
  container.innerHTML = scaleItems.map(([id, text]) => `
    <div class="scale-row">
      <div>${text}</div>
      <div class="scale-options" data-scale-id="${id}">
        ${[1,2,3,4,5].map(v => `
          <label><input type="radio" name="${id}" value="${v}" /> ${v}</label>
        `).join("")}
      </div>
    </div>
  `).join("");
}

async function login() {
  const client_meta = {
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };

  const data = await api("/api/login", {
    login_code: $("#loginCode").value.trim() || null,
    client_meta
  });

  state.participant_id = data.participant_id;
  state.session_id = data.session_id;
  state.group_condition = data.group_condition;

  localStorage.setItem("participant_id", state.participant_id);
  localStorage.setItem("session_id", state.session_id);
  localStorage.setItem("group_condition", state.group_condition);

  updateSessionBadge();
  showScreen("consent");
}

async function submitConsent() {
  const consent = $("#consentCheck").checked;
  if (!consent) {
    alert("请先勾选知情同意。");
    return;
  }
  await api("/api/consent", { ...basePayload(), consent: true });
  showScreen("pretest");
}

function collectByDataAttr(attr) {
  const obj = {};
  $all(`[${attr}]`).forEach(el => {
    obj[el.getAttribute(attr)] = el.value;
  });
  return obj;
}

async function submitPretest() {
  const answers = collectByDataAttr("data-pretest");
  await api("/api/survey", {
    ...basePayload(),
    survey_name: "pretest",
    answers
  });
  showScreen("task");
}

function addMessage(role, text) {
  state.chatMessages.push({ role, content: text });
  const box = $("#chatMessages");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;

  state.turn += 1;
  const turn_id = state.turn;
  addMessage("user", text);
  input.value = "";
  logEvent("prompt_submit", "chat", { turn_id, char_count: text.length });

  $("#btnSendChat").disabled = true;
  try {
    const data = await api("/api/chat", {
      ...basePayload(),
      turn_id,
      messages: state.chatMessages,
      payload: {
        selected_choice: state.selectedChoice,
        current_step: "task"
      }
    });
    state.lastAssistantText = data.answer;
    addMessage("assistant", data.answer);
    logEvent("ai_response_received", "chat", { turn_id, latency_ms: data.latency_ms });
  } catch (err) {
    addMessage("assistant", "AI请求失败，请稍后再试。");
    logEvent("ai_response_error", "chat", { turn_id, error: String(err) });
  } finally {
    $("#btnSendChat").disabled = false;
  }
}

async function regenerate() {
  const lastUser = [...state.chatMessages].reverse().find(m => m.role === "user");
  if (!lastUser) {
    alert("请先发送一个问题。");
    return;
  }
  logEvent("regenerate", "chat", { last_user_prompt: lastUser.content.slice(0, 100) });
  state.chatMessages.push({ role: "user", content: `请重新生成上一问题的回答：${lastUser.content}` });
  await sendChatFromState();
}

async function sendChatFromState() {
  state.turn += 1;
  const turn_id = state.turn;
  $("#btnSendChat").disabled = true;
  try {
    const data = await api("/api/chat", {
      ...basePayload(),
      turn_id,
      messages: state.chatMessages,
      payload: { regenerated: true }
    });
    state.lastAssistantText = data.answer;
    addMessage("assistant", data.answer);
  } catch (err) {
    addMessage("assistant", "AI请求失败，请稍后再试。");
  } finally {
    $("#btnSendChat").disabled = false;
  }
}

async function copyLast() {
  if (!state.lastAssistantText) {
    alert("还没有AI回复可复制。");
    return;
  }
  await navigator.clipboard.writeText(state.lastAssistantText);
  logEvent("copy", "ai_last_response", { char_count: state.lastAssistantText.length });
  alert("已复制上一条AI回复。");
}

function selectChoice(btn) {
  $all(".choice").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  state.selectedChoice = btn.dataset.choice;
  logEvent("choice_select", "intermediate_choice", { choice: state.selectedChoice });
}

async function finishTask() {
  for (const [id, start] of state.activeAois.entries()) {
    logEvent("aoi_leave", id, { dwell_ms: Date.now() - start, reason: "task_done" });
  }
  state.activeAois.clear();

  await flushEvents();
  showScreen("cognitive");
}

function collectCognitive() {
  const answers = collectByDataAttr("data-cog");
  answers.recognition = $all("[data-cog-group='recognition'] input:checked").map(x => x.value);
  return answers;
}

async function submitCognitive() {
  await api("/api/survey", {
    ...basePayload(),
    survey_name: "cognitive",
    answers: collectCognitive()
  });
  showScreen("scales");
}

function collectScales() {
  const answers = {};
  for (const [id] of scaleItems) {
    const checked = document.querySelector(`input[name="${id}"]:checked`);
    answers[id] = checked ? Number(checked.value) : null;
  }
  return answers;
}

async function submitScales() {
  const answers = collectScales();
  const missing = Object.entries(answers).filter(([,v]) => v == null);
  if (missing.length > 0) {
    alert("请完成所有量表题。");
    return;
  }
  await api("/api/survey", {
    ...basePayload(),
    survey_name: "post_scales",
    answers
  });
  showScreen("review");
}

async function submitReview() {
  const review_text = $("#openReview").value.trim();
  if (review_text.length < 20) {
    alert("开放评价建议至少20个字。");
    return;
  }

  await api("/api/review", {
    ...basePayload(),
    review_text,
    meta: {
      selected_choice: state.selectedChoice,
      chat_turns: state.turn,
      max_scroll_depth: state.maxScrollDepth
    }
  });

  await api("/api/finish", {
    ...basePayload(),
    total_duration_ms: Date.now() - state.startTime,
    payload: {
      selected_choice: state.selectedChoice,
      chat_turns: state.turn,
      max_scroll_depth: state.maxScrollDepth
    }
  });

  await flushEvents();
  showScreen("end");
}

function bindEvents() {
  $("#btnLogin").addEventListener("click", () => login().catch(err => alert(err.message)));
  $("#btnConsent").addEventListener("click", () => submitConsent().catch(err => alert(err.message)));
  $("#btnPretest").addEventListener("click", () => submitPretest().catch(err => alert(err.message)));
  $("#btnSendChat").addEventListener("click", () => sendChat());
  $("#chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendChat();
  });
  $("#btnRegenerate").addEventListener("click", () => regenerate());
  $("#btnCopyLast").addEventListener("click", () => copyLast());
  $all(".choice").forEach(btn => btn.addEventListener("click", () => selectChoice(btn)));
  $("#btnTaskDone").addEventListener("click", () => finishTask());
  $("#btnCognitive").addEventListener("click", () => submitCognitive().catch(err => alert(err.message)));
  $("#btnScales").addEventListener("click", () => submitScales().catch(err => alert(err.message)));
  $("#btnSubmitReview").addEventListener("click", () => submitReview().catch(err => alert(err.message)));
}

function init() {
  renderScaleItems();
  setupAoiTracking();
  bindEvents();
  updateSessionBadge();
  showScreen("login");
}

init();
