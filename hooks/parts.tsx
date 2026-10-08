/**
 * What every drawing of the deck shares: the surface's elements (Kit), the
 * state a drawing reads (DeckModel), the closures a press runs (Actions),
 * each agent's status as a colored dot and a word, a few small pieces, and
 * the size check that keeps a drawing well inside what the host draws.
 *
 * Pure, as every drawing: the hooks module hands in all three.
 */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { DeckAgent, DeckAgentPane, DeckData, DeckTab, DeckView } from '../types'
import { codeSourcesOf, type Hunk } from './diff'
import * as F from './format'
import type { CommitDetail, FileDiff, GitState } from './git'
import { ORCHESTRATOR, agentOf, labelOf } from './model'

type TerminalTable = Elements['terminal']

export type Kit = {
  surface: RenderSurface
  Box: TerminalTable['Box']
  Text: TerminalTable['Text']
  Button: TerminalTable['Button']
  Code: TerminalTable['Code']
  Markdown: TerminalTable['Markdown']
  Input?: TerminalTable['Input']
  Select?: TerminalTable['Select']
  Svg?: Elements['desktop']['Svg']
  columns: number
}

export type ChatLine = { role: 'parent' | 'agent' | 'tool' | 'note'; who: string; text: string }

export type UsageInfo = {
  startedAt: number
  contextPercent?: number
  costUsd?: number
  limits: { kind: string; percentUsed: number }[]
}

export type DayRow = {
  day: string
  added: number
  removed: number
  tools: number
  tokens: number
  sessions: number
  activeMs: number
}

export type DeckModel = {
  data: DeckData
  view: DeckView
  git: GitState
  fileDiff: FileDiff | null
  commit: CommitDetail | null
  chat: ChatLine[] | null
  usage: UsageInfo | null
  days: DayRow[]
  graphSvg: string | null
  /** The time the drawing shows, in steps of ten seconds so a redraw between steps draws the same text. */
  now: number
  cwd: string
  /** Draw less (fewer cards, shorter diffs): the full drawing was over the size the deck keeps to. */
  isLean?: boolean
  /** Draw the frame and a note only: even the lean drawing was too big. */
  isBare?: boolean
}

export type Actions = {
  setTab: (tab: DeckTab) => void
  /** Opens the agent's card on the Flow tab at `pane` (its diffs when not given); pressed again there, closes it. */
  toggleAgent: (id: string, pane?: DeckAgentPane) => void
  /** Goes to the Flow tab with the agent's card open on its diffs. */
  showAgent: (id: string) => void
  setAgentPane: (pane: DeckAgentPane) => void
  selectFile: (path: string) => void
  selectCommit: (hash: string) => void
  setFilter: (filter: string) => void
  toggleFiles: () => void
  toggleBand: () => void
  sendChat: (agentId: string, text: string) => void
  review: (text: string) => void
  open: (tab: DeckTab) => void
  /** Pins the deck to the repository at `root` ('' follows the work again); absent where the hooks offer no choice. */
  chooseRepo?: (root: string) => void
}

export const C = {
  live: 'green',
  wait: 'yellow',
  done: 'cyan',
  fail: 'red',
  accent: 'magenta',
  you: 'magenta',
  add: 'green',
  del: 'red',
  peer: 'yellow',
  talk: 'magenta',
} as const

/** Characters of diff text one drawing carries at most, full and lean. */
export const DIFF_CHARS = { full: 40_000, lean: 10_000 } as const

/**
 * The size the deck keeps a drawing under: well inside the host's own
 * limits (20 000 nodes, 32 deep), and small enough to send and lay out fast.
 * An Svg's markup is counted on its own (the map caps it).
 */
export const TREE_LIMITS = { nodes: 2000, chars: 100_000, depth: 28 } as const

export type StatusLook = { glyph: string; word: string; color?: string }

