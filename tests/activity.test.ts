/**
 * An agent page's Activity (hooks/ui/dash/activity.tsx), as the web deck's
 * Activity tab draws it: the agent's calls newest first in a bordered card,
 * a row each with the tool's chip on a dark tint, what the call was (a
 * shell call's own description, else its command; a path; an MCP tool's
 * server and tool), how it went (◐ running, ◐ waiting, ✕ failed, its time)
 * and how long ago, in fixed columns; on every agent's page, the
 * Orchestrator's too. The Dashboard's Recent activity stays as it was.
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { emptyGit } from '../hooks/git'
import * as M from '../hooks/model'
import { callRowsOf, chipWidthOf } from '../hooks/ui/dash/activity'
import { P } from '../hooks/ui/dash/palette'
import { CARD_CHROME } from '../hooks/ui/dash/parts'
import * as W from '../hooks/web'
import type { DeckAgent, DeckData, DeckSnapshot } from '../types'
import { deck, newWorld, NOW, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane<S extends 'terminal' | 'desktop'>(surface: S, bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

/** A call made and ended: `ms` after `at`, ok or failed; `ms` null leaves it in flight. */
function call(data: DeckData, agent: DeckAgent, id: string, tool: string, input: Record<string, unknown>, at: number, ms: number | null, ok = true) {
  M.beginTool(data, agent, M.activityOf(id, tool, input, '/repo', at))
  if (ms !== null) M.endTool(agent, id, ok, at + ms)
}

/**
 * fixer at work: a read, a shell call with no description and a failed one
 * with its own, a message to an agent, an MCP call, two reads started in
 * the same instant, and an edit in flight; the Orchestrator's own start and
 * checklist; idle, which made no call.
 */
function sessionData(): DeckData {
  const data = M.emptyData(NOW - 3_600_000)
  const main = M.agentOf(data, M.MAIN)!
  main.status = 'running'
  main.model = 'claude-opus-5-5'
  M.noteGoal(data, 'goal', { text: 'Fix the login bug', origin: 'composer', at: NOW - 3_500_000 })
  const fixer = M.newAgent('agent-fixer', 'agent', 'fixer', NOW - 1_800_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', description: 'Fix the login bug' })
  data.agents.push(fixer)
  data.agents.push(M.newAgent('agent-idle', 'agent', 'idle', NOW - 900_000, { type: 'Explore', parentId: M.MAIN, status: 'running', description: 'Look around' }))
  call(data, fixer, 'c1', 'Read', { file_path: '/repo/src/auth.ts' }, NOW - 600_000, 40)
  call(data, fixer, 'c2', 'Bash', { command: 'git commit -m "Add rate limit settings to config"' }, NOW - 540_000, 926)
  call(data, fixer, 'c3', 'Bash', { command: 'npm test', description: "Record the native deck's state and lessons in project notes" }, NOW - 480_000, 2400, false)
  call(data, fixer, 'c4', 'SendMessage', { to: 'ac32262b', message: 'The existing test files are free now: go ahead' }, NOW - 420_000, 600)
  call(data, fixer, 'c5', 'mcp__Claude_Browser__preview_start', { url: 'http://127.0.0.1:4321/' }, NOW - 300_000, 1500)
  call(data, fixer, 'c6', 'Read', { file_path: '/repo/src/a.ts' }, NOW - 60_000, 12)
  call(data, fixer, 'c7', 'Read', { file_path: '/repo/src/b.ts' }, NOW - 60_000, 15)
  call(data, fixer, 'c8', 'Edit', { file_path: '/repo/src/token.ts' }, NOW - 10_000, null)
  call(data, main, 'm1', 'Agent', { description: 'Native parity P2: Plan tab', prompt: 'Build the Plan tab' }, NOW - 3_000_000, 518)
  call(data, main, 'm2', 'TodoWrite', { todos: [] }, NOW - 2_000_000, 20)
  return data
}

function stateOf(data: DeckData = sessionData()): W.WebState {
  return W.webStateOf(data, M.defaultView(), emptyGit(), null, NOW, 's', '/repo')
}

function snapshot(data: DeckData): DeckSnapshot {
  return { v: M.SNAPSHOT_VERSION, data: M.copyOf(data), view: M.defaultView() }
}

async function started($: Engine, on: On, data: DeckData) {
  mock.clock(on, { now: NOW })
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  world(on, newWorld(), snapshot(data))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck(''))
}

/** A row's outcome as drawn: its mark and word, or its time. */
const said = (row: { outcome: { mark: string; word: string } }) => (row.outcome.mark ? `${row.outcome.mark} ${row.outcome.word}` : row.outcome.word)

