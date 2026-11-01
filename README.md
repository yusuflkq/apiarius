![Apiarius: see your agents and subagents at work, wherever you orchestrate them](assets/banner.png)

[Install](#install) · [What you see](#what-you-see) · [Examples](#examples) · [Commands](#commands) · [How it works](#how-it-works) · [Privacy](#privacy)

[![tests](https://github.com/yusuflkq/apiarius/actions/workflows/test.yml/badge.svg)](https://github.com/yusuflkq/apiarius/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Apiarius in Claude Desktop, the terminal and the browser, then a team of agents building a rate limiter, watched live in the web deck](assets/demo.gif)

When you run a team of agents, Claude Code doesn't make it easy to tell which ones are still working, which have finished and which are waiting on you. Apiarius is a mod that adds a live deck wherever you already work: the Claude Desktop side pane, the terminal or a browser tab. It shows every agent and subagent, what each one is doing right now, who started it, what they tell each other and which files each one changed. Nothing about your setup changes: install it, run `/apiarius` and keep working.

Apiarius only shows what Claude Code is already doing. It reads the events Claude Code reports and what git says about your files, and passes every permission check, tool call and prompt through unchanged. It acts only when you press something on the deck, and then through Claude Code's own channels.

## Install

This GitHub repository is its own plugin marketplace: its `.claude-plugin/marketplace.json` lists Apiarius. You add the repository once and install from it.

In a Claude Code session in the terminal, run:

```
/plugin marketplace add yusuflkq/apiarius
/plugin install apiarius@apiarius
```

The install shows what the plugin adds and asks where to install it. Install for you (user scope) puts it in every project.

From your shell, without starting a session, one command adds the marketplace and installs Apiarius for you. It needs Claude Code 2.1.292 or later.

```
claude plugin install apiarius --marketplace yusuflkq/apiarius
```

In the Claude Desktop app, `/plugin` doesn't run in the Code tab. The app has a plugin browser instead: in a local session, click + next to the prompt box and choose Add plugins (or Plugins, then Browse plugins). It lists the plugins from the marketplaces you have added, so add this one first from a terminal with `claude plugin marketplace add yusuflkq/apiarius`, then pick Apiarius in the browser. Or run the shell command above. The terminal and the Desktop app's local sessions read the same settings, so a plugin you install for yourself in one is there in the other.

It needs Claude Code 2.1.304 or later, in the terminal or in the Code tab of the Claude Desktop app. The web page needs Node.js 22 or later on your PATH, and Changes needs git 2.26 or later.

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
| `/apiarius web` | Starts the web page and opens it in your own browser, as Open in browser at the top of the deck does |
| `/apiarius web pane` | Opens the web page in Claude's Browser pane in the Desktop app instead, where each message you send waits for one Send click above your prompt |
| `/apiarius web stop` | Stops the web page. Its links stop working |
| `/apiarius demo` | Shows the deck on sample data |
| `/apiarius clear` | Hides finished agents from the deck (Claude Code is untouched) |
| `/apiarius clear show` | Shows them again |
| `/apiarius avatars [style]` | Lists the eleven avatar styles, or picks one |
| `/apiarius band` | Hides or shows the status line above the prompt |
| `/apiarius close` | Closes the deck |

Keys work while the pane has the keyboard (click it, or press ctrl+x then tab): `1` to `6` switch tabs, `Enter` opens what has the focus, `b` goes back from an agent's page, `s` opens All sessions, and `o` opens the deck in your own browser, as Open in browser does. The web page adds a few of its own, listed under Help in its Settings.

## How it works

Apiarius hooks Claude Code's events (tool calls, agent spawns, turns, messages, permission checks and notifications) into one model of the session, which the pane, the terminal and the web page all draw from. Everything it shows comes from what Claude Code and git report. Changes never credits a git hunk to an agent: the edits beside git's diff are the patches from each agent's own Edit and Write calls.

When you step in, it acts only through Claude Code's own channels: answering the questions Claude asks you, delivering your messages, TaskStop for background agents and tasks, CronDelete for schedules, and the same abort as Esc for the turn. Stop and Cancel appear only where Claude Code's permission check allows that call, and the check runs again before each press. Apiarius never grants itself a permission and never answers a permission prompt. In auto mode, where Claude Code refuses a plugin's message to a subagent, the deck asks the Orchestrator to pass yours on, and that request shows in the chat.

Where Claude Code loads its built-in guard (on a Team or Enterprise login, or a machine with managed settings), a mod's hooks on `classic.*` events, `session.compact` and `prompt.context` don't run. The agents, their tool calls and messages, Changes, Claude's questions and Stop all still work there. Permission prompts and Claude Code's notifications don't show as waiting on you, though, and Inspect has no compactions, instruction files or permission mode.

## Privacy

Apiarius makes no network requests of its own. What it hands to Claude goes through Claude Code like anything you type, and nothing is sent anywhere else.

It reads Claude Code's events for the session, the session's own transcript to recover what the deck showed after the mod reloads, and what git says about the repositories your agents work in. It keeps its files in `~/.claude/apiarius/`, in folders only you can open, and deletes a session's files there when the session ends. The one exception is the debug dump, which you turn on yourself and which stays until you delete it.

The web page runs only after you start it, with `/apiarius web` or Open in browser. It listens on 127.0.0.1, and each link to it opens one page: the page trades the one-time ticket in its link for access as it loads and takes the ticket out of the address bar, and every start of the server makes new ones. Apiarius never hands a link to Claude, and opens the Desktop's Browser pane only when you run `/apiarius web pane` or press Open in Claude's Browser pane in the deck's Settings.

Claude can read and click pages in the Desktop's Browser pane, so a page there can't tell your click from Claude's. A message, an answer or Review you send from the page in the Browser pane waits above your prompt in Claude Code until you press its Send there, and so does anything it sends to another session's deck, a Stop there included. A long or many-line message shows its Send only once you open it with More, so you see all of it first. Discard drops it, and one left there goes unsent after 10 minutes. Claude has no tool that presses that Send, and a new row never takes the keyboard from your prompt. `/apiarius web` and Open in browser, at the top of the deck (and under its Settings), open the page in your own browser with a link of their own, and there your messages go at once. Stop buttons and the deck's own settings for this session work at once from either page. If you let Claude drive your own browser too (the Claude in Chrome extension), open the page in a browser it doesn't drive.

Three things stay as they are. A Claude that drives the Browser pane can read everything the deck shows there, other sessions' decks included. A command one deck sends to another session's deck is sealed and runs there at once, so a program that can read your plugin storage could fake one, as it could already change your Claude Code settings. And the page in your own browser keeps its access in the tab's session storage, so a reload keeps working; Chrome, Edge and Firefox write that storage to disk, so a program that can read your browser's files could send from it as you, without a Send, until the server stops. Safari's files are protected by macOS.

<details>
<summary>Everything it runs, writes and reads</summary>

Apiarius makes no network requests of its own. What it hands to Claude goes through Claude Code like anything you type: your messages to agents and your answers to Claude's questions. Nothing is sent anywhere else.

`/apiarius web`, or Open in browser while the page isn't running, runs `node web/server.js` from the plugin's folder as a child process of the session. The server has no dependencies and listens on 127.0.0.1 only, on a port the system picks; a reload of the mod asks for the same port again. Every start of the server gets a new random secret on stdin, kept in memory and nowhere else. The deck seals one-time tickets with it (HMAC-SHA256), one in each link it hands out: the Browser pane's link carries a `pane` ticket and Open in browser's a `full` one. The page trades its ticket for a random handle of the same kind, sent as a header, keeps the handle in the tab's session storage so a reload keeps working, and takes the ticket out of the address bar. The server refuses a ticket used once already, any ticket or handle from an earlier start, and anything after `/apiarius web stop`, so a page left open across a restart says to open it again from the deck. Every request for the session's data needs a handle, the page's own files need none, and no cookie is set. The server marks each command with its handle's kind, and the deck holds the messages, answers and Review that come from a `pane` page, and anything it sends to another session's deck but viewing it, for your Send above the prompt. The server refuses requests addressed to any other host name, takes commands only from its own page, and can't be framed by another page. The page loads nothing from the internet. The server exits with the session, on `/apiarius web stop`, or when its parent process is gone. `/apiarius web pane` asks the Desktop's Browser pane to open the page through the pane's `preview_start` MCP tool, and Apiarius opens the pane at no other time. `/apiarius web` and Open in browser (at the right of the deck's header, and under Settings) never open the Browser pane: they run `node web/open.js`, which opens nothing but the deck's own link, taken on stdin. On macOS it hands the link to `osascript` on stdin too (`open location`), so the link is in no program's command line, where other programs of yours could read it. On Windows (cmd's `start`) and Linux (`xdg-open`) the opener has to take the link on its command line, and another program of yours could read it there while the opener runs, so the link Open in browser makes works for 30 seconds, and only once. In a terminal the deck also shows a `full` link as text to copy under its header and in Settings, and makes a new one once a page used it.

For Changes it runs read-only git commands (`config --list`, `rev-parse`, `status`, `diff`, `log`, `rev-list`, `show`, `ls-files`, `cat-file`) with `git -C` on the session's repository or the ones its agents edit in, after edits and shell commands, and every 6 seconds while a deck is open. Nothing a repository's own settings name runs: no file system monitor, signature check, submodule, remote, external diff or text conversion, and a filter driver the repository's own config defines (or that its attribute files name, so a late definition can't attach to one either) is switched off, with a notice (your global ones, such as git-lfs, keep working). Before `status` or `diff`, the only commands that could run a filter, it asks git where every attribute file is (`ls-files`, `rev-parse --git-path`), reads each one, nested and ignored ones, `info/attributes` and a `core.attributesFile` included, and switches off every filter they name. If one of them is a link, too big or unreadable, it runs no git in that repository. It reads the filter settings again after each such command, and if they changed while git ran, it drops what git printed and runs no git there again for the rest of the session. A submodule with only uncommitted changes inside it isn't listed, and a file name with control or text-direction characters shows them as replacement characters, with no diff. A symbolic link shows as its target's path, the way git shows one, never the target's content, and an untracked file whose real path lies outside the repository is left out. Untracked files and attribute files are read by `node web/files.js`, which opens each by its real path inside the repository and refuses it if any part of the path is a link, or if it isn't a plain file, so a file swapped for a link meanwhile is never read through. On Windows, which has no such open, it checks the path before and after opening it instead. It reads them again only when their size or time changed. Without Node.js, a new file shows no text.

`node web/home.js` makes Apiarius's folders and files private and removes what a session no longer needs. Short `node` one-liners read the session's process id, check whether other listed sessions' processes still run, and delete registry and inbox files the mod made. None of them runs through a shell.

It keeps its files in `~/.claude/apiarius/` (under `CLAUDE_CONFIG_DIR` when that is set, or in `APIARIUS_HOME`), with its folders 0700 and the registry, state and debug files 0600, and never follows a link there:

- `sessions/<session id>.json` (in `APIARIUS_SESSIONS` when that is set), so All sessions can list the session: its title, folder, repository, state, what needs you, what it is doing, its agents at work, its spend estimate and its process id. It is rewritten at most every 2 seconds and on a 30-second heartbeat, and deleted when the session ends or, if the session died, by another deck.
- `web/<session id>/`: the page's `state.json` and the files it loads on demand (patches, git diffs, long messages, agent pages, the timeline), written only while the web page is on or another session's deck is showing this one. That deck leaves its requests in `inbox/` there. A `/clear` or a resume empties the folder but for the inbox, the session's end deletes it, and each start deletes the folders of sessions whose process is gone.
- `debug/<session id>.json`, a dump of the deck's state, only while a `debug` folder you created exists there. It stays until you delete it.

Registry and inbox files carry an HMAC-SHA256 seal made with a random key in Claude Code's plugin storage. A deck lists only sessions whose files carry a valid seal, and refuses and deletes a command that is unsealed, altered, meant for another session, replayed or more than 2 minutes old. A session that runs an older Apiarius, or a copy installed elsewhere with its own storage, doesn't show in All sessions.

Claude Code's plugin storage keeps that key and your preferences (avatar style, the band) between sessions. The deck's snapshot and the web page's port stay in memory for the session, so a reload of the mod keeps its place. The web page's secret is never kept, so a reload of the mod starts the server with a new one. Apiarius reads the files agents edit, the session's transcript, Claude Code's settings for Inspect, and other sessions' registry files and state folders.

</details>

## Support

Report bugs and ask for features in [GitHub issues](https://github.com/yusuflkq/apiarius/issues). Report a security problem privately instead, as [SECURITY.md](SECURITY.md) describes.

A dump of what the deck believes helps with a bug. Create the folder `~/.claude/apiarius/debug/` and Apiarius writes `<session id>.json` there about 2 seconds after each change. Check that it holds nothing private before you attach it, and delete the folder to stop the dump.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). To try a clone without installing it, run `claude --plugin-dir .` in its folder. `/apiarius probe` toggles a test pane for mod authors.

```
claude plugin validate .
scripts/test.sh          # the mod's tests, one file at a time
node --test web/test/    # the server and page tests
node web/dev.js          # the web page on sample data; prints its link
```

## License

MIT. See [LICENSE](LICENSE).
