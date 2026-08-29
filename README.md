# Yahya's Jarvis

A real-time voice AI agent built on OpenAI's Realtime API (`gpt-realtime-2.1`), dark-knight styled, running three life domains — **Personal, University, Work** — around a central voice AI Agent core. Always addresses you as **Sir Yahya**.

## What's new in this version

| Feature | What it does | Anything you need to do? |
|---|---|---|
| **Due dates + priority** | Tasks can have a due date and low/normal/high priority. Overdue tasks show red, due-today shows yellow. | Nothing — just use the date/priority fields when adding a task. |
| **Edit & delete everywhere** | Hover any task/goal/course/project/note to reveal ✎ edit and × delete buttons. | Nothing. |
| **Persistent memory** | Say "remember that I..." and Jarvis saves it permanently (`remember_fact` tool). Every future session automatically knows it. | Nothing — visible in the "🧠 Memory" section of the Personal panel; click × to make it forget something. |
| **Daily briefing** | First time you hit ENGAGE each calendar day, Jarvis automatically checks your tasks/goals and gives you a short spoken summary — no need to ask. | Nothing. Tracked in your browser's local storage, so it resets if you clear browser data or use a different browser. |
| **Web search (quick facts)** | Jarvis can look up quick factual answers via DuckDuckGo's free Instant Answer API. | **Heads up:** this is *not* full web browsing — it's a lightweight lookup, good for "what's the capital of X" but not "summarize this news article." If you want real web search, that needs a paid API (Bing/Google/Tavily/Serper) — say the word and I'll wire one in with your key. |
| **Toast notifications** | A small popup in the top-right confirms every tool action ("Task added", "Task deleted", etc.) or flags a failure. | Nothing. |
| **Tuned turn detection** | Adjusted voice-activity settings (`silence_duration_ms`, `threshold`) so Jarvis responds a bit faster after you stop talking. | If it still feels slow/fast for your taste, the values are in `server.js` under `turn_detection` — lower `silence_duration_ms` = quicker cutoff, higher = more patient. |
| **Auto-disengage** | If there's 5 minutes of silence while engaged, Jarvis automatically disconnects (saves you from an accidental open, billed session). | Nothing. Change `AUTO_DISENGAGE_MS` in `app.js` if you want a different timeout. |
| **Wake word ("Hey Jarvis")** | Click **WAKE WORD: OFF** to turn it on — your browser listens locally for the word "jarvis" and auto-engages the real session when it hears it. | **Chrome or Edge only.** Also: this uses your browser's built-in speech recognition, which (on Chrome) sends short audio snippets to Google's speech service to do the recognition — that's separate from and lighter-weight than the real OpenAI voice session. If that's not something you're comfortable with, just leave wake word off and use the ENGAGE button. |

## ⚠️ Rotate your OpenAI key

Standard reminder: any key pasted into a chat should be treated as exposed. Go to https://platform.openai.com/api-keys, revoke the old one, generate a new one, put it in `.env`. Also make sure billing is set up (platform.openai.com/settings/organization/billing) or you'll get 429 errors.

## Setup

```bash
cd jarvis-app
npm install
npm start
```

Open **http://localhost:3000**, click **ENGAGE**, allow the mic, and talk.

## Using the new features by voice

- "Add a task to finish my thesis, due Friday, high priority."
- "What's overdue?" / "What do I have due today?"
- "Remember that I have a lecture every Tuesday at 9am."
- "What do you know about me?" (uses `recall_facts`)
- "What's the capital of Kazakhstan?" (uses `web_search`)
- "Edit my thesis task to say 'finish thesis intro'." (uses `update_task`)
- "Delete the task about the thesis." (uses `delete_task`)

## Using the new features by hand (dashboard)

- **Add a task**: type it, optionally pick a due date and priority, hit +.
- **Edit/delete**: hover over any item in any panel — the ✎ and × icons appear.
- **Memory panel**: shows everything Jarvis currently remembers about you; click × on any fact to make it forget.
- **Wake word toggle**: button under ENGAGE/DISENGAGE.

## Things worth knowing

- **Daily briefing** triggers once per calendar day, per browser (stored in `localStorage`, not the server) — so it won't re-trigger every time you re-engage the same day, but will reset if you use a different browser/device.
- **Web search** quality is limited by design (DuckDuckGo's free API is meant for quick facts, not deep research). This was a deliberate trade-off to avoid needing another paid API key — happy to upgrade it if you want real search results.
- **Wake word** and the **real ENGAGE session** don't run at the same time (both would fight over your microphone) — turning one on automatically pauses the other, and it resumes correctly when you disengage.

## Adding your own tools

Same pattern as always: add an entry to `TOOLS` in `server.js`, then a matching `case` in `executeTool()`. If it changes stored data, also add its name to the `DATA_TOOLS` array in `app.js` so the dashboard refreshes and shows a toast automatically.

## Cost

Realtime voice runs roughly **$0.05–0.15/minute** on `gpt-realtime-2.1`. Auto-disengage after 5 idle minutes helps avoid accidental extra cost.

## Browser requirement

WebRTC mic access requires `localhost` or HTTPS. Wake word requires Chrome or Edge specifically (Web Speech API support).
