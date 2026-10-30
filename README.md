# Agent Deck

Agent Deck is a Claude Code mod (a plugin of function hooks) that shows what a session's agents are doing. `/deck` opens it in a side pane of the Code tab, drawn with the app's own elements: a Paperclip-style dashboard that updates live with what needs you (questions you can answer right there), the goal and plan, a card per agent and what it is doing now, the org chart, the exact diffs each one made, and a box to message an agent; then a git checker. `/deck web` shows the same dashboard in the Desktop app's Browser pane, drawn from the same state.

## Install

To load it in every session, put the folder's absolute path in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. With `CLAUDE_CODE_PLUGIN_DIR_WATCH` set to `1`, saving a file reloads the mod.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "<absolute path to agent-deck>",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

To load it for one terminal session only: `claude --plugin-dir <path>`.

- It needs a Claude Code new enough to run mods. It was built and tested on 2.1.295, the Desktop app's bundled copy. The `claude` on your PATH is a separate install and may be a different version.
- `/deck web` needs Node 18 or later on PATH. Without Node, the side pane still works.

## Use

| Command | What it does |
| :- | :- |
| `/deck web` | Starts the dashboard, opens it in the Browser pane and answers with its link (click it if the pane did not open; any browser on this machine works) |
| `/deck web stop` | Stops the dashboard. The next `/deck web` gives a new link |
| `/deck` | Opens the side pane on its Dashboard (works while Claude is mid-turn) |
| `/deck org` · `/deck plan` · `/deck changes` | Opens the pane on that tab (a prefix works: `/deck c`) |
| `/deck plan 3` | Opens the Plan tab with its third step open |
| `/deck demo` | Shows the Dashboard, Org, Plan and agent pages on sample data (`web/fixtures/state.json`, its times moved to now); **Back to this chat** returns |
| `/deck band` | Hides or shows the agents band above the prompt |
| `/deck close` | Closes the pane |

Keys while the pane has focus: `1`–`4` switch tabs (Dashboard, Org, Plan, Changes); on an agent page `b` goes back and `d` / `a` / `t` show its Diffs, Activity or Talk.

## The dashboard

A sidebar lists the pages and every agent, with live and waiting dots.

- **Dashboard:** what needs you (with Open), the goal and plan progress, a card per agent, KPIs (agents running, plan steps done, session spend, waiting on you), recent activity, and the files the agents edited.
- **Org chart:** the Orchestrator at the top and the agents it started below it. Drag, scroll or use the arrow keys to pan; pinch, Ctrl+scroll or `+` / `−` to zoom; `0` fits it. **List** shows the same tree as indented rows. Click a card to open that agent.
- **Plan:** the goal, a progress bar, and each step with its status and who works on it.
- **Changes:** git's uncommitted files with `+/−` and who edited each; open a file for its agents' patches. Below, other agent edits and recent commits. In a folder that is no git repository, it says so, offers the repositories inside that folder (a press pins Changes to one, **Follow the work** lets go), and opens the newest of the agents' edits.
- **Agent page:** its task, checklist and result, with its model, tokens, lines changed and tool calls. Then three tabs:
  - **Diffs:** the patches from its own Edit and Write calls.
  - **Activity:** its tool calls.
  - **Talk:** its messages, and a box to message it. A subagent gets the message at once (a finished one resumes to answer); for the Orchestrator it becomes your next prompt. In auto mode, where Claude Code takes no message to a subagent from the deck, the Orchestrator passes it on: the request shows in the chat, and the message stays in that agent's Talk.
- **Review** (on an agent page and on Changes) puts a review request in your Claude Code prompt box; you press Enter to send it.

## The side pane

- **Dashboard:** drawn from the same state as the web page, so the two always agree.
  - **What needs you:** a question Claude asks shows its options as buttons, each with its description under it. One question with one answer sends on a press; several questions, or one with checkboxes, send with **Submit**; **Other…** takes your own words. The answer goes through the same path as the web page's. A permission prompt shows the exact command, to allow or deny in Claude Code.
  - **Goal:** the headline and its words, "Step n of m" and the plan's bar.
  - **Agents:** a card each, as many a row as fit (two in the docked pane, up to six when it is wide), with its avatar, status pill, an inner box with the step it is on, what it is doing now, and its model, tokens and age. Press any line of a card to open the agent. Recent activity and Files sit in bordered lists, side by side from 120 cells; files outside the repo fold into one row.
  - **Figures:** agents running, plan steps, session spend, waiting on you. Then the recent activity; a row opens its agent.
  - **Open in browser** starts `/deck web`.
  - **Folding:** press a section's heading (**▾ AGENTS 7**) to fold it to one line of what it holds (**▸ AGENTS 7** · 2 running · 1 waiting), and again to open it. The goal, agents, figures, recent activity and files fold one by one, as do an agent page's Task and Checklist and the Plan tab's goal. What you fold stays folded through live updates and reloads of the mod.
