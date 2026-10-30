/**
 * The org chart as an indented tree: on the terminal (its avatars coloured
 * glyphs), VS Code and the mobile app, and on the desktop where the chart's
 * Client failed. Each agent one
 * row under the agent that started it: its avatar with its status dot, its
 * name (a Button keyed `agent:<id>`, W.agentKeyOf; the one opened last the
 * primary plate), its pill and "Open →"; its one line under it (its call in
 * flight verbatim, else what it handed back). Every line of a row opens the
 * agent's page, and "Open →" lights while the pointer is on the row.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { MAIN } from '../../model'
import { agentKeyOf, type V2AgentRow, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentRowsOf, cardLine, wrapTicks } from './dashModel'
import { AVATAR, advanceOf, avatar, quiet, statusPill } from './look'
import { P, toneOf } from './palette'
import { OPEN_LABEL, buttonSlack, openButton, pillCells, plainSlack, pressText, tickParts, wrapAdvanceOf } from './parts'
import { cellsOf, cutCells, plural } from './text'

/** The cells each level of the tree indents, and the most levels it indents. */
const INDENT = 2
const LEVELS = 5
/** The cells a row's name keeps at most. */
const NAME = 28
/** The rows the tree draws at most, so its drawing keeps inside the pane's bounds. */
const MOST_ROWS = 80

/** The agents in tree order, each with its depth: the Orchestrator first, everyone under who started them, siblings as they started. */
export function treeRowsOf(state: Pick<WebStateV2, 'agents'>): { row: V2AgentRow; depth: number }[] {
  const rows = agentRowsOf(state)
  const ids = new Set(rows.map(row => row.id))
  const parentOf = (row: V2AgentRow) => (row.parent !== null && row.parent !== row.id && ids.has(row.parent) ? row.parent : null)
  const order = (x: V2AgentRow, y: V2AgentRow) => Number(y.id === MAIN) - Number(x.id === MAIN) || x.startedAt - y.startedAt
  const kids = new Map<string, V2AgentRow[]>()
  const roots: V2AgentRow[] = []
  for (const row of rows) {
    const parent = parentOf(row)
    if (parent === null) roots.push(row)
    else kids.set(parent, [...(kids.get(parent) ?? []), row])
  }
  roots.sort(order)
  for (const list of kids.values()) list.sort(order)
  const out: { row: V2AgentRow; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (row: V2AgentRow, depth: number) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    out.push({ row, depth })
    for (const kid of kids.get(row.id) ?? []) walk(kid, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  // a cycle the parents make leaves its agents unwalked: they stand at the top
  for (const row of rows) walk(row, 0)
  return out
}

/** An agent's one line on Org: its call in flight verbatim, else while it is at work its words since its latest call (quoted), else what it handed back; "stopped" for one stopped with none. */
export function orgLineOf(row: V2AgentRow): string {
  return cardLine(row) || (row.isStopped ? 'stopped' : '')
}

export function orgTree(kit: Kit, state: WebStateV2, actions: DashActions, selected: string | null): RenderElement {
  const { Box, Text, Button } = kit
  const rows = treeRowsOf(state)
  if (rows.length === 0) return quiet(kit, 'No agents yet: the Orchestrator and the agents it starts show here, each under the one that started it.')
  const adv = advanceOf(kit)
  const slack = buttonSlack(kit)
  const openCells = cellsOf(OPEN_LABEL, adv) + plainSlack(kit)
  return (
    <Box key="org:tree" flexDirection="column">
      {rows.slice(0, MOST_ROWS).map(({ row, depth }) => {
        const indent = Math.min(depth, LEVELS) * INDENT
        const lead = depth > 0 ? 4 : 3
        // the name's room: the row less its indent, the corner, the avatar (the terminal's glyph and status mark), the pill, "Open →" and the gaps between
        const room = Math.max(8, kit.columns - indent - (depth > 0 ? 2 : 0) - (kit.surface === 'terminal' ? 4 : 3) - pillCells(kit, row.status) - 1 - openCells - 1 - slack)
        const name = cutCells(row.title, Math.min(NAME, room), adv)
        const word = row.isStopped ? 'stopped' : toneOf(row.status).word
        const open = () => actions.openAgent(row.id)
        const said = wrapTicks(orgLineOf(row) || '—', Math.max(8, kit.columns - indent - lead - plainSlack(kit)), 1, wrapAdvanceOf(kit))[0] ?? []
        return (
          <Box key={`org:${row.id}`} flexDirection="column" paddingLeft={indent}>
            <Box flexDirection="row" columnGap={1} alignItems="center">
              {depth > 0 ? <Text color={P.muted3}>└</Text> : null}
              <Box flexShrink={0}>{avatar(kit, row, AVATAR.row, { dot: true, animated: true })}</Box>
              <Box flexShrink={1} minWidth={0}>
                {row.id === selected ? (
                  <Button key={agentKeyOf(row.id)} label={name} variant="primary" onPress={open} />
                ) : (
                  <Button key={agentKeyOf(row.id)} label={name} plain onPress={open}>
                    <Text bold color={P.text}>
                      {name}
                    </Text>
                  </Button>
                )}
              </Box>
              <Box flexShrink={0}>{statusPill(kit, row.status, word)}</Box>
              <Box flexGrow={1} flexShrink={0} justifyContent="flex-end">
                {openButton(kit, `org:open:${row.id}`, toneOf(row.status).pillFg, open)}
              </Box>
            </Box>
            <Box paddingLeft={lead}>{pressText(kit, `org:now:${row.id}`, tickParts(kit, said, P.muted), open, true)}</Box>
          </Box>
        )
      })}
      {rows.length > MOST_ROWS ? quiet(kit, `${plural(rows.length - MOST_ROWS, 'more agent')}: more than the pane holds. /apiarius web lists them all.`) : null}
    </Box>
  )
}
