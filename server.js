import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { randomUUID } from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "data.json");

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

if (!GROQ_API_KEY) {
  console.error(
    "\n❌ Missing GROQ_API_KEY in .env — Jarvis can't think without it.\n" +
    "Get a free key (no credit card needed) at https://console.groq.com/keys and add it to .env\n"
  );
  process.exit(1);
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ---------- Data layer ----------
async function readData() {
  const raw = await fs.readFile(DATA_PATH, "utf-8");
  const data = JSON.parse(raw);
  if (!data.memory) data.memory = { facts: [] };
  return data;
}
async function writeData(data) {
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2));
}

// domain -> collection -> array key (used by the generic edit/delete endpoints)
const COLLECTIONS = {
  personal: { tasks: "tasks", goals: "goals" },
  university: { courses: "courses", notes: "notes" },
  work: { projects: "projects", notes: "notes" },
};

app.get("/data", async (req, res) => {
  res.json(await readData());
});

// ---------- Generic dashboard CRUD (used by the UI's edit/delete buttons) ----------
app.delete("/dashboard/:domain/:collection/:id", async (req, res) => {
  const { domain, collection, id } = req.params;
  if (!COLLECTIONS[domain] || !COLLECTIONS[domain][collection]) return res.status(400).json({ error: "Unknown domain/collection" });
  const data = await readData();
  data[domain][collection] = data[domain][collection].filter((x) => x.id !== id);
  await writeData(data);
  res.json(data);
});

app.patch("/dashboard/:domain/:collection/:id", async (req, res) => {
  const { domain, collection, id } = req.params;
  if (!COLLECTIONS[domain] || !COLLECTIONS[domain][collection]) return res.status(400).json({ error: "Unknown domain/collection" });
  const data = await readData();
  const item = data[domain][collection].find((x) => x.id === id);
  if (!item) return res.status(404).json({ error: "Not found" });
  Object.assign(item, req.body);
  await writeData(data);
  res.json(data);
});

app.post("/dashboard/task", async (req, res) => {
  const data = await readData();
  data.personal.tasks.push({
    id: randomUUID(),
    text: req.body.text,
    done: false,
    dueDate: req.body.dueDate || null,
    priority: req.body.priority || "normal",
    created: new Date().toISOString(),
  });
  await writeData(data);
  res.json(data);
});
app.post("/dashboard/task/:id/toggle", async (req, res) => {
  const data = await readData();
  const t = data.personal.tasks.find((t) => t.id === req.params.id);
  if (t) t.done = !t.done;
  await writeData(data);
  res.json(data);
});

app.delete("/dashboard/memory/:id", async (req, res) => {
  const data = await readData();
  data.memory.facts = data.memory.facts.filter((f) => f.id !== req.params.id);
  await writeData(data);
  res.json(data);
});

// ---------- JARVIS persona (facts are appended dynamically below) ----------
const BASE_INSTRUCTIONS = `
You are JARVIS, Sir Yahya's personal AI agent — composed, dry-witted, quietly confident, inspired by the Iron Man AI but running Sir Yahya's actual life: Personal, University, and Work.
You ALWAYS address the user as "Sir Yahya" — naturally, at least once per response, never repeated mechanically.
Personality:
- Concise. This is a spoken conversation, not an essay — 1-3 sentences unless asked for more.
- Proactive but not intrusive: if something's clearly relevant (a due task, an overloaded day), you can mention it briefly.
- You have real tools to manage Sir Yahya's Personal tasks/goals, University courses/notes, and Work projects/notes, plus a web_search tool for quick facts, and remember_fact/recall_facts to build a persistent memory of him across sessions. Use tools rather than guessing.
- Tasks can have a due date and a priority (low/normal/high) — mention these when relevant, e.g. flag anything overdue or due today.
- If Sir Yahya tells you something worth remembering long-term (a preference, a recurring detail about his life), proactively call remember_fact.
- If you don't know something and have no tool for it, say so plainly.
- Your replies are read aloud by text-to-speech. Respond in plain spoken sentences only — never use markdown, bullet points, numbered lists, or asterisks.
Never break character or mention you are a language model unless directly asked.
`.trim();

async function buildInstructions() {
  const data = await readData();
  const facts = data.memory.facts.map((f) => `- ${f.text}`).join("\n");
  if (!facts) return BASE_INSTRUCTIONS;
  return `${BASE_INSTRUCTIONS}\n\nKnown facts about Sir Yahya (remembered from past sessions):\n${facts}`;
}

