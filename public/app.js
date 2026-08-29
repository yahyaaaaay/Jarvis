const powerBtn = document.getElementById("powerBtn");
const powerLabel = document.getElementById("powerLabel");
const wakeBtn = document.getElementById("wakeBtn");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const coreWrap = document.getElementById("coreWrap");
const barsEl = document.getElementById("bars");
const toastStack = document.getElementById("toastStack");

let pc = null;
let dc = null;
let micStream = null;
let audioEl = null;
let isActive = false;
let lastActivity = Date.now();
const AUTO_DISENGAGE_MS = 5 * 60 * 1000; // 5 minutes of silence

// ---- voice-reactive bars ----
const BAR_COUNT = 24;
for (let i = 0; i < BAR_COUNT; i++) barsEl.appendChild(document.createElement("span"));
const barEls = [...barsEl.children];

function setStatus(text) { statusEl.textContent = text; }

function logLine(who, text) {
  const div = document.createElement("div");
  div.className = "line" + (who === "you" ? " you" : " jarvis");
  div.innerHTML = `<span class="tag">${who === "you" ? "SIR YAHYA" : "JARVIS"}</span>${escapeHtml(text)}`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---- Toasts ----
function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ============ DASHBOARD ============
function dueBadgeClass(dueDate) {
  if (!dueDate) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "";
}

async function refreshDashboard() {
  const data = await (await fetch("/data")).json();

  // ---- Tasks ----
  const taskList = document.getElementById("taskList");
  taskList.innerHTML = "";
  data.personal.tasks
    .slice()
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
    .forEach((t) => {
      const li = document.createElement("li");
      li.className = "task" + (t.done ? " done" : "");
      const badge = t.dueDate ? `<span class="due-badge ${dueBadgeClass(t.dueDate)}">${t.dueDate}</span>` : "";
      li.innerHTML = `
        <span class="priority-dot ${t.priority || "normal"}"></span>
        <span class="item-text">${escapeHtml(t.text)}</span>
        ${badge}
        <span class="item-actions">
          <button class="icon-btn edit-btn" title="Edit">✎</button>
          <button class="icon-btn danger del-btn" title="Delete">×</button>
        </span>`;
      li.querySelector(".item-text").addEventListener("click", async () => {
        await fetch(`/dashboard/task/${t.id}/toggle`, { method: "POST" });
        refreshDashboard();
      });
      li.querySelector(".edit-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const newText = prompt("Edit task:", t.text);
        if (newText === null) return;
        await fetch(`/dashboard/personal/tasks/${t.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: newText }),
        });
        refreshDashboard();
      });
      li.querySelector(".del-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        await fetch(`/dashboard/personal/tasks/${t.id}`, { method: "DELETE" });
        refreshDashboard();
      });
      taskList.appendChild(li);
    });

  // ---- Goals ----
  renderSimpleList("goalList", data.personal.goals, "personal", "goals");

  // ---- University ----
  renderSimpleList("courseList", data.university.courses, "university", "courses", "name");
  renderNoteList("uniNoteList", data.university.notes, "university", "course");

  // ---- Work ----
  renderSimpleList("projectList", data.work.projects, "work", "projects", "name");
  renderNoteList("workNoteList", data.work.notes, "work", "project");

  // ---- Memory ----
  const memoryList = document.getElementById("memoryList");
  memoryList.innerHTML = "";
  document.getElementById("memCount").textContent = data.memory.facts.length ? `(${data.memory.facts.length})` : "";
  data.memory.facts.forEach((f) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="item-text">${escapeHtml(f.text)}</span>
      <span class="item-actions"><button class="icon-btn danger del-btn" title="Forget">×</button></span>`;
    li.querySelector(".del-btn").addEventListener("click", async () => {
      await fetch(`/dashboard/memory/${f.id}`, { method: "DELETE" });
      refreshDashboard();
    });
    memoryList.appendChild(li);
  });
}

function renderSimpleList(elId, items, domain, collection, field = "text") {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dot"></span><span class="item-text">${escapeHtml(item[field])}</span>
      <span class="item-actions"><button class="icon-btn danger del-btn" title="Delete">×</button></span>`;
    li.querySelector(".del-btn").addEventListener("click", async () => {
      await fetch(`/dashboard/${domain}/${collection}/${item.id}`, { method: "DELETE" });
      refreshDashboard();
    });
    el.appendChild(li);
  });
}

function renderNoteList(elId, notes, domain, parentKey) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  notes.forEach((n) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="note-meta">[${escapeHtml(n[parentKey])}]</span><span class="item-text">${escapeHtml(n.text)}</span>
      <span class="item-actions"><button class="icon-btn danger del-btn" title="Delete">×</button></span>`;
    li.querySelector(".del-btn").addEventListener("click", async () => {
      await fetch(`/dashboard/${domain}/notes/${n.id}`, { method: "DELETE" });
      refreshDashboard();
    });
    el.appendChild(li);
  });
}

document.getElementById("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("taskInput");
  const date = document.getElementById("taskDate");
  const priority = document.getElementById("taskPriority");
  if (!input.value.trim()) return;
  await fetch("/dashboard/task", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: input.value.trim(), dueDate: date.value || null, priority: priority.value }),
  });
  input.value = ""; date.value = ""; priority.value = "normal";
  refreshDashboard();
});

