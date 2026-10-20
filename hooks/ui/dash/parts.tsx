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
 * Where the surface draws Svg (the desktop), the web's small shapes are
 * images as the page draws them: a status pill rounded and ringed, a status
 * glyph, the amber "shared" tag, a stack of faces, a list's 1 px divider. A
 * desktop draws a plain Button's label alone, in its own ink (the Text in it
 * keeps neither colour nor weight), so what carries colour beside a pressable
 * line is Text or an image of its own; and it draws text in a proportional
 * face, so text is fitted to its room by `advanceOf`, not a cell a character.
 *
 * Pure but for that: Kit comes from the hooks module, and the pane each
 * agent's page showed last is kept here while the module lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckAgentPane } from '../../../types'
import type { WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import { firstPaneOf, monoAdvance, ticks, uiAdvance, uiWrapAdvance, type Advance, type TickPart } from './dashModel'
import { P, PILL_HEIGHT, avatarColor, avatarSvg, glyphOf, iconSvg, pillSvg, pillWidth, ruleSvg, stackSvg, stackWidth, tagSvg, tagWidth, toneOf, type IconName } from './palette'

/** The Svg element where the surface draws one as an image: every table but the terminal's, which answers to Svg with an empty box. */
export function svgOf(kit: Kit): Kit['Svg'] {
  return kit.surface === 'terminal' ? undefined : kit.Svg
}

/** How much room a character takes where `kit` draws: a cell on the terminal; less, and by the letter, in a desktop's proportional face. */
export function advanceOf(kit: Kit): Advance {
  return kit.surface === 'terminal' ? monoAdvance : uiAdvance
}

/** The same for text laid into lines (`wrapTicks`): on a desktop a little over, so no line runs past its room. */
export function wrapAdvanceOf(kit: Kit): Advance {
  return kit.surface === 'terminal' ? monoAdvance : uiWrapAdvance
}

/** The CSS px a desktop's cell is: the "0" of its 13 px Anthropic Sans, what an image's px are counted in cells by. */
export const CELL_PX = 7.85

/** The cells an image `px` across takes on a desktop. */
export function cellsForPx(px: number): number {
  return px / CELL_PX
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
  circle: 'Not started',
  circleX: 'Failed',
  circlePause: 'Waiting on you',
  circleDashed: 'Idle',
  progress: 'In progress',
  chevronRight: 'Shut',
  chevronDown: 'Open',
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

/**
 * A status pill beside a name, as the web's card draws it: where Svg draws,
 * rounded and ringed with its word centred (palette's pillSvg, alt its word);
 * else its word a space either side on the dark tint of its hue.
 */
export function statusPill(kit: Kit, status: string): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  const tone = toneOf(status)
  if (!Svg) return <Text color={tone.pillFg} backgroundColor={tone.pillBg}>{` ${tone.word} `}</Text>
  return <Svg source={pillSvg(tone.word, tone.hue)} alt={tone.word} width={pillWidth(tone.word)} height={PILL_HEIGHT} />
}

/** The cells `statusPill` takes for `status`. */
export function pillCells(kit: Kit, status: string): number {
  const word = toneOf(status).word
  return svgOf(kit) ? cellsForPx(pillWidth(word)) : Array.from(word).length + 2
}

/** What each status glyph says to a reader that cannot see it. */
const GLYPH_ALT: Readonly<Record<string, string>> = { done: 'Done', active: 'In progress', failed: 'Failed', waiting: 'Waiting on you', idle: 'Idle', pending: 'Not started' }

/** A status glyph (palette's GLYPH: done, active, failed, waiting, idle, pending): its icon `px` square where Svg draws, else its character, in its hue. */
export function glyph(kit: Kit, name: string, px = 15): RenderElement {
  const { Text } = kit
  const one = glyphOf(name)
  const Svg = svgOf(kit)
  if (Svg) return <Svg source={iconSvg(one.icon, one.hue, px)} alt={GLYPH_ALT[name] ?? GLYPH_ALT.pending ?? name} width={px} height={px} />
  return <Text color={one.hue}>{one.mark}</Text>
}

/** The cells `glyph` takes. */
export function glyphCells(kit: Kit, px = 15): number {
  return svgOf(kit) ? cellsForPx(px) : 1
}

/** A tag as the web's amber `.tag-wait` (a file more than one agent edited, "shared"): an image where Svg draws, else its word on the amber tint. */
export function tag(kit: Kit, word: string): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (Svg) return <Svg source={tagSvg(word)} alt={word} width={tagWidth(word)} height={20} />
  const tone = toneOf('waiting')
  return <Text color={tone.pillFg} backgroundColor={tone.pillBg}>{` ${word} `}</Text>
}

