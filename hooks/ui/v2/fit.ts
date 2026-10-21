/**
 * How tall the terminal lays a drawing out: rows, as Claude Code's terminal
 * lays out the elements the screens build (Box, Text, Button, Markdown,
 * Code, Input), `width` cells across. An estimate on the safe side: a line
 * that may wrap counts as wrapping, a row of parts as tall as its tallest.
 *
 * The terminal pane must never be taller than the terminal: past it, every
 * redraw leaves stray lines behind. So the screens that grow (Chat's
 * messages, the Dashboard's sections) are cut to the rows they may take
 * (`Kit.rows`) with this.
 *
 * Pure.
 */

/** An element as a drawing holds it: its tag, its props, its children. */
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown }

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function childrenOf(node: Node): unknown[] {
  const kids = node.children ?? node.props?.children
  if (kids === undefined || kids === null) return []
  return Array.isArray(kids) ? kids.flat(Infinity) : [kids]
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The cells a string takes on the terminal: a cell a character. */
function cells(text: string): number {
  return Array.from(text).length
}

/** The words a node shows, its Texts' strings joined: a Button's label where it has no children, a Markdown's text, a Code's source. */
export function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isNode(node)) return ''
  const props = node.props ?? {}
  if (node.type === 'Markdown') return String(props.text ?? '')
  if (node.type === 'Code') return String(props.source ?? props.code ?? '')
  const kids = childrenOf(node)
  if (node.type === 'Button' && kids.length === 0) return String(props.label ?? '')
  if (node.type === 'Input') return String(props.value || props.placeholder || '')
  return kids.map(textOf).join('')
}

/** The rows text takes in `width` cells: each of its lines a row, or more where it wraps. */
function textRows(text: string, width: number, isWrapped: boolean): number {
  const lines = text.split('\n')
  if (!isWrapped) return lines.length
  const across = Math.max(1, Math.floor(width))
  return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(cells(line) / across)), 0)
}

/** The cells a node wants on one line: its words', its own `width` where it sets one in cells. */
function naturalWidth(node: unknown, room: number): number {
  if (isNode(node) && typeof node.props?.width === 'number') return Math.min(room, node.props.width)
  const widest = textOf(node)
    .split('\n')
    .reduce((most, line) => Math.max(most, cells(line)), 0)
  const box = isNode(node) && node.type === 'Box' ? edgesAcross(node.props ?? {}) : 0
  return Math.min(room, widest + box)
}

/** The cells a Box's border and padding take across. */
function edgesAcross(props: Record<string, unknown>): number {
  const border = props.borderStyle ? 2 : 0
  const left = num(props.paddingLeft ?? props.paddingX ?? props.padding)
  const right = num(props.paddingRight ?? props.paddingX ?? props.padding)
  return border + left + right
}

/** The rows a Box's border, padding and margin take down. */
function edgesDown(props: Record<string, unknown>): number {
  const border = props.borderStyle ? 2 : 0
  const top = num(props.paddingTop ?? props.paddingY ?? props.padding) + num(props.marginTop ?? props.marginY ?? props.margin)
  const bottom = num(props.paddingBottom ?? props.paddingY ?? props.padding) + num(props.marginBottom ?? props.marginY ?? props.margin)
  return border + top + bottom
}

/** A Box's width in cells inside `room`: its own (cells, or a share of the room), else the room. */
function boxWidth(props: Record<string, unknown>, room: number): number {
  const width = props.width
  if (typeof width === 'number') return Math.min(room, width)
  const share = typeof width === 'string' ? /^(\d+(?:\.\d+)?)%$/.exec(width) : null
  return share ? Math.floor((room * Number(share[1])) / 100) : room
}

/**
 * The rows `node` takes on the terminal, `width` cells across: a column the
 * sum of its children and its gaps, a row its tallest child (a wrapping row
 * its children packed into lines), a Text its lines wrapped (one row a line
 * where it truncates), a border two more, a fixed `height` that height.
 */
