/**
 * The pieces every part of the native dashboard draws the same way: an
 * agent's avatar (a small static Svg of the web's gradient face where the
 * surface draws Svg, a dot in its colour on the terminal), an icon, a status
 * pill (the word on a dark tint of its hue), a section's head, a line whose
 * code spans read as code, a bordered card, the quiet line where content
 * will be, and the pressable lines and "Open →" that every card and row a
 * press opens an agent from is made of; and `openAgentPage`, which opens an
 * agent's page on the pane it showed last.
 *
 * Pure but for that: Kit comes from the hooks module, and the pane each
 * agent's page showed last is kept here while the module lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckAgentPane } from '../../../types'
import type { WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import { firstPaneOf, ticks, type TickPart } from './dashModel'
import { P, avatarColor, avatarSvg, iconSvg, toneOf, type IconName } from './palette'

/** The Svg element where the surface draws one as an image: every table but the terminal's, which answers to Svg with an empty box. */
export function svgOf(kit: Kit): Kit['Svg'] {
  return kit.surface === 'terminal' ? undefined : kit.Svg
}

/** Avatar sizes in CSS px: a card's, an activity row's, the agent page's. */
export const AVATAR = { card: 22, row: 20, page: 34 } as const

/** An agent's avatar: its gradient face, with its status dot in `dot`'s colour when given; a dot of its colour where no Svg draws; a grey dot for an id the state does not hold. */
export function avatar(kit: Kit, index: number | null, px: number, name: string, dot?: string): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (index === null) return <Text color={P.muted3}>●</Text>
  if (Svg) return <Svg source={avatarSvg(index, px, dot)} alt={`${name}'s avatar`} width={px} height={px} />
  return <Text color={avatarColor(index)}>●</Text>
}

/** What each icon says to a reader that cannot see it. */
const ICON_ALT: Readonly<Record<IconName, string>> = {
  help: 'Question',
  shield: 'Permission',
  target: 'Goal',
  hand: 'Waiting on you',
  octagon: 'Failed',
  circleCheck: 'Done',
  bot: 'Agents',
  listChecks: 'Plan',
  dollar: 'Spend',
  cornerDownRight: 'Follow-up',
  cpu: 'Model',
  coins: 'Tokens',
  diff: 'Lines changed',
  wrench: 'Tool calls',
  file: 'File',
}

/** An icon where the surface draws Svg; null elsewhere (the terminal draws its text alone). */
export function icon(kit: Kit, name: IconName, color: string, px = 16): RenderElement | null {
  const Svg = svgOf(kit)
  return Svg ? <Svg source={iconSvg(name, color, px)} alt={ICON_ALT[name]} width={px} height={px} /> : null
}

/** The cells a pill takes: its word centred in nine. */
export const PILL = 9

/** A status pill: the word in the hue's light text on a dark tint of it, centred in PILL cells so pills line up. */
export function pill(kit: Kit, status: string): RenderElement {
  const { Text } = kit
  const tone = toneOf(status)
  const pad = Math.max(0, PILL - tone.word.length)
  const left = Math.floor(pad / 2)
  return <Text color={tone.pillFg} backgroundColor={tone.pillBg}>{`${' '.repeat(left)}${tone.word}${' '.repeat(pad - left)}`}</Text>
}

/** A section's head: its title in muted capitals, a count after it, and a control at the right. */
export function sectionHead(kit: Kit, title: string, count: number | null, right: RenderElement | null = null): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text wrap="truncate-end">
        <Text bold color={P.muted}>
          {title.toUpperCase()}
        </Text>
        {count !== null ? <Text color={P.muted2}>{`  ${count}`}</Text> : null}
      </Text>
      {right ? <Box flexShrink={0}>{right}</Box> : null}
    </Box>
  )
}