/** The cells `tag` takes. */
export function tagCells(kit: Kit, word: string): number {
  return svgOf(kit) ? cellsForPx(tagWidth(word)) : Array.from(word).length + 2
}

/** The editors' faces, `px` square: one stacked image as the web's where Svg draws, else a dot each in its colour; at most `most`, then "+n". */
export function faces(kit: Kit, avatars: readonly (number | null)[], px: number, names: readonly string[], most = 3): RenderElement {
  const { Box, Text } = kit
  const shown = avatars.slice(0, most)
  const more = avatars.length - shown.length
  const Svg = svgOf(kit)
  return (
    <Box flexDirection="row" alignItems="center">
      {Svg && shown.length > 0 ? (
        <Svg source={stackSvg(shown, px)} alt={names.slice(0, most).join(', ')} width={stackWidth(shown.length, px)} height={px} />
      ) : (
        shown.map(one => <Text color={one === null ? P.muted3 : avatarColor(one)}>●</Text>)
      )}
      {more > 0 ? <Text color={P.muted2}>{` +${more}`}</Text> : null}
    </Box>
  )
}

/** The cells `faces` takes for `n` editors. */
export function facesCells(kit: Kit, n: number, px: number, most = 3): number {
  const shown = Math.min(n, most)
  const more = n > most ? String(n - most).length + 2 : 0
  return (svgOf(kit) ? cellsForPx(stackWidth(shown, px)) : shown) + more
}

/** The rule between a list's rows where Svg draws (1 px, in the card's edge, as the web's `.list`); nothing on the terminal, whose rows need none. */
export function rule(kit: Kit): RenderElement | null {
  const { Box } = kit
  const Svg = svgOf(kit)
  if (!Svg) return null
  return (
    <Box flexDirection="column">
      <Svg source={ruleSvg(P.border)} alt="Divider" height={1} />
    </Box>
  )
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

/** The cells a border takes across, both edges: a cell each on the terminal, a pixel each on a desktop. */
export function edgesOf(kit: Kit): number {
  return svgOf(kit) ? 2 / CELL_PX : 2
}

/** The cells a bordered Box with a cell of padding either side takes across beyond its inside: CARD_CHROME on the terminal, its padding and two pixels on a desktop. */
export function chromeOf(kit: Kit): number {
  return 2 + edgesOf(kit)
}

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
 * The cells a plain Button takes beyond its label where the dashboard lays
 * out a line: none on the terminal, a desktop's padding either side (about a
 * cell in all). A label a little long for it is cut by the desktop itself
 * where its Box may shrink (`pressText`).
 */
export function plainSlack(kit: Kit): number {
  return kit.surface === 'terminal' ? 0 : 1
}

/**
 * One line of a card as a plain Button keyed `key`, its runs Text (the
 * terminal draws their colours; a desktop draws the label alone, in its own
 * ink); `dim` draws it dim where a desktop does, as the web's muted line.
 * Its Box may shrink below the label, so a desktop cuts a label too long for
 * the line with "…" rather than let it run past the card.
 */
export function pressText(kit: Kit, key: string, parts: RenderElement[], onPress: () => void, dim = false): RenderElement {
  const { Box, Button } = kit
  return (
    <Box flexDirection="row">
      <Box flexShrink={1} minWidth={0}>
        <Button key={key} plain dimColor={dim && kit.surface !== 'terminal'} onPress={onPress}>
          {parts}
        </Button>
      </Box>
    </Box>
  )
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
