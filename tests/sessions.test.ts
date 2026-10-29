/**
 * Every session on this machine (hooks/sessions.ts, hooks/registry.ts):
 * the registry's files and the list, pure; then the deck's own file written
 * on its start and its heartbeat and gone at session.end, the others' read
 * and listed (the header's "All sessions", `s`, the band's "◆ 1 other
 * session needs you"), another session's deck opened read-only from its
 * folder, and steering through its own deck's inbox only: a command
 * another deck sent runs here as the page's own does, and one for a deck
 * that reads no inbox is refused. The registry folder is the test's
 * (`AGENT_DECK_SESSIONS`), never the person's.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import * as S from '../hooks/sessions'
import * as W from '../hooks/web'
import { SAMPLE_NOW, v2Session } from './v2session'
import { sampleSessions } from './v2sessions'
import { command, deck, newWorld, NOW, work, world, type World } from './world'

const REG = '/reg'
const OTHER = 'other-1'
const OTHER_DIR = '/other/.web/other-1'
const OLD = 'old-2'
const OLD_DIR = '/old/.web/old-2'

// ---------------------------------------------------------------------------
// The registry and the list: pure.

/** The v2 sample's own state, as its deck builds it. */
function sampleState(): W.WebStateV2 {
  const s = v2Session()
  return W.deckStateOf(s.data, s.git, s.usage, s.now, s.sessionId, s.cwd, s.answerable, s.gitDiffs)
}

/** A registry file of another session, live at `now`. */
function entry(id: string, extra: Partial<S.SessionEntry> = {}): S.SessionEntry {
  return { v: 1, id, title: `Session ${id}`, cwd: `C:\\code\\${id}`, repo: '', surface: 'terminal', terminal: '', state: 'idle', need: null, needs: 0, working: 0, live: '', costUsd: 0.5, startedAt: SAMPLE_NOW - 600_000, updatedAt: SAMPLE_NOW - 60_000, heartbeatAt: SAMPLE_NOW - 10_000, pid: 77, dir: `/x/.web/${id}`, inbox: true, ...extra }
}

test('the registry folder: AGENT_DECK_SESSIONS, else under CLAUDE_CONFIG_DIR, else ~/.claude; none with no home', () => {
  expect(S.registryDirOf({ override: 'D:\\tmp\\reg\\', configDir: 'C:/cfg', home: 'C:/Users/sam' })).toBe('D:\\tmp\\reg')
  expect(S.registryDirOf({ configDir: 'C:/cfg/', home: 'C:/Users/sam' })).toBe('C:/cfg/agent-deck/sessions')
  expect(S.registryDirOf({ home: 'C:\\Users\\sam' })).toBe('C:\\Users\\sam/.claude/agent-deck/sessions')
  expect(S.registryDirOf({})).toBe('')
  expect(S.entryPathOf('/reg', 'a1-b2')).toBe('/reg/a1-b2.json')
  expect(S.entryPathOf('/reg', '../x')).toBe('')
  expect(S.inboxPathOf('/s/.web/a', 'me-1')).toBe('/s/.web/a/inbox/me-1.json')
  // only a folder the deck makes, `.web/<its id>`, is read or written
  expect(S.isStateDirOf('C:\\mod\\.web\\a1', 'a1')).toBe(true)
  expect(S.isStateDirOf('C:/mod/.web/a1/', 'a1')).toBe(true)
  expect(S.isStateDirOf('C:/mod/.web/b2', 'a1')).toBe(false)
  expect(S.isStateDirOf('C:/Windows/System32', 'System32')).toBe(false)
  expect(S.isStateDirOf('C:/mod/.web/../.web/a1', 'a1')).toBe(false)
})

test('a session`s file says what its header says: its request`s headline, its state, the first need in a line, the agents at work, what it is doing, its spend', () => {
  const state = sampleState()
  const one = S.entryOf(state, { surface: 'desktop', terminal: '', repo: 'acme-api', pid: 4242, dir: '/m/.web/s', updatedAt: SAMPLE_NOW - 1000, heartbeatAt: SAMPLE_NOW })
  expect(one).toMatchObject({ v: 1, id: state.session.id, title: state.header.goal?.headline, state: 'waiting', needs: state.needs.length, costUsd: 4.12, pid: 4242, inbox: true, dir: '/m/.web/s', surface: 'desktop', repo: 'acme-api' })
  expect(one.need).toBe('Orchestrator asks: Which store should back the limiter in production?')
  // the times are no part of what it says: a heartbeat alone is no change
  expect(S.entryKeyOf({ ...one, heartbeatAt: 1, updatedAt: 2 })).toBe(S.entryKeyOf(one))
  // each kind of need in a line
  const permission = state.needs.find(need => need.kind === 'permission')!
  expect(S.needLineOf(permission)).toBe('Needs your OK: Bash npm test -- rateLimit')
  const notification = state.needs.find(need => need.kind === 'notification')!
  expect(S.needLineOf(notification)).toBe(`${notification.agentName}: ${notification.text}`)
})