document.getElementById("goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("goalInput");
  if (!input.value.trim()) return;
  await runTool("add_goal", { text: input.value.trim() });
  input.value = ""; refreshDashboard();
});

document.getElementById("courseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("courseInput");
  if (!input.value.trim()) return;
  await runTool("add_course", { name: input.value.trim() });
  input.value = ""; refreshDashboard();
});

document.getElementById("projectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("projectInput");
  if (!input.value.trim()) return;
  await runTool("add_project", { name: input.value.trim() });
  input.value = ""; refreshDashboard();
});

refreshDashboard();

// ============ VOICE ENGINE ============
async function startJarvis({ silentBriefing = false } = {}) {
  if (isActive) return;
  setStatus("Initializing systems...");
  powerBtn.disabled = true;
  stopWakeWordListening(); // don't run wake-word recognition and the real mic connection at once

  try {
    const tokenRes = await fetch("/session");
    if (!tokenRes.ok) throw new Error("Could not create session");
    const sessionData = await tokenRes.json();
    const ephemeralKey = sessionData.value;

    pc = new RTCPeerConnection();
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(micStream.getTracks()[0]);
    setupMicVisualizer(micStream);

    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("message", handleServerEvent);
    dc.addEventListener("open", () => {
      setStatus("Online. Listening, Sir Yahya.");
      coreWrap.classList.add("listening");
      lastActivity = Date.now();
      maybeSendDailyBriefing();
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
    });
    if (!sdpResponse.ok) throw new Error("Realtime handshake failed");

    const answerSdp = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    isActive = true;
    powerBtn.classList.add("active");
    powerLabel.textContent = "DISENGAGE";
  } catch (err) {
    console.error(err);
    setStatus("Startup failed — check console.");
    toast("Jarvis failed to connect — check the console for details.", "error");
    stopJarvis();
  } finally {
    powerBtn.disabled = false;
  }
}

function stopJarvis(reason) {
  if (dc) dc.close();
  if (pc) pc.close();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  pc = null; dc = null; micStream = null; isActive = false;
  coreWrap.classList.remove("listening", "speaking");
  powerBtn.classList.remove("active");
  powerLabel.textContent = "ENGAGE";
  setStatus(reason || "Standing by, Sir Yahya.");
  if (wakeWordEnabled) startWakeWordListening();
}

powerBtn.addEventListener("click", () => (isActive ? stopJarvis() : startJarvis()));

// ---- Auto-disengage after prolonged silence ----
setInterval(() => {
  if (isActive && Date.now() - lastActivity > AUTO_DISENGAGE_MS) {
    toast("Auto-disengaged after 5 minutes of silence, Sir Yahya.");
    stopJarvis("Auto-disengaged (idle). Standing by, Sir Yahya.");
  }
}, 15000);

// ---- Daily briefing: once per calendar day, on first engage ----
function maybeSendDailyBriefing() {
  const today = new Date().toISOString().slice(0, 10);
  const last = localStorage.getItem("jarvis_last_briefing");
  if (last === today) return;
  localStorage.setItem("jarvis_last_briefing", today);
  setTimeout(() => {
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: "(Automatic daily check-in) Give me a brief morning briefing — check my tasks and mention anything overdue or due today, plus any open goals or projects worth flagging. Keep it short." }] },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }, 600);
}

