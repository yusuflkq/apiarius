/**
 * The pieces every v2 screen draws the same way: an agent's avatar (a small
 * static Svg of the web's gradient face where the surface draws Svg, with
 * its status dot at its foot; a dot of its colour on the terminal), a
 * status dot, a status pill (an image on a desktop, its word on the
 * terminal), a status glyph, an icon, a section's head, a quiet line, and
 * how much room a character takes where it is drawn.
 *
 * A desktop draws a plain Button's label alone, in its own ink (the Text in
 * it keeps neither colour nor weight), so what carries colour beside a
 * pressable line is Text or an image of its own; and it draws text in a
 * proportional face, so text is fitted to its room by `advanceOf`.
 *
 * Pure: Kit comes from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { Kit } from '../types'
import { P, PILL_HEIGHT, avatarColor, avatarSvg, glyphOf, iconSvg, pillSvg, pillWidth, toneOf, type IconName } from './palette'
import { monoAdvance, uiAdvance, type Advance } from './text'

/** The Svg element where the surface draws one as an image: every table but the terminal's, which answers to Svg with an empty box. */
export function svgOf(kit: Kit): Kit['Svg'] {
  return kit.surface === 'terminal' ? undefined : kit.Svg
}

/** How much room a character takes where `kit` draws: a cell on the terminal; less, and by the letter, in a desktop's proportional face. */
export function advanceOf(kit: Kit): Advance {
  return kit.surface === 'terminal' ? monoAdvance : uiAdvance
}


/** Avatar sizes in CSS px: a tree row's, the agent page's. */
export const AVATAR = { row: 18, page: 32 } as const

/**
 * An agent's avatar: its gradient face (with its status dot at its foot in
 * `dot`'s colour, when given) where Svg draws; a dot of the avatar's colour
 * on the terminal.
 */
export function avatar(kit: Kit, index: number, px: number, name: string, dot?: string): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (Svg) return <Svg source={avatarSvg(index, px, dot)} alt={`${name}'s avatar`} width={px} height={px} />
  return <Text color={avatarColor(index)}>●</Text>
}

/** The status dot: ● in its status's hue (amber waiting, blue at work, green done, red failed, grey idle). */
export function statusDot(kit: Kit, status: string): RenderElement {
  const { Text } = kit
  return <Text color={toneOf(status).hue}>●</Text>
}

/** A status's word as a pill: rounded and ringed where Svg draws (alt its word); its word on the dark tint of its hue on the terminal. */
export function statusPill(kit: Kit, status: string, word = toneOf(status).word): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  const tone = toneOf(status)
  if (!Svg) return <Text color={tone.pillFg} backgroundColor={tone.pillBg}>{` ${word} `}</Text>
  return <Svg source={pillSvg(word, tone.hue)} alt={word} width={pillWidth(word)} height={PILL_HEIGHT} />
}

/** What each glyph says to a reader that cannot see it. */
const GLYPH_ALT: Readonly<Record<string, string>> = { done: 'Done', active: 'In progress', failed: 'Failed', waiting: 'Waiting on you', idle: 'Idle', pending: 'Not started' }

/** A status glyph (done, active, failed, waiting, idle, pending): its icon `px` square where Svg draws, else its character, in its hue. */
export function glyph(kit: Kit, name: string, px = 14): RenderElement {
  const { Text } = kit
  const one = glyphOf(name)
  const Svg = svgOf(kit)
  if (Svg) return <Svg source={iconSvg(one.icon, one.hue, px)} alt={GLYPH_ALT[name] ?? 'Not started'} width={px} height={px} />
  return <Text color={one.hue}>{one.mark}</Text>
}

/** What each icon says to a reader that cannot see it. */
const ICON_ALT: Readonly<Record<IconName, string>> = {
  help: 'Question',
  shield: 'Permission',
  bell: 'Notification',
  circleCheck: 'Done',
  circle: 'Not started',
  circleX: 'Failed',
  circlePause: 'Waiting on you',
  circleDashed: 'Idle',
  progress: 'In progress',
}

/** An icon where the surface draws Svg; else `mark` in `color` (the terminal draws text alone). */
export function icon(kit: Kit, name: IconName, color: string, mark: string, px = 14): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  return Svg ? <Svg source={iconSvg(name, color, px)} alt={ICON_ALT[name]} width={px} height={px} /> : <Text color={color}>{mark}</Text>
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

/** One quiet line where content will be, saying in a plain sentence what will appear there. */
export function quiet(kit: Kit, text: string): RenderElement {
  const { Text } = kit
  return (
    <Text color={P.muted2} italic wrap="wrap">
      {text}
    </Text>
  )
}

/**
 * A key's Button: plain, with its one-character hotkey; the terminal draws
 * `n: Next`, a desktop the label alone. `dim` draws it dim at rest.
 */
export function keyButton(kit: Kit, key: string, hotkey: string, label: string, onPress: () => void, dim = true): RenderElement {
  const { Button } = kit
  return <Button key={key} label={label} plain hotkey={hotkey} dimColor={dim} onPress={onPress} />
}

/** Words with `code` spans as Text runs: the plain words in `color`, each code span (backticks dropped) on the chip's grey. */
export function ticked(kit: Kit, text: string, color: string): RenderElement[] {
  const { Text } = kit
  return String(text ?? '')
    .split(/`([^`\n]+)`/)
    .flatMap((part, i) => {
      if (part === '') return []
      if (i % 2 === 0) return [<Text color={color}>{part}</Text>]
      return [
        <Text color={P.fg2} backgroundColor={P.chip}>
          {part}
        </Text>,
      ]
    })
}