test('what a session is doing, derived from its own rows: its agents at work and the first one`s call; the Orchestrator`s call; idle, its latest answer; else nothing', () => {
  const sample = sampleSessions()
  const said = Object.fromEntries(sample.decks.map(deck => [deck.state.header.goal?.headline ?? '', S.liveLineOf(deck.state)]))
  expect(said).toEqual({
    'Agent Deck terminal faces': '2 agents working · builder: Bash npm test',
    'Fix the flaky CI job': 'Orchestrator: Bash gh run view 1842 --log',
    'Landing page copy': 'Orchestrator: Bash rm -rf dist',
    'Notes sync': 'Finished: “Synced 14 notebooks.”',
  })
})

test('a registry file read: every field checked, an unknown surface none, a bad id or a stranger`s file nothing', () => {
  const good = entry('a1', { surface: 'desktop', state: 'waiting', need: 'Orchestrator asks: Which?' })
  expect(S.entryFromText(JSON.stringify(good))).toEqual(good)
  expect(S.entryFromText(JSON.stringify({ ...good, surface: 'toaster', state: 'busy', pid: -3 }))).toMatchObject({ surface: '', state: 'idle', pid: null })
  expect(S.entryFromText(JSON.stringify({ ...good, id: '../../x' }))).toBeNull()
  expect(S.entryFromText(JSON.stringify({ ...good, v: 2 }))).toBeNull()
  expect(S.entryFromText('{"v":1,"id":"a1"')).toBeNull()
  expect(S.entryFromText('[1,2]')).toBeNull()
})

test('a file whose heartbeat stopped: left out at once; checked against the system, then cleaned once its process is gone, or long after; an ended one at once', () => {
  const now = SAMPLE_NOW
  expect(S.staleStepOf(entry('a'), now)).toBe('keep')
  expect(S.isLiveEntry(entry('a'), now)).toBe(true)
  const silent = entry('a', { heartbeatAt: now - S.STALE_MS - 1 })
  expect(S.isLiveEntry(silent, now)).toBe(false)
  expect(S.staleStepOf(silent, now)).toBe('check')
  expect(S.staleStepOf(silent, now, true)).toBe('keep')
  expect(S.staleStepOf(silent, now, false)).toBe('gone')
  expect(S.staleStepOf({ ...silent, pid: null }, now)).toBe('gone')
  expect(S.staleStepOf(entry('a', { heartbeatAt: now - S.GONE_MS - 1 }), now, true)).toBe('gone')
  expect(S.staleStepOf(entry('a', { endedAt: now - 5 }), now)).toBe('gone')
  expect(S.isLiveEntry(entry('a', { endedAt: now - 5 }), now)).toBe(false)
})

test('the list: this chat first, then the others the newest started first (rows stay put while they work); the stale and the ended left out; how they stand in a line; the other sessions waiting on you for the band', () => {
  const now = SAMPLE_NOW
  const me = entry('me', { state: 'working', startedAt: now - 60_000 })
  const older = entry('older', { state: 'waiting', need: 'Needs your OK: Bash rm -rf dist', startedAt: now - 3_600_000, updatedAt: now - 540_000, surface: 'terminal', terminal: 'Windows Terminal', repo: 'site' })
  const newer = entry('newer', { state: 'working', live: 'Orchestrator: Bash gh run view', startedAt: now - 120_000, updatedAt: now - 5_000, surface: 'desktop', inbox: false })
  const stale = entry('stale', { heartbeatAt: now - S.STALE_MS - 1 })
  const ended = entry('ended', { endedAt: now - 1 })
  const view = S.sessionsViewOf([older, stale, newer, ended, { ...me, state: 'idle' }], me, now)
  expect(view.rows.map(row => [row.id, row.isMe])).toEqual([
    ['me', true],
    ['newer', false],
    ['older', false],
  ])
  expect(view.text).toBe('3 on this machine · 1 waiting on you · 2 working')
  expect(view.others).toEqual({ waiting: 1, working: 1 })
  expect(view.rows[2]).toMatchObject({ stateText: 'Waiting on you', place: 'Terminal · Windows Terminal', repo: 'site', need: 'Needs your OK: Bash rm -rf dist', say: 'Needs your OK: Bash rm -rf dist', cost: '≈$0.50', age: '9m', canOpen: true, canSteer: true })
  // a deck that reads no inbox opens, read-only, and is answered in its window
  expect(view.rows[1]).toMatchObject({ place: 'Desktop', repo: 'newer', say: 'Orchestrator: Bash gh run view', age: 'now', canOpen: true, canSteer: false })
  expect(S.othersLineOf(view)).toBe('1 other session needs you')
  expect(S.othersLineOf({ others: { waiting: 2, working: 0 } })).toBe('2 other sessions need you')
  expect(S.othersLineOf(null)).toBeNull()
})

