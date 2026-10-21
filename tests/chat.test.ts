/**
 * Chat as a group chat, on the desktop and the terminal: the member list at
 * the top (Everyone, then every agent with its avatar, name and status; two
 * or three columns, folded where the pane is narrow; one wrapped line on the
 * terminal), an agent picked showing your conversation with it and pointing
 * the composer at it; yours at the right in a blue bubble with what came of
 * it and when under it; others' at the left under the sender's avatar, name,
 * "to" the recipient's avatar and name, and time, each name opening that
 * agent's page, their words as Markdown in a dark bubble; one sender's
 * messages stacked under one name; Claude Code's notices centred; a question
 * held on you amber with "Answer on Now →"; a long message folded with Show
 * more; the window that keeps inside the pane's bounds; and "Did you mean"
 * for a name several agents answer to. Drawn by the deck itself (`/deck
 * demo` over the v2 sample, `/deck` over a live session).
 */
import type { On } from 'claude-code'
import { expect, mock, test, type Engine, type FoundElement } from 'claude-code/testing'

import * as M from '../hooks/model'
import { chatEndOf, followStep, isAtEndOf, membersOf, routeFrom, type ChatFollow } from '../hooks/ui/v2/chat'
import * as AV from '../web/avatars.mjs'
import { P, mix } from '../hooks/ui/v2/palette'
import * as W from '../hooks/web'
import { IDS, SAMPLE_NOW, v2Session } from './v2session'
import { deck, newWorld, NOW, work, world, type World } from './world'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = 'terminal' | 'desktop'

/** The deck's pane as a surface lays it out, `bodyColumns` across. */
function pane(surface: Surface, bodyColumns = 84) {
  return {
    plugin: 'agent-deck',
    surface,
    component: 'Pane' as const,
    requestId: 'agent-deck',
    viewport: { columns: bodyColumns + 4, rows: 60, isFullscreen: true },
    props: { title: 'Agent Deck', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }
}

type Drawing = { press: (target: { key: string }) => Promise<unknown>; redraw: () => Promise<void> }

/** A press, then the drawing as the pane draws it next. */
async function press(ui: Drawing, key: string) {
  await ui.press({ key })
  await ui.redraw()
}

/** The v2 sample as `/deck demo` reads it: the sample session's state and its agent files, patches and cut messages. */
function sample(on: On, patch: (state: W.WebStateV2) => W.WebStateV2 = state => state) {
  const session = v2Session()
  const v2 = patch(W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable))
  const v1 = W.webStateOf(session.data, M.defaultView(), session.git, session.usage, session.now, session.sessionId, session.cwd)
  const agentFiles = new Map(W.agentFilesOf(session.data).map(one => [one.id, one.text]))
  const patches = new Map(session.data.edits.map(edit => [W.webIdOf(edit.id), edit.patch]))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('/web/fixtures/state.json')) return { value: JSON.stringify(v1) }
    if (path.endsWith('/web/fixtures/state.v2.json')) return { value: JSON.stringify(v2) }
    const agent = /\/web\/fixtures\/v2\/agents\/([^/]+)\.json$/.exec(path)?.[1]
    if (agent && agentFiles.has(agent)) return { value: agentFiles.get(agent)! }
    const patch = /\/web\/fixtures\/v2\/patches\/([^/]+)\.diff$/.exec(path)?.[1]
    if (patch && patches.has(patch)) return { value: patches.get(patch)! }
    if (/\/web\/fixtures\/v2\/messages\//.test(path)) return { value: 'The whole answer.\n\n- **researcher** mapped the routes.\n' }
    return { deny: 'no such file' }
  })
  return v2
}

/** The engine, the v2 sample read, and `/deck demo` shown. */
async function demo($: Engine, on: On, w: World = newWorld(), patch?: (state: W.WebStateV2) => W.WebStateV2) {
  const clock = mock.clock(on, { now: SAMPLE_NOW + 3_600_000 })
  const v2 = sample(on, patch)
  on('ui.focus', () => ({}))
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run(deck('demo'))
  await clock.advance(1000)
  return { clock, v2, w }
}

/** An element as a drawing describes it, found under another. */
type Node = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

function keyOf(node: Node): string {
  return String(node.key ?? node.props?.key ?? '')
}

/** The elements under `el` (itself left out) that `test` takes, in document order. */
function under(el: { children: unknown[] } | Node | undefined, test: (node: Node) => boolean): Node[] {
  const found: Node[] = []
  const walk = (list: unknown[]) => {
    for (const one of list) {
      if (!one || typeof one !== 'object') continue
      const node = one as Node
      if (test(node)) found.push(node)
      walk(node.children ?? [])
    }
  }
  walk(el?.children ?? [])
  return found
}

/** The Box keys a drawing holds, in document order, that start with `prefix`. */
async function boxKeys(ui: { findAll: (q: { type: 'Box' }) => Promise<FoundElement[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith(prefix))
}

/** The Button keys a drawing holds, in document order, that start with `prefix`. */
async function buttonKeys(ui: { findAll: (q: { type: 'Button' }) => Promise<FoundElement[]> }, prefix: string): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith(prefix))
}

const BLUE = '#2563eb'
const BUBBLE = '#262626'
const PICKED = mix(BLUE, P.ground, 0.8)

