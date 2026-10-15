/**
 * The native dashboard's cards and rows as things to press (tests/dash.test.ts
 * covers the rest of it): every line of an agent card, an Org tree row and a
 * needs card or row opens that agent's page, and "Open →" says so, lit while
 * the pointer is on what it opens.
 */
import type { On, RenderElement } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { dashboardTab } from '../hooks/ui/dash/dashboard'
import { wrapTicks } from '../hooks/ui/dash/dashModel'
import { needsCards } from '../hooks/ui/dash/needs'
import { orgTree } from '../hooks/ui/dash/orgTree'
import { TONE } from '../hooks/ui/dash/palette'
import { quiet } from '../hooks/ui/dash/parts'
import type { DashActions, Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import type { DeckData, DeckSnapshot } from '../types'
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
          expect(calls).toEqual([`openAgent:${JSON.stringify(agent.id)}`])
        }
        const open = keyed(drawn, `dash:open:${agent.id}`)
        expect(open?.props).toMatchObject({ label: 'Open →', plain: true, dimColor: true })
        expect(open?.hover).toEqual({ color: tone.pillFg, dimColor: false })
        // the lines keep their colours: the foot in the dim grey, as before
        const foot = await ui.find({ key: `dash:foot:${agent.id}` })
        expect(foot?.text).toContain(agent.model)
        expect((foot?.children[0] as Element | undefined)?.props?.color).toBe('#737373')
      }
      // the now line on one row or two, its code span a chip
      const said = [await ui.find({ key: 'dash:now:agent-fixer:0' }), await ui.find({ key: 'dash:now:agent-fixer:1' })].map(one => one?.text ?? '').filter(Boolean)
      expect(said.join(' ')).toBe('Needs your OK to run npm test')
      expect((await ui.findAll({ type: 'Text', text: 'npm' })).some(one => one.props.backgroundColor === '#262626')).toBe(true)
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
        expect(calls).toEqual([`openAgent:${JSON.stringify(agent.id)}`])
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
  // two more held calls: five in all, so two go past the cards as rows
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
        expect(calls).toEqual([`openAgent:${JSON.stringify(agent)}`])
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
        expect(calls).toEqual([`openAgent:${JSON.stringify(agent)}`])
      }
    }
    await ui.unmount()
  }
})