export function rowsOf(node: unknown, width: number): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node === 'string' || typeof node === 'number') return textRows(String(node), width, true)
  if (Array.isArray(node)) return node.reduce((sum: number, one) => sum + rowsOf(one, width), 0)
  if (!isNode(node)) return 0
  const props = node.props ?? {}
  const type = node.type
  if (type === 'Text') return textRows(textOf(node), width, !String(props.wrap ?? 'wrap').startsWith('truncate'))
  if (type === 'Button') return childrenOf(node).length > 0 ? rowsOfRow(childrenOf(node), width, false, 0) : textRows(textOf(node), width, true)
  if (type === 'Markdown') return textRows(textOf(node), Math.max(1, width - 2), true)
  if (type === 'Code') return textRows(textOf(node), width, false) + 2
  if (type === 'Input' || type === 'Select') return 1
  if (type === 'Svg') return 1
  if (type === 'Client') return Math.max(1, num(props.height))
  if (typeof props.height === 'number') return props.height
  const inner = Math.max(1, boxWidth(props, width) - edgesAcross(props))
  const kids = childrenOf(node).filter(one => one !== null && one !== undefined && typeof one !== 'boolean')
  const isColumn = props.flexDirection === 'column' || props.flexDirection === 'column-reverse'
  if (isColumn) {
    const gap = num(props.rowGap ?? props.gap)
    const rows = kids.reduce((sum: number, one) => sum + rowsOf(one, inner), 0)
    return rows + gap * Math.max(0, kids.length - 1) + edgesDown(props)
  }
  return rowsOfRow(kids, inner, props.flexWrap === 'wrap', num(props.columnGap ?? props.gap)) + edgesDown(props)
}

/** A row of parts: one line as tall as its tallest (the widest part given the room the others leave), or, wrapping, its parts packed into lines. */
function rowsOfRow(kids: readonly unknown[], width: number, isWrapping: boolean, gap: number): number {
  if (kids.length === 0) return 0
  const wants = kids.map(one => naturalWidth(one, width))
  if (isWrapping) {
    let rows = 0
    let used = 0
    let tallest = 0
    kids.forEach((one, i) => {
      const want = wants[i] ?? 0
      if (used > 0 && used + gap + want > width) {
        rows += tallest
        used = 0
        tallest = 0
      }
      used += (used > 0 ? gap : 0) + want
      tallest = Math.max(tallest, rowsOf(one, Math.max(1, want)))
    })
    return rows + tallest
  }
  const total = wants.reduce((sum, want) => sum + want, 0) + gap * (kids.length - 1)
  if (total <= width) return Math.max(...kids.map((one, i) => rowsOf(one, Math.max(1, wants[i] ?? 1))))
  // past the room: the widest part shrinks to what the others leave it
  const widest = wants.indexOf(Math.max(...wants))
  const rest = total - (wants[widest] ?? 0)
  return Math.max(...kids.map((one, i) => rowsOf(one, i === widest ? Math.max(1, width - rest) : Math.max(1, wants[i] ?? 1))))
}

// The rows the pane may take on the terminal.

/**
 * What the rest of Claude Code's screen needs beside an inline pane: the
 * pane's frame (2), the prompt's box (3), its footer (1), a spinner's line
 * (1) and the tabs' row while two panes are open (1).
 */
export const SCREEN_RESERVE = 8

/** The fewest rows the deck draws into, however short the terminal. */
export const FEWEST_ROWS = 8

/**
 * The rows the deck's drawing may take on the terminal: the room the pane
 * has (`scroll.bodyRows`), and never more than the terminal less what the
 * rest of its screen needs (`viewport.rows`, SCREEN_RESERVE); FEWEST_ROWS at
 * the least. Undefined when neither is known.
 */
export function paneRowsFor(bodyRows: number | undefined, screenRows: number | undefined): number | undefined {
  const room = typeof bodyRows === 'number' && bodyRows > 0 ? bodyRows : Infinity
  const screen = typeof screenRows === 'number' && screenRows > 0 ? screenRows - SCREEN_RESERVE : Infinity
  const rows = Math.min(room, screen)
  return Number.isFinite(rows) ? Math.max(FEWEST_ROWS, Math.floor(rows)) : undefined
}

/**
 * The body rows the deck asks for as it opens on a terminal `screenRows`
 * tall (`$.ui.open`'s `rows`, which seats an inline pane that tall): a third
 * of it, as Claude Code's own default, never more than the terminal less
 * what the rest of its screen needs; undefined while the height is unknown.
 */
export function openRowsFor(screenRows: number): number | undefined {
  if (!(screenRows > 0)) return undefined
  return Math.max(FEWEST_ROWS, Math.min(screenRows - SCREEN_RESERVE, Math.round(screenRows / 3)))
}
