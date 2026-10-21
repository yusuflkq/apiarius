/**
 * The pieces Now's dashboard draws the same way, beside ./look's: a face
 * for an agent the state may not hold, the cells a pill, a glyph or a face
 * takes, the amber "shared" tag, a stack of editors' faces, a list's 1 px
 * rule, a section's head that folds it (`foldHead`: "▾ AGENTS 7", a press
 * folds the section to it and one dim line), a line whose code spans read
 * as code, the chrome of a bordered card, and the pressable lines and
 * "Open →" every card and row is made of.
 *
 * A desktop draws a plain Button's label alone, in its own ink (the Text in
 * it keeps neither colour nor weight), so what carries colour beside a
 * pressable line is Text or an image of its own; and it draws text in a
 * proportional face, so text is fitted to its room by the letter.
 *
 * Pure: Kit and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DashActions, Kit } from '../types'
import { ticks, uiWrapAdvance, type TickPart } from './dashModel'
import { avatar, svgOf } from './look'
import { P, avatarColor, pillWidth, ruleSvg, stackSvg, stackWidth, tagSvg, tagWidth, toneOf } from './palette'
import { monoAdvance, type Advance } from './text'

/** How much room a character takes in text laid into lines: on a desktop a little over, so no line runs past its room. */
export function wrapAdvanceOf(kit: Kit): Advance {
  return kit.surface === 'terminal' ? monoAdvance : uiWrapAdvance
}

/** The CSS px a desktop's cell is: the "0" of its 13 px Anthropic Sans, what an image's px are counted in cells by. */
export const CELL_PX = 7.85

/** The cells an image `px` across takes on a desktop. */
export function cellsForPx(px: number): number {
  return px / CELL_PX
}

/** An agent's face, with its status dot in `dot`'s colour when given; a grey dot for an agent the state does not hold. */
export function face(kit: Kit, index: number | null, px: number, name: string, dot?: string): RenderElement {
  const { Text } = kit
  if (index === null) return <Text color={P.muted3}>●</Text>
  return avatar(kit, index, px, name, dot)
}

/** The cells ./look's `statusPill` takes for `status`. */
export function pillCells(kit: Kit, status: string): number {
  const word = toneOf(status).word
  return svgOf(kit) ? cellsForPx(pillWidth(word)) : Array.from(word).length + 2
}

/** The cells ./look's `glyph` takes. */
export function glyphCells(kit: Kit, px = 14): number {
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

/** The chevron of a section's head: ▾ while the section is open, ▸ while it is folded. */
export function chevronOf(isOpen: boolean): string {
  return isOpen ? '▾' : '▸'
}

/** The words of a section's head that folds: "▾ AGENTS 7" while open, "▸ AGENTS 7" folded; no count where `count` is null. */
export function foldLabel(title: string, count: number | null, isOpen: boolean): string {
  return `${chevronOf(isOpen)} ${title.toUpperCase()}${count !== null ? ` ${count}` : ''}`
}

/** A section that folds: its id in `DeckView.collapsed` (dashModel's FOLD), whether it is open, and what its one line says while it is folded. */
export type Fold = { id: string; isOpen: boolean; summary: string }

/** The fold of section `id`, open unless `collapsed` (the view's) holds it; `summary` its one line while folded. */
export function sectionFold(collapsed: readonly string[], id: string, summary: string): Fold {
  return { id, isOpen: !collapsed.includes(id), summary }
}

/**
 * A section's head that folds it: one plain Button keyed `fold:<id>` whose
 * label is "▾ AGENTS 7" while the section is open and "▸ AGENTS 7" while it
 * is folded (a desktop draws the label alone, dim; the terminal draws its
 * Text, the title bold), a press folding or opening it at once
 * (`toggleSection`). While folded, its one-line summary, dim, beside it,
 * cut to the line; a control at the right either way. The Button's key
 * stays as it folds, so nothing flashes.
 */
export function foldHead(kit: Kit, fold: Fold, title: string, count: number | null, actions: DashActions, right: RenderElement | null = null): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>
        <Button key={`fold:${fold.id}`} label={foldLabel(title, count, fold.isOpen)} plain dimColor={kit.surface !== 'terminal'} onPress={() => actions.toggleSection(fold.id)}>
          <Text color={P.muted2}>{`${chevronOf(fold.isOpen)} `}</Text>
          <Text bold color={P.muted}>
            {title.toUpperCase()}
          </Text>
          {count !== null ? <Text color={P.muted2}>{` ${count}`}</Text> : null}
        </Button>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {!fold.isOpen && fold.summary ? (
          <Text color={P.muted2} wrap="truncate-end">
            {`· ${fold.summary}`}
          </Text>
        ) : null}
      </Box>
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

/** The cells a card's border and padding take across: one each side for the rule, one each side inside it. */
export const CARD_CHROME = 4

/** The cells a border takes across, both edges: a cell each on the terminal, a pixel each on a desktop. */
export function edgesOf(kit: Kit): number {
  return svgOf(kit) ? 2 / CELL_PX : 2
}

/** The cells a bordered Box with a cell of padding either side takes across beyond its inside. */
export function chromeOf(kit: Kit): number {
  return 2 + edgesOf(kit)
}

/** `n` boxes across `columns` with one cell between them: each one's width. */
export function widthFor(columns: number, n: number): number {
  return Math.max(12, Math.floor((columns - (n - 1)) / Math.max(1, n)))
}

/** The cells a plain Button takes beyond its text: none on the terminal (the label alone), a desktop's native button its padding. */
export function buttonSlack(kit: Kit): number {
  return kit.surface === 'terminal' ? 0 : 2
}

/** What ends every card a press opens an agent from. */
export const OPEN_LABEL = 'Open →'

/**
 * "Open →": a plain Button, dim at rest and lit in `hue` while the pointer
 * is anywhere on the keyed Box that holds it (the card it opens), so the
 * whole of that reads as one thing to press.
 */
export function openButton(kit: Kit, key: string, hue: string, onPress: () => void): RenderElement {
  const { Button } = kit
  return <Button key={key} label={OPEN_LABEL} plain dimColor hover={{ color: hue, dimColor: false }} onPress={onPress} />
}

/** The cells a plain Button takes beyond its label where a line is laid out: none on the terminal, about a cell on a desktop. */
export function plainSlack(kit: Kit): number {
  return kit.surface === 'terminal' ? 0 : 1
}

/**
 * One line as a plain Button keyed `key`, its runs Text (the terminal draws
 * their colours; a desktop draws the label alone, in its own ink); `dim`
 * draws it dim where a desktop does. Its Box may shrink below the label, so
 * a desktop cuts a label too long for the line with "…".
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