test('Chat is a group chat: yours at the right in a blue bubble, when under it; others at the left under the sender`s avatar and name, "to" the recipient`s avatar and name, and time, their words as Markdown in a dark bubble; each name opens that agent`s page', async ($, on) => {
  const { v2 } = await demo($, on)
  const prompt = v2.chat.find(row => row.from === 'you' && row.kind === 'prompt')!
  const found = v2.chat.find(row => row.from === IDS.researcher && row.kind === 'result')!
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    // every message, oldest first
    expect(await boxKeys(ui, 'msg:')).toEqual(v2.chat.map(row => `msg:${row.id}`))

    // yours: at the right, three quarters wide at most, when under it; no head over a prompt to the Orchestrator
    const mine = await ui.find({ key: `msg:${prompt.id}` })
    expect(mine?.props).toMatchObject({ alignItems: 'flex-end', width: '75%' })
    expect(mine?.text).toMatch(/\d+m$/)
    expect(await ui.find({ key: `grp:msg:${prompt.id}` })).toBeDefined()
    expect(await ui.find({ key: `head:msg:${prompt.id}` })).toBeUndefined()
    if (surface === 'desktop') {
      const bubble = under(mine, node => node.type === 'Box' && node.props?.backgroundColor === BLUE)
      expect(bubble.length).toBe(1)
      expect(under(bubble[0], node => node.type === 'Text' && node.props?.color === '#ffffff').length).toBeGreaterThan(0)
    } else {
      expect(mine?.text.startsWith('›')).toBe(true)
    }

    // others': the sender's avatar beside its name, "to", the recipient's avatar and name, the time; the words as Markdown
    const group = await ui.find({ key: `grp:msg:${found.id}` })
    expect((await ui.find({ key: `chat:from:msg:${found.id}` }))?.props).toMatchObject({ label: 'researcher', plain: true })
    expect((await ui.find({ key: `chat:to:msg:${found.id}` }))?.props).toMatchObject({ label: 'Orchestrator', plain: true })
    expect((await ui.find({ key: `head:msg:${found.id}` }))?.text).toMatch(/^researcher.*to.*Orchestrator\d+m$/)
    const theirs = await ui.find({ key: `msg:${found.id}` })
    expect(under(theirs, node => node.type === 'Markdown' && node.props?.text === found.text).length).toBe(1)
    if (surface === 'desktop') {
      const faces = under(group, node => node.type === 'Svg')
      expect(faces.map(node => [String(node.props?.alt), node.props?.width])).toEqual([
        ["researcher's avatar", 20],
        ["Orchestrator's avatar", 16],
      ])
      expect(theirs?.props).toMatchObject({ alignItems: 'flex-start', width: '88%' })
      expect(under(theirs, node => node.type === 'Box' && node.props?.backgroundColor === BUBBLE && node.props?.borderStyle === 'round').length).toBe(1)
      // a desktop draws a Button's label alone, in its own ink: the sender's lit, the recipient's dim
      expect((await ui.find({ key: `chat:from:msg:${found.id}` }))?.props.dimColor).toBe(false)
      expect((await ui.find({ key: `chat:to:msg:${found.id}` }))?.props.dimColor).toBe(true)
    }
    // each name opens that agent's page; Back comes back to Chat
    await press(ui, `chat:from:msg:${found.id}`)
    expect(await ui.find({ key: `page:${IDS.researcher}` })).toBeDefined()
    await press(ui, 'key:b')
    await press(ui, `chat:to:msg:${found.id}`)
    expect(await ui.find({ key: 'page:main' })).toBeDefined()
    await press(ui, 'key:b')
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)

    // words to you name no recipient; to nobody in particular, none either
    const answer = v2.chat.find(row => row.from === 'main' && row.to === 'you' && row.kind === 'answer')!
    expect(await ui.find({ key: `chat:to:msg:${answer.id}` })).toBeUndefined()
    expect((await ui.find({ key: `head:msg:${answer.id}` }))?.text).toMatch(/^Orchestrator\d+m$/)
    const plain = v2.chat.find(row => row.to === null)!
    expect((await ui.find({ key: `head:msg:${plain.id}` }))?.text).toMatch(/^builder\d+m$/)
    // a name SendMessage was given that no agent carries: said, no press, a grey dot for its face
    const lost = v2.chat.find(row => row.to === 'ops-bot')!
    expect(await ui.find({ key: `chat:to:msg:${lost.id}` })).toBeUndefined()
    expect((await ui.find({ key: `head:msg:${lost.id}` }))?.text).toMatch(/^builder.*to.*ops-bot\d+m$/)
    // a SendMessage's summary, bold over its words
    const between = v2.chat.find(row => row.kind === 'message' && row.title === 'Limiter ready for review')!
    expect((await ui.find({ key: `chat:to:msg:${between.id}` }))?.props.label).toBe('reviewer')
    expect(under(await ui.find({ key: `msg:${between.id}` }), node => node.type === 'Text' && node.props?.bold === true && JSON.stringify(node).includes('Limiter ready for review')).length).toBe(1)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('one sender`s messages within a few minutes stack under one avatar and name; one to another recipient says so over it, with that one`s avatar and name', async ($, on) => {
  const { v2 } = await demo($, on)
  // the Orchestrator answers you, then starts builder, docs and scout, each within minutes of the last
  const answer = v2.chat.find(row => row.from === 'main' && row.to === 'you' && row.kind === 'answer')!
  const spawns = v2.chat.filter(row => row.from === 'main' && row.kind === 'spawn' && row.at > answer.at && row.at - answer.at < 6 * 60_000)
  expect(spawns.map(row => row.to)).toEqual([IDS.builder, IDS.docs, IDS.scout])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    const group = await ui.find({ key: `grp:msg:${answer.id}` })
    // one head for the four
    for (const row of spawns) expect(await ui.find({ key: `grp:msg:${row.id}` })).toBeUndefined()
    expect(under(group, node => keyOf(node).startsWith('msg:')).map(keyOf)).toEqual([answer, ...spawns].map(row => `msg:${row.id}`))
    // each spawn after the answer to you names whom it went to: its face, its name a press, when
    expect(await ui.find({ key: `to:msg:${answer.id}` })).toBeUndefined()
    for (const [i, name] of ['builder', 'docs', 'scout'].entries()) {
      const row = spawns[i]!
      expect((await ui.find({ key: `to:msg:${row.id}` }))?.text).toMatch(new RegExp(`^to[◆●▲■✦⬢★◉]?${name}· [0-9]+m$`))
      expect((await ui.find({ key: `chat:to:msg:${row.id}` }))?.props.label).toBe(name)
    }
    // the sender's face once, at the group's left; each recipient's beside its name
    if (surface === 'desktop') {
      expect(under(group, node => node.type === 'Svg').map(node => String(node.props?.alt))).toEqual(["Orchestrator's avatar", "builder's avatar", "docs's avatar", "scout's avatar"])
    } else {
      const glyphs = under(group, node => node.type === 'Text' && typeof node.children?.[0] === 'string' && AV.GLYPHS.includes(node.children[0] as string))
      expect(glyphs.length).toBe(4)
    }
    // another sender between starts a group of its own
    const result = v2.chat.find(row => row.from === IDS.researcher)!
    expect(await ui.find({ key: `grp:msg:${result.id}` })).toBeDefined()
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('Claude Code`s notices are centred, small and dim; a question held on you is amber-edged with Answer on Now →, which takes Now`s card for it into view', async ($, on) => {
  const { v2 } = await demo($, on)
  const done = v2.chat.find(row => row.from === 'engine' && row.kind === 'task')!
  const asked = v2.chat.find(row => row.kind === 'question' && row.callId === 'toolu_01AskOne')!
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    const notice = await ui.find({ key: `msg:${done.id}` })
    expect(notice?.props.justifyContent).toBe('center')
    expect(notice?.text).toMatch(/^Claude Code · Agent "Write the limiter tests" completed · \d+m$/)
    expect(under(notice, node => node.type === 'Text' && node.props?.color === P.muted2).length).toBe(1)
    // no avatar, no group: a line of its own
    expect(await ui.find({ key: `grp:msg:${done.id}` })).toBeUndefined()
    // a permission notification names the agent it is about
    const permission = v2.chat.find(row => row.from === 'engine' && row.kind === 'notification' && row.agent === IDS.builder)!
    expect((await ui.find({ key: `msg:${permission.id}` }))?.text).toMatch(/^Claude Code · Claude needs your permission to use Bash · builder · \d+m$/)

    // the question held on you
    const held = await ui.find({ key: `msg:${asked.id}` })
    expect(held?.text).toContain('Which store should back the limiter in production?')
    expect((await ui.find({ key: `chat:answer:${asked.id}` }))?.props).toMatchObject({ label: 'Answer on Now →', plain: true })
    if (surface === 'desktop') expect(under(held, node => node.type === 'Box' && node.props?.borderColor === mix(P.wait, P.card, 0.45)).length).toBe(1)
    else expect(under(held, node => node.type === 'Text' && node.props?.color === P.waitText && JSON.stringify(node).includes('?')).length).toBe(1)
    // a press takes the pane to Now, where the card for it is
    await press(ui, `chat:answer:${asked.id}`)
    expect((await ui.find({ key: 'tab:now' }))?.props.dimColor).toBe(false)
    expect(await ui.find({ key: 'needs:toolu_01AskOne' })).toBeDefined()
    expect(await ui.find({ key: W.needKeyOf('toolu_01AskOne') })).toBeDefined()
    await ui.unmount()
  }

  // answered, it is a plain bubble, and how you answered is yours, at the right
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'answer:toolu_01AskOne:0:0')
  await press(ui, 'tab:chat')
  expect(await ui.find({ key: `chat:answer:${asked.id}` })).toBeUndefined()
  const choice = (await ui.findAll({ type: 'Box' })).find(box => (box.key ?? '').startsWith('msg:') && box.text.includes('You answered: Redis'))
  expect(choice?.props).toMatchObject({ alignItems: 'flex-end', width: '75%' })
  expect(under(choice, node => node.type === 'Box' && node.props?.backgroundColor === BLUE).length).toBe(1)
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('a slash command you ran alone is a small line in the middle, "You ran /login", never a bubble of yours', async ($, on) => {
  await demo($, on, newWorld(), state => ({ ...state, chat: [...state.chat, { id: 'mcmd', at: SAMPLE_NOW - 60_000, from: 'you', to: null, who: 'You', kind: 'command', text: '/login' }] }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    const line = await ui.find({ key: 'msg:mcmd' })
    expect(line?.props.justifyContent).toBe('center')
    expect(line?.text).toMatch(/^You ran \/login · \d+m$/)
    expect(under(line, node => node.type === 'Box' && node.props?.backgroundColor === BLUE).length).toBe(0)
    expect(await ui.find({ key: 'grp:msg:mcmd' })).toBeUndefined()
    await ui.unmount()
  }
})

test('under your message, what came of it and when: Not delivered, Queued, Delivered (dim once the agent spoke after it); over it, whom it went to when that is not the Orchestrator', async ($, on) => {
  const { v2 } = await demo($, on)
  const failed = v2.chat.find(row => row.ackId === 'c-1')!
  const delivered = v2.chat.find(row => row.ackId === 'c-2')!
  const queued = v2.chat.find(row => row.ackId === 'c-3')!
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    expect((await ui.find({ key: `msg:${failed.id}` }))?.text).toMatch(/✕ Not delivered: it has ended · \d+m$/)
    expect((await ui.find({ key: `msg:${queued.id}` }))?.text).toMatch(/◷ Queued: Claude reads it when it finishes its current turn · \d+m$/)
    const done = await ui.find({ key: `msg:${delivered.id}` })
    expect(done?.text).toMatch(/✓ Delivered: it reads it at its next step · \d+m$/)
    // builder answered after it: old news, drawn dim
    expect(under(done, node => node.type === 'Text' && node.props?.color === P.muted2 && JSON.stringify(node).includes('Delivered')).length).toBe(1)
    // yours to an agent names it over the bubble, at the right: its face, its name a press
    const head = await ui.find({ key: `head:msg:${delivered.id}` })
    expect(head?.props.justifyContent).toBe('flex-end')
    expect(head?.text).toMatch(/^to[◆●▲■✦⬢★◉]?builder$/)
    expect((await ui.find({ key: `chat:to:msg:${delivered.id}` }))?.props.label).toBe('builder')
    // yours to the Orchestrator name no one
    expect(await ui.find({ key: `head:msg:${queued.id}` })).toBeUndefined()
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('a long message shows about six lines and Show more; a cut one opens in place as Markdown, its whole text read, then Show less', async ($, on) => {
  const { v2 } = await demo($, on)
  const cut = v2.chat.find(row => row.isCut)!
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    expect((await ui.find({ key: `chat:more:${cut.id}` }))?.props).toMatchObject({ label: 'Show more', plain: true })
    const folded = under(await ui.find({ key: `msg:${cut.id}` }), node => node.type === 'Markdown')[0]
    expect(String(folded?.props?.text).split('\n').length).toBeLessThanOrEqual(6)
    await press(ui, `chat:more:${cut.id}`)
    expect(await ui.find({ type: 'Markdown', text: /The whole answer/ })).toBeDefined()
    expect((await ui.find({ key: `chat:more:${cut.id}` }))?.props.label).toBe('Show less')
    await press(ui, `chat:more:${cut.id}`)
    expect(await ui.find({ type: 'Markdown', text: /The whole answer/ })).toBeUndefined()
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('the member list: Everyone, then every agent with its avatar, name and status, two columns at 84 cells and three at 160; a pick shows your conversation with that agent, marked, and the composer goes to it', async ($, on) => {
  const { v2 } = await demo($, on)
  const agents = v2.agents.filter((row): row is W.V2AgentRow => row.row === 'agent' && row.kind !== 'engine')
  expect(membersOf(v2, '').members.map(one => one.id)).toEqual(agents.map(row => row.id))
  const all = v2.chat.map(row => `msg:${row.id}`)
  for (const [cols, across] of [[84, 2], [160, 3]] as const) {
    const ui = await $.ui.mount(pane('desktop', cols))
    await press(ui, 'tab:chat')
    // no filter row, no dropdown
    for (const key of ['key:f', 'chat:filter:more', 'chat:filter:you', 'chat:filters']) expect(await ui.find({ key })).toBeUndefined()
    // a bordered list, in columns, down each: Everyone first
    const list = await ui.find({ key: 'chat:members:list' })
    expect(list?.props).toMatchObject({ borderStyle: 'round' })
    expect(under(list, node => node.type === 'Box' && node.props?.width === `${Math.floor(100 / across)}%`).length).toBe(across)
    expect(await buttonKeys(ui, 'chat:filter:')).toEqual(['chat:filter:between', 'chat:filter:all', ...agents.map(row => `chat:filter:${row.id}`)])
    expect((await ui.find({ key: 'chat:members:fold' }))?.props.label).toBe(`▾ ${agents.length} agents`)
    // a row: the avatar, the name, the status word
    const row = await ui.find({ key: `chat:member:${IDS.builder}` })
    expect(under(row, node => node.type === 'Svg').map(node => String(node.props?.alt))).toEqual(["builder's avatar"])
    expect(row?.text).toBe('builderwaiting')
    // Everyone picked: on blue, lit; the rest dim
    expect((await ui.find({ key: 'chat:member:all' }))?.props.backgroundColor).toBe(PICKED)
    expect((await ui.find({ key: 'chat:filter:all' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: `chat:filter:${IDS.builder}` }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Input' }))?.props.placeholder).toBe('Message the Orchestrator, or @name an agent…')

    // a pick: your conversation with it (from it, to it), marked; the composer to it, no @ needed
    await press(ui, `chat:filter:${IDS.builder}`)
    expect(await boxKeys(ui, 'msg:')).toEqual(v2.chat.filter(one => one.from === IDS.builder || one.to === IDS.builder || one.agent === IDS.builder).map(one => `msg:${one.id}`))
    expect((await ui.find({ key: `chat:member:${IDS.builder}` }))?.props.backgroundColor).toBe(PICKED)
    expect((await ui.find({ key: 'chat:member:all' }))?.props.backgroundColor).toBeUndefined()
    expect((await ui.find({ key: `chat:filter:${IDS.builder}` }))?.props.dimColor).toBe(false)
    expect(await ui.find({ key: 'chat:filter:between' })).toBeUndefined()
    expect((await ui.find({ type: 'Input' }))?.props.placeholder).toBe('Message builder…')
    // yours to it name no one over them: it is whom you are talking with
    expect(await ui.find({ key: `head:msg:${v2.chat.find(one => one.ackId === 'c-2')!.id}` })).toBeUndefined()

    // Everyone again; Between agents keeps to what agents said to each other, and lets go at a second press
    await press(ui, 'chat:filter:all')
    expect(await boxKeys(ui, 'msg:')).toEqual(all)
    await press(ui, 'chat:filter:between')
    expect((await ui.find({ key: 'chat:filter:between' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: 'chat:member:all' }))?.props.backgroundColor).toBe(PICKED)
    const between = await boxKeys(ui, 'msg:')
    expect(between).toContain(`msg:${v2.chat.find(one => one.title === 'Limiter ready for review')!.id}`)
    expect(between).not.toContain(`msg:${v2.chat.find(one => one.ackId === 'c-2')!.id}`)
    await press(ui, 'chat:filter:between')
    expect(await boxKeys(ui, 'msg:')).toEqual(all)
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

test('a narrow pane folds the member list to one line naming whom you are talking with: a press opens it, one column, and folds it again', async ($, on) => {
  const { v2 } = await demo($, on)
  const n = v2.agents.filter(row => row.row === 'agent' && row.kind !== 'engine').length
  const ui = await $.ui.mount(pane('desktop', 68))
  await press(ui, 'tab:chat')
  expect(await ui.find({ key: 'chat:members:list' })).toBeUndefined()
  expect((await ui.find({ key: 'chat:members:head' }))?.text).toMatch(new RegExp(`^▸ ${n} agents·Everyone`))
  await press(ui, 'chat:members:fold')
  const list = await ui.find({ key: 'chat:members:list' })
  expect(under(list, node => node.type === 'Box' && node.props?.width === '100%').length).toBe(1)
  expect((await ui.find({ key: 'chat:members:fold' }))?.props.label).toBe(`▾ ${n} agents`)
  // picked, then folded: the line names it, with its face
  await press(ui, `chat:filter:${IDS.docs}`)
  await press(ui, 'chat:members:fold')
  const head = await ui.find({ key: 'chat:members:head' })
  expect(head?.text).toMatch(new RegExp(`^▸ ${n} agents·docs$`))
  expect(under(head, node => node.type === 'Svg').map(node => String(node.props?.alt))).toEqual(["docs's avatar"])
  // folded, a pick of Everyone is a press away again
  await press(ui, 'chat:members:fold')
  await press(ui, 'chat:filter:all')
  await press(ui, 'chat:members:fold')
  expect(await ui.find({ key: 'chat:members:list' })).toBeUndefined()
  await press(ui, 'tab:now')
  await ui.unmount()
  // wide again, the list is open: what the width has
  const wide = await $.ui.mount(pane('desktop', 84))
  await press(wide, 'tab:chat')
  expect(await wide.find({ key: 'chat:members:list' })).toBeDefined()
  await press(wide, 'tab:now')
  await wide.unmount()
})

test('the terminal draws the group chat with no image: the member list one wrapped line of glyphs and names (the one picked on blue), an avatar its glyph in its colour, yours a block at the right after a ›, others` an indented block under the name', async ($, on) => {
  const { v2 } = await demo($, on)
  const ui = await $.ui.mount(pane('terminal'))
  await press(ui, 'tab:chat')
  const chat = await ui.find({ key: 'chat' })
  expect(under(chat, node => node.type === 'Svg')).toEqual([])
  expect(under(chat, node => node.type === 'Box' && (node.props?.backgroundColor === BLUE || node.props?.backgroundColor === BUBBLE))).toEqual([])
  // the member line: Everyone, each agent, Between agents
  const agents = v2.agents.filter((row): row is W.V2AgentRow => row.row === 'agent' && row.kind !== 'engine')
  expect((await ui.find({ key: 'chat:members' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
  expect(await buttonKeys(ui, 'chat:filter:')).toEqual(['chat:filter:all', ...agents.map(row => `chat:filter:${row.id}`), 'chat:filter:between'])
  const builder = agents.find(row => row.id === IDS.builder)!
  const mark = AV.terminalFace({ id: builder.id, status: builder.status })
  const chip = await ui.find({ key: `chat:filter:${IDS.builder}` })
  expect(chip?.text).toBe(`${mark.glyph} builder`)
  expect(under(chip, node => node.type === 'Text' && node.props?.color === mark.color).length).toBe(1)
  const onBlue = (node: Node) => node.type === 'Text' && node.props?.backgroundColor === '#1e3a8a'
  expect(under(await ui.find({ key: 'chat:filter:all' }), onBlue).length).toBe(1)
  await press(ui, `chat:filter:${IDS.builder}`)
  expect(under(await ui.find({ key: `chat:filter:${IDS.builder}` }), onBlue).length).toBe(1)
  expect(under(await ui.find({ key: 'chat:filter:all' }), onBlue).length).toBe(0)
  await press(ui, 'chat:filter:all')

  // others': the sender's glyph in its colour at the left, its name, "to", the recipient's glyph and name
  const found = v2.chat.find(row => row.from === IDS.researcher && row.kind === 'result')!
  const researcher = agents.find(row => row.id === IDS.researcher)!
  const main = agents.find(row => row.id === 'main')!
  const group = await ui.find({ key: `grp:msg:${found.id}` })
  expect(group?.props.flexDirection).toBe('row')
  const glyph = AV.terminalFace({ id: researcher.id, status: researcher.status })
  const to = AV.terminalFace({ id: main.id, name: main.title, role: 'main', status: main.status })
  expect(group?.text.startsWith(`${glyph.glyph}researcherto${to.glyph}Orchestrator`)).toBe(true)
  expect(under(group, node => node.type === 'Text' && node.props?.color === glyph.color && node.children?.[0] === glyph.glyph).length).toBe(1)
  for (const row of v2.chat.filter(one => one.from === 'you')) {
    const mine = await ui.find({ key: `msg:${row.id}` })
    expect(mine?.props.alignItems).toBe('flex-end')
    expect(under(mine, node => node.type === 'Text' && node.children?.[0] === '›' && node.props?.color === P.runText).length).toBe(1)
  }
  await press(ui, 'tab:now')
  await ui.unmount()
})

test('the composer: no @ goes to the Orchestrator, @name to that agent by SendMessage (previewed so), a name no agent carries is refused; with an agent picked, words go to it with no @; a send shows at once as your bubble and keeps its key once the state holds it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = newWorld()
  on('ui.focus', () => ({}))
  world(on, w)
  await work($)
  await $.command.run(deck('chat'))
  await clock.advance(1000)
  const field = async (ui: { find: (q: { type: 'Input' }) => Promise<{ key?: string } | undefined> }) => (await ui.find({ type: 'Input' }))?.key ?? ''
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ type: 'Input' }))?.props.placeholder).toBe('Message the Orchestrator, or @name an agent…')
    // nothing typed: nothing under the field
    await ui.input({ key: await field(ui), text: '', kind: 'change' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toBe('Send')
    // a name no agent carries: refused, said why, nothing sent
    await ui.input({ key: await field(ui), text: '@nobody look again' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toMatch(/@nobody/)
    expect(w.sent).toEqual([])
    // the preview says where the words go while they are typed
    await ui.input({ key: await field(ui), text: '@scout look', kind: 'change' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('→ scout via SendMessage')
    await ui.input({ key: await field(ui), text: 'hello', kind: 'change' })
    await ui.redraw()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('→ Orchestrator')
    await ui.unmount()
  }
  const ui = await $.ui.mount(pane('desktop'))
  const before = await field(ui)
  await ui.input({ key: before, text: '@scout look at src/range.js again' })
  await ui.redraw()
  // at once: your bubble, keyed by its send
  const sent = await boxKeys(ui, 'send:')
  expect(sent.length).toBe(1)
  await clock.advance(400)
  await ui.redraw()
  expect(w.sent).toEqual([{ to: 'agent-x1', text: 'look at src/range.js again' }])
  // the state's message now, under the same key, with what came of it; the field starts empty again
  expect(await boxKeys(ui, 'send:')).toEqual(sent)
  const mine = await ui.find({ key: sent[0]! })
  expect(mine?.text).toContain('look at src/range.js again')
  expect(mine?.text).toContain('✓ Delivered')
  expect(mine?.props).toMatchObject({ alignItems: 'flex-end', width: '75%' })
  // whom it went to, over it (its group's head, or the line over it where it stacks under your prompt): scout, a press
  expect(((await ui.find({ key: `head:${sent[0]}` })) ?? (await ui.find({ key: `to:${sent[0]}` })))?.text).toMatch(/^to.*scout$/)
  expect((await ui.find({ key: `chat:to:${sent[0]}` }))?.props.label).toBe('scout')
  expect(await field(ui)).not.toBe(before)
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('')

  // scout picked: words with no @ go to it, the composer says so
  await press(ui, 'chat:filter:agent-x1')
  expect((await ui.find({ type: 'Input' }))?.props.placeholder).toBe('Message scout…')
  await ui.input({ key: await field(ui), text: 'and the tests', kind: 'change' })
  await ui.redraw()
  expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('→ scout via SendMessage')
  await ui.input({ key: await field(ui), text: 'and the tests' })
  await ui.redraw()
  await clock.advance(400)
  await ui.redraw()
  expect(w.sent).toEqual([
    { to: 'agent-x1', text: 'look at src/range.js again' },
    { to: 'agent-x1', text: 'and the tests' },
  ])
  // in your conversation with it, yours name no one over them
  const both = await boxKeys(ui, 'send:')
  expect(both.length).toBe(2)
  for (const key of both) expect(await ui.find({ key: `chat:to:${key}` })).toBeUndefined()
  // the Orchestrator picked: words go to it
  await press(ui, 'chat:filter:main')
  expect((await ui.find({ type: 'Input' }))?.props.placeholder).toBe('Message the Orchestrator…')
  await press(ui, 'chat:filter:all')
  await ui.unmount()
})

test('what W.recipientOf answers reads as a route or a refusal: today`s shapes, and a name several agents answer to, its candidates as ids, rows or names', async () => {
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  expect(routeFrom(v2, { agentId: IDS.builder, title: 'builder', text: 'hi' })).toEqual({ agentId: IDS.builder, title: 'builder', text: 'hi' })
  expect(routeFrom(v2, { error: 'No agent named @x in this session' })).toEqual({ error: 'No agent named @x in this session', candidates: [] })
  // W.recipientOf's: each candidate with the handle that names it alone
  const tie = routeFrom(v2, { error: 'Did you mean: researcher (@a3f9c2e) or reviewer (@aa11bb2)?', ambiguous: [{ agentId: IDS.researcher, title: 'researcher', handle: 'a3f9c2e' }, { agentId: IDS.reviewer, title: 'reviewer', handle: 'aa11bb2' }] })
  expect('error' in tie && tie.error).toBe('Did you mean: researcher (@a3f9c2e) or reviewer (@aa11bb2)?')
  expect('error' in tie ? tie.candidates.map(one => [one.row.id, one.handle]) : []).toEqual([
    [IDS.researcher, 'a3f9c2e'],
    [IDS.reviewer, 'aa11bb2'],
  ])
  // other shapes: ids, rows, names; no handle given, one that names it alone
  const many = routeFrom(v2, { error: 'Several agents go by @re', candidates: [{ agentId: IDS.researcher, title: 'researcher' }, IDS.reviewer, 'nobody'] })
  expect('error' in many ? many.candidates.map(one => [one.row.id, one.handle]) : []).toEqual([
    [IDS.researcher, 'researcher'],
    [IDS.reviewer, 'reviewer'],
  ])
  const bare = routeFrom(v2, { status: 'ambiguous', matches: [{ id: IDS.docs }, { name: 'scout' }, '@docs'] })
  expect('error' in bare && bare.error).toBe('More than one agent goes by that name')
  expect('error' in bare ? bare.candidates.map(one => one.row.id) : []).toEqual([IDS.docs, IDS.scout])
  // whatever W.recipientOf gives now, the composer reads
  expect(routeFrom(v2, W.recipientOf(v2, '@builder hi'))).toMatchObject({ agentId: IDS.builder, text: 'hi' })
  expect(routeFrom(v2, W.recipientOf(v2, 'hi'))).toMatchObject({ agentId: 'main', text: 'hi' })
  expect('error' in routeFrom(v2, W.recipientOf(v2, '@nobody hi'))).toBe(true)
})

test('a name several agents answer to equally: "Did you mean" offers each, its face and name, in place of the refusal; a press puts the handle that names it alone in the composer', async ($, on) => {
  // two agents at work, started together, both "native …"
  const twins = (state: W.WebStateV2): W.WebStateV2 => {
    const builder = state.agents.find((row): row is W.V2AgentRow => row.row === 'agent' && row.id === IDS.builder)!
    const twin = (id: string, name: string): W.V2AgentRow => ({ ...builder, id, fileId: id, shortId: id.slice(0, 7), name, title: name, status: 'running', isStopped: false, startedAt: state.now - 60_000, needs: 0 })
    return { ...state, agents: [...state.agents, twin('n1a2b3c4d5e6f708', 'native-chat'), twin('n9f8e7d6c5b4a302', 'native-pane')] }
  }
  const { v2 } = await demo($, on, newWorld(), twins)
  const found = routeFrom(v2, W.recipientOf(v2, '@native look'))
  // a W.recipientOf that matches no part of a name offers no one: refused, and nothing offered
  if ((W.recipientOf(v2, '@native look') as { ambiguous?: unknown }).ambiguous === undefined) {
    const ui = await $.ui.mount(pane('desktop'))
    await press(ui, 'tab:chat')
    await ui.input({ key: (await ui.find({ type: 'Input' }))?.key ?? '', text: '@native look', kind: 'change' })
    await ui.redraw()
    expect('error' in found && found.candidates).toEqual([])
    expect(await ui.find({ key: 'chat:mean' })).toBeUndefined()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('@native')
    await press(ui, 'tab:now')
    await ui.unmount()
    return
  }
  expect('error' in found ? found.candidates.map(one => one.row.title) : []).toEqual(['native-chat', 'native-pane'])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    await press(ui, 'tab:chat')
    const field = async () => (await ui.find({ type: 'Input' }))?.key ?? ''
    await ui.input({ key: await field(), text: '@native look', kind: 'change' })
    await ui.redraw()
    const mean = await ui.find({ key: 'chat:mean' })
    expect(mean?.text).toBe('Did you mean:' + (surface === 'desktop' ? 'native-chatnative-pane' : `${AV.terminalFace({ id: 'n1a2b3c4d5e6f708', status: 'running' }).glyph}native-chat${AV.terminalFace({ id: 'n9f8e7d6c5b4a302', status: 'running' }).glyph}native-pane`))
    expect(await buttonKeys(ui, 'chat:mean:')).toEqual(['chat:mean:n1a2b3c4d5e6f708', 'chat:mean:n9f8e7d6c5b4a302'])
    if (surface === 'desktop') expect(under(mean, node => node.type === 'Svg').map(node => String(node.props?.alt))).toEqual(["native-chat's avatar", "native-pane's avatar"])
    // the offer says it: no refusal over it
    expect((await ui.find({ key: 'chat:compose' }))?.text).not.toContain('No agent')
    expect((await ui.find({ key: 'chat:compose' }))?.text).not.toContain('(@')
    // sent as it is: refused, the offer stays
    await ui.input({ key: await field(), text: '@native look' })
    await ui.redraw()
    expect(await ui.find({ key: 'chat:mean' })).toBeDefined()
    // a press: its handle in place of the @name, the words kept; where they go now
    await press(ui, 'chat:mean:n9f8e7d6c5b4a302')
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('@n9f8e7d look')
    expect(await ui.find({ key: 'chat:mean' })).toBeUndefined()
    expect((await ui.find({ key: 'chat:compose' }))?.text).toContain('→ native-pane via SendMessage')
    await ui.input({ key: await field(), text: '', kind: 'change' })
    await press(ui, 'tab:now')
    await ui.unmount()
  }
})

/** The elements a drawn tree holds. */
function nodesOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return 1
  const children = (node as { children?: unknown[] }).children ?? []
  return 1 + children.reduce((sum: number, child) => sum + nodesOf(child), 0)
}

/** The characters a drawn tree holds: its strings and its string props. */
function charsOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node !== 'object') return String(node).length
  const props = (node as { props?: Record<string, unknown> }).props ?? {}
  const own = Object.values(props).reduce((sum: number, value) => sum + (typeof value === 'string' ? value.length : 0), 0)
  return own + ((node as { children?: unknown[] }).children ?? []).reduce((sum: number, child) => sum + charsOf(child), 0)
}

test('Chat draws a window of the newest messages, Show earlier adds more, and even the whole of the state`s 200 keeps inside the pane`s bounds', async ($, on) => {
  const data = M.emptyData(NOW - 7_200_000)
  for (let i = 0; i < 260; i++) M.addMessage(data, { from: i % 2 ? M.YOU : M.MAIN, to: i % 2 ? M.MAIN : M.YOU, kind: i % 2 ? 'prompt' : 'answer', text: `Message ${i}: ${'words '.repeat(80)}`, at: NOW - (260 - i) * 10_000 })
  const view = { ...M.defaultView(), v2: { ...M.defaultView2(), tab: 'chat' as const } }
  const clock = mock.clock(on, { now: NOW })
  world(on, newWorld(), { v: M.SNAPSHOT_VERSION, data, view })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/repo' })
  await $.command.run(deck('chat'))
  await clock.advance(1000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // what opening the pane started (git, the usage) draws again once it is read
    await clock.advance(1000)
    await ui.redraw()
    const rows = async () => (await boxKeys(ui, 'msg:')).length
    // the window is the pane's own, the same on every surface it draws on: paged on the first
    if (surface === SURFACES[0]) {
      expect(await rows()).toBe(30)
      expect((await ui.find({ key: 'chat:earlier' }))?.props.label).toBe('Show earlier · 170 more')
      // a long one folds, with Show more
      expect((await buttonKeys(ui, 'chat:more:')).length).toBe(30)
      await press(ui, 'chat:earlier')
      expect(await rows()).toBe(60)
    }
    for (let i = 0; i < 6 && (await ui.find({ key: 'chat:earlier' })); i++) await press(ui, 'chat:earlier')
    // as many as the pane holds, the newest; then it says where the rest are
    const shown = await rows()
    expect(shown).toBeGreaterThan(30)
    expect(await ui.find({ key: 'chat:earlier' })).toBeUndefined()
    expect((await ui.find({ key: 'chat' }))?.text).toContain(`${200 - shown} earlier: more than the pane holds.`)
    const drawn = await ui.drawn()
    expect(nodesOf(drawn)).toBeLessThan(2000)
    expect(charsOf(drawn)).toBeLessThan(90_000)
    await ui.unmount()
  }
})

test('Chat keeps to its newest message: to the end as Chat comes into view, and again for something new there while you were at the end; not once you scrolled up', async () => {
  const follow: ChatFollow = { isShown: false, end: '', isAtEnd: false }
  // Chat not on show: nothing moves
  expect(followStep(follow, null)).toBe(false)
  // Chat comes into view: to its end, and you are there
  expect(followStep(follow, '3|msg:a|')).toBe(true)
  expect(follow.isAtEnd).toBe(true)
  // drawn again with nothing new: the pane stays
  expect(followStep(follow, '3|msg:a|')).toBe(false)
  // a new message, then its ack, while you are at the end: each follows
  expect(followStep(follow, '4|msg:b|')).toBe(true)
  expect(followStep(follow, '4|msg:b|delivered:It reads it at its next step')).toBe(true)
  // you scroll up: something new leaves you where you are
  follow.isAtEnd = isAtEndOf({ offset: 10, bodyRows: 30, contentRows: 120 })
  expect(follow.isAtEnd).toBe(false)
  expect(followStep(follow, '5|msg:c|')).toBe(false)
  // back at the end (a row short counts): it follows again
  follow.isAtEnd = isAtEndOf({ offset: 89, bodyRows: 30, contentRows: 120 })
  expect(follow.isAtEnd).toBe(true)
  expect(followStep(follow, '6|msg:d|')).toBe(true)
  // a drawing that fits the window shows its end
  expect(isAtEndOf({ offset: 0, bodyRows: 30, contentRows: 12 })).toBe(true)
  // leaving Chat forgets it all; coming back goes to the end, though you had scrolled up
  follow.isAtEnd = false
  expect(followStep(follow, null)).toBe(false)
  expect(followStep(follow, '6|msg:d|')).toBe(true)
  expect(follow.isAtEnd).toBe(true)
})

test('what Chat ends with changes with a new message, the ack under its last one and the filter, and with nothing else', async () => {
  const session = v2Session()
  const v2 = W.deckStateOf(session.data, session.git, session.usage, session.now, session.sessionId, session.cwd, session.answerable)
  const last = v2.chat[v2.chat.length - 1]!
  const end = chatEndOf(v2, '')
  expect(end).toBe(`${v2.chat.length}|msg:${last.id}|`)
  expect(chatEndOf({ ...v2, now: v2.now + 60_000 }, '')).toBe(end)
  expect(chatEndOf({ ...v2, chat: v2.chat.slice(0, -1) }, '')).not.toBe(end)
  expect(chatEndOf(v2, 'between')).not.toBe(end)
  const sent = v2.chat.find(row => row.ackId === 'c-3')!
  const upTo = v2.chat.slice(0, v2.chat.indexOf(sent) + 1)
  const queued = chatEndOf({ ...v2, chat: upTo }, '')
  expect(queued).toBe(`${upTo.length}|msg:${sent.id}|queued:Claude reads it when it finishes its current turn`)
  expect(chatEndOf({ ...v2, chat: upTo, acks: [...v2.acks, { id: 'c-3', ok: true, status: 'answered', text: 'Claude carries on', at: v2.now }] }, '')).not.toBe(queued)
})

test('the pane follows Chat through the engine: your scrolling passes through the deck`s ui.scroll hook untouched, and Chat opened by its tab, /deck chat and a new message draws on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.focus', () => ({}))
  on('ui.scroll', () => ({}))
  world(on, newWorld())
  await work($)
  await clock.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  await press(ui, 'tab:chat')
  await clock.advance(200)
  // you scroll up, then back to the end: the deck lets each move through
  const scroll = (offset: number) => $.ui.scroll({ component: 'Pane', requestId: 'agent-deck', offset, by: offset === 0 ? -50 : 50, bodyRows: 30, contentRows: 80, origin: { kind: 'person' } })
  expect(await scroll(0)).toEqual({})
  await $.turn.complete({ turnId: 't1', answer: 'Fixed: the loop now stops at `length - 1`.', durationMs: 1000, isAborted: false, reason: 'answer' })
  await clock.advance(1000)
  await ui.redraw()
  await clock.advance(200)
  expect((await ui.findAll({ type: 'Markdown' })).some(one => String(one.props.text).includes('Fixed: the loop now stops'))).toBe(true)
  expect(await scroll(50)).toEqual({})
  await $.command.run(deck('chat'))
  await clock.advance(200)
  await ui.redraw()
  expect((await ui.find({ key: 'tab:chat' }))?.props.dimColor).toBe(false)
  await press(ui, 'tab:now')
  await clock.advance(200)
  await ui.unmount()
})
