/**
 * Every session on the sample's machine (All sessions): the v2 sample's own
 * session (tests/v2session.ts, "this chat") and four others, each recorded
 * through the model's own recorders as a live one is, at the sample's `now`.
 * web/fixtures/make-v2.mjs writes them as the sample's registry
 * (web/fixtures/sessions.v2.json: each session's file as its deck writes it,
 * `dir` under web/fixtures) and the other sessions' decks
 * (web/fixtures/sessions/<id>/state.json and agents/), for `/deck demo`,
 * `web/dev.js` and the tests.
 *
 * - Agent Deck terminal faces (the Desktop, agent-deck): two agents at work;
 *   a fork of another session, so its spend counts its parent's.
 * - Fix the flaky CI job (Windows Terminal, api-server): the Orchestrator's
 *   own `gh run view` in flight.
 * - Landing page copy (a terminal, site): its `rm -rf dist` waits on your OK.
 * - Notes sync (the Desktop, notes): idle, its answer given; its
 *   deck an older build's, which reads no inbox (answer it in its window).
 *
 * Plain TypeScript that Node runs as it is (no `claude-code` import).
 */
import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import * as S from '../hooks/sessions'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData } from '../types'
import { SAMPLE_NOW, ago, v2Session } from './v2session'

/** One of the sample's other sessions: its id, where its deck's folder sits under web/fixtures, its state and its agent files. */
export type SampleDeck = { id: string; dir: string; state: W.WebStateV2; agentFiles: { id: string; text: string }[] }

/** The sample's registry and decks: when it was made, this chat's id, each session's file, the list as this chat's deck shows it, and the other sessions' decks. */
export type SampleSessions = { now: number; me: string; entries: S.SessionEntry[]; view: S.SessionsV2; decks: SampleDeck[] }

/** A session begun `minutes` ago on `prompt` (its first line its headline), the Orchestrator at work in its turn. */
function begun(minutes: number, prompt: string, model = 'claude-opus-5-5'): { data: DeckData; main: DeckAgent } {
  const data = M.emptyData(ago(minutes))
  const main = M.agentOf(data, M.MAIN) as DeckAgent
  Object.assign(main, { status: 'running', model })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', text: prompt, at: ago(minutes - 1) })
  M.noteGoal(data, 'goal', { text: prompt, origin: 'composer', at: ago(minutes - 1) })
  return { data, main }
}

/** An agent the Orchestrator started, at work. */
function started(data: DeckData, one: { id: string; name: string; description: string; prompt: string; at: number }): DeckAgent {
  const { agent } = M.noteSpawn(data, { toolUseId: `toolu_sp_${one.id.slice(0, 6)}`, agentId: one.id, parentId: M.MAIN, name: one.name, description: one.description, prompt: one.prompt, type: 'general-purpose', background: true, isTeammate: false, model: 'claude-sonnet-4-5', at: one.at })
  M.addMessage(data, { from: M.MAIN, to: agent.id, kind: 'spawn', text: one.prompt, at: one.at })
  return agent
}

/** A deck of the sample as its mod would write it: its state at the sample's now, and its agents' files. */
function deckOf(id: string, data: DeckData, cwd: string, costUsd: number, contextPercent: number): SampleDeck {
  const state = W.deckStateOf(data, emptyGit(), { startedAt: data.startedAt, contextPercent, costUsd, limits: [] }, SAMPLE_NOW, id, cwd)
  return { id, dir: `sessions/${id}`, state, agentFiles: W.agentFilesOf(data) }
}

const FACES = 'C:\\Users\\sam\\code\\agent-deck'
const CI = 'C:\\Users\\sam\\code\\api-server'
const SITE = 'C:\\Users\\sam\\code\\site'
const NOTES = 'C:\\Users\\sam\\notes'

/** Agent Deck terminal faces: on the Desktop, builder's tests and painter's edit in flight; begun as a fork of another session (`claude --resume … --fork-session`). */
function faces(): SampleDeck {
  const { data } = begun(25, 'Agent Deck terminal faces\n\nGive each agent a glyph of its own in the terminal, in its avatar colour, with its status mark beside it.')
  data.isFork = true
  const builder = started(data, { id: 'c1a2b3c4d5e6f708', name: 'builder', description: 'Build and test the faces', prompt: 'Add terminalFace to web/avatars.mjs and run the tests.', at: ago(20) })
  M.beginTool(data, builder, M.activityOf('toolu_fc_b1', 'Bash', { command: 'npm test', description: 'Run the tests' }, FACES, ago(0.6)))
  const painter = started(data, { id: 'd1e2f3a4b5c6d708', name: 'painter', description: 'Draw the glyphs', prompt: 'Draw a glyph per agent in hooks/ui/v2/look.tsx.', at: ago(18) })
  M.beginTool(data, painter, M.activityOf('toolu_fc_p1', 'Edit', { file_path: `${FACES}\\hooks\\ui\\v2\\look.tsx` }, FACES, ago(0.3)))
  return deckOf('8b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', data, FACES, 1.8, 22)
}

