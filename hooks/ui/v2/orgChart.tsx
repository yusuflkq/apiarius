/**
 * Org's chart on a desktop, in the pane's own elements, so each card shows
 * the agent's avatar (a Client draws the terminal's elements alone, and no
 * Svg): each agent a bordered card where ./orgLayout lays it out, in cells
 * across and rows down, over box-drawing connectors; the Orchestrator at the
 * top, each agent under the one that started it, a parent's children
 * wrapped into rows where one row would be wider than the pane.
 *
 * - A card (CARD_W by CARD_H): the agent's avatar (the deck's avatar library,
 *   its status dot at its foot; moving, in a frame the Desktop keeps, while
 *   the agent starts, runs or waits on you; still otherwise), its name (a
 *   plain Button keyed `agent:<id>`, W.agentKeyOf, that opens its page), its
 *   type, its model and tokens, and its one line (its call in flight, else
 *   what it handed back). Its edge in its status's hue while it runs, waits
 *   on you or failed, brighter for the agent whose page was opened last;
 *   under the pointer, a tint.
 * - The connectors: each run down one Text of lines; each run across cut at
 *   its junctions (`orgPiecesOf`), each junction a glyph on its own cell and
 *   each stretch of `─` clipped to its cells (the Desktop's box-drawing
 *   glyphs are about 1.17 cells wide). Under the cards, in the hue of what
 *   they lead to: blue to an agent at work, amber to one waiting on you.
 * - Bounded: the chart is the pane's width at most and as tall as it needs
 *   (the pane scrolls), and CHART_MOST elements at most, strings counted as
 *   the Desktop counts them. A chart wider than the pane (a tree too broad
 *   to wrap) or larger has no plan here (`orgChartPlanOf` is null): Org
 *   draws the chart's Client instead, which pans.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { MAIN } from '../../model'
import { agentKeyOf, type V2AgentRow, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentRowsOf } from './dashModel'
import { AVATAR, advanceOf, avatar, svgOf, type Face } from './look'
import { CARD_H, CARD_W, orgLayoutOf, orgPiecesOf, type OrgAgent, type OrgHeat, type OrgLayout, type OrgStatus } from './orgLayout'
import { P } from './palette'
import { cellsForPx, plainSlack } from './parts'
import { cutCells } from './text'

/**
 * What each part of the chart costs in the Desktop's count of elements
 * (strings count): the frame, a card (its box, its head row, the avatar's
 * box and image, the name's box and Button, and three Text lines and their
 * strings), a run down, a junction, a stretch across.
 */
export const CHART_NODES = { frame: 1, card: 12, down: 3, glyph: 3, stretch: 4 } as const

/** The most elements the chart takes: the rest of the pane (the header, the tabs, Org's head) keeps it well under the Desktop's 2000. */
export const CHART_MOST = 1500

/** A card's edge: grey at rest, its status's hue while it runs, waits on you or failed; brighter for the agent whose page was opened last. */
const EDGE: Readonly<Record<OrgStatus, string>> = { starting: P.run, running: P.run, waiting: P.wait, failed: P.fail, done: P.border, idle: P.border }
const EDGE_SELECTED: Readonly<Record<OrgStatus, string>> = { starting: '#93c5fd', running: '#93c5fd', waiting: '#fcd34d', failed: '#fca5a5', done: '#d4d4d4', idle: '#d4d4d4' }
/** Under the pointer: a tint behind the card, and a grey edge lifted. */
const HOVER_FILL = '#262626'

/** The connectors by heat: dim grey, amber toward an agent waiting on you, blue toward one at work (the web deck's edges). */
const WIRE: Readonly<Record<OrgHeat, string>> = { 0: '#4a4a4a', 1: '#7a5418', 2: '#2f5aa3' }

/** The statuses whose avatar moves: an Svg in a frame, which the Desktop keeps across redraws. */
const MOVING: ReadonlySet<OrgStatus> = new Set<OrgStatus>(['starting', 'running', 'waiting'])

/** The most avatars that move at once, in the layout's order: each is a frame of its own, and a document of its own in the drawing's characters. The rest stand still. */
export const MOST_MOVING = 24

/** How a chart is drawn here: the layout, and the cells it stands in from the pane's left edge (centred). */
export type OrgChartPlan = { layout: OrgLayout; left: number; nodes: number }

/** What the connectors of `layout` cost in elements. */
function wiresCost(layout: OrgLayout): number {
  let cost = 0
  for (const segment of layout.segments) {
    if (segment.down) cost += CHART_NODES.down
    else for (const piece of orgPiecesOf(segment.glyphs)) cost += Array.from(piece.glyphs).length > 1 ? CHART_NODES.stretch : CHART_NODES.glyph
  }
  return cost
}

/**
 * How `agents` are drawn as a chart on this surface, or null where it is
 * not: on a surface other than the desktop (the terminal, VS Code and the
 * mobile app list them as a tree), with no agents, where the layout is wider
 * than the pane even wrapped, or where it would pass CHART_MOST elements.
 */
