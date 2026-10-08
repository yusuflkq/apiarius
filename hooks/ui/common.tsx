/**
 * The pieces every screen of the deck draws the same way: the status
 * square, `+a −r`, a diff file's header and its hunks as native diff blocks,
 * text-strength switches (tabs and toggles), the quiet empty-state line,
 * agent names, and the size check that keeps a drawing inside the host's
 * bounds. Native text has one face and one size, so these carry the
 * system's hierarchy in weight, dimness, colour and space alone.
 *
 * Pure, as every drawing: Kit and the data come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckData, DeckShownStatus } from '../../types'
import { codeSourcesOf, type Hunk } from '../diff'
import * as F from '../format'
import { MAIN, ORCHESTRATOR, agentOf, labelOf } from '../model'
import { N, NATIVE_TEXT, STATUS_GLYPH, STATUS_NATIVE } from './theme'
import type { Kit } from './types'

/** Below this many characters left in a budget, a diff is noted as cut rather than drawn a few lines deep. */
const LEAST_DIFF = 400

/** The status square as native text: `■` in its status colour, an idle one hollow and grey. */
export function glyph(kit: Kit, status: DeckShownStatus): RenderElement {
  const { Text } = kit
  return <Text color={STATUS_NATIVE[status]}>{STATUS_GLYPH[status]}</Text>
}

/** `+a −r` in the add and delete colours, a zero side left out; null when nothing changed. */
export function plusMinus(kit: Kit, added: number, removed: number): RenderElement | null {
  const { Text } = kit
  if (added <= 0 && removed <= 0) return null
  return (
    <Text>
      {added > 0 ? <Text color={N.add}>{`+${F.num(added)}`}</Text> : null}
      {added > 0 && removed > 0 ? ' ' : null}
      {removed > 0 ? <Text color={N.del}>{`−${F.num(removed)}`}</Text> : null}
    </Text>
  )
}

/** One quiet line where content will be, saying in a plain sentence what will appear there. */
export function emptyLine(kit: Kit, text: string): RenderElement {
  const { Text } = kit
  return (
    <Text {...NATIVE_TEXT.text4} wrap="truncate-end">
      {text}
    </Text>
  )
}

/** One switch of a row: what it shows, and the key it presses by on the pane (a digit or a letter). */
export type ToggleItem<T extends string> = { id: T; label: string; hotkey?: string }

/**
 * A row of text-strength switches (the tabs, Tree | Wire, Diffs |
 * Conversation | Activity): plain Buttons, the open one at full strength, the
 * others dim. No plates: the one plate on a screen is the selected agent.
 * Each is keyed `${prefix}:${id}`.
 */
export function toggles<T extends string>(kit: Kit, prefix: string, items: readonly ToggleItem<T>[], open: T, onPick: (id: T) => void): RenderElement {
  const { Box, Button } = kit
  return (
    <Box flexDirection="row" columnGap={2}>
      {items.map(item => (
        <Button
          key={`${prefix}:${item.id}`}
          label={item.label}
          plain
          dimColor={item.id !== open}
          {...(item.hotkey ? { hotkey: item.hotkey } : {})}
          onPress={() => onPick(item.id)}
        />
      ))}
    </Box>
  )
}

/** The name the deck gives an agent id: its label, the Orchestrator for the main loop, else the id itself. */
export function nameOf(data: DeckData, id: string): string {
  const agent = agentOf(data, id)
  if (agent) return labelOf(agent)
  return id === MAIN ? ORCHESTRATOR : id.replace(/^peer:/, '')
}

/**
 * A diff file's header row: its directory dim (cut from its start when it
 * is long), its name bold, then `+a −r` and an optional dim note ("new").
 * `room` is the cells the row has.
 */
export function fileHeader(kit: Kit, path: string, added: number, removed: number, room: number, note = ''): RenderElement {
  const { Box, Text } = kit
  const cut = path.lastIndexOf('/')
  const name = cut >= 0 ? path.slice(cut + 1) : path
  const dir = cut >= 0 ? path.slice(0, cut + 1) : ''
  const counts = plusMinus(kit, added, removed)
  const countWidth = `+${F.num(added)} −${F.num(removed)}`.length + (note ? note.length + 2 : 0) + 2
  const dirRoom = Math.max(6, room - Array.from(name).length - countWidth)
  return (
    <Box flexDirection="row" columnGap={2}>
      <Text wrap="truncate-end">
        {dir ? <Text dimColor>{F.truncStart(dir, dirRoom)}</Text> : null}
        <Text bold>{name}</Text>
      </Text>
      {counts || note ? (
        <Box flexDirection="row" columnGap={2} flexShrink={0}>
          {counts}
          {note ? <Text dimColor>{note}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * Hunks as native `Code format="diff"` blocks, each under the element's
 * 10,000 characters, spending from `budget`; a quiet note says when the
 * budget cut some of them.
 */
export function codeBlocks(kit: Kit, hunks: readonly Hunk[], path: string, budget: { chars: number }): RenderElement[] {
  const { Code } = kit
  if (hunks.length === 0) return [emptyLine(kit, 'No line changes to show.')]
  if (budget.chars < LEAST_DIFF) return [emptyLine(kit, 'Cut to fit the pane.')]
  const { sources, isCut, used } = codeSourcesOf(hunks, budget.chars)
  budget.chars -= used
  const blocks = sources.map(source => <Code source={source} format="diff" path={path.slice(-200)} />)
  if (isCut) blocks.push(emptyLine(kit, 'The rest is cut to fit the pane.'))
  return blocks
}

/**
 * What a drawing may hold, a little inside the host's own bounds: 20,000
 * nodes, 32 deep, 100,000 characters of text. An Svg's markup is not text
 * there (the map keeps it under the element's own 131,072).
 */
export const TREE_BOUNDS = { nodes: 18_000, chars: 90_000, depth: 30 } as const

export type TreeSize = { nodes: number; chars: number; depth: number }

/** The characters of text a prop holds: a string's own, or the strings inside an array or a plain object (a Select's options). */
function textOf(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce((sum: number, one) => sum + textOf(one), 0)
  if (typeof value === 'object' && value !== null) return Object.values(value).reduce((sum: number, one) => sum + textOf(one), 0)
  return 0
}

/**
 * A drawing's nodes (elements and strings), its depth, and its characters
 * of text as the host bounds them: every string it holds, in children and in
 * props (a Code's source, a label, a key), an Svg's markup apart. Counting
 * props and keys keeps the figure a little over the host's own.
 */
export function treeSize(root: RenderElement): TreeSize {
  let nodes = 0
  let depth = 0
  let chars = 0
  const walk = (node: unknown, level: number) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, level)
      return
    }
    if (node === null || node === undefined || typeof node === 'boolean') return
    nodes += 1
    if (typeof node !== 'object') {
      chars += String(node).length
      return
    }
    depth = Math.max(depth, level)
    const element = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
    for (const [name, value] of Object.entries(element.props ?? {})) {
      if (!(element.type === 'Svg' && name === 'source')) chars += textOf(value)
    }
    if (Array.isArray(element.children)) for (const child of element.children) walk(child, level + 1)
  }
  walk(root, 1)
  return { nodes, depth, chars }
}

/** Whether a drawing fits TREE_BOUNDS. */
export function fitsTree(root: RenderElement): boolean {
  const size = treeSize(root)
  return size.nodes <= TREE_BOUNDS.nodes && size.chars <= TREE_BOUNDS.chars && size.depth <= TREE_BOUNDS.depth
}
