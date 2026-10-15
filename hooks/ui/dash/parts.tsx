/**
 * The pieces every part of the native dashboard draws the same way: an
 * agent's avatar (a small static Svg of the web's gradient face where the
 * surface draws Svg, a dot in its colour on the terminal), an icon, a status
 * pill (the word on a dark tint of its hue), a section's head, a line whose
 * code spans read as code, a bordered card, and the quiet line where content
 * will be.
 *
 * Pure: Kit comes from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { Kit } from '../types'
import { ticks } from './dashModel'
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

/** A line's parts as Text: its plain words in `color`, its code spans (backticked) on the chip's grey. */
export function tickTexts(kit: Kit, text: string, color: string): RenderElement[] {
  const { Text } = kit
  return ticks(text).map(part =>
    part.isCode ? (
      <Text color={P.fg2} backgroundColor={P.chip}>
        {part.text}
      </Text>
    ) : (
      <Text color={color}>{part.text}</Text>
    ),
  )
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
