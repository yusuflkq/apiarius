# Contributing

## Run the mod from a clone

You need Claude Code 2.1.304 or later. The checks below also need Node.js 22.18 or later.

```bash
git clone https://github.com/yusuflkq/apiarius.git
cd apiarius
claude --plugin-dir .
```

Type `/apiarius` in that session to open the deck. Claude Code watches a folder loaded with `--plugin-dir`, so saving a file reloads the mod. To load the clone in every session, the Desktop app's included, set `CLAUDE_CODE_PLUGIN_DIRS` to its absolute path in the `env` block of `~/.claude/settings.json`.

Only one plugin of a name loads. If you installed Apiarius from its marketplace too, turn that copy off first with `claude plugin disable apiarius@apiarius`. A clone keeps its own plugin storage, and so its own sealing key: its decks don't list or steer sessions that run an installed copy. To keep a test session's files apart from your own, set `APIARIUS_HOME` to a scratch folder.

## Code map

Data flows one way: Claude Code's events into one model of the session, that model into one view model, and the view model onto each surface.

- `hooks/hooks.json` names the one hooks module Claude Code loads, `hooks/register.tsx`. It hooks the events and holds the session's `DeckData`, and hands three parts to modules of their own: `hooks/webServer.ts` (the web deck), `hooks/gitRunner.ts` (git, run) and `hooks/commands.ts` (`/apiarius`). Each owns its state and shares it through small accessors (`currentGit()`, `isWebOn()`), and imports from `register.tsx` what of its own it reads (`currentData()`) or asks for (`redraw`). These four and `hooks/inspectHooks.ts` are the only files with `$` calls, so the modules below stay pure. `$` goes only to a function declared in the mod (imported or not), never through an object's member: Claude Code's check of the module refuses one it cannot follow.
- `hooks/model.ts` turns each event into a change to `DeckData`: agents, calls, edits, messages, what waits on you. Beside it: `hooks/background.ts` (background shells, agents and schedules), `hooks/inspect.ts` (Inspect's records), `hooks/lane.ts` and `hooks/timeline.ts` (Org's Timeline), `hooks/repos.ts` (which repository a file belongs to).
- `hooks/web.ts` has `deckStateOf`, which builds `WebStateV2` from `DeckData`, git's state and the usage. Every surface draws that one view model. `webStateOf` wraps it as the web page's `state.json`.
- The pane and the terminal draw it with `hooks/views.tsx` and `hooks/ui/v2/`: `deck.tsx` is the header and the tabs, `now.tsx`, `chat.tsx`, `org.tsx`, `changes.tsx`, `inspect.tsx` and `settings.tsx` are the tabs, and `page.tsx` is an agent's page. `hooks/ui/band.tsx` is the line above the prompt.
- The web page draws the same model: `web/app.js` and `web/state.mjs`, then a file a tab (`web/now.mjs`, `chat.mjs`, `org.mjs`, `changes.mjs`, `inspect.mjs`, `settings.mjs`). `web/avatars.mjs` and `web/timeline.mjs` are shared with the pane.
- Git: `hooks/git.ts` builds every git command and its guards, and `hooks/gitRunner.ts` runs them (`runGit`, `refreshGit`) and reads what Changes shows. `web/files.js` reads untracked and attribute files without following links.
- The web server: `hooks/webServer.ts` starts and watches `web/server.js` (`superviseWeb`, `writeWeb`), opens the page and holds what the Browser pane's page sends in your voice (as `hooks/hold.ts` says), and `register.tsx` runs the page's commands (`runCommand`). `web/open.js` opens your own browser, and `web/home.js` keeps the home folders private.
- The registry of sessions: `hooks/registry.ts` (live) and `hooks/sessions.ts` (pure) write and read `sessions/<id>.json` and the inboxes, sealed by `hooks/seal.ts`.

Which tests cover what (each `tests/<name>.test.ts`):

- The model: `model`, `data`, `engine`, `live`, `scenario`, `words`, `clean`, `recover`, `questions`, `talk`, `background`, `clear`, `outside`.
- `deckStateOf` and the view model: `v2`, `inspect`, `timeline`.
- The pane and the terminal: `pane`, `deck`, `now`, `chat`, `org`, `orgtab`, `orgrender`, `agentpage`, `changes`, `fit`, `press`, `avatars`, `probe`.
- Git: `gitsafety`, `repos`, and `tests/gitpoc.test.mjs`, which runs real git against hostile repositories with `node --test`.
- The web deck: `web`, `hold`, `debug`, and `web/test/` for the server, the page and the Node scripts.
- Other sessions: `sessions`, `seal`.

The shared fakes are `tests/world.ts`, which answers the engine's calls for a live deck, and `tests/v2session.ts`, a sample session's data. `web/fixtures/` is the sample the web page and `/apiarius demo` show, built by `web/fixtures/make-v2.mjs` from the mod's own code.

## Checks

CI runs these on every push and pull request to `main` (`.github/workflows/test.yml`). Run them before you open a pull request:

```bash
claude plugin validate --strict --profile directory .
scripts/test.sh                                         # the mod's tests, one file at a time
scripts/typecheck.sh                                    # tsc
node --test web/test/                                   # the web server and page
node web/fixtures/make-v2.mjs --check                   # the sample data is current
```

- The sample data in `web/fixtures/` is built by the mod's own code. When a change alters what the deck shows, run `node web/fixtures/make-v2.mjs` to write it again, and commit the result with the change.
- `scripts/test.sh` runs the mod's tests one file at a time and prints a summary, as CI does. `claude plugin test .` runs every file at once, and on a busy machine a test can run past the 5 seconds the kit gives it. Name files to run only those (`scripts/test.sh web.test.ts`), and set `CLAUDE` to try another Claude Code. It needs bash: macOS, Linux, or Git Bash on Windows.
- CI runs the checks on Ubuntu, macOS and Windows. A test of a path only Windows spells, with a drive letter or an 8.3 short name, runs on Windows alone, and its twin with POSIX paths runs on the others.
- `scripts/typecheck.sh` type-checks the mod with `tsc`, as CI does on Ubuntu and macOS. It checks against the types Claude Code writes to `.claude-plugin/types/` when it loads the mod in an interactive session. When there are none yet, or with `--fresh`, it starts a short signed-out session to write them, with no prompt typed.
- `node web/dev.js` serves the dashboard on the sample data and prints a link (each link opens one page; it prints the next). `--pane` gives the Browser pane's kind of link, whose messages wait until you press Enter in its terminal, as they wait for Send above the prompt.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): a type such as `feat`, `fix`, `docs`, `test`, `refactor`, `chore` or `ci`, an optional scope, and a subject of 72 characters at most. One example from the history is `fix(web): remove a stale variable that broke the dev server's reset`. Keep each commit to one change.

## Issues

Report bugs and ask for features with the issue templates. They ask for your Claude Code version, where you saw the problem (the terminal, the Desktop app's side pane or the web page) and your OS. Report a security problem privately, as [SECURITY.md](SECURITY.md) describes.