test('the spend in the list: /cost`s estimate, "≈$4.12", whole dollars from $100; a fork`s file says it is one, and its row that its spend counts its parent`s', () => {
  const now = SAMPLE_NOW
  const state = sampleState()
  const facts = { surface: 'desktop' as const, terminal: '', repo: 'acme-api', pid: 4242, dir: '/m/.web/s', updatedAt: now - 1000, heartbeatAt: now }
  const fork = S.entryOf({ ...state, session: { ...state.session, isFork: true } }, facts)
  expect(fork.isFork).toBe(true)
  expect('isFork' in S.entryOf(state, facts)).toBe(false)
  // read back from its file as written; anything but true says nothing of it
  expect(S.entryFromText(JSON.stringify(fork))?.isFork).toBe(true)
  expect('isFork' in (S.entryFromText(JSON.stringify({ ...fork, isFork: 'yes' })) ?? {})).toBe(false)
  const view = S.sessionsViewOf([entry('big', { costUsd: 491.37, isFork: true }), entry('small', { costUsd: 4.123 }), entry('unknown', { costUsd: null, isFork: true })], null, now)
  expect(view.rows.map(row => [row.id, row.cost, row.costNote])).toEqual([
    ['big', '≈$491', 'incl. its parent’s'],
    ['small', '≈$4.12', ''],
    ['unknown', '', ''],
  ])
})

test('the band counts the other sessions waiting on you: "◆ 1 other session needs you", after this one`s own parts', () => {
  const state = sampleState()
  const view = S.sessionsViewOf([entry('a', { state: 'waiting' }), entry('b', { state: 'waiting' })], null, SAMPLE_NOW)
  const band = W.bandOf({ ...state, sessions: view })
  expect(band?.parts.at(-1)).toEqual({ kind: 'sessions', glyph: '◆', count: 2, text: '2 other sessions need you' })
  expect(band?.text.endsWith(' · ◆ 2 other sessions need you')).toBe(true)
  // nothing of this session's: the others alone still raise it
  const quiet = { agents: [], needs: [], sessions: view }
  expect(W.bandOf(quiet)?.text).toBe('◆ 2 other sessions need you')
  expect(W.bandOf({ agents: [], needs: [] })).toBeNull()
})

test('an inbox: a viewer`s look and its chat or answer commands, each with its id; anything else left out; the newest 20, none past two minutes', () => {
  const now = SAMPLE_NOW
  const file = S.inboxWith('me-1', now, now + S.VIEW_MS, [{ at: now - S.COMMAND_MS - 1, cmd: { cmd: 'chat', id: 'old', agentId: 'main', text: 'x' } }], { cmd: 'answer', id: 'a1', callId: 'toolu_1', answers: { 'Which?': 'Redis' } })
  expect(file).toEqual({ v: 1, from: 'me-1', at: now, viewUntil: now + S.VIEW_MS, cmds: [{ at: now, cmd: { cmd: 'answer', id: 'a1', callId: 'toolu_1', answers: { 'Which?': 'Redis' } } }] })
  const read = S.inboxFromText(JSON.stringify({ ...file, cmds: [...file.cmds, { at: now, cmd: { cmd: 'review', id: 'r', text: 'x' } }, { at: now, cmd: { cmd: 'chat', agentId: 'main', text: 'no id' } }] }))
  expect(read?.cmds.map(one => one.cmd.id)).toEqual(['a1'])
  expect(S.inboxFromText(JSON.stringify({ ...file, from: '../x' }))).toBeNull()
  // a page command for another session: view, chat or answer, naming it; none for this one
  expect(S.sessionCmdOf({ cmd: 'chat', id: 'c', agentId: 'main', text: 'hi', session: 'other-1' }, 'me-1')).toEqual({ session: 'other-1', cmd: { cmd: 'chat', id: 'c', agentId: 'main', text: 'hi' } })
  expect(S.sessionCmdOf({ cmd: 'view', session: 'other-1' }, 'me-1')).toEqual({ session: 'other-1', cmd: { cmd: 'view' } })
  expect(S.sessionCmdOf({ cmd: 'stopAgent', agentId: 'x', session: 'other-1' }, 'me-1')).toBeNull()
  expect(S.sessionCmdOf({ cmd: 'chat', agentId: 'main', text: 'hi', session: 'me-1' }, 'me-1')).toBeNull()
  expect(S.sessionCmdOf({ cmd: 'chat', agentId: 'main', text: 'hi' }, 'me-1')).toBeNull()
})

test('another session`s state as a deck shows it: read-only, its questions answerable only where its deck takes answers from another, its own list left out', () => {
  const state = { ...sampleState(), sessions: S.sessionsViewOf([], null, SAMPLE_NOW) }
  const shown = S.viewedStateOf(state, false)
  expect('sessions' in shown).toBe(false)
  expect(shown.needs.some(need => need.isAnswerable)).toBe(false)
  expect(S.viewedStateOf(state, true).needs.filter(need => need.isAnswerable).map(need => need.id)).toEqual(state.needs.filter(need => need.isAnswerable).map(need => need.id))
  // a state file: the deck's (v2 under `v2`) or the sample's (bare)
  expect(JSON.parse(S.stateFileV2Of(JSON.stringify({ v: 1, now: 1, v2: state })) ?? '{}').v).toBe(2)
  expect(JSON.parse(S.stateFileV2Of(JSON.stringify(state)) ?? '{}').v).toBe(2)
  expect(S.stateFileV2Of('{"v":1,"empty":true}')).toBeNull()
})

// ---------------------------------------------------------------------------
// The deck: its file, the others', the pane, the inbox, another session's deck.

type Disk = { files: Map<string, string> }

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

