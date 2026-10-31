![Apiarius: see your agents and subagents at work, wherever you orchestrate them](assets/banner.png)

[Install](#install) · [What you see](#what-you-see) · [Examples](#examples) · [Commands](#commands) · [How it works](#how-it-works) · [Privacy](#privacy)

[![tests](https://github.com/yusuflkq/apiarius/actions/workflows/test.yml/badge.svg)](https://github.com/yusuflkq/apiarius/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Apiarius in Claude Desktop, the terminal and the browser, then a team of agents building a rate limiter, watched live in the web deck](assets/demo.gif)

When you run a team of agents, Claude Code doesn't make it easy to tell which ones are still working, which have finished and which are waiting on you. Apiarius is a mod that adds a live deck wherever you already work: the Claude Desktop side pane, the terminal or a browser tab. It shows every agent and subagent, what each one is doing right now, who started it, what they tell each other and which files each one changed. Nothing about your setup changes: install it, run `/apiarius` and keep working.

Apiarius only shows what Claude Code is already doing. It reads the events Claude Code reports and what git says about your files, and passes every permission check, tool call and prompt through unchanged. It acts only when you press something on the deck, and then through Claude Code's own channels.

## Install

```
/plugin marketplace add yusuflkq/apiarius
/plugin install apiarius@apiarius
```

Or do both in one step:

```
/plugin install apiarius --marketplace yusuflkq/apiarius
```

It needs Claude Code 2.1.304 or later, in the terminal or in the Code tab of the Claude Desktop app. The web page needs Node.js 20 or later on your PATH, and Changes needs git.

Then run `/apiarius`.

## What you see

The Dashboard has a card for each agent with what it is doing right now, then the session's figures, the plan, recent activity and the files the agents touched. When an agent asks you something, it shows at the top.

- Chat shows the session as a group chat, including the messages agents send each other.
- Org shows who started whom, as a chart or as a timeline of each agent's run.
- Changes shows git's diff of each uncommitted file next to each agent's own edits of it.
- Each agent has a page with its task, to-do list, result, tool calls and edits.
- Inspect shows what fills the context, every permission decision and who made it, what is loaded and the spend per agent.
- Background lists the background shells, agents and schedules still running.
- All sessions lists every Claude Code session on this machine that runs Apiarius, so one deck can check on all of them.

When you do need to step in, you can answer Claude's questions, message an agent, or stop an agent, a background task or the turn, from the deck.

| In Claude Desktop | In the terminal |
| :-: | :-: |
| ![The deck's Org chart in the Claude Desktop side pane](assets/screenshots/desktop.png) | ![The deck beside Claude Code in the terminal](assets/screenshots/terminal.png) |
| Chat | Changes |
| ![Chat](assets/screenshots/web-chat.png) | ![Changes](assets/screenshots/web-changes.png) |
| Org chart | Inspect |
| ![Org chart](assets/screenshots/web-org.png) | ![Inspect](assets/screenshots/web-inspect.png) |

## Examples

Ask for work that several agents share:

```
Use three subagents in parallel to review src/auth: security, missing tests and docs.
```

Run `/apiarius` while they work. The Dashboard has a card for each of them with its current step, and Chat shows what each one reports back.

To answer Claude from the deck, have it ask you something:

```
Before you change anything, ask me which database to use.
```

The question shows at the top of the Dashboard with its options. Press one to answer, in the pane or on the web page.

After agents have edited files in a git repository, `/apiarius changes` shows git's diff of each uncommitted file next to the edits each agent made to it, so you can see who changed what.

To look around before you run any agents, use `/apiarius demo`. The deck shows a sample session in which a team of agents adds rate limiting to an API, with several things waiting on you. Nothing you press there reaches Claude, and Back to this chat returns to your own session.

## Commands

| Command | What it does |
| :- | :- |
| `/apiarius` | Opens the deck on the Dashboard |
| `/apiarius chat`, `org`, `changes`, `inspect`, `settings` | Opens that tab. A prefix works: `/apiarius i` is Inspect |
| `/apiarius sessions` | Opens All sessions |
| `/apiarius web` | Starts the web page and answers with its link |
| `/apiarius web stop` | Stops the web page. The next start gives a new link |
| `/apiarius demo` | Shows the deck on sample data |
| `/apiarius clear` | Hides finished agents from the deck (Claude Code is untouched) |
| `/apiarius clear show` | Shows them again |
| `/apiarius avatars [style]` | Lists the eleven avatar styles, or picks one |
| `/apiarius band` | Hides or shows the status line above the prompt |
| `/apiarius close` | Closes the deck |

Keys work while the pane has the keyboard (click it, or press ctrl+x then tab): `1` to `6` switch tabs, `Enter` opens what has the focus, `b` goes back from an agent's page, and `s` opens All sessions. The web page adds a few of its own, listed under Help in its Settings.

## How it works

Apiarius hooks Claude Code's events (tool calls, agent spawns, turns, messages, permission checks and notifications) into one model of the session, which the pane, the terminal and the web page all draw from. Everything it shows comes from what Claude Code and git report. Changes never credits a git hunk to an agent: the edits beside git's diff are the patches from each agent's own Edit and Write calls.

When you step in, it acts only through Claude Code's own channels: answering the questions Claude asks you, delivering your messages, TaskStop for background agents and tasks, CronDelete for schedules, and the same abort as Esc for the turn. Stop and Cancel appear only where Claude Code's permission check allows that call, and the check runs again before each press. Apiarius never grants itself a permission and never answers a permission prompt. In auto mode, where Claude Code refuses a plugin's message to a subagent, the deck asks the Orchestrator to pass yours on, and that request shows in the chat.

Where Claude Code loads its built-in guard (on a Team or Enterprise login, or a machine with managed settings), a mod's hooks on `classic.*` events, `session.compact` and `prompt.context` don't run. The agents, their tool calls and messages, Changes, Claude's questions and Stop all still work there. Permission prompts and Claude Code's notifications don't show as waiting on you, though, and Inspect has no compactions, instruction files or permission mode.

## Privacy

Apiarius makes no network requests of its own. What it hands to Claude goes through Claude Code like anything you type, and nothing is sent anywhere else.

It reads Claude Code's events for the session, the session's own transcript to recover what the deck showed after the mod reloads, and what git says about the repositories your agents work in. It writes only under `~/.claude/apiarius/`, in files only you can read, and deletes a session's files there when the session ends. The one exception is the debug dump, which you turn on yourself and which stays until you delete it.

The web page runs only after you start it. It listens on 127.0.0.1, and its link carries a random token that every request for the session's data needs. Apiarius opens the Desktop's Browser pane only when you run `/apiarius web` or press Start the web page in the deck's Settings.

<details>
<summary>Everything it runs, writes and reads</summary>

Apiarius makes no network requests of its own. What it hands to Claude goes through Claude Code like anything you type: your messages to agents, your answers to Claude's questions, and a note with the web page's link. Nothing is sent anywhere else.

`/apiarius web` runs `node web/server.js` from the plugin's folder as a child process of the session. The server has no dependencies and listens on 127.0.0.1 only, on a port the system picks; a reload of the mod asks for the same port again. It refuses any request for the session's data without a random token, which reaches the server in an environment variable and reaches you in the link; `/apiarius web stop` discards it. The page sets no cookie. The server also refuses requests addressed to any other host name, and takes commands only from its own page. The page loads nothing from the internet. The server exits with the session, on `/apiarius web stop`, or when its parent process is gone. On the Desktop the command asks the Browser pane to open the page through the pane's `preview_start` MCP tool, and Apiarius opens the pane at no other time. Its answer leaves Claude the note with the link, so Claude can open the page when you ask.

For Changes it runs read-only git commands (`rev-parse`, `status`, `diff`, `log`, `rev-list`, `show`) in the session's repository or the ones its agents edit in, with `--no-optional-locks`, no pager or prompts, and `--no-ext-diff --no-textconv` on diffs. They run after edits and shell commands, and every 6 seconds while a deck is open. Short `node` one-liners read the session's process id, check whether other listed sessions' processes still run, and delete registry and inbox files the mod made.

It writes these under `~/.claude/apiarius/` (`$CLAUDE_CONFIG_DIR/apiarius/` when that is set), each file readable by you alone (0600, in 0700 folders):

- `sessions/<session id>.json`, so All sessions can list the session: its title, folder, repository, state, what needs you, what it is doing, its agents at work, its spend estimate and its process id. It is rewritten at most every 2 seconds and on a 30-second heartbeat, and deleted when the session ends or, if the session died, by another deck.
- `web/<session id>/`: the page's `state.json` and the files it loads on demand (patches, git diffs, long messages, agent pages, the timeline), written only while the web page is on or another session's deck is showing this one. That deck leaves its requests in `inbox/` there, signed, and a deck acts only on requests whose signature checks out. The folder is deleted when the session ends.
- `debug/<session id>.json`, a dump of the deck's state, only while a `debug` folder you created exists there. It stays until you delete it.

Claude Code's plugin storage keeps your preferences (avatar style, the band) between sessions. For each session it also holds the deck's snapshot and the web page's token and port, so a reload of the mod keeps its place; those last only as long as the session. Apiarius reads the files agents edit, the session's transcript, Claude Code's settings for Inspect, and other sessions' registry files and state folders.

</details>

## Support

Report bugs and ask for features in [GitHub issues](https://github.com/yusuflkq/apiarius/issues). Report a security problem privately instead, as [SECURITY.md](SECURITY.md) describes.

A dump of what the deck believes helps with a bug. Create the folder `~/.claude/apiarius/debug/` and Apiarius writes `<session id>.json` there about 2 seconds after each change. Check that it holds nothing private before you attach it, and delete the folder to stop the dump.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). To try a clone without installing it, run `claude --plugin-dir .` in its folder. `/apiarius probe` toggles a test pane for mod authors.

```
claude plugin validate .
claude plugin test .     # the mod's tests
node --test web/test/    # the server and page tests
node web/dev.js          # the web page on sample data; prints its link
```

## License

MIT. See [LICENSE](LICENSE).