export function orgChartPlanOf(kit: Kit, agents: readonly OrgAgent[]): OrgChartPlan | null {
  if (kit.surface !== 'desktop' || !svgOf(kit) || agents.length === 0) return null
  // rows of two or more where they fit; else a column where a level needs one
  const wrapped = orgLayoutOf(agents, kit.columns)
  const layout = wrapped.width > kit.columns ? orgLayoutOf(agents, kit.columns, { lone: true }) : wrapped
  if (layout.cards.length === 0 || layout.width > kit.columns) return null
  const nodes = CHART_NODES.frame + layout.cards.length * CHART_NODES.card + wiresCost(layout)
  if (nodes > CHART_MOST) return null
  return { layout, left: Math.max(0, Math.floor((kit.columns - layout.width) / 2)), nodes }
}

/** The Button keys of a planned chart's names, in the layout's order (the Orchestrator first, then level by level). */
export function orgChartKeysOf(plan: OrgChartPlan): string[] {
  return plan.layout.cards.map(card => agentKeyOf(card.agent.id))
}

/** The chart as planned: its connectors, then its cards over them, in a box the chart's height and the pane's width. */
export function orgChart(kit: Kit, state: WebStateV2, plan: OrgChartPlan, selected: string | null, actions: DashActions): RenderElement {
  const { Box } = kit
  const rows = new Map(agentRowsOf(state).map(row => [row.id, row]))
  const { layout, left } = plan
  let moving = 0
  return (
    <Box key="org:chart" flexDirection="column" width={kit.columns} height={layout.height} flexShrink={0}>
      {wiresOf(kit, layout, left)}
      {layout.cards.map(card => {
        const row = rows.get(card.agent.id)
        const isMoving = MOVING.has(card.agent.status) && row?.isStopped !== true && moving < MOST_MOVING
        if (isMoving) moving += 1
        return cardOf(kit, card.agent, row, left + card.x, card.y, card.agent.id === selected, isMoving, actions)
      })}
    </Box>
  )
}

/** The connectors, `left` cells in: a run down as one Text of lines; a run across in pieces, each junction on its cell and each stretch of `─` clipped to its cells. */
function wiresOf(kit: Kit, layout: OrgLayout, left: number): RenderElement[] {
  const { Box, Text } = kit
  const parts: RenderElement[] = []
  for (const segment of layout.segments) {
    const color = WIRE[segment.heat]
    if (segment.down) {
      parts.push(
        <Box position="absolute" left={left + segment.x} top={segment.y}>
          <Text color={color}>{Array.from(segment.glyphs).join('\n')}</Text>
        </Box>,
      )
      continue
    }
    for (const piece of orgPiecesOf(segment.glyphs)) {
      const length = Array.from(piece.glyphs).length
      parts.push(
        length > 1 ? (
          <Box position="absolute" left={left + segment.x + piece.at} top={segment.y} width={length} height={1} overflow="hidden">
            <Box width={length * 2} flexShrink={0}>
              <Text color={color}>{piece.glyphs}</Text>
            </Box>
          </Box>
        ) : (
          <Box position="absolute" left={left + segment.x + piece.at} top={segment.y}>
            <Text color={color}>{piece.glyphs}</Text>
          </Box>
        ),
      )
    }
  }
  return parts
}

/** The cells a card's text has across: its width less its border (a pixel each side) and a cell of padding each side. */
const INSIDE = CARD_W - 2 - 2 / 7.85

/**
 * One card at (`x`, `y`): the avatar (moving with `isMoving`) and the name,
 * then the type, the model and tokens, and the one line, each cut to the
 * card. `row` is the agent's row in the state, for its avatar; without one
 * the card draws it from what the chart holds.
 */
function cardOf(kit: Kit, agent: OrgAgent, row: V2AgentRow | undefined, x: number, y: number, isSelected: boolean, isMoving: boolean, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const face: Face = row ?? { id: agent.id, title: agent.label || agent.id, kind: agent.id === MAIN ? 'orchestrator' : 'agent', status: agent.status, isStopped: false }
  const name = cutCells(agent.label || agent.id, Math.max(4, INSIDE - cellsForPx(AVATAR.card) - 1 - plainSlack(kit) - 1), adv)
  const fit = (text: string) => cutCells(text, Math.max(4, INSIDE - 0.5), adv)
  const meta = [agent.model || '—', agent.tokens ? `${agent.tokens} tokens` : ''].filter(one => one !== '').join(' · ')
  const said = agent.now || (face.isStopped ? 'stopped' : agent.status)
  const edge = isSelected ? EDGE_SELECTED[agent.status] : EDGE[agent.status]
  return (
    <Box
      key={`org:card:${agent.id}`}
      position="absolute"
      left={x}
      top={y}
      width={CARD_W}
      height={CARD_H}
      flexDirection="column"
      borderStyle="round"
      borderColor={edge}
      hover={{ backgroundColor: HOVER_FILL, ...(edge === P.border ? { borderColor: P.borderStrong } : {}) }}
      paddingX={1}
      paddingY={1}
    >
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexShrink={0}>{avatar(kit, face, AVATAR.card, { dot: true, animated: isMoving })}</Box>
        <Box flexShrink={1} minWidth={0}>
          <Button key={agentKeyOf(agent.id)} label={name} plain onPress={() => actions.openAgent(agent.id)} />
        </Box>
      </Box>
      <Text color={P.muted} wrap="truncate-end">
        {fit(agent.type) || ' '}
      </Text>
      <Text color={P.muted2} wrap="truncate-end">
        {fit(meta)}
      </Text>
      <Text color={P.fg2} wrap="truncate-end">
        {fit(said)}
      </Text>
    </Box>
  )
}
