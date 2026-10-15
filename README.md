# Agent Deck

Agent Deck is a Claude Code mod (a plugin of function hooks) that shows what a session's agents are doing. `/deck` opens it in a side pane of the Code tab, drawn with the app's own elements: a Paperclip-style dashboard that updates live with what needs you (questions you can answer right there), the goal and plan, a card per agent and what it is doing now, the org chart, the exact diffs each one made, and a box to message an agent; then a git checker and session stats. `/deck web` shows the same dashboard in the Desktop app's Browser pane, drawn from the same state.

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
| `/deck org` · `/deck changes` · `/deck stats` · `/deck classic` | Opens the pane on that tab (a prefix works: `/deck c`) |
| `/deck demo` | Shows the Dashboard, Org and agent pages on sample data (`web/fixtures/state.json`, its times moved to now); **Back to this chat** returns |
| `/deck details` | Opens Classic with the full outline |
| `/deck band` | Hides or shows the agents band above the prompt |
| `/deck close` | Closes the pane |

Keys while the pane has focus: `1`–`5` switch tabs (Dashboard, Org, Changes, Stats, Classic); on an agent page `b` goes back and `d` / `t` / `c` show its Diffs, Talk or Tool calls. In Classic: `w` opens the dashboard in the Browser pane, `e` toggles Details, `n` opens what needs you; in Details, `o` selects the Orchestrator, `f` / `z` fold or zoom the selected row, `u` goes back up a zoom level.

## The dashboard

A sidebar lists the pages and every agent, with live and waiting dots.

- **Dashboard:** what needs you (with Open), the goal and plan progress, a card per agent, KPIs (agents running, plan steps done, session spend, waiting on you), recent activity, and the files the agents edited.
- **Org chart:** the Orchestrator at the top and the agents it started below it. Drag, scroll or use the arrow keys to pan; pinch, Ctrl+scroll or `+` / `−` to zoom; `0` fits it. **List** shows the same tree as indented rows. Click a card to open that agent.
- **Plan:** the goal, a progress bar, and each step with its status and who works on it.
- **Changes:** git's uncommitted files with `+/−` and who edited each; open a file for its agents' patches. Below, other agent edits and recent commits.
- **Agent page:** its task, checklist and result, with its model, tokens, lines changed and tool calls. Then three tabs:
  - **Diffs:** the patches from its own Edit and Write calls.
  - **Activity:** its tool calls.
  - **Talk:** its messages, and a box to message it. A subagent gets the message at once (a finished one resumes to answer); for the Orchestrator it becomes your next prompt.
- **Review** (on an agent page and on Changes) puts a review request in your Claude Code prompt box; you press Enter to send it.

## The side pane

- **Dashboard:** drawn from the same state as the web page, so the two always agree.
  - **What needs you:** a question Claude asks shows its options as buttons, each with its description under it. One question with one answer sends on a press; several questions, or one with checkboxes, send with **Submit**; **Other…** takes your own words. The answer goes through the same path as the web page's. A permission prompt shows the exact command, to allow or deny in Claude Code.
  - **Goal:** the headline and its words, "Step n of m" and the plan's bar.
  - **Agents:** a card each (two a row in the docked pane), with its avatar, status, what it is doing now, and its model, tokens and age. Press a name to open the agent.
  - **Figures:** agents running, plan steps, session spend, waiting on you. Then the recent activity; a row opens its agent.
  - **Open in browser** starts `/deck web`.
- **Org:** the org chart, cards over connectors. Click a card to open its agent; drag or the arrow keys pan a big chart. VS Code and mobile list the agents as an indented tree.
- **Agent page:** its avatar, name, type, who it reports to and status; its Now line, task and checklist; what it waits on you for; its result; then Diffs (its exact patches), Talk (with a box to message it) and Tool calls. Back returns to the tab you came from.
- **Classic:** the earlier Agents tab, kept for now. A short summary, and **Details** for the full outline: the Orchestrator, its plan steps, the agents under the step they serve (sub-agents under their parent), then the files they are changing. Click a row for its detail.
- **Changes:** the git checker: branch and upstream, uncommitted files with who edited each, and recent commits with the agent that made each. Press a file for its hunks or a commit for its patch. Outside a git repo, it lists the agents' edits by file.
- **Stats:** session time, tool calls, lines changed by agents, uncommitted files, tokens and cost; activity over the last 30 minutes; lines changed per day over the last 7 days.
- **Band:** while subagents run, one line above the prompt says who is working on what, with **Open**.

The pane also works in a terminal session, where Stats draws its charts as text.

## How it works

- Hooks on tool calls, agent spawns, turns, messages and notifications feed one live model of the session. It is kept in `$.state`, so it survives a reload of the mod; daily totals and the band setting are kept in `$.store`.
- Git runs in the background (`--no-optional-locks`, no external diff tools) after edits and shell commands, and every few seconds while the pane or the dashboard is open.
- `/deck web` starts `web/server.js`, a plain Node server with no dependencies. It listens on 127.0.0.1 only, every request needs a token made for the session, and the page loads nothing from the internet, so nothing leaves the machine.
- While it runs, the mod writes `.web/<sessionId>/state.json` (at most every 300 ms) and one patch file per edit. The server streams each new state to the page over SSE, and the page updates in place without losing your view, scroll or draft.
- Messages and review requests from the page come back to the mod on the server's stdout. The mod checks each one against the session before it acts on it.
- The server stops with the session or on `/deck web stop`, and the page keeps showing the last state. A reload of the mod restarts it on the same link. `web/CONTRACT.md` is the spec for the state file, the routes and the commands.

## Develop

```bash
claude plugin validate .
claude plugin test .     # 188 tests
node --test web/test/    # 39 server and page tests
node web/dev.js          # serves the dashboard on the sample data in web/fixtures and prints the URL
```

- Make a `.debug/` folder in the mod and it dumps its live state to `.debug/<sessionId>.json` about 2 s after each change.
- `/deck demo` draws the side pane's Dashboard, Org and agent pages on `web/fixtures/state.json`, for judging the design without a session.
- `/deck probe` toggles a diagnostic pane that shows how the current surface draws native text, a Client canvas and an Svg. The deck's own views don't use it.