/** The test's own files beneath the deck (the world reads none): the registry and the other sessions' folders, read and listed; the surfaces the session draws on. */
function disk(on: On, d: Disk) {
  on('fs.list', ($, e) => {
    const dir = norm(e.path).replace(/\/+$/, '')
    const names = [...d.files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
    if (names.length === 0) return { deny: 'no such folder' }
    return { value: names.map(path => ({ name: path.slice(dir.length + 1), kind: 'file' as const, size: (d.files.get(path) ?? '').length, mtimeMs: NOW + (d.files.get(path) ?? '').length, isLink: false })) }
  })
  on('fs.read', ($, e) => {
    const text = d.files.get(norm(e.path))
    return text !== undefined ? { value: text } : { deny: 'no such file' }
  })
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
}

/** Another session's file in the test's registry: live, its folder `dir`. */
function listed(d: Disk, id: string, dir: string, extra: Partial<S.SessionEntry> = {}) {
  d.files.set(`${REG}/${id}.json`, JSON.stringify({ ...entry(id, { title: id === OTHER ? 'Landing page copy' : 'Notes sync', state: 'waiting', need: 'Needs your OK: Bash rm -rf dist', startedAt: NOW - 60_000, updatedAt: NOW - 30_000, heartbeatAt: NOW, dir }), ...extra }))
}

/** The engine with the test's registry and another session listed (`other-1`, its deck the sample's Landing page copy), then the session started (by `begin`: session.start, or the world's `work`). */
async function started($: Engine, on: On, w: World = newWorld(), d: Disk = { files: new Map() }, begin: ($: Engine) => Promise<void> = async one => void (await one.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' }))) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { AGENT_DECK_SESSIONS: REG })
  disk(on, d)
  world(on, w)
  listed(d, OTHER, OTHER_DIR)
  const site = sampleSessions().decks.find(one => one.state.header.goal?.headline === 'Landing page copy')!
  d.files.set(`${OTHER_DIR}/state.json`, JSON.stringify({ v: 1, now: NOW, v2: { ...site.state, session: { ...site.state.session, id: OTHER } } }))
  for (const file of site.agentFiles) d.files.set(`${OTHER_DIR}/agents/${file.id}.json`, file.text)
  await begin($)
  await clock.advance(1000)
  return { clock, w, d }
}

/** This deck's own registry files written, oldest first. */
function ownEntries(w: World): S.SessionEntry[] {
  return w.writes.filter(one => norm(one.path) === `${REG}/session-1.json`).map(one => JSON.parse(one.text) as S.SessionEntry)
}

function pane(surface: 'terminal' | 'desktop', bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 400, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }
}

test('with no registry folder known (no home, as in every other test) the deck lists nothing and writes no file of the registry', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(60_000)
  expect(w.writes.filter(one => /agent-deck[\\/]sessions|[\\/]inbox[\\/]/.test(one.path))).toEqual([])
})

test('the deck writes its own file at its start (its state folder, its process, that it reads an inbox), again on its heartbeat, and marks it ended then removes it at session.end; a /clear keeps it', async ($, on) => {
  const { clock, w } = await started($, on)
  const first = ownEntries(w)
  expect(first.length).toBe(1)
  expect(first[0]).toMatchObject({ v: 1, id: 'session-1', cwd: '/work', surface: 'desktop', pid: 4242, inbox: true, heartbeatAt: NOW })
  expect(S.isStateDirOf(first[0]!.dir, 'session-1')).toBe(true)
  // the heartbeat: written again, its heartbeat moved; with nothing new, what it says and when it last changed stay
  await clock.advance(S.HEARTBEAT_MS)
  await clock.advance(S.HEARTBEAT_MS)
  const beats = ownEntries(w)
  expect(beats.length).toBeGreaterThanOrEqual(3)
  const [before, after] = beats.slice(-2) as [S.SessionEntry, S.SessionEntry]
  expect(after.heartbeatAt - before.heartbeatAt).toBe(S.HEARTBEAT_MS)
  expect(after.updatedAt).toBe(before.updatedAt)
  expect(S.entryKeyOf(after)).toBe(S.entryKeyOf(before))
  // a /clear: the process goes on, its file stays
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { sessionId: 'session-1' } } as never)
  expect(ownEntries(w).some(one => one.endedAt !== undefined)).toBe(false)
  // the session ends: its file says so first (a deck reading it leaves it out and cleans it), then goes (node removes it: the engine's files never do)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { sessionId: 'session-1' } } as never)
  expect(ownEntries(w).at(-1)?.endedAt).toBeGreaterThan(0)
  expect(S.isLiveEntry(ownEntries(w).at(-1)!, NOW)).toBe(false)
  // and nothing is written after it
  const count = ownEntries(w).length
  await clock.advance(S.HEARTBEAT_MS * 2)
  expect(ownEntries(w).length).toBe(count)
})

