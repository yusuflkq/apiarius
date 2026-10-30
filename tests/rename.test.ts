/**
 * The mod was `agent-deck` before it was Apiarius. What it kept under that
 * name is read where the new name holds nothing: the person's prefs from the
 * old store's file (a plugin's `$.store` is a file named after it), and in a
 * session open across the rename its snapshot, web deck and pin (`$.state`
 * keeps a session's values by plugin name).
 */
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import * as M from '../hooks/model'
import type * as W from '../hooks/web'
import type { DeckSnapshot, DeckWebSaved } from '../types'
import { NOW, PORT, deck, lastState, newWorld, world } from './world'

const STORE = 'C:/Users/sam/.claude/plugins/store'

/** The store files under Claude Code's configuration folder, as `fs.list` lists them, and what each holds; `listed` gets each folder listed. Nothing else is there. */
function stores(on: On, files: Record<string, { mtimeMs: number; text: string }>, listed: string[]) {
  const slash = (path: string) => path.replace(/\\/g, '/')
  on('fs.list', ($, e) => {
    listed.push(slash(e.path))
    if (slash(e.path) !== STORE) return { deny: 'no such folder' }
    return { value: Object.entries(files).map(([name, one]) => ({ name, kind: 'file' as const, size: one.text.length, mtimeMs: one.mtimeMs, isLink: false })) }
  })
  on('fs.read', ($, e) => {
    const one = slash(e.path).startsWith(`${STORE}/`) ? files[slash(e.path).slice(STORE.length + 1)] : undefined
    return one ? { value: one.text } : { deny: 'no such file' }
  })
}

const OLD_STORES = {
  'agent-deck_inline-1111.json': { mtimeMs: NOW - 9_000, text: JSON.stringify({ prefs: { isBandHidden: false, avatarStyle: 'pixel' } }) },
  'agent-deck_inline-2222.json': { mtimeMs: NOW - 1_000, text: JSON.stringify({ prefs: { isBandHidden: true, avatarStyle: 'mood' }, history: {} }) },
  'notes_inline-3333.json': { mtimeMs: NOW, text: JSON.stringify({ prefs: { avatarStyle: 'blob' } }) },
}

test('prefs from before the rename: a store with none takes those of the newest agent-deck store file and keeps them; another plugin`s file is no old one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const listed: string[] = []
  stores(on, OLD_STORES, listed)
  mock.env(on, { USERPROFILE: 'C:\\Users\\sam' })
  const store = new Map<string, unknown>()
  world(on, newWorld({ store }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(store.get('prefs')).toEqual({ isBandHidden: true, avatarStyle: 'mood' })
  expect((await $.command.run(deck('avatars'))).text).toContain('Avatar styles (now Mood faces)')
  await clock.advance(1000)
  expect(listed.filter(path => path === STORE)).toHaveLength(1)
})

test('prefs in the store: the old store files are not looked at', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const listed: string[] = []
  stores(on, OLD_STORES, listed)
  mock.env(on, { USERPROFILE: 'C:\\Users\\sam' })
  const store = new Map<string, unknown>([['prefs', { isBandHidden: false, avatarStyle: 'critter' }]])
  world(on, newWorld({ store }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(listed).not.toContain(STORE)
  expect(store.get('prefs')).toEqual({ isBandHidden: false, avatarStyle: 'critter' })
  expect((await $.command.run(deck('avatars'))).text).toContain('Avatar styles (now Critters)')
  await clock.advance(1000)
  expect(listed).not.toContain(STORE)
})

test('a session open across the rename: its snapshot, web deck and pin under agent-deck are read while apiarius holds none', async ($, on) => {
  const clock = mock.clock(on, { now: NOW + 5_000 })
  const SITE = 'C:/Users/sam/code/site'
  const data = M.emptyData(NOW)
  data.agents.push(M.newAgent('agent-old', 'agent', 'scout', NOW, { status: 'running', parentId: M.MAIN }))
  const snapshot: DeckSnapshot = { v: M.SNAPSHOT_VERSION, data, view: M.defaultView() }
  const web: DeckWebSaved = { isOn: true, token: 'token-from-before', port: PORT, dir: '/mod/.web/session-1' }
  on('state.get', { plugin: 'agent-deck', key: 'snapshot' }, () => ({ value: { value: snapshot, version: 4 } }))
  on('state.get', { plugin: 'agent-deck', key: 'web' }, () => ({ value: { value: web, version: 2 } }))
  on('state.get', { plugin: 'agent-deck', key: 'repo' }, () => ({ value: { value: SITE, version: 1 } }))
  const saved: DeckSnapshot[] = []
  on('state.set', { plugin: 'apiarius', key: 'snapshot' }, ($, e) => {
    saved.push(JSON.parse(JSON.stringify(e.value)) as DeckSnapshot)
    return { value: { isSet: true as const, version: saved.length } }
  })
  // git: the pinned repository, and no other
  const git = (argv: readonly string[], cwd?: string) => {
    const line = argv.join(' ')
    if ((cwd ?? '').replace(/\\/g, '/').toLowerCase() !== SITE.toLowerCase()) return { exitCode: 128, stdout: '' }
    if (line.includes('rev-parse --show-toplevel')) return { exitCode: 0, stdout: `${SITE}\n` }
    if (line.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'main\n' }
    return { exitCode: line.includes('status --porcelain') ? 0 : 1, stdout: '' }
  }
  const w = newWorld({ git })
  world(on, w)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.settle()
  // the web deck: its server again, with the token its page holds
  expect(w.children).toHaveLength(1)
  expect(w.children[0]!.request.env).toEqual({ APIARIUS_TOKEN: 'token-from-before' })
  await $.command.run(deck(''))
  await clock.advance(2000)
  // the snapshot's agents, kept under the new name from now on
  expect(saved.at(-1)?.data.agents.map(agent => agent.id)).toEqual([M.YOU, M.MAIN, 'agent-old'])
  // the pin
  expect((lastState(w) as W.WebState & { v2: W.WebStateV2 }).v2.changes.where?.pinned).toBe(SITE)
})
