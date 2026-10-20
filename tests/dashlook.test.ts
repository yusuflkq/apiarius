/**
 * The native Dashboard laid out as the web deck's page (web/app.js
 * `Dashboard`): agent cards in rows of as many as fit (two at the docked
 * pane's 68 to 84 cells, up to six), each row's cards as wide and as tall;
 * a card as the web's run card (its head, its step box, its now line, its
 * foot); Recent activity and Files as bordered lists, side by side from a
 * 120-cell pane; the files outside the repository folded into one dim row;
 * and the whole within what a desktop draws (it drops a drawing of 2000
 * elements or more). A desktop's text is fitted in its own proportional
 * face, so the width model is checked too.
 */
import type { On, RenderElement } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { dashboardTab } from '../hooks/ui/dash/dashboard'
import { cardsPerRow, cellsOf, chipOf, cutCells, monoAdvance, runShort, runTitle, shortPath, uiAdvance, uiWrapAdvance, wrapTicks } from '../hooks/ui/dash/dashModel'
import { P, TONE, pillWidth } from '../hooks/ui/dash/palette'
import { widthFor } from '../hooks/ui/dash/parts'
import type { DashActions, Kit } from '../hooks/ui/types'
import * as W from '../hooks/web'
import type { DeckData } from '../types'
import { newWorld, NOW, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends Surface>(surface: S, bodyColumns: number) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: PROBE,
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

type Element = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

/** The element keyed `key` in a drawn tree, depth first. */
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

/** Every element of `type` in a drawn tree, depth first. */
function allOf(tree: unknown, type: string): Element[] {
  if (!tree || typeof tree !== 'object') return []
  const node = tree as Element
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap(child => allOf(child, type))]
}

/** A drawn element's children that are elements. */
function kids(node: Element | undefined): Element[] {
  return (node?.children ?? []).filter((child): child is Element => !!child && typeof child === 'object')
}

/** All the words in a drawn tree, in order. */
function wordsOf(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (!tree || typeof tree !== 'object') return ''
  const node = tree as Element
  return [typeof node.props?.label === 'string' && !(node.children ?? []).length ? node.props.label : '', ...(node.children ?? []).map(wordsOf)].join('')
}

/** The instance a test draws the Dashboard into by itself. */
const PROBE = 'look-probe'

/** Draws `draw`'s tree as the deck's pane would (a cell narrower than the pane), under the PROBE instance, with the surface's own elements. */
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

async function started($: Engine, on: On) {
  mock.clock(on, { now: NOW })
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, newWorld())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
}

function todo(content: string, status: 'completed' | 'in_progress' | 'pending', activeForm = content) {
  return { content, status, activeForm }
}

/**
 * A session under way: the Orchestrator's three-step plan, one step done;
 * fixer on its four-item checklist, running the tests; helper done; and
 * `more` agents beside them, every third one done. Each agent has calls,
 * and fixer edited two files.
 */
