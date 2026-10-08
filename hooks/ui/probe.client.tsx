/**
 * The surface module of `/deck probe`: a Client drawn with the surface's own
 * elements, to show in one look whether a surface runs one, and whether its
 * cells, pointer and keys line up.
 *
 * Row 0 reports the region's size and what reached the instance, row 1 is a
 * ruler (one digit a cell), then a 4 by 4 grid of 10 by 3 boxes. A pointer
 * down fills the box under it copper and posts the cell to the hooks module
 * (`ui.message`). The state lives in `surface.state`, written only from the
 * input handlers, so a redraw (each tick hands new props) keeps the clicks
 * and the copper box.
 *
 * Self-contained: it runs on the drawing thread, with no `$` and nothing of
 * the plugin's but its props.
 */
import type { ClientKeyEvent, ClientModule } from 'claude-code'

type ProbeProps = { tick: number; cols: number }
type ProbeState = { clicks: number; box: readonly [number, number] | null; key: string }

/** theme.ts's Copper (the clicked box), Raised (the hover tint) and Graphite (the text on copper). */
const COPPER = '#c9824f'
const RAISED = '#242422'
const GRAPHITE = '#161615'

/** Each box's cells across and down, and the rows above the grid: the report and the ruler. */
const BOX_COLUMNS = 10
const BOX_ROWS = 3
const GRID_TOP = 2
const GRID = [0, 1, 2, 3] as const

const FIRST: ProbeState = { clicks: 0, box: null, key: 'none' }

function keyName(event: ClientKeyEvent): string {
  const held = [event.ctrl ? 'ctrl' : '', event.meta ? 'meta' : '', event.shift ? 'shift' : ''].filter(Boolean)
  return [...held, event.key].join('+')
}

const Probe: ClientModule<ProbeProps, ProbeState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? FIRST

  // each listener reads the state as it is when the input comes, so setting them again on every call is safe
  surface.onPointer(event => {
    if (event.type !== 'down') return
    const col = Math.floor(event.x / BOX_COLUMNS)
    const row = Math.floor((event.y - GRID_TOP) / BOX_ROWS)
    const now = surface.state ?? FIRST
    surface.setState({ ...now, clicks: now.clicks + 1, box: [row, col] })
    surface.post({ box: [row, col], x: event.x, y: event.y })
  })
  surface.onKey(event => {
    surface.setState({ ...(surface.state ?? FIRST), key: keyName(event) })
  })

  // before the first layout the region reads 0 across: the ruler spans the pane's body instead
  const span = surface.columns > 0 ? surface.columns : Math.max(Number(props.cols) || 0, BOX_COLUMNS * GRID.length)
  const ruler = '0123456789'.repeat(Math.ceil(span / 10)).slice(0, span)
  const isPicked = (row: number, col: number) => state.box !== null && state.box[0] === row && state.box[1] === col

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">{`${surface.columns}×${surface.rows} · clicks ${state.clicks} · tick ${props.tick} · key ${state.key}`}</Text>
      <Text wrap="truncate">{ruler}</Text>
      {GRID.map(row => (
        <Box flexDirection="row">
          {GRID.map(col => {
            const picked = isPicked(row, col)
            // the clicked box stays copper under the pointer that clicked it
            return (
              <Box
                key={`r${row}c${col}`}
                width={BOX_COLUMNS}
                height={BOX_ROWS}
                flexShrink={0}
                borderStyle="round"
                hover={{ backgroundColor: picked ? COPPER : RAISED }}
                {...(picked ? { backgroundColor: COPPER } : {})}
              >
                <Text {...(picked ? { color: GRAPHITE } : {})}>{`r${row}c${col}`}</Text>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export default Probe