test('the spend keeps live with the deck shut: a measurement that says the cost moved reads /cost again (nothing polls), and this deck`s file says it within 2 s', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const { clock, w } = await started($, on)
  expect(ownEntries(w).at(-1)?.costUsd).toBe(1.25)
  // no pane and no web deck: nothing reads /cost again on its own, the heartbeat writing what was read
  w.costUsd = 7.5
  await clock.advance(S.HEARTBEAT_MS + 1000)
  expect(ownEntries(w).at(-1)?.costUsd).toBe(1.25)
  // a measurement whose cost stayed reads nothing
  const measured = { context: { window: 200_000, tokens: 24_000, percent: 12 }, rateLimits: [] }
  await $.session.measure({ ...measured, cost: { usd: 1.25 }, changed: ['rateLimits'] })
  await clock.advance(S.ENTRY_WRITE_MS + 500)
  expect(ownEntries(w).at(-1)?.costUsd).toBe(1.25)
  // Claude Code measured the turn and its cost grew: read again, the file says it
  await $.session.measure({ ...measured, cost: { usd: 7.5 }, changed: ['context', 'cost'] })
  await clock.advance(S.ENTRY_WRITE_MS + 500)
  expect(ownEntries(w).at(-1)?.costUsd).toBe(7.5)
  // and this chat's row in the list
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ key: 'session-row:session-1' }))?.text).toContain('≈$7.50')
  await ui.unmount()
})

test('a session Claude Code began as a fork (its SessionStart says `fork`, just before session.start) says so in its file and its row, its spend "incl. its parent`s"; a reload keeps it; a /clear starts a session that is none', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  const { clock, w } = await started($, on, newWorld(), { files: new Map() }, async one => {
    await one.classic.SessionStart({ source: 'fork' })
    await one.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  })
  expect(ownEntries(w).at(-1)).toMatchObject({ costUsd: 1.25, isFork: true })
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(pane(surface))
    const mine = (await ui.find({ key: 'session-row:session-1' }))?.text ?? ''
    expect(mine).toContain('≈$1.25')
    expect(mine).toContain('incl. its parent’s')
    expect((await ui.find({ key: `session-row:${OTHER}` }))?.text).not.toContain('parent')
    await ui.unmount()
  }
  // a reload hears no SessionStart: its snapshot keeps the fork
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(S.HEARTBEAT_MS)
  expect(ownEntries(w).at(-1)?.isFork).toBe(true)
  // a /clear: a new conversation, no fork's
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(S.ENTRY_WRITE_MS + 500)
  expect('isFork' in (ownEntries(w).at(-1) ?? {})).toBe(false)
})

test('the others listed: the header`s "◆ 1 other session needs you" and All sessions (hotkey s); s opens the list over the tab, this chat first; b goes back; the band says it too', async ($, on) => {
  const { clock } = await started($, on)
  await $.command.run(deck(''))
  await clock.advance(3000)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(pane(surface))
    const header = await ui.find({ key: 'deck:header' })
    expect(header?.text).toContain('◆ 1 other session needs you')
    expect((await ui.find({ key: 'key:s' }))?.props).toMatchObject({ label: 'All sessions', hotkey: 's' })
    await ui.press({ key: 'key:s' })
    await clock.advance(500)
    await ui.redraw()
    const list = await ui.find({ key: 'sessions' })
    expect(list?.text).toContain('All sessions')
    expect(list?.text).toContain('2 on this machine · 1 waiting on you')
    const rows = (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('session:'))
    expect(rows).toEqual(['session:session-1', `session:${OTHER}`])
    const other = await ui.find({ key: `session-row:${OTHER}` })
    expect(other?.text).toContain('Landing page copy')
    expect(other?.text).toContain('Needs your OK: Bash rm -rf dist')
    expect(other?.text).toContain('Waiting on you')
    // "this chat": its tag, an image on the desktop, its word on the terminal
    if (surface === 'terminal') expect((await ui.find({ key: 'session-row:session-1' }))?.text).toContain('this chat')
    else expect(JSON.stringify(await ui.drawn())).toContain('"alt":"this chat"')
    // the tabs dim while it shows; b goes back to the tab
    expect((await ui.find({ key: 'tab:now' }))?.props).toMatchObject({ dimColor: true })
    await ui.press({ key: 'key:b' })
    await clock.advance(500)
    await ui.redraw()
    expect(await ui.find({ key: 'sessions' })).toBeUndefined()
    await ui.unmount()
  }
  // the band above the prompt counts it
  const band = await $.ui.mount({ plugin: 'agent-deck', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} } })
  expect(JSON.stringify(await band.drawn())).toContain('1 other session needs you')
  await band.unmount()
})

/** An element as a drawing describes it. */
type Node = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The elements under `el` (itself too) that `test` takes, in document order. */
function nodesIn(el: unknown, test: (node: Node) => boolean): Node[] {
  if (!el || typeof el !== 'object') return []
  const node = el as Node
  return [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(child => nodesIn(child, test))]
}

/** The words a drawn element holds, its strings and its images' alt text, run together. */
function wordsIn(el: unknown): string {
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  if (!el || typeof el !== 'object') return ''
  const node = el as Node
  return `${typeof node.props?.alt === 'string' ? node.props.alt : ''}${(node.children ?? []).map(wordsIn).join('')}`
}