test('an agent`s calls as the web`s Activity tab rows them: newest first, the tool`s chip, the call in its own words, how it went; keys that stay as calls arrive', () => {
  const data = sessionData()
  const state = stateOf(data)
  const rows = callRowsOf(state, 'agent-fixer')
  expect(rows.map(row => [row.tool, row.text, said(row)])).toEqual([
    ['Edit', 'src/token.ts', '◐ running'],
    ['Read', 'src/b.ts', '15ms'],
    ['Read', 'src/a.ts', '12ms'],
    // an MCP tool's chip says MCP; its server and tool are what it was aimed at
    ['MCP', 'Claude_Browser / preview_start', '1.5s'],
    ['SendMessage', '→ ac32262b: The existing test files are free now: go ahead', '600ms'],
    // a shell call in its own words, else its command
    ['Bash', "Record the native deck's state and lessons in project notes", '✕ failed'],
    ['Bash', 'git commit -m "Add rate limit settings to config"', '926ms'],
    ['Read', 'src/auth.ts', '40ms'],
  ])
  expect(rows.map(row => row.isFailed)).toEqual([false, false, false, false, false, true, false, false])
  expect(rows.map(row => row.outcome.tone)).toEqual(['live', 'quiet', 'quiet', 'quiet', 'quiet', 'fail', 'quiet', 'quiet'])
  // two calls of one tool started in the same instant: the second counted
  expect(rows.slice(0, 3).map(row => row.key)).toEqual([`call:${NOW - 10_000}:Edit`, `call:${NOW - 60_000}:Read:1`, `call:${NOW - 60_000}:Read`])
  // the chip column fits the longest name, a cell each side
  expect(chipWidthOf(rows)).toBe('SendMessage'.length + 2)
  expect(chipWidthOf(rows.slice(0, 3))).toBe(6)
  // at most `most`, the newest
  expect(callRowsOf(state, 'agent-fixer', 2).map(row => row.text)).toEqual(['src/token.ts', 'src/b.ts'])

  // a newer call arrives: the rows before it keep their keys
  const before = new Map(rows.map(row => [row.text, row.key]))
  call(data, M.agentOf(data, 'agent-fixer')!, 'c9', 'Read', { file_path: '/repo/src/c.ts' }, NOW - 5_000, 9)
  const after = callRowsOf(stateOf(data), 'agent-fixer')
  expect(after[0]?.text).toBe('src/c.ts')
  for (const row of after.slice(1)) expect(row.key).toBe(before.get(row.text))

  // a call in flight: waiting while its agent waits on you, — once its agent stopped
  const waiting = stateOf()
  waiting.agents.find(agent => agent.id === 'agent-fixer')!.status = 'waiting'
  expect(said(callRowsOf(waiting, 'agent-fixer')[0]!)).toBe('◐ waiting')
  expect(callRowsOf(waiting, 'agent-fixer')[0]?.outcome.tone).toBe('wait')
  const done = stateOf()
  done.agents.find(agent => agent.id === 'agent-fixer')!.status = 'done'
  expect(said(callRowsOf(done, 'agent-fixer')[0]!)).toBe('—')

  // the Orchestrator's own calls; an agent with none has no rows
  expect(callRowsOf(state, 'main').map(row => [row.tool, row.text, said(row)])).toEqual([
    ['TodoWrite', 'update todos', '20ms'],
    ['Agent', 'Native parity P2: Plan tab', '518ms'],
  ])
  expect(callRowsOf(state, 'agent-idle')).toEqual([])
})