/** An agent's status as a dot and a word: running green, waiting amber, done cyan, failed red; an idle Orchestrator dim. */
export function statusOf(agent: DeckAgent): StatusLook {
  if (agent.kind === 'you') return { glyph: '◉', word: 'you', color: C.you }
  if (agent.kind === 'peer') return { glyph: '◇', word: 'peer', color: C.peer }
  if (agent.kind === 'main') return agent.status === 'running' ? { glyph: '●', word: 'running', color: C.live } : { glyph: '○', word: 'idle' }
  switch (agent.status) {
    case 'running':
      return { glyph: '●', word: 'running', color: C.live }
    case 'pending':
      return { glyph: '●', word: 'starting', color: C.live }
    case 'waiting':
      return { glyph: '●', word: 'waiting', color: C.wait }
    case 'idle':
      return { glyph: '○', word: 'idle', color: C.wait }
    case 'completed':
      return { glyph: '●', word: 'done', color: C.done }
    case 'killed':
      return { glyph: '●', word: 'stopped', color: C.fail }
    default:
      return { glyph: '●', word: 'failed', color: C.fail }
  }
}

/** A Text's color props for `color`, dim when there is none. */
export function tone(color: string | undefined): { color: string } | { dimColor: true } {
  return color ? { color } : { dimColor: true }
}

/** The name a chat line or message gives: the main loop's own (`main`) is the Orchestrator. */
export function whoName(who: string): string {
  return who === 'main' ? ORCHESTRATOR : who
}

export function nameOf(data: DeckData, id: string): string {
  const agent = agentOf(data, id)
  return agent ? labelOf(agent) : whoName(id)
}

export function elapsedOf(agent: DeckAgent, now: number): string {
  return F.dur((agent.endedAt ?? now) - agent.startedAt)
}

export function heading(kit: Kit, text: string, note = '') {
  const { Text } = kit
  return (
    <Text wrap="truncate-end">
      <Text bold>{text}</Text>
      {note ? <Text dimColor>{`  ${note}`}</Text> : null}
    </Text>
  )
}

export function plusMinus(kit: Kit, added: number, removed: number) {
  const { Text } = kit
  return (
    <Text>
      <Text color={C.add}>{`+${F.num(added)}`}</Text> <Text color={C.del}>{`−${F.num(removed)}`}</Text>
    </Text>
  )
}

/** Hunks as `Code` diff blocks, spending from `budget`; a note when something was cut. */
export function codeBlocks(kit: Kit, hunks: readonly Hunk[], path: string, budget: { chars: number }) {
  const { Code, Text } = kit
  if (hunks.length === 0) return [<Text dimColor italic>no line changes to show</Text>]
  const { sources, isCut, used } = codeSourcesOf(hunks, budget.chars)
  budget.chars -= used
  const blocks = sources.map(source => <Code source={source} format="diff" path={path.slice(-200)} />)
  if (isCut) blocks.push(<Text dimColor italic>… cut to fit the pane</Text>)
  return blocks
}

export type TreeSize = { nodes: number; chars: number; depth: number }

/** A drawing's nodes (elements and strings), serialized characters (an Svg's markup apart) and element depth. */
export function treeSize(root: RenderElement): TreeSize {
  let nodes = 0
  let depth = 0
  let markup = 0
  const walk = (node: unknown, level: number) => {
    nodes += 1
    if (typeof node !== 'object' || node === null) return
    depth = Math.max(depth, level)
    const element = node as { type?: unknown; props?: { source?: unknown }; children?: unknown }
    if (element.type === 'Svg' && typeof element.props?.source === 'string') markup += element.props.source.length
    if (Array.isArray(element.children)) for (const child of element.children) walk(child, level + 1)
  }
  walk(root, 1)
  return { nodes, depth, chars: JSON.stringify(root).length - markup }
}

export function fitsTree(root: RenderElement): boolean {
  const size = treeSize(root)
  return size.nodes <= TREE_LIMITS.nodes && size.chars <= TREE_LIMITS.chars && size.depth <= TREE_LIMITS.depth
}