test('All sessions at any width: the title cuts beside "this chat", which never shrinks; where it runs and what it says cut before the row`s right; the spend, then the state`s word, left out where the pane is narrow, and the header`s way in says "◆ 1" there', async ($, on) => {
  const { clock } = await started($, on)
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const columns of [84, 56, 40, 24]) {
      const ui = await $.ui.mount(pane(surface, columns))
      const drawn = await ui.drawn()
      const [mine] = nodesIn(drawn, node => (node.key ?? node.props?.key) === 'session-row:session-1')
      // the title's line: a column Box that may shrink to nothing, holding the title's Button, then the tag's Box, which never shrinks
      const [line] = nodesIn(mine, node => node.type === 'Box' && node.children?.length === 2 && wordsIn(node.children[1]).includes('this chat'))
      const [title, tagged] = (line?.children ?? []) as Node[]
      expect(title?.props).toMatchObject({ flexDirection: 'column', flexShrink: 1, minWidth: 0 })
      expect(nodesIn(title, node => (node.key ?? node.props?.key) === 'session:session-1').length).toBe(1)
      expect(tagged?.props).toMatchObject({ flexShrink: 0 })
      // where it runs and what it says: each may shrink, each cut at its end
      const [other] = nodesIn(drawn, node => (node.key ?? node.props?.key) === `session-row:${OTHER}`)
      const said = nodesIn(other, node => node.type === 'Text' && wordsIn(node).includes('Needs your OK'))[0]
      expect(said?.props).toMatchObject({ wrap: 'truncate-end' })
      expect(nodesIn(other, node => node.type === 'Box' && node.props?.flexShrink === 0 && nodesIn(node, one => one.type === 'Text' && wordsIn(one).includes('Terminal')).length > 0)).toEqual([])
      // the right of a row: its state's word from 48 cells, its spend from 64, its age always
      const words = wordsIn(other)
      expect([words.includes('Waiting on you'), words.includes('≈$0.50')]).toEqual([columns >= 48, columns >= 64])
      // the header's way in: its words where they fit, "◆ 1" alone where not
      const header = wordsIn(nodesIn(drawn, node => (node.key ?? node.props?.key) === 'deck:sessions')[0])
      expect(header.includes('◆ 1')).toBe(true)
      expect(header.includes('other session needs you')).toBe(columns >= 64)
      await ui.unmount()
    }
  }
})

test('a fork`s row: its spend with "incl. its parent`s" under its word and its spend, ending where the spend does; both left out where the pane is narrow', async ($, on) => {
  const d: Disk = { files: new Map() }
  listed(d, 'fork-3', '/fork/.web/fork-3', { state: 'idle', need: null, costUsd: 491.37, isFork: true })
  const { clock } = await started($, on, newWorld(), d)
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const columns of [84, 56]) {
      const ui = await $.ui.mount(pane(surface, columns))
      const drawn = await ui.drawn()
      const [row] = nodesIn(drawn, node => (node.key ?? node.props?.key) === 'session-row:fork-3')
      const words = wordsIn(row)
      expect([words.includes('≈$491'), words.includes('incl. its parent’s')]).toEqual([columns >= 64, columns >= 64])
      // under the word and the spend: a column at the row's right, the note's line clear of the age's cells
      const [right] = nodesIn(row, node => (node.key ?? node.props?.key) === 'session-cost:fork-3')
      if (columns >= 64) {
        expect(right?.props).toMatchObject({ flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 })
        expect(nodesIn(right, node => node.type === 'Box' && node.props?.paddingRight === 5 && wordsIn(node) === 'incl. its parent’s').length).toBe(1)
      } else {
        expect(right).toBeUndefined()
      }
      expect(wordsIn(nodesIn(drawn, node => (node.key ?? node.props?.key) === `session-row:${OTHER}`)[0])).not.toContain('parent')
      await ui.unmount()
    }
  }
})

test('a press on another session opens its deck read-only from its folder under "Viewing <title>", asks its deck through its inbox to keep writing it, and Back to this chat leaves it, telling its deck so', async ($, on) => {
  const { clock, w } = await started($, on)
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: `session:${OTHER}` })
  await clock.advance(3000)
  await ui.redraw()
  const bar = await ui.find({ key: 'viewing:head' })
  expect(bar?.text).toContain('Viewing')
  expect(bar?.text).toContain('Landing page copy')
  expect(bar?.text).toContain('Read-only: answers and messages go through its own deck.')
  // its own deck: its header and its need, read from its state.json
  expect((await ui.find({ key: 'deck:header' }))?.text).toContain('Landing page copy')
  expect((await ui.find({ key: 'deck:header' }))?.text).not.toContain('All sessions')
  const asked = w.writes.filter(one => norm(one.path) === `${OTHER_DIR}/inbox/session-1.json`).map(one => JSON.parse(one.text) as S.InboxFile)
  expect(asked.at(-1)).toMatchObject({ v: 1, from: 'session-1', cmds: [] })
  expect(asked.at(-1)!.viewUntil).toBeGreaterThan(NOW)
  // back to this chat: its deck told this one looks no more
  await ui.press({ key: 'viewing:back' })
  await clock.advance(500)
  await ui.redraw()
  expect(await ui.find({ key: 'viewing:head' })).toBeUndefined()
  const last = w.writes.filter(one => norm(one.path) === `${OTHER_DIR}/inbox/session-1.json`).map(one => JSON.parse(one.text) as S.InboxFile).at(-1)
  expect(last?.viewUntil).toBe(0)
  await ui.unmount()
})