test('the Activity tab: a bordered card, a row a call with its chip on a dark tint, its words cut to the row (red where it failed), how it went and when in fixed columns at the right', async ($, on) => {
  await started($, on, sessionData())
  for (const surface of SURFACES) {
    for (const columns of [84, 68]) {
      const ui = await $.ui.mount(pane(surface, columns))
      await ui.press({ key: 'dash:agent:agent-fixer' })
      await ui.redraw()
      await ui.press({ key: 'detail:activity' })
      await ui.redraw()
      expect((await ui.find({ key: 'detail:activity' }))?.props).toMatchObject({ label: 'Activity 8', dimColor: false })

      // the card, its rows newest first
      const card = (await ui.findAll({ type: 'Box' })).find(box => box.props.borderStyle === 'round' && box.text.includes('src/token.ts'))
      expect(card?.props.borderColor).toBe(P.border)
      const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('call:'))
      expect(rows.map(row => row.key)).toEqual([
        `call:${NOW - 10_000}:Edit`,
        `call:${NOW - 60_000}:Read:1`,
        `call:${NOW - 60_000}:Read`,
        `call:${NOW - 300_000}:mcp__Claude_Browser__preview_start`,
        `call:${NOW - 420_000}:SendMessage`,
        `call:${NOW - 480_000}:Bash`,
        `call:${NOW - 540_000}:Bash`,
        `call:${NOW - 600_000}:Read`,
      ])
      expect(rows[0]?.text).toBe(' Edit ' + 'src/token.ts' + '◐ running' + 'now')
      // a command the row has room for whole at 84 cells, cut at 68 (34 cells for the words there)
      expect(rows[6]?.text).toBe(' Bash ' + (columns === 84 ? 'git commit -m "Add rate limit settings to config"' : 'git commit -m "Add rate limit set…') + '926ms' + '9m')
      expect(rows[7]?.text).toBe(' Read ' + 'src/auth.ts' + '40ms' + '10m')

      // the chip: the tool's name on the dark tint, in a column as wide as the longest name
      const chip = await ui.find({ type: 'Text', text: /^ SendMessage $/ })
      expect(chip?.props).toMatchObject({ color: P.fg2, backgroundColor: P.chip })
      expect((await ui.find({ type: 'Text', text: /^ MCP $/ }))?.props.backgroundColor).toBe(P.chip)
      // how it went, in its hue; how long ago, dim
      expect((await ui.find({ type: 'Text', text: /^◐ running$/ }))?.props.color).toBe(P.runText)
      expect((await ui.find({ type: 'Text', text: /^✕ failed$/ }))?.props.color).toBe(P.failText)
      expect((await ui.find({ type: 'Text', text: /^926ms$/ }))?.props.color).toBe(P.muted2)
      expect((await ui.find({ type: 'Text', text: /^9m$/ }))?.props.color).toBe(P.muted2)
      // a failed call's words in red, cut to the row like any
      const failed = await ui.find({ type: 'Text', text: /^Record the native deck/ })
      expect(failed?.props.color).toBe('#fca5a5')

      // nothing runs past the card: the words are cut to what the row leaves them, with …
      const inner = columns - 1 - CARD_CHROME
      for (const row of rows) expect(Array.from(row.text).length <= inner).toBe(true)
      const message = rows[4]?.text ?? ''
      expect(message.startsWith(' SendMessage → ac32262b:')).toBe(true)
      expect(message.includes('…')).toBe(true)
      await ui.press({ key: 'page:back' })
      await ui.redraw()
      await ui.unmount()
    }
  }
})

test('every page draws it, the Orchestrator`s too: its own calls; more calls than the state holds are counted under the card; an agent with none says so', async ($, on) => {
  const data = sessionData()
  // busy made more calls than the deck keeps of one agent's
  const busy = M.newAgent('agent-busy', 'agent', 'busy', NOW - 1_200_000, { type: 'general-purpose', parentId: M.MAIN, status: 'running', description: 'Read everything' })
  data.agents.push(busy)
  for (let i = 0; i < 16; i++) call(data, busy, `b${i}`, 'Read', { file_path: `/repo/src/f${i}.ts` }, NOW - 1_100_000 + i * 60_000, 10)
  await started($, on, data)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await ui.press({ key: 'dash:agent:main' })
    await ui.redraw()
    await ui.press({ key: 'detail:activity' })
    await ui.redraw()
    const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('call:'))
    expect(rows.map(row => row.text)).toEqual([' TodoWrite ' + 'update todos' + '20ms' + '33m', ' Agent ' + 'Native parity P2: Plan tab' + '518ms' + '50m'])
    expect(await ui.find({ type: 'Text', text: /^The newest/ })).toBeUndefined()
    await ui.press({ key: 'page:back' })
    await ui.redraw()

    await ui.press({ key: 'dash:agent:agent-busy' })
    await ui.redraw()
    await ui.press({ key: 'detail:activity' })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('call:')).length).toBe(M.LIMITS.recent)
    expect((await ui.find({ type: 'Text', text: `The newest ${M.LIMITS.recent} of its 16 calls.` }))?.props.color).toBe(P.muted2)
    await ui.press({ key: 'page:back' })
    await ui.redraw()

    await ui.press({ key: 'dash:agent:agent-idle' })
    await ui.redraw()
    await ui.press({ key: 'detail:activity' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'No tool calls yet: its tool calls show here as it makes them.' })).toBeDefined()
    expect((await ui.findAll({ type: 'Box' })).some(box => box.key?.startsWith('call:'))).toBe(false)
    await ui.press({ key: 'page:back' })
    await ui.redraw()
    await ui.unmount()
  }
})

test('the Dashboard`s Recent activity stays as it was: the agent`s name, the verb and the target; a press opens the agent on its Activity', async ($, on) => {
  await started($, on, sessionData())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // each row's words: the name and the target the presses, the verb between them
    const words = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('act:')).map(box => box.text)
    expect(words[0]).toContain('fixer edited src/token.ts')
    expect(words[1]).toContain('fixer read src/b.ts')
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('dash:act:'))
    expect(rows.map(row => row.text).slice(0, 2)).toEqual(['fixer', 'fixer'])
    await ui.press({ key: rows[0]?.key ?? '' })
    await ui.redraw()
    expect((await ui.find({ key: 'detail:activity' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: `call:${NOW - 10_000}:Edit` }))?.text).toBe(' Edit ' + 'src/token.ts' + '◐ running' + 'now')
    await ui.press({ key: 'page:back' })
    await ui.redraw()
    await ui.unmount()
  }
})
