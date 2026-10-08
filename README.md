# Agent Deck

A Claude Code mod: one pane that shows your git changes, every agent's live work and exact edits, lets you chat with subagents, tracks productivity, and draws an Obsidian-style graph of which agents talk to each other.

Built and tested against Claude Code 2.1.289 (the Desktop app's bundled copy). Works in the Desktop Code tab and the terminal; the graph and charts are SVG on the desktop and text in the terminal.

## Use

| Command | What it does |
| :- | :- |
| `/deck` | Opens the pane (works while Claude is mid-turn) |
| `/deck agents` · `/deck diffs` · `/deck commits` · `/deck graph` | Opens on that tab (prefixes work: `/deck g`) |
| `/deck close` | Closes it |

Keys while the pane has focus: `1`–`5` switch tabs, `r` refreshes, `a` / `e` / `c` switch an agent's Activity / Diffs / Chat, `f` toggles file nodes on the graph.

## Tabs

- **Overview**: session time and time Claude spent working, tool calls and failure rate, lines added/removed by agents, uncommitted files, commits this session and today, agents live/done, tokens and cache share, cost and context fill. Activity chart for the last 30 minutes, who is working right now, top tools, hot files (with which agent touched them), and lines changed per day over the last week (kept across sessions).
- **Agents**: you, the main loop, every subagent and teammate: status, type, model, elapsed time, tool calls, lines changed, what each is doing right now. Per agent:
  - **Activity**: the current tool call and the last 14, with timings and failures, plus the final answer.
  - **Diffs**: exactly what that agent changed, taken from its own Edit and Write patches (not a guess from git).
  - **Chat**: its conversation as bubbles, and a field to message it. Subagents get the message through SendMessage (a finished one resumes to answer); for the main loop it is queued as your prompt.
  - **Ask main to review**: puts a review request in your prompt (you press Enter).
- **Diffs**: branch, upstream ahead/behind, every uncommitted file (staged, unstaged, untracked, renames) with +/− counts and which agent edited it. Press a file for its hunks. The **Show** picker switches to one agent's exact edits. Outside a git repo it lists the edits agents made.
- **Commits**: the last 25 commits with stats, the ones from this session starred, and the agent that made each one when it came from a shell command Claude ran. Press one for its message, files and patch.
- **Graph**: a force-directed map of you → main → subagents (and outside peers). Node color is status (green running, amber waiting, blue done, red failed), size is activity. Links show who spawned whom; purple curved links are messages, and packets flow along links that carried a message in the last 30 seconds. Hover a node to light up who it talks to; hover nodes and links for details. File nodes show which files each agent edited. Below it, a "Who's talking" feed.

While subagents run, a one-line band above the prompt lists them and what each is doing, with **Open deck**, **Graph** and **Hide** buttons (show it again from the Overview tab).

## How it works

- Hooks on `tool.call`, `agent.spawn`, `turn.start`, `turn.step`, `turn.complete`, `session.send` and `session.receive` feed one live model; `$.agent.list()` fills in agents the deck did not see start.
- Git runs in the background (`--no-optional-locks`, no external diff drivers), after edits and shell commands, at turn ends, and every few seconds while the pane is open.
- The session's model is kept in `$.state`, so it survives a reload of the mod; per-day totals and the band preference are kept in `$.store`.

## Develop

```bash
claude plugin validate ./agent-deck
claude plugin test ./agent-deck
```

To load it in a terminal session: `claude --plugin-dir ./agent-deck`. To load it in every Desktop session, add the folder's absolute path to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.