/** A world whose `fs.stat` answers from the test's disk: a file the disk lacks is missing, as Claude Code's own stat says. */
function diskWorld(d: Disk): World {
  return newWorld({
    stat: path => {
      const text = d.files.get(norm(path))
      return text === undefined ? null : { size: text.length, mtimeMs: NOW + text.length }
    },
  })
}

test('another session`s deck that writes its state only once asked: "Asking its deck for its state…" once, where its deck will be, under a bar that says what can be done from here; then its deck at the next tick', async ($, on) => {
  const d: Disk = { files: new Map() }
  const { clock } = await started($, on, diskWorld(d), d)
  const written = d.files.get(`${OTHER_DIR}/state.json`)!
  d.files.delete(`${OTHER_DIR}/state.json`)
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  const ui = await $.ui.mount(pane('terminal'))
  const desktop = await $.ui.mount(pane('desktop'))
  await ui.press({ key: `session:${OTHER}` })
  await clock.advance(3000)
  for (const one of [ui, desktop]) {
    await one.redraw()
    expect(JSON.stringify(await one.drawn()).split('Asking its deck for its state…').length - 1).toBe(1)
    expect((await one.find({ key: 'viewing:head' }))?.text).toContain('Read-only: answers and messages go through its own deck.')
    expect(await one.find({ key: 'deck:header' })).toBeUndefined()
  }
  // its deck read its inbox and wrote its state: it shows at the next tick
  d.files.set(`${OTHER_DIR}/state.json`, written)
  await clock.advance(2500)
  for (const one of [ui, desktop]) {
    await one.redraw()
    expect((await one.find({ key: 'deck:header' }))?.text).toContain('Landing page copy')
    expect(JSON.stringify(await one.drawn())).not.toContain('Asking its deck')
  }
  await ui.unmount()
  await desktop.unmount()
})

test('another session`s deck that never answers says so within ANSWER_MS: it wrote no state, or one this deck cannot read; answer it in its window', async ($, on) => {
  const d: Disk = { files: new Map() }
  const { clock } = await started($, on, diskWorld(d), d)
  d.files.delete(`${OTHER_DIR}/state.json`)
  await $.command.run(deck('sessions'))
  await clock.advance(3000)
  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: `session:${OTHER}` })
  await clock.advance(S.ANSWER_MS + 2500)
  await ui.redraw()
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Its deck has not written its state: answer it in its window.')
  expect(drawn).not.toContain('Asking its deck')
  // a state an older build wrote, with no v2 in it: written, but not one this deck reads
  d.files.set(`${OTHER_DIR}/state.json`, JSON.stringify({ v: 1, now: NOW, agents: [] }))
  await clock.advance(2500)
  await ui.redraw()
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn.split('Its deck wrote a state this deck cannot read: answer it in its window.').length - 1).toBe(1)
  await ui.unmount()
})

test('with the registry on, ticks that change nothing draw nothing again and write no state again, here or for a deck viewing this one', async ($, on) => {
  const d: Disk = { files: new Map() }
  const { clock, w } = await started($, on, newWorld(), d)
  await $.command.run(deck(''))
  const ui = await $.ui.mount(pane('desktop'))
  await clock.advance(3000)
  expect((await ui.find({ key: 'deck:header' }))?.text).toContain('◆ 1 other session needs you')
  w.invalidates = 0
  await clock.advance(10_000)
  expect(w.invalidates).toBe(0)
  // other-1 views this session: its state is written once, then again only when it says something new
  const dir = norm(ownEntries(w)[0]!.dir)
  d.files.set(`${dir}/inbox/${OTHER}.json`, JSON.stringify({ v: 1, from: OTHER, at: NOW, viewUntil: NOW + S.VIEW_MS, cmds: [] }))
  await clock.advance(3000)
  const states = () => w.writes.filter(one => norm(one.path) === `${dir}/state.json`).length
  const first = states()
  expect(first).toBeGreaterThan(0)
  w.invalidates = 0
  await clock.advance(10_000)
  expect([states(), w.invalidates]).toEqual([first, 0])
  await ui.unmount()
})

