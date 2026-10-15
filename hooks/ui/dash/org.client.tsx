/**
 * The Org tab's org chart, a surface module: each agent a bordered card over
 * box-drawing connectors, the Orchestrator at the top and nested agents under
 * their parent, laid out by ./orgLayout.ts and drawn with the surface's own
 * elements.
 *
 * - A click on a card posts `{ type: 'open', id }`: the hooks module opens that agent's page.
 * - A drag, or the arrow keys once a click gave it the focus, pans a chart
 *   wider or taller than its region (shift for a card at a time); Home centres it again.
 * - The card under a resting pointer takes a tint; the selected one (props) a brighter border.
 *
 * Pan, hover and a drag under way live in `surface.state`, written only from
 * the input handlers, so a redraw (each new state of the deck hands new
 * props) keeps them. Only what shows in the region is drawn.
 *
 * Self-contained: it runs on the drawing thread, with no `$` and nothing of
 * the plugin's but its props and the pure layout it imports.
 */
import type { ClientElements, ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface, RenderElement } from 'claude-code'
import {
  CARD_H,
  CARD_W,
  GAP_X,
  GAP_Y,
  MAX_ROWS,
  orgCardAt,
  orgCardLinesOf,
  orgCardsIn,
  orgLayoutOf,
  orgSegmentIn,
  orgSizeOfLayout,
  orgViewOf,
  type OrgAgent,
  type OrgHeat,
  type OrgLayout,
  type OrgProps,
  type OrgStatus,
  type OrgView,
} from './orgLayout'

/** The status dot: the web deck's status hues. */
const DOT: Record<OrgStatus, string> = {
  starting: '#3b82f6',
  running: '#3b82f6',
  waiting: '#f59e0b',
  done: '#22c55e',
  failed: '#ef4444',
  idle: '#a8aeb2',
}

/** A card's border: grey, or its status hue while it runs, waits on you, or once it failed. */
const GREY = '#2a2a2a'
const BORDER: Record<OrgStatus, string> = {
  starting: '#3b82f6',
  running: '#3b82f6',
  waiting: '#f59e0b',
  failed: '#ef4444',
  done: GREY,
  idle: GREY,
}

/** The selected card's border: the same hue, brighter. */
const BORDER_SELECTED: Record<OrgStatus, string> = {
  starting: '#93c5fd',
  running: '#93c5fd',
  waiting: '#fcd34d',
  failed: '#fca5a5',
  done: '#d4d4d4',
  idle: '#d4d4d4',
}

/** Under a resting pointer: a tint behind the card, and a grey border lifted. */
const HOVER_FILL = '#262626'
const HOVER_BORDER = '#525252'

/** The connectors by heat: dim grey, amber toward an agent waiting on you, blue toward a running one (the web deck's edges). */
const WIRE: Record<OrgHeat, string> = { 0: '#4a4a4a', 1: '#7a5418', 2: '#2f5aa3' }

/** What an arrow key pans by, and with shift: a card and its gap. */
const STEP_X = 6
const STEP_Y = 2
const FAR_X = CARD_W + GAP_X
const FAR_Y = CARD_H + GAP_Y

/** The width laid out for before the region's first layout (it reads 0 across until then). */
const FIRST_COLUMNS = 80

/** A pointer held down: where it went down, the pan then, whether it has left that cell, and whether its up may open a card. */
type Drag = { x: number; y: number; panX: number; panY: number; moved: boolean; opens: boolean }

type OrgState = {
  /** The pan from where the chart starts (orgViewOf), in cells. */
  panX: number
  panY: number
  /** The agent whose card is under the resting pointer. */
  hover: string | null
  drag: Drag | null
}

const FIRST: OrgState = { panX: 0, panY: 0, hover: null, drag: null }

type ViewAt = (panX: number, panY: number) => OrgView

/** Each instance's last layout, by its surface: a redraw from its own input (same props, same width) lays nothing out again. */
const layouts = new WeakMap<object, { agents: unknown; columns: number; layout: OrgLayout }>()

function layoutFor(surface: object, agents: unknown, columns: number): OrgLayout {
  const last = layouts.get(surface)
  if (last && last.agents === agents && last.columns === columns) return last.layout
  const layout = orgLayoutOf(Array.isArray(agents) ? (agents as OrgAgent[]) : [], columns)
  layouts.set(surface, { agents, columns, layout })
  return layout
}

/**
 * Down holds the pointer; a move while held pans (once it leaves the cell it
 * went down in), else hovers; an up that never left its cell is a click,
 * hit-tested by cell, and opens the card under it.
 */
function onPointer(surface: ClientSurface<OrgState>, event: ClientPointerEvent, layout: OrgLayout, viewAt: ViewAt) {
  const now = surface.state ?? FIRST
  const view = viewAt(now.panX, now.panY)
  if (event.type === 'down') {
    if (event.button === 'right') return
    surface.setState({ ...now, drag: { x: event.x, y: event.y, panX: view.panX, panY: view.panY, moved: false, opens: event.button !== 'middle' } })
    return
  }
  if (event.type === 'move') {
    const drag = now.drag
    if (drag) {
      const moved = drag.moved || event.x !== drag.x || event.y !== drag.y
      const next = viewAt(drag.panX + event.x - drag.x, drag.panY + event.y - drag.y)
      if (moved !== drag.moved || next.panX !== now.panX || next.panY !== now.panY) {
        surface.setState({ ...now, panX: next.panX, panY: next.panY, drag: { ...drag, moved } })
      }
      return
    }
    const hover = orgCardAt(layout, view, event.x, event.y)
    if (hover !== now.hover) surface.setState({ ...now, hover })
    return
  }
  if (event.type === 'up') {
    const drag = now.drag
    if (!drag) return
    const hit = orgCardAt(layout, view, event.x, event.y)
    if (!drag.moved && drag.opens && hit !== null) surface.post({ type: 'open', id: hit })
    surface.setState({ ...now, drag: null, hover: hit })
    return
  }
  if (event.type === 'leave' && !now.drag && now.hover !== null) surface.setState({ ...now, hover: null })
}