function lookData(more = 0): DeckData {
  const data = M.emptyData(NOW - 600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Fix the login bug', origin: 'composer', at: NOW - 540_000 })
  M.noteTodo(data, main, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Find the bug', 'completed'), todo('Fix it and run the tests', 'in_progress', 'Fixing it'), todo('Review the diff', 'pending')] }, NOW - 500_000)
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
  M.noteTodo(data, fixer, 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: [todo('Read the auth code', 'completed'), todo('Find the expiry check', 'completed'), todo('Fix the check', 'in_progress', 'Fixing the expiry check'), todo('Run the tests', 'pending')] }, NOW - 380_000)
  const helper = M.newAgent('agent-helper', 'agent', 'helper', NOW - 300_000, { type: 'Explore', parentId: fixer.id, status: 'completed', endedAt: NOW - 200_000, description: 'Find the auth module', answer: 'It is src/auth.ts' })
  data.agents.push(helper)
  for (let i = 0; i < more; i++) {
    const one = M.newAgent(`agent-w${i}`, 'agent', `Worker number ${i}`, NOW - 280_000 + i * 1000, { type: 'general-purpose', parentId: M.MAIN, status: i % 3 === 0 ? 'completed' : 'running', endedAt: i % 3 === 0 ? NOW - 60_000 : undefined, description: `Part ${i} of the rate limiter work`, answer: i % 3 === 0 ? `Part ${i} is done and committed` : undefined })
    data.agents.push(one)
    M.beginTool(data, one, M.activityOf(`w${i}`, 'Read', { file_path: `/repo/src/part${i}.ts` }, '/repo', NOW - 50_000 + i * 1000))
    M.endTool(one, `w${i}`, true, NOW - 49_000 + i * 1000)
  }
  M.beginTool(data, helper, M.activityOf('h1', 'Grep', { pattern: 'login', path: '/repo/src' }, '/repo', NOW - 280_000))
  M.endTool(helper, 'h1', true, NOW - 279_000)
  M.beginTool(data, fixer, M.activityOf('c1', 'Read', { file_path: '/repo/src/auth.ts' }, '/repo', NOW - 360_000))
  M.endTool(fixer, 'c1', true, NOW - 359_960)
  M.beginTool(data, fixer, M.activityOf('c2', 'Edit', { file_path: '/repo/src/auth.ts' }, '/repo', NOW - 240_000))
  M.endTool(fixer, 'c2', false, NOW - 239_000)
  M.beginTool(data, fixer, M.activityOf('c3', 'Bash', { command: 'npm test', description: 'Run the unit tests' }, '/repo', NOW - 20_000))
  const patch = ['@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' export { a, b }'].join('\n')
  M.addEdit(data, fixer, { id: 'e1', agent: fixer.id, tool: 'Edit', path: 'src/auth.ts', abs: '/repo/src/auth.ts', at: NOW - 240_000, added: 1, removed: 1, patch, isNew: false })
  M.addEdit(data, fixer, { id: 'e2', agent: fixer.id, tool: 'Edit', path: 'src/token.ts', abs: '/repo/src/token.ts', at: NOW - 100_000, added: 2, removed: 0, patch, isNew: false })
  return data
}

function stateOf(data: DeckData = lookData()): W.WebState {
  return W.webStateOf(data, M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
}

/** The state in a repository, with `n` scratch files outside it (the newest first), as `webStateOf` marks them. */
function withOutside(state: W.WebState, n: number): W.WebState {
  state.repo = { name: 'repo', root: '/repo', branch: 'main', ahead: 0, behind: 0, head: 'abc1234' }
  const scratch = Array.from({ length: n }, (_, i) => ({
    path: `C:/Users/me/AppData/Local/Temp/claude/session/scratchpad/talk${i % 3}/msg${i}.txt`,
    editors: ['agent-fixer'],
    live: false,
    isShared: false,
    added: i + 1,
    removed: 0,
    lastAt: NOW - 1_000 * (i + 1),
    isOutside: true as const,
  }))
  state.files = [...state.files.filter(file => !file.isOutside), ...scratch]
  state.summary.filesInRepo = state.files.filter(file => !file.isOutside).length
  return state
}

test('cards a row as the web grid`s auto-fill lays them, at 32 cells or more: one below a 66-cell pane, two at its usual 68 to 84, three at 120, four at 160, up to six at its widest', () => {
  // the pane's cells; the tab draws a cell narrower
  const rows = [56, 65, 66, 68, 84, 98, 99, 120, 160, 165, 198, 244, 400].map(paneCells => cardsPerRow(paneCells - 1))
  expect(rows).toEqual([1, 1, 2, 2, 2, 2, 3, 3, 4, 5, 6, 6, 6])
  // never narrower than 32 cells where two or more stand in a row
  for (const paneCells of [66, 84, 99, 120, 132, 160, 198, 244]) expect(widthFor(paneCells - 1, cardsPerRow(paneCells - 1)) >= 32).toBe(true)
})

test('at 68, 84, 120 and 160 cells the cards stand in rows, every card of a row as wide and as tall (its now line padded to the row`s longest), no row wider than the pane, and no blank line inside a card on the terminal', async ($, on) => {
  const state = stateOf(lookData(5))
  // one agent with a long line, so its row's bodies take two lines
  const long = state.agents.find(one => one.id === 'agent-w1')!
  long.now = 'Reading the limiter, the Redis store and the tests to see where the window slides and why it double counts at the edge'
  probe(on, kit => dashboardTab(kit, state, noting([]), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    for (const paneCells of [68, 84, 120, 160]) {
      const columns = paneCells - 1
      const ui = await $.ui.mount(pane(surface, paneCells))
      const drawn = await ui.drawn()
      const perRow = cardsPerRow(columns)
      const width = widthFor(columns, perRow)
      const grid = kids(keyed(drawn, 'dash:agents'))[1]
      const rows = kids(grid)
      expect(rows.length).toBe(Math.ceil(state.agents.length / perRow))
      for (const row of rows) {
        const cards = kids(row)
        expect(cards.every(card => String(card.props?.key).startsWith('card:'))).toBe(true)
        expect(cards.length <= perRow).toBe(true)
        expect(cards.map(card => card.props?.width)).toEqual(cards.map(() => width))
        expect(cards.length * width + (cards.length - 1) <= columns).toBe(true)
        // the bodies: as many lines in every card of the row, one or two
        const bodies = cards.map(card => kids(card)[2]?.props?.height)
        expect(new Set(bodies).size).toBe(1)
        expect([1, 2]).toContain(bodies[0])
        if (surface === 'terminal') expect(cards.every(card => (card.props?.rowGap ?? 0) === 0)).toBe(true)
      }
      // the row that holds the long line takes two lines; a row of short ones one
      const tall = rows.find(row => kids(row).some(card => card.props?.key === 'card:agent-w1'))
      expect(kids(kids(tall)[0])[2]?.props?.height).toBe(2)
      await ui.unmount()
    }
  }
})

test('a card reads as the web`s run card: the avatar, the name, its pill right after it and "Open →" at the right; the step box with its glyph, words and "n/total"; the now line; "model · tokens" at the left of its foot and "Started 6m ago" at the right', async ($, on) => {
  const state = stateOf()
  probe(on, kit => dashboardTab(kit, state, noting([]), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 84))
    const drawn = await ui.drawn()
    const card = keyed(drawn, 'card:agent-fixer')
    const [head, step, body, foot] = kids(card)
    // the head: the avatar, the name, the pill, "Open →" last
    const [face, name, pill, open] = kids(head)
    if (surface === 'desktop') {
      expect(kids(face)[0]?.type).toBe('Svg')
      expect(kids(pill)[0]?.props).toMatchObject({ alt: 'running', width: pillWidth('running'), height: 22 })
    } else {
      expect(wordsOf(face)).toBe('●')
      expect(kids(pill)[0]?.props).toMatchObject({ color: TONE.running.pillFg, backgroundColor: TONE.running.pillBg })
      expect(wordsOf(pill)).toBe(' running ')
    }
    expect(kids(name)[0]?.props).toMatchObject({ key: 'dash:agent:agent-fixer', label: 'fixer', plain: true })
    expect(keyed(open, 'dash:open:agent-fixer')?.props).toMatchObject({ label: 'Open →' })
    // the step box: bordered, a shade over the pane; fixer's glyph (in hand), its scope, its checklist's count dim
    expect(step?.props).toMatchObject({ key: 'chip:agent-fixer', borderStyle: 'round', borderColor: P.stepEdge, backgroundColor: P.stepBox })
    const [glyph, words, count] = kids(step)
    if (surface === 'desktop') expect(kids(glyph)[0]?.props).toMatchObject({ alt: 'In progress', width: 15, height: 15 })
    else expect(kids(glyph)[0]?.props?.color).toBe(P.run)
    expect(wordsOf(words)).toBe('Fix the login bug')
    expect(wordsOf(count)).toBe('2/4')
    expect(kids(count)[0]?.props?.color).toBe(P.muted2)
    // the now line, dim where a desktop draws a Button's ink alone
    expect(wordsOf(body)).toBe('Fixing the expiry check')
    expect(allOf(body, 'Button')[0]?.props?.dimColor).toBe(surface === 'desktop')
    // the foot: model and tokens at the left, when at the right
    expect(foot?.props?.justifyContent).toBe('space-between')
    expect(kids(foot).map(wordsOf)).toEqual(['haiku-4.5 · 48k', 'Started 6m ago'])
    // the Orchestrator's step box: the step in hand and the plan's count; helper's done
    expect(wordsOf(keyed(drawn, 'chip:main'))).toContain('Fix it and run the tests')
    expect(wordsOf(keyed(drawn, 'chip:main'))).toContain('1/3')
    expect(wordsOf(keyed(drawn, 'chip:agent-helper'))).toContain('Find the auth module')
    expect(wordsOf(kids(keyed(drawn, 'card:agent-helper'))[3])).toContain('Finished 3m ago')
    await ui.unmount()
  }
})

test('the step box says what the web`s chip says: the Orchestrator`s step in hand (or "Plan done") with the plan`s count; an agent`s scope with its checklist`s; its glyph by how it stands; the foot`s time in the web`s words', () => {
  const state = stateOf()
  const agent = (id: string) => state.agents.find(one => one.id === id)!
  expect(chipOf(state, agent('main'))).toEqual({ text: 'Fix it and run the tests', glyph: 'active', n: '1/3' })
  expect(chipOf(state, agent('agent-fixer'))).toEqual({ text: 'Fix the login bug', glyph: 'active', n: '2/4' })
  expect(chipOf(state, agent('agent-helper'))).toMatchObject({ text: 'Find the auth module', glyph: 'done' })
  for (const step of state.plan.steps) step.status = 'done'
  state.summary.stepText = null
  expect(chipOf(state, agent('main'))).toEqual({ text: 'Plan done', glyph: 'done', n: '3/3' })
  agent('agent-fixer').status = 'waiting'
  expect(chipOf(state, agent('agent-fixer')).glyph).toBe('waiting')
  agent('agent-fixer').status = 'failed'
  expect(chipOf(state, agent('agent-fixer')).glyph).toBe('failed')
  // when, as the web's foot says it, and in fewer words for a narrow card
  expect(runTitle(agent('agent-helper'), NOW)).toBe('Finished 3m ago')
  expect(runShort(agent('agent-helper'), NOW)).toBe('3m ago')
  agent('agent-fixer').status = 'running'
  expect(runTitle(agent('agent-fixer'), NOW)).toBe('Started 6m ago')
})

test('Recent activity as the web`s list: a bordered box, a 1 px rule between rows where a desktop draws one, each row the face, the name (bold where a Button`s Text draws), the verb dim, the target; how it went and when in fixed columns; the name and the target open the agent on its Activity', async ($, on) => {
  const calls: string[] = []
  const state = stateOf()
  probe(on, kit => dashboardTab(kit, state, noting(calls), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 84))
    const drawn = await ui.drawn()
    const list = keyed(drawn, 'dash:calls')
    expect(list?.props).toMatchObject({ borderStyle: 'round', borderColor: P.border })
    const rows = kids(list).filter(row => String(row.props?.key).startsWith('act:'))
    expect(rows.length).toBe(state.activity.length)
    // the rules: one between each two rows on a desktop, none on the terminal
    const rules = allOf(list, 'Svg').filter(svg => svg.props?.alt === 'Divider')
    expect(rules.length).toBe(surface === 'desktop' ? rows.length - 1 : 0)
    // fixer's call in flight: its words, its outcome in blue, its age
    const first = rows[0]
    expect(first?.hover).toEqual({ backgroundColor: P.rowHover })
    const [, words, outcome, age] = kids(first)
    expect(wordsOf(words)).toBe('fixer ran Run the unit tests')
    const [name, verb, target] = kids(words)
    expect(kids(kids(name)[0])[0]?.props).toMatchObject({ bold: true, color: P.text })
    expect(kids(verb)[0]?.props?.color).toBe(P.muted)
    expect(kids(target)[0]?.type).toBe('Button')
    expect(outcome?.props?.width).toBe(9)
    expect(age?.props?.width).toBe(4)
    expect(wordsOf(outcome)).toBe('◐ running')
    expect(kids(outcome)[0]?.props?.color).toBe(P.runText)
    expect(wordsOf(age)).toBe('now')
    // the failed edit: ✕ in red
    const failed = rows.find(row => wordsOf(row).includes('edited'))
    expect(wordsOf(kids(failed)[2])).toBe('✕ failed')
    // a press on the name or the target opens fixer on its Activity
    for (const key of [`dash:act:${String(first?.props?.key).slice('act:'.length)}`, `dash:acttarget:${String(first?.props?.key).slice('act:'.length)}`]) {
      calls.length = 0
      await ui.press({ plugin: 'test', key })
      expect(calls).toEqual(['setAgentPane:"activity"', 'openAgent:"agent-fixer"'])
    }
    await ui.unmount()
  }
})

test('the files outside the repository fold into one dim row after the repository`s own: FILES counts the state`s filesInRepo, a press opens them by their last two parts (the newest twenty, then how many more), another shuts them; with no repository nothing folds', async ($, on) => {
  const calls: string[] = []
  const where: { state: W.WebState } = { state: withOutside(stateOf(), 25) }
  probe(on, kit => dashboardTab(kit, where.state, noting(calls), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 84))
    expect((await ui.find({ key: 'dash:files' }))?.text).toContain('FILES  2')
    const files = () => ui.findAll({ type: 'Button' }).then(buttons => buttons.map(button => button.key ?? '').filter(key => key.startsWith('dash:file:')))
    expect(await files()).toEqual(['dash:file:src/token.ts', 'dash:file:src/auth.ts'])
    const fold = await ui.find({ key: 'dash:files:outside' })
    expect(fold?.props).toMatchObject({ label: '25 files outside the repo', plain: true, dimColor: true })
    // open: the newest twenty, by their last two parts, then how many more
    calls.length = 0
    await ui.press({ plugin: 'test', key: 'dash:files:outside' })
    expect(calls).toEqual(['redraw:'])
    await ui.redraw()
    const open = await files()
    expect(open.length).toBe(2 + 20)
    expect(open[2]).toBe('dash:file:C:/Users/me/AppData/Local/Temp/claude/session/scratchpad/talk0/msg0.txt')
    expect((await ui.find({ key: open[2] ?? '' }))?.text).toBe('msg0.txt')
    expect((await ui.find({ key: 'files:C:/Users/me/AppData/Local/Temp/claude/session/scratchpad/talk0/msg0.txt' }))?.text).toContain('…/talk0/')
    expect((await ui.find({ key: 'files:outside:more' }))?.text).toBe('and 5 more files outside the repo')
    // shut again
    await ui.press({ plugin: 'test', key: 'dash:files:outside' })
    await ui.redraw()
    expect((await files()).length).toBe(2)
    await ui.unmount()
  }
  // with no repository the state marks nothing outside: every file is listed, nothing folds
  where.state = stateOf()
  const ui = await $.ui.mount(pane('desktop', 84))
  expect(await ui.find({ key: 'dash:files:outside' })).toBeUndefined()
  expect((await ui.find({ key: 'dash:files' }))?.text).toContain('FILES  2')
  await ui.unmount()
  expect(shortPath('C:/Users/me/scratchpad/talk/msg2.txt')).toEqual({ dir: '…/talk/', name: 'msg2.txt' })
  expect(shortPath('/tmp/a.txt')).toEqual({ dir: '/tmp/', name: 'a.txt' })
})

test('Recent activity and Files sit side by side from a 120-cell pane, each half of it, as the web`s two columns; one under the other below', async ($, on) => {
  const state = stateOf()
  probe(on, kit => dashboardTab(kit, state, noting([]), NOW, null))
  await started($, on)
  for (const surface of SURFACES) {
    for (const paneCells of [84, 119, 120, 160]) {
      const ui = await $.ui.mount(pane(surface, paneCells))
      const drawn = await ui.drawn()
      const activity = keyed(drawn, 'dash:activity')
      const files = keyed(drawn, 'dash:files')
      const parent = allOf(drawn, 'Box').find(box => kids(box).includes(activity as Element))
      expect(kids(parent).includes(files as Element)).toBe(true)
      const isSide = paneCells >= 120
      expect(parent?.props?.flexDirection).toBe(isSide ? 'row' : 'column')
      const width = isSide ? Math.floor((paneCells - 1 - 2) / 2) : paneCells - 1
      expect([activity?.props?.width, files?.props?.width]).toEqual([width, width])
      await ui.unmount()
    }
  }
})

/** What a desktop counts of a drawn tree before it draws it: every element and string a node, the deepest path, every character of strings and props. */
function budgetOf(tree: unknown): { nodes: number; depth: number; chars: number } {
  if (typeof tree === 'string') return { nodes: 1, depth: 1, chars: tree.length }
  if (!tree || typeof tree !== 'object') return { nodes: 1, depth: 1, chars: 0 }
  const node = tree as Element
  let nodes = 1
  let depth = 1
  let chars = JSON.stringify(node.props ?? {}).length + JSON.stringify(node.hover ?? {}).length
  for (const child of node.children ?? []) {
    const one = budgetOf(child)
    nodes += one.nodes
    depth = Math.max(depth, one.depth + 1)
    chars += one.chars
  }
  return { nodes, depth, chars }
}

test('the Dashboard stays well inside what a desktop draws (it drops a drawing of 2000 elements, 32 deep or 262144 characters): twelve agents, ten calls, ten files and the twenty newest of forty outside the repository open', async ($, on) => {
  const data = lookData(12)
  for (let i = 0; i < 12; i++) M.addEdit(data, M.agentOf(data, 'agent-fixer')!, { id: `x${i}`, agent: 'agent-fixer', tool: 'Edit', path: `src/deep/folder/file${i}.ts`, abs: `/repo/src/deep/folder/file${i}.ts`, at: NOW - 90_000 + i * 1000, added: i + 1, removed: i, patch: '@@ -1 +1 @@\n-a\n+b', isNew: false })
  const state = withOutside(stateOf(data), 40)
  probe(on, kit => dashboardTab(kit, state, noting([]), NOW, null))
  await started($, on)
  for (const paneCells of [68, 244]) {
    const ui = await $.ui.mount(pane('desktop', paneCells))
    await ui.press({ plugin: 'test', key: 'dash:files:outside' })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('dash:file:')).length).toBe(30)
    const budget = budgetOf(await ui.drawn())
    expect(budget.nodes < 1600).toBe(true)
    expect(budget.depth < 20).toBe(true)
    expect(budget.chars < 200_000).toBe(true)
    await ui.press({ plugin: 'test', key: 'dash:files:outside' })
    await ui.unmount()
  }
})

