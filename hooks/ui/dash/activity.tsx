/**
 * An agent page's Activity, as the web deck's Activity tab draws it
 * (web/app.js `ActivityTab`, `Outcome`): the agent's tool calls, newest
 * first, in a bordered card, one row a call:
 *
 * - the tool, as a small chip: its name on a dark tint (an MCP tool's "MCP"),
 *   in a column as wide as the longest name it holds, so the rest line up;
 * - what the call was, as the state words it: a shell call's or a start's
 *   own description (its command when it gave none), a file's path, a
 *   search's pattern; cut to the row, and red where the call failed;
 * - how it went, in a fixed column at the right: ◐ running (blue), ◐ waiting
 *   while its agent waits on you (amber), ✕ failed (red), else how long it
 *   took, dim; "—" for a call its stopped agent left unfinished;
 * - how long ago, dim, in a fixed column after it.
 *
 * At most the newest 80 of the agent's calls the state holds (it keeps the
 * newest 150 of every agent's), as the web shows; where the agent made more,
 * a line under the card says how many. Every agent's page draws it, the
 * Orchestrator's too. The Dashboard's Recent activity is its own
 * (./dashboard).
 *
 * Pure: Kit and the state come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebAgent, WebState } from '../../web'
import type { Kit } from '../types'
import { agentOf, ago, cut, flat, isLive, msText, num } from './dashModel'
import { P } from './palette'
import { CARD_CHROME, quiet } from './parts'

/** The most calls the tab shows, as the web's. */
export const MOST_CALLS = 80

/** How a call stands, at its row's right: its mark and word, or how long it took; and its hue. */
export type CallOutcome = { mark: string; word: string; tone: 'live' | 'wait' | 'fail' | 'quiet' }

/** One row: its key, the tool's chip, what the call was, whether it failed, how it went, when it started. */
export type CallRow = { key: string; tool: string; text: string; isFailed: boolean; outcome: CallOutcome; at: number }

type Call = WebState['activity'][number]

/** How a call went, as the web's `Outcome` says it: in flight (waiting while its agent waits on you, unfinished once its agent stopped), failed, or how long it took. */
function outcomeOf(agent: WebAgent | undefined, call: Call): CallOutcome {
  if (call.ok === null || call.ok === undefined) {
    if (agent?.status === 'waiting') return { mark: '◐', word: 'waiting', tone: 'wait' }
    if (agent && !isLive(agent.status)) return { mark: '', word: '—', tone: 'quiet' }
    return { mark: '◐', word: 'running', tone: 'live' }
  }
  if (call.ok === false) return { mark: '✕', word: 'failed', tone: 'fail' }
  return { mark: '', word: msText(call.ms) || 'ok', tone: 'quiet' }
}

/** The chip's word: the tool's name; an MCP tool's "MCP" (its server and tool are its target already). */
export function chipOf(tool: string): string {
  return tool.startsWith('mcp__') ? 'MCP' : tool
}

/**
 * Agent `agentId`'s calls as the tab rows them, newest first, at most
 * `most`. Each is keyed by when it started and its tool (`call:<at>:<tool>`,
 * a count after the second of the same), counted oldest first, so a row
 * keeps its key as newer calls arrive above it.
 */
export function callRowsOf(state: WebState, agentId: string, most = MOST_CALLS): CallRow[] {
  const agent = agentOf(state, agentId)
  const seen = new Map<string, number>()
  const rows = state.activity
    .filter(call => call.agent === agentId)
    .map(call => {
      const base = `${call.at}:${call.tool}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      return {
        key: `call:${n === 0 ? base : `${base}:${n}`}`,
        tool: chipOf(call.tool),
        text: flat(call.target || ''),
        isFailed: call.ok === false,
        outcome: outcomeOf(agent, call),
        at: call.at,
      }
    })
  return rows.slice(-Math.max(1, most)).reverse()
}

/** The cells the outcome and the age take at a row's right ("◐ running", "12m"). */
const OUTCOME = 9
const TIME = 4
/** The chip's cells at least and at most, its padding in. */
const LEAST_CHIP = 6
const MOST_CHIP = 17
/** A failed call's words, as the web reddens them. */
const FAIL_TARGET = '#fca5a5'
const HUE: Readonly<Record<CallOutcome['tone'], string>> = { live: P.runText, wait: P.waitText, fail: P.failText, quiet: P.muted2 }

/** The chip column's cells: the longest tool name among the rows and a cell each side, within LEAST_CHIP and MOST_CHIP. */
export function chipWidthOf(rows: readonly CallRow[]): number {
  const longest = Math.max(0, ...rows.map(row => Array.from(row.tool).length))
  return Math.min(MOST_CHIP, Math.max(LEAST_CHIP, longest + 2))
}

/** The tab: a bordered card of the agent's calls, newest first; how many it made under it where the state holds fewer; a quiet line before its first. */
export function activityTab(kit: Kit, state: WebState, agent: WebAgent, now: number): RenderElement {
  const { Box, Text } = kit
  const rows = callRowsOf(state, agent.id)
  if (rows.length === 0) return quiet(kit, 'No tool calls yet: its tool calls show here as it makes them.')
  const chip = chipWidthOf(rows)
  // the words' room: the card's inside less the chip, the outcome, the age and the gaps between them
  const room = Math.max(8, kit.columns - CARD_CHROME - chip - OUTCOME - TIME - 3)
  const made = agent.tools || 0
  return (
    <Box key="page:activity" flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
        {rows.map(row => callRow(kit, row, chip, room, now))}
      </Box>
      {made > rows.length ? <Text color={P.muted2}>{`The newest ${num(rows.length)} of its ${num(made)} calls.`}</Text> : null}
    </Box>
  )
}

/** One call: its chip, its words, how it went and when. */
function callRow(kit: Kit, row: CallRow, chip: number, room: number, now: number): RenderElement {
  const { Box, Text } = kit
  const said = row.outcome.mark ? `${row.outcome.mark} ${row.outcome.word}` : row.outcome.word
  return (
    <Box key={row.key} flexDirection="row" columnGap={1}>
      <Box width={chip} flexShrink={0}>
        <Text color={P.fg2} backgroundColor={P.chip}>{` ${cut(row.tool, chip - 2)} `}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {row.text ? (
          <Text color={row.isFailed ? FAIL_TARGET : P.fg2} wrap="truncate-end">
            {cut(row.text, room)}
          </Text>
        ) : null}
      </Box>
      <Box width={OUTCOME} flexShrink={0} justifyContent="flex-end">
        <Text color={HUE[row.outcome.tone]}>{said}</Text>
      </Box>
      <Box width={TIME} flexShrink={0} justifyContent="flex-end">
        <Text color={P.muted2}>{ago(row.at, now)}</Text>
      </Box>
    </Box>
  )
}
