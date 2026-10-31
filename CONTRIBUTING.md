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

## Checks

CI runs these on every push and pull request to `main` (`.github/workflows/test.yml`). Run them before you open a pull request:

```bash
claude plugin validate --strict --profile directory .
claude plugin test .                                    # the mod's tests
node --test web/test/                                   # the web server and page
node web/fixtures/make-v2.mjs --check                   # the sample data is current
```

- The sample data in `web/fixtures/` is built by the mod's own code. When a change alters what the deck shows, run `node web/fixtures/make-v2.mjs` to write it again, and commit the result with the change.
- The mod's tests feed it Windows paths, so CI runs `claude plugin test` on Windows only.
- To type-check, open the mod once in an interactive session, which writes Claude Code's types to `.claude-plugin/types/`. Then run `npx --package typescript@5.6.3 tsc -p .`.
- `node web/dev.js` serves the dashboard on the sample data and prints a link (each link opens one page; it prints the next). `--pane` gives the Browser pane's kind of link, whose messages wait until you press Enter in its terminal, as they wait for Send above the prompt.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): a type such as `feat`, `fix`, `docs`, `test`, `refactor`, `chore` or `ci`, an optional scope, and a subject of 72 characters at most. One example from the history is `fix(web): remove a stale variable that broke the dev server's reset`. Keep each commit to one change.

## Issues

Report bugs and ask for features with the issue templates. They ask for your Claude Code version, where you saw the problem (the terminal, the Desktop app's side pane or the web page) and your OS. Report a security problem privately, as [SECURITY.md](SECURITY.md) describes.