async function handleServerEvent(e) {
  const event = JSON.parse(e.data);
  lastActivity = Date.now();
  switch (event.type) {
    case "input_audio_buffer.speech_started":
      coreWrap.classList.remove("speaking"); coreWrap.classList.add("listening");
      break;
    case "response.output_audio.delta":
      coreWrap.classList.remove("listening"); coreWrap.classList.add("speaking");
      break;
    case "response.done":
      coreWrap.classList.remove("speaking"); coreWrap.classList.add("listening");
      break;
    case "conversation.item.input_audio_transcription.completed":
      logLine("you", event.transcript);
      break;
    case "response.output_audio_transcript.done":
      logLine("jarvis", event.transcript);
      break;
    case "response.output_item.done":
      if (event.item?.type === "function_call") await handleVoiceToolCall(event.item);
      break;
    default:
      break;
  }
}

const DATA_TOOLS = ["add_task", "complete_task", "update_task", "delete_task", "add_goal", "add_course", "add_note", "add_project", "add_work_note", "remember_fact"];

const TOOL_LABELS = {
  add_task: "Task added", complete_task: "Task completed", update_task: "Task updated", delete_task: "Task deleted",
  add_goal: "Goal added", add_course: "Course added", add_note: "Note added", add_project: "Project added",
  add_work_note: "Note added", remember_fact: "Remembered",
};

async function handleVoiceToolCall(item) {
  const result = await runTool(item.name, safeParse(item.arguments));
  dc.send(JSON.stringify({
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result) },
  }));
  dc.send(JSON.stringify({ type: "response.create" }));
  setStatus("Online. Listening, Sir Yahya.");
}

function safeParse(raw) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

// Shared by both voice tool calls and the dashboard's own "+" buttons
async function runTool(name, args) {
  setStatus(`Running "${name}"...`);
  let result;
  try {
    const res = await fetch("/tool", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: args }),
    });
    result = await res.json();
    if (result.error) throw new Error(result.error);
    if (DATA_TOOLS.includes(name)) {
      toast(TOOL_LABELS[name] || "Done");
      refreshDashboard();
    }
  } catch (err) {
    console.error(err);
    toast(`"${name}" failed — see console.`, "error");
    result = { error: String(err) };
  }
  return result;
}

function setupMicVisualizer(stream) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    if (!isActive) return;
    analyser.getByteFrequencyData(data);
    barEls.forEach((bar, i) => {
      const v = data[i % data.length] / 255;
      bar.style.height = `${6 + v * 80}px`;
      bar.style.opacity = 0.3 + v * 0.7;
    });
    requestAnimationFrame(tick);
  }
  tick();
}

// ============ WAKE WORD ("Hey Jarvis") ============
// Uses the browser's built-in speech recognition (Chrome/Edge only) to listen
// for the word "jarvis" while disengaged, then auto-starts the real session.
// Note: this sends audio to the browser vendor's speech service (e.g. Google on Chrome)
// for local keyword spotting — separate from, and lighter than, the OpenAI voice session.
let wakeWordEnabled = false;
let wakeRecognition = null;

function supportsWakeWord() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

function startWakeWordListening() {
  if (!supportsWakeWord() || isActive) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  wakeRecognition = new SpeechRecognition();
  wakeRecognition.continuous = true;
  wakeRecognition.interimResults = true;
  wakeRecognition.lang = "en-US";

  wakeRecognition.onresult = (e) => {
    const transcript = Array.from(e.results).map((r) => r[0].transcript).join(" ").toLowerCase();
    if (transcript.includes("jarvis")) {
      stopWakeWordListening();
      startJarvis();
    }
  };
  wakeRecognition.onerror = () => { /* mic permission issues, transient network errors — just let onend restart it */ };
  wakeRecognition.onend = () => {
    if (wakeWordEnabled && !isActive) {
      try { wakeRecognition.start(); } catch { /* already running */ }
    }
  };

  try { wakeRecognition.start(); } catch { /* already running */ }
}

function stopWakeWordListening() {
  if (wakeRecognition) {
    wakeRecognition.onend = null;
    wakeRecognition.stop();
    wakeRecognition = null;
  }
}

wakeBtn.addEventListener("click", () => {
  if (!supportsWakeWord()) {
    toast("Wake word needs Chrome or Edge — not supported in this browser.", "error");
    return;
  }
  wakeWordEnabled = !wakeWordEnabled;
  wakeBtn.classList.toggle("active", wakeWordEnabled);
  wakeBtn.textContent = wakeWordEnabled ? "WAKE WORD: ON" : "WAKE WORD: OFF";
  if (wakeWordEnabled) {
    toast('Listening for "Jarvis"...');
    startWakeWordListening();
  } else {
    stopWakeWordListening();
  }
});
