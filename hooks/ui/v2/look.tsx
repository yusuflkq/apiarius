/**
 * The pieces every v2 screen draws the same way: an agent's avatar (an Svg
 * of the deck's avatar library, web/avatars.mjs, in the style the deck draws,
 * its status dot at its foot, where the surface draws Svg; its glyph and
 * status mark on the terminal), a
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

import * as AV from '../../../web/avatars.mjs'
import type { V2AgentRow } from '../../web'
import type { Kit } from '../types'
import { P, PILL_HEIGHT, glyphOf, iconSvg, pillSvg, pillWidth, toneOf, type IconName } from './palette'
import { monoAdvance, uiAdvance, type Advance } from './text'

/** The Svg element where the surface draws one as an image: every table but the terminal's, which answers to Svg with an empty box. */
export function svgOf(kit: Kit): Kit['Svg'] {
  return kit.surface === 'terminal' ? undefined : kit.Svg
}

/** How much room a character takes where `kit` draws: a cell on the terminal; less, and by the letter, in a desktop's proportional face. */
export function advanceOf(kit: Kit): Advance {
  return kit.surface === 'terminal' ? monoAdvance : uiAdvance
}


/** Avatar sizes in CSS px: a tree row's, the agent page's, an agent card's on Now, a row of Now's lists. */
export const AVATAR = { row: 18, page: 32, card: 22, list: 20 } as const

/** Who an avatar draws: an agent's row as the state gives it (its own TodoWrite list fills a progress ring). */
export type Face = Pick<V2AgentRow, 'id' | 'title' | 'kind' | 'status' | 'isStopped'> & { todos?: V2AgentRow['todos'] }

/** The style `kit` draws avatars in: the deck's setting, else the library's default (robots). */
export function avatarStyleOf(kit: Kit): AV.AvatarStyle {
  return AV.styleOf(kit.avatarStyle)
}

/** A row as the avatar library takes an agent: seeded by its id, the Orchestrator as `main`, a stopped one as stopped. */
export function avatarAgentOf(row: Face): AV.AvatarAgent {
  return {
    id: row.id,
    name: row.title,
    role: row.kind === 'orchestrator' ? 'main' : '',
    status: row.isStopped ? 'stopped' : row.status,
    progress: AV.progressOf(row.todos),
  }
}

/**
 * An agent's avatar in the deck's style (web/avatars.mjs), `px` square, with
 * its status dot when `dot`, where Svg draws. The terminal draws its glyph in
 * its colour, and with `dot` its status mark after it.
 *
 * Still, it is an image. With `animated` it moves as its status does, in an
 * interactive Svg (a sandboxed frame): the Desktop builds every element of
 * the pane afresh on each redraw and keeps only a frame whose source is the
 * same (its renderer's `Ko`), so an image's motion would start over at every
 * redraw (a robot's one-time settle would play again and again) where a
 * frame's runs on. Its source changes only with its status or the style, so
 * it loads again only then. A frame with no control in it takes no Tab stop.
 */
export function avatar(kit: Kit, row: Face, px: number, opts: { dot?: boolean; animated?: boolean } = {}): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  const agent = avatarAgentOf(row)
  if (Svg) {
    const isAnimated = opts.animated === true
    const source = AV.avatarSvg(avatarStyleOf(kit), agent, { size: px, dot: opts.dot === true, animated: isAnimated, ground: P.ground })
    if (isAnimated) return <Svg source={source} alt={`${row.title}'s avatar`} width={px} height={px} isInteractive />
    return <Svg source={source} alt={`${row.title}'s avatar`} width={px} height={px} />
  }
  const face = AV.terminalFace(agent, avatarStyleOf(kit))
  if (!opts.dot) return terminalCell(kit, face)
  return (
    <Text>
      {terminalCell(kit, face)}
      <Text color={face.markColor}>{face.mark}</Text>
    </Text>
  )
}

/** A terminal face's one cell: its glyph in its colour, bold on its background where the style tiles it (mono). */
export function terminalCell(kit: Kit, face: ReturnType<typeof AV.terminalFace>): RenderElement {
  const { Text } = kit
  if (face.background === undefined) return <Text color={face.color}>{face.glyph}</Text>
  return (
    <Text color={face.color} backgroundColor={face.background} bold={face.bold === true}>
      {face.glyph}
    </Text>
  )
}

/** The cells `avatar` takes: its px in a desktop's cells (7.85 px each); on the terminal its glyph, and its mark with `dot`. */
export function avatarCells(kit: Kit, px: number, dot = false): number {
  return svgOf(kit) ? px / 7.85 : dot ? 2 : 1
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
  bot: 'Agents',
  listChecks: 'Plan',
  dollar: 'Spend',
  hand: 'Waiting on you',
  file: 'File',
  chevronRight: 'Shut',
  chevronDown: 'Open',
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