test('a desktop`s text is fitted in its own face: Anthropic Sans at 13 px, a cell its "0"; cut and laid into lines by it, never past the room; the terminal a cell a character', () => {
  // as the face draws them (measured: 10.24 and 13.88 cells)
  expect(Math.abs(cellsOf('Orchestrator', uiAdvance) - 10.24) < 0.2).toBe(true)
  expect(Math.abs(cellsOf('Native dashboard', uiAdvance) - 13.88) < 0.2).toBe(true)
  expect(cellsOf('Orchestrator', monoAdvance)).toBe(12)
  // a cut keeps to its room and ends in …
  const cut = cutCells('Native dashboard visual parity pass', 12, uiAdvance)
  expect(cut.endsWith('…')).toBe(true)
  expect(cellsOf(cut, uiAdvance) <= 12).toBe(true)
  expect(cutCells('Native dashboard', 20, uiAdvance)).toBe('Native dashboard')
  // lines laid by the face, each within its room, more words a line than a cell a character holds
  const said = 'Activity and Talk in the native deck now match the web, and everything is pushed (81f29d4, 227 tests passing).'
  const lines = wrapTicks(said, 40, 2, uiWrapAdvance).map(row => row.map(part => part.text).join(''))
  expect(lines.length).toBe(2)
  for (const line of lines) expect(cellsOf(line, uiWrapAdvance) <= 40).toBe(true)
  expect(Array.from(lines[0] ?? '').length > 40).toBe(true)
  expect(lines[1]?.endsWith('…')).toBe(true)
})