/** A line's runs (plain and code, as `ticks` and `wrapTicks` give them) as Text: its plain words in `color`, its code spans on the chip's grey. */
export function tickParts(kit: Kit, parts: readonly TickPart[], color: string): RenderElement[] {
  const { Text } = kit
  return parts.map(part =>
    part.isCode ? (
      <Text color={P.fg2} backgroundColor={P.chip}>
        {part.text}
      </Text>
    ) : (
      <Text color={color}>{part.text}</Text>
    ),
  )
}

/** A line's parts as Text: its plain words in `color`, its code spans (backticked) on the chip's grey. */
export function tickTexts(kit: Kit, text: string, color: string): RenderElement[] {
  return tickParts(kit, ticks(text), color)
}

/** One quiet line where content will be, saying in a plain sentence what will appear there. */
export function quiet(kit: Kit, text: string): RenderElement {
  const { Text } = kit
  return (
    <Text color={P.muted2} italic wrap="wrap">
      {text}
    </Text>
  )
}

/** The cells a card's border and padding take across: one each side for the rule, one each side inside it. */
export const CARD_CHROME = 4

/** `n` boxes across `columns` with one cell between them: each one's width. */
export function widthFor(columns: number, n: number): number {
  return Math.max(12, Math.floor((columns - (n - 1)) / Math.max(1, n)))
}

// Which pane an agent's page opens on.

/** The pane picked last on each agent's page (Diffs, Activity or Talk), while the module lives: its page opens on it again, as the web deck's does. */
const pagePanes = new Map<string, DeckAgentPane>()

/** Notes the pane picked on agent `id`'s page: a press on its tabs. */
export function notePagePane(id: string, pane: DeckAgentPane): void {
  pagePanes.set(id, pane)
}

/**
 * Opens agent `id`'s page on `pane` when given (an activity row opens it on
 * Activity, for that once), else on the pane last picked on it, else on its
 * first (as the web deck's: the Orchestrator's Talk; an agent's Diffs where
 * it edited, Activity while it works, Talk once it ended), so no page opens
 * on a pane it has nothing for.
 */
export function openAgentPage(actions: DashActions, state: WebState, id: string, pane?: DeckAgentPane): void {
  actions.setAgentPane(pane ?? pagePanes.get(id) ?? firstPaneOf(state, id))
  actions.openAgent(id)
}

// What a press opens an agent from: lines that are Buttons, and "Open →".

/**
 * The cells a plain Button takes beyond its text: none on the terminal
 * (the label alone), a desktop's native button its padding. A pressable
 * line's text is cut to its room less this, so it never wraps or spills.
 */
export function buttonSlack(kit: Kit): number {
  return kit.surface === 'terminal' ? 0 : 2
}

/** What ends every card and row a press opens an agent from. */
export const OPEN_LABEL = 'Open →'

/** The cells "Open →" takes, its button's chrome with it. */
export function openWidth(kit: Kit): number {
  return Array.from(OPEN_LABEL).length + buttonSlack(kit)
}

/**
 * "Open →": a plain Button, dim at rest and lit in `hue` while the pointer
 * is anywhere on the keyed Box that holds it (the card or row it opens), so
 * the whole of that reads as one thing to press. Drawn in a keyed Box only.
 */
export function openButton(kit: Kit, key: string, hue: string, onPress: () => void): RenderElement {
  const { Button } = kit
  return <Button key={key} label={OPEN_LABEL} plain dimColor hover={{ color: hue, dimColor: false }} onPress={onPress} />
}

/**
 * One line of a card or row as a plain Button keyed `key`: its runs are
 * Text, so they keep their colours, and a press anywhere on them runs
 * `onPress`. Its row lets it shrink, never grow past the line.
 */
export function pressLine(kit: Kit, key: string, parts: RenderElement[], onPress: () => void): RenderElement {
  const { Box, Button } = kit
  return (
    <Box flexDirection="row">
      <Box flexShrink={1}>
        <Button key={key} plain onPress={onPress}>
          {parts}
        </Button>
      </Box>
    </Box>
  )
}