test('from the page: a message to another session goes into its inbox (its own deck takes it); one to a deck that reads no inbox is refused, "Answer it in its window"; view asks its deck to write; the server reads the registry', async ($, on) => {
  const d: Disk = { files: new Map() }
  const w = newWorld()
  listed(d, OLD, OLD_DIR, { inbox: false })
  const { clock } = await started($, on, w, d, work)
  await clock.advance(1000)
  const child = w.children[0]
  expect(child?.request.argv.slice(-2)).toEqual(['--sessions', REG])
  command(child, { cmd: 'view', session: OTHER })
  command(child, { cmd: 'chat', id: 'x-1', agentId: 'main', text: 'Go ahead and rebuild', session: OTHER })
  await clock.advance(1000)
  const inbox = w.writes.filter(one => norm(one.path) === `${OTHER_DIR}/inbox/session-1.json`).map(one => JSON.parse(one.text) as S.InboxFile).at(-1)
  expect(inbox?.viewUntil).toBeGreaterThan(NOW)
  expect(inbox?.cmds.map(one => one.cmd)).toEqual([{ cmd: 'chat', id: 'x-1', agentId: 'main', text: 'Go ahead and rebuild' }])
  // nothing of it ran here
  expect(w.submitted.some(one => one.text === 'Go ahead and rebuild')).toBe(false)
  command(child, { cmd: 'chat', id: 'x-2', agentId: 'main', text: 'Hello', session: OLD })
  await clock.advance(1000)
  const states = w.writes.filter(one => /[\\/]\.web[\\/]session-1[\\/]state\.json$/.test(one.path)).map(one => JSON.parse(one.text) as { v2: W.WebStateV2 })
  expect(states.at(-1)?.v2.acks.find(one => one.id === 'x-2')).toMatchObject({ ok: false, status: 'failed', text: 'Answer it in its window: its deck takes no answers or messages from another' })
  expect(w.writes.some(one => norm(one.path).startsWith(`${OLD_DIR}/`))).toBe(false)
  // the page's state lists the sessions
  expect(states.at(-1)?.v2.sessions?.rows.map(row => row.id)).toEqual(['session-1', OLD, OTHER])
})

test('this session`s inbox: a deck viewing it has its state written (no /deck web), and its message runs here as the page`s own (your next prompt), acked in its state; a stranger`s inbox file is ignored', async ($, on) => {
  const d: Disk = { files: new Map() }
  const { clock, w } = await started($, on, newWorld(), d)
  const dir = norm(ownEntries(w)[0]!.dir)
  const file = (from: string, cmds: S.InboxCommand[]) => JSON.stringify({ v: 1, from, at: NOW, viewUntil: NOW + S.VIEW_MS, cmds })
  // a session the registry does not list: nothing comes of it
  d.files.set(`${dir}/inbox/stranger.json`, file('stranger', [{ at: NOW, cmd: { cmd: 'chat', id: 's-1', agentId: 'main', text: 'Delete everything' } }]))
  await clock.advance(3000)
  expect(w.submitted.some(one => one.text === 'Delete everything')).toBe(false)
  expect(w.writes.some(one => norm(one.path) === `${dir}/state.json`)).toBe(false)
  // other-1 views this session and sends it a message
  d.files.set(`${dir}/inbox/${OTHER}.json`, file(OTHER, [{ at: NOW, cmd: { cmd: 'chat', id: 'o-1', agentId: 'main', text: 'Also run the linter' } }]))
  await clock.advance(3000)
  expect(w.submitted.at(-1)).toMatchObject({ text: 'Also run the linter', origin: { kind: 'plugin', name: 'agent-deck', asUser: true } })
  await clock.advance(1000)
  const written = w.writes.filter(one => norm(one.path) === `${dir}/state.json`).map(one => JSON.parse(one.text) as { v2: W.WebStateV2 })
  expect(written.length).toBeGreaterThan(0)
  expect(written.at(-1)?.v2.acks.find(one => one.id === 'o-1')).toMatchObject({ ok: true })
  // read again, the same command does not run twice
  d.files.set(`${dir}/inbox/${OTHER}.json`, `${file(OTHER, [{ at: NOW, cmd: { cmd: 'chat', id: 'o-1', agentId: 'main', text: 'Also run the linter' } }])} `)
  await clock.advance(3000)
  expect(w.submitted.filter(one => one.text === 'Also run the linter').length).toBe(1)
})

test('/deck demo lists the sample`s sessions (s) and opens one`s deck from the fixtures, under "Sample data": nothing is sent', async ($, on) => {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const own = sampleState()
  const sample = sampleSessions()
  on('fs.read', ($, e) => {
    const path = norm(e.path)
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(own) }
    if (path.endsWith('/web/fixtures/sessions.v2.json')) return { value: JSON.stringify({ now: sample.now, me: sample.me, entries: sample.entries, view: sample.view }) }
    const one = sample.decks.find(deck => path.endsWith(`/web/fixtures/${deck.dir}/state.json`))
    return one ? { value: JSON.stringify(one.state) } : { deny: 'no such file' }
  })
  on('ui.focus', () => ({}))
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'deck:header' }))?.text).toContain('◆ 1 other session needs you')
  await ui.press({ key: 'key:s' })
  await clock.advance(500)
  await ui.redraw()
  expect((await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('session:'))).toEqual(sample.view.rows.map(row => `session:${row.id}`))
  const ci = sample.view.rows.find(row => row.title === 'Fix the flaky CI job')!
  expect((await ui.find({ key: `session-row:${ci.id}` }))?.text).toContain('Terminal · Windows Terminal · api-server')
  await ui.press({ key: `session:${ci.id}` })
  await clock.advance(500)
  await ui.redraw()
  const bar = await ui.find({ key: 'viewing:head' })
  expect(bar?.text).toContain('Fix the flaky CI job')
  expect(bar?.text).toContain('Sample data')
  expect((await ui.find({ key: 'deck:header' }))?.text).toContain('Fix the flaky CI job')
  await ui.unmount()
})