/** Fix the flaky CI job: in Windows Terminal, the Orchestrator reads the failed run's log itself. */
function ci(): SampleDeck {
  const { data, main } = begun(12, 'Fix the flaky CI job\n\nThe integration tests fail one run in five on CI. Find out why and fix it.')
  M.beginTool(data, main, M.activityOf('toolu_ci_m1', 'Bash', { command: 'gh run view 1842 --log', description: 'Read the failed run’s log' }, CI, ago(0.4)))
  return deckOf('2c4e6a8b-0d1f-4a3c-8e5b-7d9f1a3c5e70', data, CI, 0.64, 18)
}

/** Landing page copy: in a terminal, its `rm -rf dist` waits on your OK. */
function site(): SampleDeck {
  const { data, main } = begun(30, 'Landing page copy\n\nTighten the hero and the pricing blurb, then rebuild the site.')
  const clean = { command: 'rm -rf dist', description: 'Remove the old build' }
  M.beginTool(data, main, M.activityOf('toolu_st_m1', 'Bash', clean, SITE, ago(9)))
  M.notePending(data, M.permissionOf({ id: 'toolu_st_m1', tool: 'Bash', input: clean, agentId: M.MAIN, at: ago(9) }, SITE))
  return deckOf('6e8a0c2e-4b6d-4f8a-9c1e-3a5c7e9b1d24', data, SITE, 0.22, 9)
}

/** Notes sync: on the Desktop, idle, its answer given. */
function notes(): SampleDeck {
  const { data, main } = begun(150, 'Notes sync\n\nSync my notebooks into the notes folder as Markdown.', 'claude-sonnet-4-5')
  const answer = 'Synced 14 notebooks.\n\nEach is a Markdown file under `notes/remarkable/`, its pages in order.'
  M.addMessage(data, { from: M.MAIN, to: M.YOU, kind: 'answer', text: answer, at: ago(120) })
  M.noteMainAnswer(main, answer)
  Object.assign(main, { status: 'idle' })
  return deckOf('9a7c5e3b-1d2f-4e6a-8c0b-2e4f6a8c0d13', data, NOTES, 0.31, 7)
}

/** The sample's registry, as each session's deck writes its file, and the four other sessions' decks. */
export function sampleSessions(): SampleSessions {
  const own = v2Session()
  const me = W.deckStateOf(own.data, own.git, own.usage, own.now, own.sessionId, own.cwd, own.answerable, own.gitDiffs)
  const decks = [faces(), ci(), site(), notes()]
  const facts = { faces: { surface: 'desktop', terminal: '', repo: 'agent-deck', at: ago(0.3) }, ci: { surface: 'terminal', terminal: 'Windows Terminal', repo: 'api-server', at: ago(0.4) }, site: { surface: 'terminal', terminal: '', repo: 'site', at: ago(9) }, notes: { surface: 'desktop', terminal: '', repo: '', at: ago(120) } } as const
  const entryOf = (deck: SampleDeck, fact: { surface: S.SessionSurface; terminal: string; repo: string; at: number }, pid: number, inbox = true): S.SessionEntry => ({
    ...S.entryOf(deck.state, { surface: fact.surface, terminal: fact.terminal, repo: fact.repo, pid, dir: deck.dir, updatedAt: fact.at, heartbeatAt: SAMPLE_NOW }),
    inbox,
  })
  const [f, c, s, n] = decks as [SampleDeck, SampleDeck, SampleDeck, SampleDeck]
  const mine = S.entryOf(me, { surface: 'desktop', terminal: '', repo: 'acme-api', pid: 4242, dir: '', updatedAt: ago(2), heartbeatAt: SAMPLE_NOW })
  const entries = [
    mine,
    entryOf(f, facts.faces, 4310),
    entryOf(c, facts.ci, 4388),
    entryOf(s, facts.site, 4402),
    // an older build's deck: it lists itself, and reads no inbox
    entryOf(n, facts.notes, 4417, false),
  ]
  const view = S.sessionsViewOf(entries.slice(1), mine, SAMPLE_NOW)
  return { now: SAMPLE_NOW, me: own.sessionId, entries, view, decks }
}