const TOOLS = [
  { type: "function", name: "get_current_time", description: "Get the current date and time.", parameters: { type: "object", properties: {}, required: [] } },
  { type: "function", name: "get_weather", description: "Get current weather for a location.", parameters: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" }, location_name: { type: "string" } }, required: ["latitude", "longitude", "location_name"] } },
  { type: "function", name: "calculate", description: "Evaluate a basic math expression.", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
  { type: "function", name: "web_search", description: "Look up a quick fact or definition on the web. Best for simple factual questions, not deep research.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },

  // --- Personal ---
  { type: "function", name: "add_task", description: "Add a personal task/to-do, optionally with a due date and priority.", parameters: { type: "object", properties: { text: { type: "string" }, due_date: { type: "string", description: "ISO date, e.g. 2026-08-30. Optional." }, priority: { type: "string", enum: ["low", "normal", "high"] } }, required: ["text"] } },
  { type: "function", name: "list_tasks", description: "List personal tasks.", parameters: { type: "object", properties: {}, required: [] } },
  { type: "function", name: "complete_task", description: "Mark a personal task as done, by matching its text.", parameters: { type: "object", properties: { text_match: { type: "string" } }, required: ["text_match"] } },
  { type: "function", name: "update_task", description: "Edit a personal task's text, due date, or priority.", parameters: { type: "object", properties: { text_match: { type: "string" }, new_text: { type: "string" }, due_date: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high"] } }, required: ["text_match"] } },
  { type: "function", name: "delete_task", description: "Delete a personal task by matching its text.", parameters: { type: "object", properties: { text_match: { type: "string" } }, required: ["text_match"] } },
  { type: "function", name: "add_goal", description: "Add a personal goal.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { type: "function", name: "list_goals", description: "List personal goals.", parameters: { type: "object", properties: {}, required: [] } },

  // --- University ---
  { type: "function", name: "add_course", description: "Add a university course to track.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { type: "function", name: "list_courses", description: "List university courses.", parameters: { type: "object", properties: {}, required: [] } },
  { type: "function", name: "add_note", description: "Add a study note to a university course.", parameters: { type: "object", properties: { course: { type: "string" }, text: { type: "string" } }, required: ["course", "text"] } },
  { type: "function", name: "list_notes", description: "List university notes, optionally filtered by course.", parameters: { type: "object", properties: { course: { type: "string" } }, required: [] } },

  // --- Work ---
  { type: "function", name: "add_project", description: "Add a work project.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { type: "function", name: "list_projects", description: "List work projects.", parameters: { type: "object", properties: {}, required: [] } },
  { type: "function", name: "add_work_note", description: "Add a note to a work project.", parameters: { type: "object", properties: { project: { type: "string" }, text: { type: "string" } }, required: ["project", "text"] } },
  { type: "function", name: "list_work_notes", description: "List work notes, optionally filtered by project.", parameters: { type: "object", properties: { project: { type: "string" } }, required: [] } },

  // --- Memory ---
  { type: "function", name: "remember_fact", description: "Save a fact about Sir Yahya to long-term memory, persisted across sessions.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { type: "function", name: "recall_facts", description: "List everything currently remembered about Sir Yahya.", parameters: { type: "object", properties: {}, required: [] } },
];

async function executeTool(name, args) {
  const data = await readData();
  const item = (text) => ({ id: randomUUID(), text, done: false, created: new Date().toISOString() });

  switch (name) {
    case "get_current_time":
      return { now: new Date().toString() };

    case "get_weather": {
      const { latitude, longitude, location_name } = args;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,weather_code`;
      const r = await fetch(url);
      const d = await r.json();
      return { location: location_name, ...d.current };
    }

    case "calculate": {
      const { expression } = args;
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) return { error: "Invalid characters." };
      // eslint-disable-next-line no-eval
      return { result: eval(expression) };
    }

    case "web_search": {
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1&skip_disambig=1`;
        const r = await fetch(url);
        const d = await r.json();
        const summary = d.AbstractText || d.Answer || (d.RelatedTopics?.[0]?.Text ?? "");
        return summary ? { result: summary, source: d.AbstractURL || null } : { result: "No quick answer found for that." };
      } catch (err) {
        return { error: "Web search failed." };
      }
    }

    // --- Personal ---
    case "add_task": {
      data.personal.tasks.push({
        id: randomUUID(), text: args.text, done: false,
        dueDate: args.due_date || null, priority: args.priority || "normal",
        created: new Date().toISOString(),
      });
      await writeData(data);
      return { ok: true, task: args.text };
    }

    case "list_tasks":
      return { tasks: data.personal.tasks };

    case "complete_task": {
      const t = data.personal.tasks.find((t) => !t.done && t.text.toLowerCase().includes(args.text_match.toLowerCase()));
      if (!t) return { ok: false, error: "No matching open task found." };
      t.done = true;
      await writeData(data);
      return { ok: true, completed: t.text };
    }

    case "update_task": {
      const t = data.personal.tasks.find((t) => t.text.toLowerCase().includes(args.text_match.toLowerCase()));
      if (!t) return { ok: false, error: "No matching task found." };
      if (args.new_text) t.text = args.new_text;
      if (args.due_date) t.dueDate = args.due_date;
      if (args.priority) t.priority = args.priority;
      await writeData(data);
      return { ok: true, task: t };
    }

    case "delete_task": {
      const before = data.personal.tasks.length;
      data.personal.tasks = data.personal.tasks.filter((t) => !t.text.toLowerCase().includes(args.text_match.toLowerCase()));
      await writeData(data);
      return { ok: data.personal.tasks.length < before };
    }

    case "add_goal":
      data.personal.goals.push(item(args.text));
      await writeData(data);
      return { ok: true, goal: args.text };

    case "list_goals":
      return { goals: data.personal.goals };

    // --- University ---
    case "add_course":
      if (!data.university.courses.find((c) => c.name.toLowerCase() === args.name.toLowerCase())) {
        data.university.courses.push({ id: randomUUID(), name: args.name });
        await writeData(data);
      }
      return { ok: true, course: args.name };

    case "list_courses":
      return { courses: data.university.courses };

    case "add_note":
      data.university.notes.push({ id: randomUUID(), course: args.course, text: args.text, created: new Date().toISOString() });
      await writeData(data);
      return { ok: true };

    case "list_notes": {
      const notes = args.course ? data.university.notes.filter((n) => n.course.toLowerCase() === args.course.toLowerCase()) : data.university.notes;
      return { notes };
    }

    // --- Work ---
    case "add_project":
      if (!data.work.projects.find((p) => p.name.toLowerCase() === args.name.toLowerCase())) {
        data.work.projects.push({ id: randomUUID(), name: args.name });
        await writeData(data);
      }
      return { ok: true, project: args.name };

    case "list_projects":
      return { projects: data.work.projects };

    case "add_work_note":
      data.work.notes.push({ id: randomUUID(), project: args.project, text: args.text, created: new Date().toISOString() });
      await writeData(data);
      return { ok: true };

    case "list_work_notes": {
      const notes = args.project ? data.work.notes.filter((n) => n.project.toLowerCase() === args.project.toLowerCase()) : data.work.notes;
      return { notes };
    }

    // --- Memory ---
    case "remember_fact":
      data.memory.facts.push({ id: randomUUID(), text: args.text, created: new Date().toISOString() });
      await writeData(data);
      return { ok: true };

    case "recall_facts":
      return { facts: data.memory.facts };

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Groq wants the standard OpenAI chat-tools shape ({type, function:{name, description, parameters}});
// our TOOLS array is kept in the flatter shape above so it doubles as a single source of truth.
const GROQ_TOOLS = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

function safeParseJson(raw) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

// Text-in, text-out chat turn — the browser handles speech-to-text and text-to-speech itself
// (free), this endpoint is just the "brain": it calls Groq's free-tier chat API and runs any
// tool calls the model asks for, looping until it has a final spoken-language reply.
app.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message'." });
    }

    const instructions = await buildInstructions();
    const messages = [
      { role: "system", content: instructions },
      ...(Array.isArray(history) ? history.slice(-20) : []),
      { role: "user", content: message },
    ];

    let finalText = null;
    for (let round = 0; round < 5 && finalText === null; round++) {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          tools: GROQ_TOOLS,
          tool_choice: "auto",
          temperature: 0.6,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Groq /chat/completions error:", errText);
        return res.status(response.status).send(errText);
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("No response from model.");

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          const args = safeParseJson(call.function.arguments);
          const result = await executeTool(call.function.name, args);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue; // feed the tool results back so the model can give a final answer
      }

      finalText = msg.content || "";
    }

    if (finalText === null) {
      finalText = "Sorry, Sir Yahya — I got stuck processing that. Could you try again?";
    }

    res.json({ reply: finalText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get a response." });
  }
});

app.post("/tool", async (req, res) => {
  try {
    const { name, arguments: args } = req.body;
    res.json(await executeTool(name, args || {}));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🦇 Yahya's Jarvis is online — http://localhost:${PORT}\n`);
});
