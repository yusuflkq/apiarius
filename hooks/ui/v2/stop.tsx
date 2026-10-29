/**
 * Stop, as the pane and the terminal draw it (the web page draws the same,
 * web/app.js):
 *
 * - **Stop turn** at the right of the header while the main loop's turn
 *   runs (`header.turn`): `$.turn.abort`, as Esc does.
 * - **Stop** on a background agent's or a teammate's card, beside Open, and
 *   on its page, only where Claude Code's own permission check allows its
 *   TaskStop (the agent row's `stop.can`); where none is offered, its page
 *   says why in one line.
 * - On another session's deck (its state marked `peer`) nothing is stopped:
 *   its Stop turn says, quietly where it stands, to stop the turn in its
 *   window, and its agents' pages say where (their `why`, ../../sessions
 *   `peerStateOf`).
 *
 * Every press goes through DashActions to the hooks module, which stops only
 * through Claude Code's own channels, asking its check again first; in the
 * sample, nothing is stopped. A desktop draws a plain Button's label alone,
 * in its own ink, so the red stop mark beside it is an image of its own.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { V2Stop } from '../../background'
import type { V2AgentRow, WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { advanceOf, svgOf } from './look'
import { P } from './palette'
import { plainSlack } from './parts'
import { cellsOf } from './text'

/** The stop mark, `px` square: a rounded red square where the surface draws Svg (Lucide's `square`), else ■. */
export function stopMark(kit: Kit, px = 12): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (!Svg) return <Text color={P.failText}>■</Text>
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${P.failText}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>`
  return <Svg source={source} alt="Stop" width={px} height={px} />
}

/** Stop turn at the right of the header, while the main loop's turn runs (`header.turn`): the stop mark, then the plain Button keyed `stop:turn`; on another session's deck, quietly, where to stop it. Null between turns. */
export function stopTurnButton(kit: Kit, state: Pick<WebStateV2, 'header' | 'peer'>, actions: Pick<DashActions, 'abortTurn'>): RenderElement | null {
  const { Box, Text, Button } = kit
  if (!state.header.turn) return null
  if (state.peer) {
    return (
      <Box key="stop:turnbox" flexShrink={0}>
        <Text color={P.muted2}>Stop the turn in its window</Text>
      </Box>
    )
  }
  return (
    <Box key="stop:turnbox" flexShrink={0} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{stopMark(kit)}</Box>
      <Box flexShrink={0}>
        <Button key="stop:turn" label="Stop turn" plain dimColor onPress={() => actions.abortTurn()} />
      </Box>
    </Box>
  )
}

/** Whether an agent's Stop is offered: Claude Code's check allows TaskStop of it. */
function canStop(row: Pick<V2AgentRow, 'stop'>): row is { stop: V2Stop } {
  return row.stop?.can === true
}

/** The cells a card's Stop takes, its gap included; 0 where none is offered. */
export function cardStopCells(kit: Kit, row: Pick<V2AgentRow, 'stop'>): number {
  return canStop(row) ? cellsOf(row.stop.label, advanceOf(kit)) + plainSlack(kit) + 1 : 0
}

/** A background agent's or a teammate's Stop on its card, beside Open: a plain dim Button keyed `card:stop:<id>`; null where none is offered. */
export function cardStop(kit: Kit, row: Pick<V2AgentRow, 'id' | 'stop'>, actions: Pick<DashActions, 'stopAgent'>): RenderElement | null {
  const { Button } = kit
  if (!canStop(row)) return null
  return <Button key={`card:stop:${row.id}`} label={row.stop.label} plain dimColor onPress={() => actions.stopAgent(row.id)} />
}

/**
 * An agent page's Stop while it is at work: where Claude Code's check allows
 * TaskStop of it, the stop mark, Stop (keyed `page:stop`) and, dim, what a
 * press does; where it does not, why, in one dim line. Null for an agent
 * that is not at work.
 */
export function pageStop(kit: Kit, row: Pick<V2AgentRow, 'id' | 'stop'>, actions: Pick<DashActions, 'stopAgent'>): RenderElement | null {
  const { Box, Text, Button } = kit
  const stop = row.stop
  if (!stop) return null
  if (!stop.can) {
    return (
      <Box key="page:stopline" flexDirection="row">
        <Text color={P.muted2} wrap="wrap">
          {stop.why}
        </Text>
      </Box>
    )
  }
  return (
    <Box key="page:stopline" flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{stopMark(kit)}</Box>
      <Box flexShrink={0}>
        <Button key="page:stop" label={stop.label} plain onPress={() => actions.stopAgent(row.id)} />
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {`Claude Code's own ${stop.tool} ends it`}
        </Text>
      </Box>
    </Box>
  )
}