- **Org:** the org chart, cards over connectors. Click a card to open its agent; drag or the arrow keys pan a big chart. VS Code and mobile list the agents as an indented tree.
- **Plan:** the goal and its follow-ups; how far the plan is (steps done, in progress and failed), where it came from, and its bar; then a row for each step with its status, its words, who works on it, and whether it needs you. Click a row to open it: a card for each agent on the step (with the agents it started under it), showing what it is doing now, its checklist, its last three tool calls, the files it touched, its result and anything it waits on you for, then **Open agent →** and **Talk →**. A step the Orchestrator does itself shows its checklist item and what it just did. Open steps stay open while the pane updates.
- **Agent page:** its avatar, name, type, who it reports to and status; four boxes for its model, tokens, lines changed and tool calls; its Now line, its task beside its checklist, what it waits on you for and its result. Then Diffs (its exact patches), Activity (each tool call with its description, how long it took and when) and Talk (chat bubbles, each of your messages with its delivery status, and a box to message it). Back returns to the tab you came from.
- **Changes:** the git checker: branch and upstream, uncommitted files with who edited each, and recent commits with the agent that made each. Press a file (▸) for its hunks or a commit for its patch. Outside a git repo, it says where the chat runs, offers the repositories inside that folder (a press pins Changes to one, **Follow the work** lets go), and lists the agents' edits by file, each with its editors' faces, the newest open.
- **Band:** while subagents run, one line above the prompt says who is working on what, with **Open**.
- **Off the tab row:** Stats and Classic, from earlier builds, are kept but no longer on the tab row. `/deck stats` opens Stats: session time, tool calls, lines changed by agents, uncommitted files, tokens and cost; activity over the last 30 minutes; lines changed per day over the last 7 days. `/deck classic` opens Classic, the earlier Agents tab: a short summary, and **Details** (`/deck details`) for the full outline of the Orchestrator, its plan steps, the agents under the step they serve, then the files they are changing. In Classic, `w` opens the dashboard in the Browser pane, `e` toggles Details and `n` opens what needs you; in Details, `o` selects the Orchestrator, `f` / `z` fold or zoom the selected row, and `u` goes back up a zoom level.

The pane also works in a terminal session, where Stats draws its charts as text.

## How it works

- Hooks on tool calls, agent spawns, turns, messages and notifications feed one live model of the session. It is kept in `$.state`, so it survives a reload of the mod; daily totals and the band setting are kept in `$.store`.
- Git runs in the background (`--no-optional-locks`, no external diff tools) after edits and shell commands, and every few seconds while the pane or the dashboard is open.
- `/deck web` starts `web/server.js`, a plain Node server with no dependencies. It listens on 127.0.0.1 only, every request needs a token made for the session, and the page loads nothing from the internet, so nothing leaves the machine.
- While it runs, the mod writes `.web/<sessionId>/state.json` (at most every 300 ms) and one patch file per edit. The server streams each new state to the page over SSE, and the page updates in place without losing your view, scroll or draft.
- Messages and review requests from the page come back to the mod on the server's stdout. The mod checks each one against the session before it acts on it.
- The server stops with the session or on `/deck web stop`, and the page keeps showing the last state. A reload of the mod restarts it on the same link.

## Develop

```bash
claude plugin validate .
claude plugin test .     # 250 tests
node --test web/test/    # 42 server and page tests
node web/dev.js          # serves the dashboard on the sample data in web/fixtures and prints the URL
```

- Make a `.debug/` folder in the mod and it dumps its live state to `.debug/<sessionId>.json` about 2 s after each change.
- `/deck demo` draws the side pane's Dashboard, Org, Plan and agent pages on `web/fixtures/state.json`, for judging the design without a session.
- `/deck probe` toggles a diagnostic pane that shows how the current surface draws native text, a Client canvas and an Svg. The deck's own views don't use it.
