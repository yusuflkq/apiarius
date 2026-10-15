/**
 * The native dashboard's cards and rows as things to press, and the agent
 * page they open (tests/dash.test.ts covers the rest of it): every line of
 * an agent card, an Org tree row and a needs card or row opens that agent's
 * page, and "Open →" says so, lit while the pointer is on what it opens; the
 * page reads as the web deck's, its four figures, its task beside its
 * checklist, then Diffs · Activity · Talk, opening on a pane it has
 * something for; and in the sample every page has its task, checklist,
 * diffs, activity and talk.
 */
import type { On, RenderElement } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { dashboardTab } from '../hooks/ui/dash/dashboard'
import { firstPaneOf, foldText, wrapTicks } from '../hooks/ui/dash/dashModel'
import { needsCards } from '../hooks/ui/dash/needs'
import { orgTree } from '../hooks/ui/dash/orgTree'
import { P, TONE } from '../hooks/ui/dash/palette'
import { notePagePane, openAgentPage, quiet } from '../hooks/ui/dash/parts'
import type { DashActions, Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'
import { deck, newWorld, NOW, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends Surface>(surface: S, bodyColumns = 84, requestId = 'agent-deck') {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId,
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

type Element = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

/** The element keyed `key` in a drawn tree, as drawn (its `hover` beside its props), depth first. */
function keyed(tree: unknown, key: string): Element | undefined {
  if (!tree || typeof tree !== 'object') return undefined
  const node = tree as Element
  if (node.props?.key === key) return node
  for (const child of node.children ?? []) {
    const found = keyed(child, key)
    if (found) return found
  }
  return undefined
}

/** The instance a test draws a piece of the dashboard into by itself. */
const PROBE = 'cards-probe'

/** Draws `draw`'s tree as the deck's pane would, under the PROBE instance, with the surface's own elements. */
function probe(on: On, draw: (kit: Kit) => RenderElement): void {
  on('ui.render', { component: 'Pane', requestId: PROBE }, ($, e) => {
    const ui = $.ui.resolve(e)
    return draw({
      surface: e.surface,
      Box: ui.Box,
      Text: ui.Text,
      Button: ui.Button,
      Code: ui.Code,
      Markdown: ui.Markdown,
      columns: Math.max(24, e.props.bodyColumns - 1),
      ...('Input' in ui ? { Input: ui.Input } : {}),
      ...('Svg' in ui && e.surface !== 'terminal' ? { Svg: ui.Svg } : {}),
    })
  })
}

/** Actions that note each call as `name:args` (JSON), and do nothing else. */
function noting(calls: string[]): DashActions {
  return new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]) => {
          calls.push(`${String(name)}:${args.map(one => JSON.stringify(one)).join(',')}`)
        },
    },
  ) as DashActions
}

/** The agents `openAgent` was called with, in order. */
function opens(calls: readonly string[]): string[] {
  return calls.filter(one => one.startsWith('openAgent:')).map(one => JSON.parse(one.slice('openAgent:'.length)) as string)
}

const QUESTION = {
  question: 'Which library should we use for dates?',
  header: 'Library',
  multiSelect: false,
  options: [
    { label: 'date-fns', description: 'Small and modular' },
    { label: 'Luxon', description: 'Time zones built in' },
  ],
}

/**
 * A session under way: the Orchestrator asks which library to use; fixer
 * runs the tests and waits on your OK for them; helper, which fixer
 * started, has finished.
 */
function sessionData(): DeckData {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Fix the login bug', origin: 'composer', at: NOW - 540_000 })
  const fixer = M.newAgent('agent-fixer', 'agent', 'fixer', NOW - 400_000, {
    type: 'general-purpose',
    parentId: M.MAIN,
    status: 'running',
    prompt: 'Fix the login bug in src/auth.ts and run the tests',
    description: 'Fix the login bug',
    model: 'claude-haiku-4-5-20251001',
    tokensIn: 40_000,
    tokensOut: 8_000,
  })
  data.agents.push(fixer)
  data.agents.push(M.newAgent('agent-helper', 'agent', 'helper', NOW - 300_000, { type: 'Explore', parentId: fixer.id, status: 'completed', endedAt: NOW - 200_000, description: 'Find the auth module', answer: 'It is src/auth.ts' }))
  M.beginTool(data, fixer, M.activityOf('t1', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 20_000))
  M.notePending(data, { id: 'toolu_q', agentId: M.MAIN, kind: 'question', tool: 'AskUserQuestion', at: NOW - 5_000, questions: [QUESTION] })
  M.notePending(data, M.permissionOf({ id: 'toolu_p', tool: 'Bash', input: { command: 'npm test', description: 'Run the unit tests' }, agentId: 'agent-fixer', at: NOW - 4_000 }, '/repo'))
  return data
}

function stateOf(data: DeckData = sessionData()): W.WebState {
  return W.webStateOf(data, M.defaultView(), emptyGit(), null, NOW, 's', '/repo', new Set(['toolu_q']))
}

function snapshot(data: DeckData): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data: M.copyOf(data), view: M.defaultView() }
}

/** The engine for these tests: tests/world.ts, plus the Client's posts and faults. */
function engine(on: On, restored?: DeckSnapshot) {
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, newWorld(), restored)
}

async function started($: Engine, on: On, restored?: DeckSnapshot) {
  const clock = mock.clock(on, { now: NOW })
  engine(on, restored)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  return clock
}