/** The arrows pan (shift: a card at a time), page up and down a region, Home back to where the chart starts. */
function onKey(surface: ClientSurface<OrgState>, event: ClientKeyEvent, viewAt: ViewAt) {
  const now = surface.state ?? FIRST
  const view = viewAt(now.panX, now.panY)
  const far = event.shift === true
  let panX = view.panX
  let panY = view.panY
  switch (event.key) {
    case 'left':
      panX += far ? FAR_X : STEP_X
      break
    case 'right':
      panX -= far ? FAR_X : STEP_X
      break
    case 'up':
      panY += far ? FAR_Y : STEP_Y
      break
    case 'down':
      panY -= far ? FAR_Y : STEP_Y
      break
    case 'pageup':
      panY += Math.max(1, view.rows - STEP_Y)
      break
    case 'pagedown':
      panY -= Math.max(1, view.rows - STEP_Y)
      break
    case 'home':
      panX = 0
      panY = 0
      break
    default:
      return
  }
  const next = viewAt(panX, panY)
  if (next.panX !== now.panX || next.panY !== now.panY) surface.setState({ ...now, panX: next.panX, panY: next.panY })
}

/** One card: the status dot and bold name, the dim type, the dim model and tokens, the now line. */
function cardOf(
  { Box, Text }: Pick<ClientElements, 'Box' | 'Text'>,
  agent: OrgAgent,
  left: number,
  top: number,
  isSelected: boolean,
  isHovered: boolean,
): RenderElement {
  const lines = orgCardLinesOf(agent)
  const base = BORDER[agent.status]
  const border = isSelected ? BORDER_SELECTED[agent.status] : isHovered && base === GREY ? HOVER_BORDER : base
  const fill = isHovered ? { backgroundColor: HOVER_FILL } : {}
  return (
    <Box
      key={`card:${agent.id}`}
      position="absolute"
      left={left}
      top={top}
      width={CARD_W}
      height={CARD_H}
      flexDirection="column"
      paddingX={1}
      borderStyle="round"
      borderColor={border}
      {...fill}
    >
      <Text wrap="truncate-end">
        <Text color={DOT[agent.status]}>●</Text>
        <Text bold>{` ${lines.name}`}</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {lines.type || ' '}
      </Text>
      <Text dimColor wrap="truncate-end">
        {lines.meta}
      </Text>
      <Text wrap="truncate-end">{lines.now}</Text>
    </Box>
  )
}

const Org: ClientModule<OrgProps, OrgState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const given: Partial<OrgProps> = props !== null && typeof props === 'object' ? props : {}
  const selected = typeof given.selected === 'string' ? given.selected : null
  const columns = surface.columns > 0 ? surface.columns : FIRST_COLUMNS
  const layout = layoutFor(surface, given.agents, columns)
  const rows = surface.rows > 0 ? surface.rows : Math.min(MAX_ROWS, orgSizeOfLayout(layout, columns).rows)
  const viewAt: ViewAt = (panX, panY) => orgViewOf(layout, columns, rows, { x: panX, y: panY })
  const state = surface.state ?? FIRST
  const view = viewAt(state.panX, state.panY)

  // each listener reads the state as it is when the input comes, and this call's layout and region
  surface.onPointer(event => onPointer(surface, event, layout, viewAt))
  surface.onKey(event => onKey(surface, event, viewAt))

  if (layout.cards.length === 0) {
    return (
      <Box width={columns} height={rows}>
        <Text dimColor>No agents yet.</Text>
      </Box>
    )
  }

  // the connectors first, the cards over them: only what shows in the region
  const parts: RenderElement[] = []
  for (const segment of layout.segments) {
    const shown = orgSegmentIn(segment, view)
    if (!shown) continue
    const color = WIRE[segment.heat]
    // a run down is a column of one-glyph lines: no newline inside a Text for a surface to read its own way
    parts.push(
      shown.down ? (
        <Box position="absolute" left={shown.x} top={shown.y} flexDirection="column">
          {Array.from(shown.glyphs, glyph => (
            <Text color={color}>{glyph}</Text>
          ))}
        </Box>
      ) : (
        <Box position="absolute" left={shown.x} top={shown.y}>
          <Text color={color}>{shown.glyphs}</Text>
        </Box>
      ),
    )
  }
  for (const card of orgCardsIn(layout, view)) {
    parts.push(cardOf({ Box, Text }, card.agent, view.x + card.x, view.y + card.y, card.agent.id === selected, card.agent.id === state.hover))
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box width={columns} height={view.rows} overflow="hidden">
        {parts}
      </Box>
      {view.note ? (
        <Text dimColor wrap="truncate-end">
          {view.note}
        </Text>
      ) : null}
    </Box>
  )
}

export default Org