const PATCH_A = ['@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'].join('\n')
const PATCH_B = ['@@ -0,0 +1,2 @@', '+export const TTL = 60', '+export const LIMIT = 100'].join('\n')

function todo(content: string, status: 'completed' | 'in_progress' | 'pending', activeForm = content) {
  return { content, status, activeForm }
}

/** A call made and ended: `ms` after `at`, ok or failed; `ms` null leaves it in flight. */
function call(data: DeckData, agent: DeckAgent, id: string, tool: string, input: Record<string, unknown>, at: number, ms: number | null, ok = true) {
  M.beginTool(data, agent, M.activityOf(id, tool, input, '/repo', at))
  if (ms !== null) M.endTool(agent, id, ok, at + ms)
}

/** The task fixer is given: long enough to fold. */
const LONG_TASK = [
  'Fix the login bug in src/auth.ts: a token that expires mid-request is read as valid, so the user is logged in for one more request after it lapsed.',
  'Keep the old tokens working while the new ones roll out, add a test for the expiry edge, run the unit tests, and report what you changed and why.',
  'The last words of the task are these.',
].join(' ')

/**
 * fixer at work, for its page: a long task, a four-item checklist (two
 * done, one in hand), three edits on two files, four calls (one failed, one
 * in flight), its tokens, and three messages; helper done, with none of
 * its own edits.
 */
function workData(): DeckData {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Fix the login bug', origin: 'composer', at: NOW - 540_000 })
  const fixer = M.newAgent('agent-fixer', 'agent', 'fixer', NOW - 400_000, {
    type: 'general-purpose',
    parentId: M.MAIN,
    status: 'running',
    prompt: LONG_TASK,
    description: 'Fix the login bug',
    model: 'claude-haiku-4-5-20251001',
    tokensIn: 92_400,
    tokensOut: 14_830,
    cacheRead: 1_048_200,
  })
  data.agents.push(fixer)
  data.agents.push(M.newAgent('agent-helper', 'agent', 'helper', NOW - 300_000, { type: 'Explore', parentId: fixer.id, status: 'completed', endedAt: NOW - 200_000, prompt: 'Find the auth module', description: 'Find the auth module', answer: 'It is src/auth.ts' }))
  M.noteTodo(data, fixer, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Read the auth code', 'completed'), todo('Find the expiry check', 'completed'), todo('Fix the check', 'in_progress', 'Fixing the expiry check'), todo('Run the tests', 'pending')] }, NOW - 380_000)
  call(data, fixer, 'c1', 'Read', { file_path: '/repo/src/auth.ts' }, NOW - 360_000, 40)
  call(data, fixer, 'c2', 'Edit', { file_path: '/repo/src/auth.ts' }, NOW - 240_000, 30)
  call(data, fixer, 'c3', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, NOW - 120_000, 2400, false)
  call(data, fixer, 'c4', 'Edit', { file_path: '/repo/src/token.ts' }, NOW - 10_000, null)
  M.addEdit(data, fixer, { id: 'e1', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 240_000, added: 1, removed: 1, patch: PATCH_A, isNew: false })
  M.addEdit(data, fixer, { id: 'e2', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 200_000, added: 1, removed: 1, patch: PATCH_A, isNew: false })
  M.addEdit(data, fixer, { id: 'e3', agent: fixer.id, tool: 'Write', path: 'src/token.ts', abs: '/repo/src/token.ts', at: NOW - 100_000, added: 2, removed: 0, patch: PATCH_B, isNew: true })
  M.addMessage(data, { from: M.MAIN, to: fixer.id, kind: 'spawn', at: NOW - 400_000, text: LONG_TASK })
  M.addMessage(data, { from: M.YOU, to: fixer.id, kind: 'chat', at: NOW - 90_000, text: 'Keep the old tokens working.' })
  M.addMessage(data, { from: fixer.id, to: M.YOU, kind: 'chat', at: NOW - 80_000, text: 'Will do: both kinds are read.' })
  return data
}

test('wrapTicks lays a line into rows at its spaces, keeps code spans as code on each row, cuts a word longer than a row, and ends the last row in … when words are left', () => {
  expect(wrapTicks('Run `npm test` now', 40, 2)).toEqual([
    [
      { text: 'Run ', isCode: false },
      { text: 'npm test', isCode: true },
      { text: ' now', isCode: false },
    ],
  ])
  // a word that fits a row moves to the next one whole; a path longer than a row is cut where the row ends, its code on both rows
  expect(wrapTicks('Fixing the `login` bug', 12, 3).map(row => row.map(part => part.text).join(''))).toEqual(['Fixing the', 'login bug'])
  const path = wrapTicks('Editing `src/middleware/rateLimit.ts` now', 20, 3)
  expect(path).toEqual([
    [
      { text: 'Editing ', isCode: false },
      { text: 'src/middlewa', isCode: true },
    ],
    [
      { text: 're/rateLimit.ts', isCode: true },
      { text: ' now', isCode: false },
    ],
  ])
  // two rows kept: the second ends in …, never past the room
  const rows = wrapTicks('one two three four five six seven eight nine ten', 12, 2)
  expect(rows.map(row => row.map(part => part.text).join(''))).toEqual(['one two', 'three four…'])
  for (const row of rows) expect(Array.from(row.map(part => part.text).join('')).length <= 12).toBe(true)
  expect(wrapTicks('   ', 10, 2)).toEqual([])
  expect(wrapTicks('a b', 10, 2)).toEqual([[{ text: 'a b', isCode: false }]])
})

test('foldText keeps about so many rows of a column, its own lines kept, and says whether it left anything out', () => {
  expect(foldText('short', 20, 4)).toEqual({ text: 'short', isCut: false })
  // three lines of one row each, a fourth of two: cut in the fourth
  const folded = foldText(['one', 'two', 'three', 'a line long enough to take two rows of this column'].join('\n'), 20, 4)
  expect(folded.isCut).toBe(true)
  expect(folded.text.split('\n').slice(0, 3)).toEqual(['one', 'two', 'three'])
  expect(folded.text.endsWith('…')).toBe(true)
  // the rows full at a line's end: the rest is left out, unless it is only blank lines
  expect(foldText('a\nb\nc', 20, 2)).toEqual({ text: 'a\nb', isCut: true })
  expect(foldText('a\nb\n\n', 20, 2)).toEqual({ text: 'a\nb', isCut: false })
})

test('an agent card: its name, now line and "model · tokens · time" are each a plain Button that opens its page, "Open →" at its foot, lit in its hue while the pointer is on the card', async ($, on) => {
  const calls: string[] = []
  const state = stateOf()
  probe(on, kit => dashboardTab(kit, state, noting(calls), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    for (const columns of [68, 84]) {
      const ui = await $.ui.mount(pane(surface, columns, PROBE))
      const drawn = await ui.drawn()
      for (const agent of state.agents) {
        const tone = TONE[agent.status]
        // the card keeps its edge and its hover tint
        expect(keyed(drawn, `card:${agent.id}`)?.hover).toEqual({ borderColor: tone.hot })
        const lines = [`dash:agent:${agent.id}`, `dash:now:${agent.id}:0`, `dash:foot:${agent.id}`, `dash:open:${agent.id}`]
        for (const key of lines) {
          const button = await ui.find({ key })
          expect(button?.type).toBe('Button')
          expect(button?.props.plain).toBe(true)
          calls.length = 0
          await ui.press({ plugin: 'test', key })
          expect(opens(calls)).toEqual([agent.id])
        }
        const open = keyed(drawn, `dash:open:${agent.id}`)
        expect(open?.props).toMatchObject({ label: 'Open →', plain: true, dimColor: true })
        expect(open?.hover).toEqual({ color: tone.pillFg, dimColor: false })
        // the lines keep their colours: the foot in the dim grey, as before
        const foot = await ui.find({ key: `dash:foot:${agent.id}` })
        expect(foot?.text).toContain(agent.model)
        expect((foot?.children[0] as Element | undefined)?.props?.color).toBe(P.muted2)
      }
      // the now line on one row or two, its code span a chip
      const said = [await ui.find({ key: 'dash:now:agent-fixer:0' }), await ui.find({ key: 'dash:now:agent-fixer:1' })].map(one => one?.text ?? '').filter(Boolean)
      expect(said.join(' ')).toBe('Needs your OK to run npm test')
      expect((await ui.findAll({ type: 'Text', text: 'npm' })).some(one => one.props.backgroundColor === P.chip)).toBe(true)
      await ui.unmount()
    }
  }
})

test('a now line longer than its card is two Buttons, the second cut with …; one that fits is one; neither runs past the card', async ($, on) => {
  const state = stateOf()
  const fixer = state.agents.find(one => one.id === 'agent-fixer')!
  fixer.now = 'Editing `src/middleware/stores/redisStore.ts` and then the tests in `test/rateLimit.test.ts`, then the docs'
  probe(on, kit => dashboardTab(kit, state, noting([]), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 68, PROBE))
    // 68 cells: two cards a row of 33, 29 inside, less a desktop button's chrome
    const room = 29 - (surface === 'terminal' ? 0 : 2)
    const first = await ui.find({ key: 'dash:now:agent-fixer:0' })
    const second = await ui.find({ key: 'dash:now:agent-fixer:1' })
    expect(await ui.find({ key: 'dash:now:agent-fixer:2' })).toBeUndefined()
    expect(first?.text.startsWith('Editing')).toBe(true)
    expect(second?.text.endsWith('…')).toBe(true)
    for (const line of [first, second]) expect(Array.from(line?.text ?? '').length <= room).toBe(true)
    // code spans stay code on the row they land on
    const chip = (await ui.findAll({ type: 'Text', text: /redisStore/ })).find(one => one.props.backgroundColor !== undefined)
    expect(chip).toBeDefined()
    expect(await ui.find({ key: 'dash:now:agent-helper:1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('end to end: on /deck a press on a card`s now line, its foot or its Open → opens that agent`s page, and Back returns to the Dashboard', async ($, on) => {
  await started($, on, snapshot(sessionData()))
  await $.command.run(deck(''))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    for (const key of ['dash:now:agent-helper:0', 'dash:foot:agent-helper', 'dash:open:agent-helper']) {
      await ui.press({ key })
      await ui.redraw()
      expect((await ui.find({ key: 'page:head' }))?.text).toContain('helper')
      expect((await ui.find({ key: 'page:back' }))?.props.label).toBe('← Dashboard')
      await ui.press({ key: 'page:back' })
      await ui.redraw()
      expect(await ui.find({ key: 'page:head' })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('an Org tree row: its name, its now line and Open → each open the agent`s page; Open → lights while the pointer is on the row', async ($, on) => {
  const calls: string[] = []
  const state = stateOf()
  probe(on, kit => orgTree(kit, state, noting(calls), 'agent-fixer'))
  await started($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 68, PROBE))
    const drawn = await ui.drawn()
    for (const agent of state.agents) {
      for (const key of [`org:agent:${agent.id}`, `org:now:${agent.id}`, `org:open:${agent.id}`]) {
        calls.length = 0
        await ui.press({ plugin: 'test', key })
        expect(opens(calls)).toEqual([agent.id])
      }
      expect(keyed(drawn, `org:open:${agent.id}`)?.hover).toEqual({ color: TONE[agent.status].pillFg, dimColor: false })
      // inside the row's keyed Box, which the hover answers to
      expect(keyed(keyed(drawn, `org:${agent.id}`), `org:open:${agent.id}`)).toBeDefined()
    }
    // the agent opened last keeps its primary plate
    expect((await ui.find({ key: 'org:agent:agent-fixer' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'org:now:agent-fixer' }))?.text).toContain('Needs your OK to run npm test')
    await ui.unmount()
  }
})

test('what needs you: on the Dashboard a card`s title and Open → open the asking agent`s page, the card`s edge lit under the pointer; on that agent`s own page neither shows; past three cards each row ends in Open →', async ($, on) => {
  const calls: string[] = []
  const data = sessionData()
  // three more held calls: five in all, so two go past the cards as rows
  M.notePending(data, M.permissionOf({ id: 'toolu_p2', tool: 'Edit', input: { file_path: '/repo/src/a.ts' }, agentId: 'agent-fixer', at: NOW - 3_000 }, '/repo'))
  M.notePending(data, M.permissionOf({ id: 'toolu_p3', tool: 'WebFetch', input: { url: 'https://example.com' }, agentId: 'agent-fixer', at: NOW - 2_000 }, '/repo'))
  M.notePending(data, M.permissionOf({ id: 'toolu_p4', tool: 'Bash', input: { command: 'npm run build' }, agentId: M.MAIN, at: NOW - 1_000 }, '/repo'))
  const state = stateOf(data)
  // where the cards stand: the Dashboard, or fixer's own page
  const where: { at: 'dash' | 'agent'; agentId: string } = { at: 'dash', agentId: '' }
  probe(on, kit => needsCards(kit, state, noting(calls), NOW, where.at, where.agentId) ?? quiet(kit, 'nothing'))
  await started($, on)
  for (const surface of SURFACES) {
    // on fixer's own page: its cards, no title to press and no Open →, no edge lit
    Object.assign(where, { at: 'agent', agentId: 'agent-fixer' })
    const page = await $.ui.mount(pane(surface, 84, PROBE))
    const onPage = await page.drawn()
    expect(keyed(onPage, 'needs:toolu_p')).toBeDefined()
    expect(keyed(onPage, 'needs:toolu_p')?.hover).toBeUndefined()
    expect(keyed(onPage, 'needs:title:toolu_p')).toBeUndefined()
    expect(keyed(onPage, 'needs:open:toolu_p')).toBeUndefined()
    expect(keyed(onPage, 'needs:toolu_q')).toBeUndefined()
    await page.unmount()

    Object.assign(where, { at: 'dash', agentId: '' })
    const ui = await $.ui.mount(pane(surface, 84, PROBE))
    const drawn = await ui.drawn()
    // the cards: the question first, then the permissions oldest first
    for (const [id, agent] of [
      ['toolu_q', 'main'],
      ['toolu_p', 'agent-fixer'],
      ['toolu_p2', 'agent-fixer'],
    ] as const) {
      expect(keyed(drawn, `needs:${id}`)?.hover).toEqual({ borderColor: TONE.waiting.hue })
      expect(keyed(drawn, `needs:open:${id}`)?.props).toMatchObject({ label: 'Open →', plain: true })
      for (const key of [`needs:title:${id}`, `needs:open:${id}`]) {
        calls.length = 0
        await ui.press({ plugin: 'test', key })
        expect(opens(calls)).toEqual([agent])
      }
    }
    expect((await ui.find({ key: 'needs:title:toolu_q' }))?.text).toBe('Orchestrator asks you')
    expect((await ui.find({ key: 'needs:title:toolu_p' }))?.text).toBe('fixer needs your OK to run npm test')
    // past the cards: a row each, its words and Open → both opening the agent
    for (const [id, agent] of [
      ['toolu_p3', 'agent-fixer'],
      ['toolu_p4', 'main'],
    ] as const) {
      for (const key of [`needs:more:${id}`, `needs:more:open:${id}`]) {
        calls.length = 0
        await ui.press({ plugin: 'test', key })
        expect(opens(calls)).toEqual([agent])
      }
    }
    await ui.unmount()
  }
})

test('a page opens on a pane it has something for, as the web deck`s: the Orchestrator`s Talk; Diffs where the agent edited, Activity while it works, else Talk; then on the pane it showed last', () => {
  const data = workData()
  M.agentOf(data, 'agent-helper')!.status = 'completed'
  const scout = M.newAgent('agent-scout', 'agent', 'scout', NOW - 100_000, { parentId: M.MAIN, status: 'running', description: 'Look around' })
  data.agents.push(scout)
  const state = stateOf(data)
  expect(firstPaneOf(state, 'main')).toBe('chat')
  expect(firstPaneOf(state, 'agent-fixer')).toBe('edits')
  expect(firstPaneOf(state, 'agent-scout')).toBe('activity')
  expect(firstPaneOf(state, 'agent-helper')).toBe('chat')
  expect(firstPaneOf(state, 'nobody')).toBe('chat')

  // the pane is set first, then the page opens; a pane given wins for that once; a pane picked on the page is the one it opens on next
  const calls: string[] = []
  openAgentPage(noting(calls), state, 'agent-scout')
  expect(calls).toEqual(['setAgentPane:"activity"', 'openAgent:"agent-scout"'])
  calls.length = 0
  openAgentPage(noting(calls), state, 'agent-scout', 'chat')
  openAgentPage(noting(calls), state, 'agent-scout')
  expect(calls).toEqual(['setAgentPane:"chat"', 'openAgent:"agent-scout"', 'setAgentPane:"activity"', 'openAgent:"agent-scout"'])
  calls.length = 0
  notePagePane('agent-scout', 'edits')
  openAgentPage(noting(calls), state, 'agent-scout')
  expect(calls).toEqual(['setAgentPane:"edits"', 'openAgent:"agent-scout"'])
})

test('the agent page reads as the web deck`s: its four figures in boxes, its task folded beside its checklist (under it below 84 cells), the checklist`s bar, then Diffs · Activity · Talk with a count each', async ($, on) => {
  await started($, on, snapshot(workData()))
  await $.command.run(deck(''))
  for (const surface of SURFACES) {
    for (const columns of [84, 68]) {
      const isWide = columns === 84
      const ui = await $.ui.mount(pane(surface, columns))
      await ui.press({ key: 'dash:agent:agent-fixer' })
      await ui.redraw()

      // the four figures, four a row at 84 cells, two below
      const boxes = await Promise.all(['model', 'tokens', 'lines', 'calls'].map(key => ui.find({ key: `stat:${key}` })))
      const width = isWide ? 20 : 33
      expect(boxes.map(box => box?.props.width)).toEqual([width, width, width, width])
      expect(boxes.map(box => box?.props.borderStyle)).toEqual(['round', 'round', 'round', 'round'])
      expect(boxes[0]?.text).toContain('Model')
      expect(boxes[0]?.text).toContain('haiku-4.5')
      expect(boxes[0]?.text).toContain('agent')
      expect(boxes[1]?.text).toContain('1.2M')
      expect(boxes[1]?.text).toContain('92.4k in · 14.8k out · 1M cache')
      expect(boxes[2]?.text).toContain('Lines changed')
      expect(boxes[2]?.text).toContain('2 files')
      expect((await ui.find({ type: 'Text', text: /^[+]4$/ }))?.props.color).toBe(P.doneText)
      expect((await ui.find({ type: 'Text', text: /^−2$/ }))?.props.color).toBe(P.failText)
      expect(boxes[3]?.text).toContain('4')
      expect((await ui.find({ type: 'Text', text: /^1 error$/ }))?.props.color).toBe(P.failText)

      // the task beside the checklist at 84 cells, under it below; folded to about four rows, Show more for the rest
      expect((await ui.find({ key: 'page:work' }))?.props.flexDirection).toBe(isWide ? 'row' : 'column')
      const task = await ui.find({ key: 'page:task' })
      expect(task?.text).toContain('Task')
      expect(task?.text).toContain('Fix the login bug in src/auth.ts')
      expect(task?.text).not.toContain('The last words of the task are these.')
      expect((await ui.find({ key: 'page:more:task:agent-fixer' }))?.props.label).toBe('Show more')
      await ui.press({ key: 'page:more:task:agent-fixer' })
      await ui.redraw()
      expect((await ui.find({ key: 'page:task' }))?.text).toContain('The last words of the task are these.')
      await ui.press({ key: 'page:more:task:agent-fixer' })
      await ui.redraw()
      const list = await ui.find({ key: 'page:checklist' })
      expect(list?.text).toContain('Checklist')
      expect(list?.text).toContain('2/4')
      expect(list?.text).toContain('Fixing the expiry check')
      const bar = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === '2 of 4 done')
      if (surface === 'desktop') expect(bar).toBeDefined()
      else expect(list?.text).toContain('━')

      // the tabs in the web's names and order, a count each: files, calls, messages; open on Diffs, as fixer edited
      const tabs = (await ui.findAll({ type: 'Button' })).filter(button => /^detail:(edits|activity|chat)$/.test(button.key ?? ''))
      expect(tabs.map(tab => tab.props.label)).toEqual(['Diffs 2', 'Activity 4', 'Talk 3'])
      expect(tabs.map(tab => tab.props.dimColor)).toEqual([false, true, true])
      expect((await ui.findAll({ type: 'Code' })).length > 0).toBe(true)

      // Activity: as the dashboard words a call, newest first, how it went and when at the right
      await ui.press({ key: 'detail:activity' })
      await ui.redraw()
      const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('call:'))
      expect(rows.map(row => row.key)).toEqual(['call:c4', 'call:c3', 'call:c2', 'call:c1'])
      expect(rows.map(row => row.text)).toEqual(['edited src/token.ts' + 'running' + 'now', 'ran npm test' + 'failed' + '2m', 'edited src/auth.ts' + '30ms' + '4m', 'read src/auth.ts' + '40ms' + '6m'])
      expect((await ui.find({ type: 'Text', text: /^failed$/ }))?.props.color).toBe(P.failText)
      expect(await ui.find({ type: 'Text', text: 'Tool calls 4' })).toBeUndefined()

      // Talk: the thread and the field that sends, as the detail draws them
      await ui.press({ key: 'detail:chat' })
      await ui.redraw()
      expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
      expect(await ui.find({ key: 'chat:agent-fixer' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Will do: both kinds are read.' })).toBeDefined()

      // Back, and the card again: the page opens on Talk, the pane it showed last
      await ui.press({ key: 'page:back' })
      await ui.redraw()
      await ui.press({ key: 'dash:agent:agent-fixer' })
      await ui.redraw()
      expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
      await ui.press({ key: 'detail:edits' })
      await ui.redraw()
      await ui.press({ key: 'page:back' })
      await ui.redraw()

      // helper, done with no edits of its own: its page opens on Talk, and its Diffs says it edited nothing
      await ui.press({ key: 'dash:agent:agent-helper' })
      await ui.redraw()
      expect((await ui.find({ key: 'detail:chat' }))?.props.dimColor).toBe(false)
      await ui.press({ key: 'detail:edits' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: 'helper did not edit any files.' })).toBeDefined()
      await ui.press({ key: 'detail:chat' })
      await ui.redraw()
      await ui.press({ key: 'page:back' })
      await ui.redraw()
      await ui.unmount()
    }
  }
})

/**
 * A sample in web/fixtures/state.json's shape: three agents, each with a
 * task, a checklist, calls and messages; two with edits, whose patches the
 * sample keeps by edit id, as web/fixtures/patches does.
 */
function sampleOf(): { text: string; patches: Record<string, string> } {
  const data = workData()
  const helper = M.agentOf(data, 'agent-helper')!
  M.noteTodo(data, helper, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Find the auth module', 'completed')] }, NOW - 290_000)
  call(data, helper, 'h1', 'Grep', { pattern: 'login', path: '/repo/src' }, NOW - 280_000, 20)
  M.addMessage(data, { from: helper.id, to: 'agent-fixer', kind: 'result', at: NOW - 200_000, text: 'It is src/auth.ts' })
  const main = M.agentOf(data, M.MAIN)!
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Fix the bug', 'in_progress', 'Fixing the bug'), todo('Review', 'pending')] }, NOW - 500_000)
  call(data, main, 'm1', 'Agent', { description: 'fixer: fix the login bug', prompt: LONG_TASK }, NOW - 400_000, null)
  M.addEdit(data, main, { id: 'e4', agent: M.MAIN, tool: 'Edit', path: 'README.md', abs: '/repo/README.md', at: NOW - 50_000, added: 1, removed: 0, patch: PATCH_B, isNew: false })
  M.addMessage(data, { from: M.YOU, to: M.MAIN, kind: 'prompt', at: NOW - 540_000, text: 'Fix the login bug' })
  const state = W.webStateOf(data, M.defaultView(), emptyGit(), null, NOW, 'sample', '/acme')
  const patches: Record<string, string> = {}
  for (const edit of data.edits) patches[W.webIdOf(edit.id)] = edit.patch
  return { text: JSON.stringify(state), patches }
}

test('in /deck demo every agent`s page is full: its figures, task and checklist; its first pane has something in it; Diffs from the sample`s patches, Activity and Talk each with rows', async ($, on) => {
  const sample = sampleOf()
  on('fs.read', ($, e) => {
    if (/state\.json$/.test(e.path)) return { value: sample.text }
    const id = /([A-Za-z0-9_-]+)\.diff$/.exec(e.path)?.[1] ?? ''
    return sample.patches[id] !== undefined ? { value: sample.patches[id] ?? '' } : { deny: 'no such file' }
  })
  const clock = await started($, on)
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  for (const [id, first] of [
    ['main', 'chat'],
    ['agent-fixer', 'edits'],
    ['agent-helper', 'chat'],
  ] as const) {
    await ui.press({ key: `dash:open:${id}` })
    await ui.redraw()
    for (const key of ['stat:model', 'stat:tokens', 'stat:lines', 'stat:calls', 'page:task', 'page:checklist']) expect(await ui.find({ key })).toBeDefined()
    expect((await ui.find({ key: `detail:${first}` }))?.props.dimColor).toBe(false)
    // each pane, and what it holds
    await ui.press({ key: 'detail:activity' })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Box' })).some(box => box.key?.startsWith('call:'))).toBe(true)
    await ui.press({ key: 'detail:chat' })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Button' })).some(button => button.key?.startsWith('msg:'))).toBe(true)
    await ui.press({ key: 'detail:edits' })
    await ui.redraw()
    if (id !== 'agent-helper') expect((await ui.findAll({ type: 'Code' })).some(code => String(code.props.source).includes('@@'))).toBe(true)
    else expect(await ui.find({ type: 'Text', text: 'helper did not edit any files.' })).toBeDefined()
    await ui.press({ key: `detail:${first}` })
    await ui.redraw()
    await ui.press({ key: 'page:back' })
    await ui.redraw()
  }
  await ui.unmount()
})

/** A file edit for the Files panel's tests: `added` and `removed` lines by `agent`, at `at`. */
function fileEdit(data: DeckData, agentId: string, id: string, path: string, at: number, added: number, removed: number) {
  const agent = M.agentOf(data, agentId)!
  M.addEdit(data, agent, { id, agent: agentId, tool: 'Edit', path, abs: `/repo/${path}`, at, added, removed, patch: PATCH_A, isNew: false })
}

/** workData with ten files edited, one a minute apart (f9 last), src/shared.ts by fixer and helper both. */
function filesData(): DeckData {
  const data = workData()
  for (let i = 0; i < 10; i++) fileEdit(data, 'agent-fixer', `f${i}`, `src/deep/folder/file${i}.ts`, NOW - 600_000 + i * 60_000, i + 1, i)
  fileEdit(data, 'agent-helper', 'g1', 'src/shared.ts', NOW - 30_000, 3, 1)
  fileEdit(data, 'agent-fixer', 'g2', 'src/shared.ts', NOW - 20_000, 2, 0)
  return data
}

const LIVE_WEB = { status: 'off' as const, url: '', opened: '' as const, note: '' }

test('the Dashboard`s Files: the eight edited last under Recent activity, each its path (folder dim, name bright), a live dot, "shared", its editors` faces and +a −r; "Changes →" beside the head where Changes can show them', async ($, on) => {
  const state = stateOf(filesData())
  const shared = state.files.find(file => file.path === 'src/shared.ts')!
  // the panel draws what the state says of a file: shared, and an agent at it now
  shared.isShared = true
  shared.live = true
  const where: { web: typeof LIVE_WEB | null } = { web: LIVE_WEB }
  probe(on, kit => dashboardTab(kit, state, noting([]), NOW, where.web))
  await started($, on)
  for (const surface of SURFACES) {
    where.web = LIVE_WEB
    const ui = await $.ui.mount(pane(surface, 84, PROBE))
    const drawn = await ui.drawn()
    // under Recent activity
    const tab = keyed(drawn, 'dash:files')
    expect(tab).toBeDefined()
    const order = (await ui.findAll({ type: 'Box' })).map(box => box.key)
    expect(order.indexOf('dash:files') > order.findIndex(key => key?.startsWith('act:'))).toBe(true)
    // the eight edited last, newest first
    const rows = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('dash:file:'))
    expect(rows).toEqual(['dash:file:src/shared.ts', 'dash:file:src/deep/folder/file9.ts', 'dash:file:src/token.ts', 'dash:file:src/deep/folder/file8.ts', 'dash:file:src/deep/folder/file7.ts', 'dash:file:src/auth.ts', 'dash:file:src/deep/folder/file6.ts', 'dash:file:src/deep/folder/file5.ts'])
    expect((await ui.find({ key: 'dash:files' }))?.text).toContain('FILES')
    expect((await ui.find({ key: 'dash:changes' }))?.props).toMatchObject({ label: 'Changes →', plain: true })
    // the path: its folder dim, its name bright
    const path = keyed(drawn, 'dash:file:src/deep/folder/file9.ts')
    expect((path?.children ?? []).map(child => [(child as Element).props?.color, ((child as Element).children ?? []).join('')])).toEqual([
      [P.muted2, 'src/deep/folder/'],
      [P.fg2, 'file9.ts'],
    ])
    // shared: the tag, a live dot, both editors' faces, its counts green and red
    const row = await ui.find({ key: 'files:src/shared.ts' })
    expect(row?.text).toContain(' shared ')
    expect(row?.text).toContain('●')
    expect(row?.text).toContain('+5')
    expect(row?.text).toContain('−1')
    expect((await ui.find({ key: 'files:src/token.ts' }))?.text).not.toContain('shared')
    const stat = keyed(drawn, 'dash:filestat:src/shared.ts')
    expect((stat?.children ?? []).map(child => (child as Element).props?.color)).toEqual([P.doneText, undefined, P.failText])
    if (surface === 'desktop') {
      const faces = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('avatar') && svg.props.width === 16)
      expect(faces.length).toBe(9)
    }
    await ui.unmount()

    // the sample: no "Changes →", which there has nothing of its own
    where.web = null
    const sample = await $.ui.mount(pane(surface, 84, PROBE))
    expect(await sample.find({ key: 'dash:changes' })).toBeUndefined()
    expect(await sample.find({ key: 'dash:file:src/shared.ts' })).toBeDefined()
    await sample.unmount()
  }
})

test('a press on a file opens it in Changes where Changes lists it (git`s uncommitted files in a repository; outside one, every file agents edited), else the Diffs of the agent that edited it last', async ($, on) => {
  const calls: string[] = []
  const state = stateOf(filesData())
  const where: { web: typeof LIVE_WEB | null } = { web: LIVE_WEB }
  probe(on, kit => dashboardTab(kit, state, noting(calls), NOW, where.web))
  await started($, on)
  const pressed = async (key: string) => {
    const ui = await $.ui.mount(pane('desktop', 84, PROBE))
    calls.length = 0
    await ui.press({ plugin: 'test', key })
    await ui.unmount()
    return [...calls]
  }
  // outside a repository: Changes lists every file agents edited; none open first, so a second press never folds it
  const opensInChanges = ['selectFile:""', 'setTab:"changes"', 'selectFile:"src/token.ts"']
  expect(await pressed('dash:file:src/token.ts')).toEqual(opensInChanges)
  expect(await pressed('dash:filestat:src/token.ts')).toEqual(opensInChanges)
  // in a repository: git's uncommitted files open in Changes; one it no longer lists opens its last editor's Diffs
  state.repo = { name: 'repo', root: '/repo', branch: 'main', ahead: 0, behind: 0, head: 'abc1234' }
  state.changes = [{ path: 'src/token.ts', code: 'M', added: 2, removed: 0, editors: ['agent-fixer'] }]
  expect(await pressed('dash:file:src/token.ts')).toEqual(opensInChanges)
  expect(await pressed('dash:file:src/shared.ts')).toEqual(['openAgent:"agent-fixer","edits"'])
  // the sample has no Changes of its own: every file opens its last editor's Diffs
  where.web = null
  state.repo = null
  expect(await pressed('dash:file:src/token.ts')).toEqual(['openAgent:"agent-fixer","edits"'])
  expect(await pressed('dash:filestat:src/shared.ts')).toEqual(['openAgent:"agent-fixer","edits"'])
})

test('end to end: a file pressed on the Dashboard opens in Changes, open there each time; in /deck demo it opens the Diffs of the agent that edited it last', async ($, on) => {
  const sample = sampleOf()
  on('fs.read', ($, e) => {
    if (/state\.json$/.test(e.path)) return { value: sample.text }
    const id = /([A-Za-z0-9_-]+)\.diff$/.exec(e.path)?.[1] ?? ''
    return sample.patches[id] !== undefined ? { value: sample.patches[id] ?? '' } : { deny: 'no such file' }
  })
  const clock = await started($, on, snapshot(workData()))
  await $.command.run(deck(''))
  const ui = await $.ui.mount(pane('desktop'))
  // this session, outside a repository: Changes lists the files agents edited, by the path the deck shows them at (here the whole one)
  const row = (await ui.findAll({ type: 'Button' })).find(button => button.key?.startsWith('dash:file:') && button.key.endsWith('src/token.ts'))
  const path = (row?.key ?? '').slice('dash:file:'.length)
  expect(path.endsWith('src/token.ts')).toBe(true)
  for (let i = 0; i < 2; i++) {
    await ui.press({ key: `dash:file:${path}` })
    await ui.redraw()
    expect((await ui.find({ key: 'tab:changes' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: `file:${path}` }))?.props.dimColor).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^Created by fixer/ })).toBeDefined()
    await ui.press({ key: 'tab:dashboard' })
    await ui.redraw()
  }
  // the sample: the Diffs of the agent that edited it last
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  await ui.redraw()
  await ui.press({ key: 'dash:file:README.md' })
  await ui.redraw()
  expect((await ui.find({ key: 'page:head' }))?.text).toContain('Orchestrator')
  expect((await ui.find({ key: 'detail:edits' }))?.props.dimColor).toBe(false)
  expect((await ui.findAll({ type: 'Code' })).some(code => String(code.props.source).includes('LIMIT'))).toBe(true)
  await ui.unmount()
})

/** workData with the Orchestrator's own three-step todo list: the first step done, the second in hand. */
function planData(): DeckData {
  const data = workData()
  const main = M.agentOf(data, M.MAIN)!
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Find the bug', 'completed'), todo('Fix it and run the tests', 'in_progress', 'Fixing it'), todo('Review the diff', 'pending')] }, NOW - 500_000)
  return data
}

test('the goal card`s "Step n of m · <step>" is a plain Button: it opens the Plan tab on the step in hand, or the Plan tab itself while none is', async ($, on) => {
  const calls: string[] = []
  const state = stateOf(planData())
  const active = state.plan.steps.find(step => step.status === 'active')
  expect(active?.text).toBe('Fix it and run the tests')
  probe(on, kit => dashboardTab(kit, state, noting(calls), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 68, PROBE))
    const link = await ui.find({ key: 'dash:step' })
    expect(link?.props.plain).toBe(true)
    expect(link?.text).toBe('Step 2 of 3 · Fix it and run the tests')
    expect(Array.from(link?.text ?? '').length <= 67 - 4 - 2 - (surface === 'terminal' ? 0 : 2)).toBe(true)
    calls.length = 0
    await ui.press({ plugin: 'test', key: 'dash:step' })
    expect(calls).toEqual([`openStep:${JSON.stringify(active?.key)}`])
    await ui.unmount()
  }
  // every step done: "Plan done", and a press opens the Plan tab
  for (const step of state.plan.steps) step.status = 'done'
  state.summary.step = null
  state.summary.stepText = null
  const ui = await $.ui.mount(pane('desktop', 84, PROBE))
  expect((await ui.find({ key: 'dash:step' }))?.text).toBe('Plan done')
  calls.length = 0
  await ui.press({ plugin: 'test', key: 'dash:step' })
  expect(calls).toEqual(['setTab:"plan"'])
  await ui.unmount()
})

test('end to end: the goal card`s step opens the Plan tab with that step open', async ($, on) => {
  await started($, on, snapshot(planData()))
  await $.command.run(deck(''))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'dash:step' })
    await ui.redraw()
    expect((await ui.find({ key: 'tab:plan' }))?.props.dimColor).toBe(false)
    const open = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('plan:body:'))
    expect(open.length).toBe(1)
    expect((await ui.find({ key: open[0]?.key?.replace('plan:body:', 'plan:step:') ?? '' }))?.text).toContain('Fix it and run the tests')
    await ui.press({ key: 'tab:dashboard' })
    await ui.redraw()
    await ui.unmount()
  }
})
