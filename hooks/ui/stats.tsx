/**
 * The Stats tab: the session's figures as metric cards, then the tool calls
 * and edits of the last 30 minutes and the lines agents changed over the
 * last 7 days.
 *
 * Where the surface draws Svg, the cards are one full-width strip drawn from
 * the theme's tokens and the charts are bars; the terminal draws native
 * boxes and sparklines. Static: no Svg here is interactive, and every figure
 * is coarse (to the minute), so a redraw that changes nothing draws the same
 * strings and nothing reloads.
 *
 * Pure: the hooks module hands in the Kit, the DeckModel and the Actions.
 */
import type { RenderElement } from 'claude-code'

import { CHART, barsSvg, svgOpen } from '../charts'
import * as F from '../format'
import { series, totalsOf } from '../model'
import { NATIVE_TEXT, RADIUS, SIZE, T } from './theme'
import type { Actions, DayRow, DeckModel, Kit } from './types'

type Piece = { text: string; tone?: 'add' | 'del' }

/** A metric card: what it counts, the figure, one line beside it. A quiet card's figure is zero or not known yet. */
type Card = { label: string; value: Piece[]; sub: string; isQuiet: boolean }

/** The card strip's geometry on its logical canvas, in px on the 4 px grid. */
const STRIP = { pad: 16, gap: 8, height: 80, inset: 12, label: 22, value: 50, sub: 68 } as const

/** A glyph's average advance per px of font size: Bahnschrift's labels, Cascadia Mono's figures. */
const ADVANCE = { label: 0.56, mono: 0.6 } as const

const CHART_HEIGHT = 140
const MINUTES = 30

/** The tab: the cards, then the last 30 minutes, then the last 7 days. Nothing on it is pressed, so `actions` goes unused. */
export function statsTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box } = kit
  const cards = cardsOf(model)

  return (
    <Box flexDirection="column" gap={1}>
      {svgOf(kit) ? cardStrip(kit, cards) : nativeCards(kit, cards)}
      {activityChart(kit, model)}
      {weekChart(kit, model.days.slice(-7))}
    </Box>
  )
}

/**
 * The Svg element where the surface draws one: every table but the
 * terminal's. The terminal's table at run time carries an Svg that draws an
 * empty Box, so the element's presence alone does not say.
 */
function svgOf(kit: Kit): Kit['Svg'] {
  return kit.surface === 'terminal' ? undefined : kit.Svg
}

// The figures.

/** A live duration to the minute: "<1m" until a minute has passed. */
function coarse(ms: number): string {
  return ms < 60_000 ? '<1m' : F.dur(ms)
}

function cardsOf(model: DeckModel): Card[] {
  const { data, git, usage, now } = model
  const t = totalsOf(data)
  const sessionMs = Math.max(0, now - (usage?.startedAt ?? data.startedAt))
  const failShare = t.tools > 0 ? Math.round((t.errors / t.tools) * 100) : 0
  const input = t.tokensIn + t.cacheRead
  const tokens = input + t.tokensOut
  const cacheShare = input > 0 ? Math.round((t.cacheRead / input) * 100) : 0

  const lines: Piece[] = []
  if (t.added > 0) lines.push({ text: `+${F.num(t.added)}`, tone: 'add' })
  if (t.removed > 0) lines.push({ text: `${t.added > 0 ? ' ' : ''}−${F.num(t.removed)}`, tone: 'del' })
  if (lines.length === 0) lines.push({ text: '0' })

  const gitCard: Card =
    git.isRepo === true
      ? {
          label: 'Uncommitted files',
          value: [{ text: F.num(git.files.length) }],
          sub: `${F.plural(git.sessionCommits, 'commit')} · ${F.num(git.today.commits)} today`,
          isQuiet: git.files.length === 0,
        }
      : { label: 'Uncommitted files', value: [{ text: '—' }], sub: git.isRepo === null ? 'reading git…' : 'no repository', isQuiet: true }

  return [
    { label: 'Session', value: [{ text: coarse(sessionMs) }], sub: `${coarse(data.turnMs)} working`, isQuiet: false },
    {
      label: 'Tool calls',
      value: [{ text: F.num(t.tools) }],
      sub: t.errors > 0 ? `${F.num(t.errors)} failed (${failShare}%)` : 'none failed',
      isQuiet: t.tools === 0,
    },
    { label: 'Lines by agents', value: lines, sub: t.files > 0 ? `in ${F.plural(t.files, 'file')}` : 'no edits yet', isQuiet: t.added === 0 && t.removed === 0 },
    gitCard,
    { label: 'Tokens', value: [{ text: F.num(tokens) }], sub: input > 0 ? `${cacheShare}% from cache` : 'none yet', isQuiet: tokens === 0 },
    {
      label: 'Cost',
      value: [{ text: F.money(usage?.costUsd) }],
      sub: usage?.contextPercent !== undefined ? `context ${Math.round(usage.contextPercent)}% full` : 'context not known',
      isQuiet: usage?.costUsd === undefined,
    },
  ]
}

function valueText(card: Card): string {
  return card.value.map(piece => piece.text).join('')
}

// The cards: a strip of Svg where the surface draws it, native boxes elsewhere.

function cardStrip(kit: Kit, cards: readonly Card[]): RenderElement | null {
  const Svg = svgOf(kit)
  if (!Svg) return null
  return <Svg source={stripSvg(cards, canvasWidth(kit))} alt={cards.map(card => `${card.label}: ${valueText(card)}, ${card.sub}`).join('; ')} />
}

function nativeCards(kit: Kit, cards: readonly Card[]): RenderElement {
  const { Box, Text } = kit
  const widest = Math.max(...cards.flatMap(card => [card.label, valueText(card), card.sub].map(text => Array.from(text).length)))
  const perRow = [cards.length, Math.ceil(cards.length / 2), Math.ceil(cards.length / 3)].find(n => Math.floor((kit.columns - (n - 1)) / n) - 4 >= widest) ?? 2
  const width = Math.max(12, Math.floor((kit.columns - (perRow - 1)) / perRow))

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {cards.map(card => (
        <Box flexDirection="column" width={width} borderStyle="single" borderDimColor paddingX={1}>
          <Text dimColor wrap="truncate-end">
            {card.label}
          </Text>
          {card.isQuiet ? (
            <Text {...NATIVE_TEXT.text4} wrap="truncate-end">
              {valueText(card)}
            </Text>
          ) : (
            <Text bold wrap="truncate-end">
              {card.value.map(piece => (piece.tone ? <Text color={piece.tone === 'add' ? T.ok : T.err}>{piece.text}</Text> : piece.text))}
            </Text>
          )}
          <Text wrap="truncate-end">{card.sub}</Text>
        </Box>
      ))}
    </Box>
  )
}

/** The logical width a full-width Svg is laid out on: about the pane's width in px, so its text draws near its set size. */
function canvasWidth(kit: Kit): number {
  return Math.round(Math.max(480, Math.min(1200, kit.columns * 8)))
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
}

function widthOf(text: string, size: number, advance: number): number {
  return Array.from(text).length * size * advance
}

/** `text` cut with an ellipsis to the characters `room` px holds at `size`. */
function clip(text: string, size: number, advance: number, room: number): string {
  return widthOf(text, size, advance) <= room ? text : F.trunc(text, Math.max(1, Math.floor(room / (size * advance))))
}

/** Cards per row: all in one row when every label, figure and line fits, else half, else a third. */
function perRowOf(cards: readonly Card[], width: number): { perRow: number; cardWidth: number } {
  const counts = [cards.length, Math.ceil(cards.length / 2), Math.ceil(cards.length / 3)]
  for (const perRow of counts) {
    const cardWidth = (width - 2 * STRIP.pad - (perRow - 1) * STRIP.gap) / perRow
    const room = cardWidth - 2 * STRIP.inset
    const fits = cards.every(
      card =>
        widthOf(card.label, SIZE.caption, ADVANCE.label) <= room &&
        widthOf(valueText(card), SIZE.large, ADVANCE.mono) <= room &&
        widthOf(card.sub, SIZE.caption, ADVANCE.label) <= room,
    )
    if (fits) return { perRow, cardWidth }
  }
  const perRow = counts[counts.length - 1] ?? 2
  return { perRow, cardWidth: (width - 2 * STRIP.pad - (perRow - 1) * STRIP.gap) / perRow }
}

const stripMemo = new Map<string, string>()

/**
 * The cards as one Svg on the instrument face: `panel` plates with a `line`
 * edge, the label in Bahnschrift 11 `text3`, the figure in Cascadia Mono 18
 * `text1` (lines in `ok` and `err`, a zero in `text4`), the line beside it
 * 11 `text2`. The same cards at the same width give the same string.
 */
function stripSvg(cards: readonly Card[], width: number): string {
  const key = JSON.stringify([cards, width])
  const known = stripMemo.get(key)
  if (known !== undefined) return known

  const { perRow, cardWidth } = perRowOf(cards, width)
  const rows = Math.ceil(cards.length / perRow)
  const height = 2 * STRIP.pad + rows * STRIP.height + (rows - 1) * STRIP.gap
  const room = cardWidth - 2 * STRIP.inset
  const parts: string[] = []

  cards.forEach((card, i) => {
    const x = Math.round(STRIP.pad + (i % perRow) * (cardWidth + STRIP.gap))
    const y = STRIP.pad + Math.floor(i / perRow) * (STRIP.height + STRIP.gap)
    const tx = x + STRIP.inset
    const value = widthOf(valueText(card), SIZE.large, ADVANCE.mono) <= room ? card.value : [{ text: clip(valueText(card), SIZE.large, ADVANCE.mono, room) }]
    const spans = value
      .map(piece => `<tspan fill="${piece.tone === 'add' ? T.ok : piece.tone === 'del' ? T.err : card.isQuiet ? T.text4 : T.text1}">${esc(piece.text)}</tspan>`)
      .join('')

    parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${Math.round(cardWidth) - 1}" height="${STRIP.height - 1}" rx="${RADIUS.plate}" fill="${T.panel}" stroke="${T.line}"/>`)
    parts.push(`<text x="${tx}" y="${y + STRIP.label}" font-size="${SIZE.caption}" fill="${T.text3}">${esc(clip(card.label, SIZE.caption, ADVANCE.label, room))}</text>`)
    parts.push(`<text x="${tx}" y="${y + STRIP.value}" font-family="${T.fontMono}" font-size="${SIZE.large}" font-weight="600">${spans}</text>`)
    parts.push(`<text x="${tx}" y="${y + STRIP.sub}" font-size="${SIZE.caption}" fill="${T.text2}">${esc(clip(card.sub, SIZE.caption, ADVANCE.label, room))}</text>`)
  })

  const svg = [
    svgOpen(width, height, ` font-family="${T.fontLabel}"`),
    `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="${RADIUS.face}" fill="${T.bg}" stroke="${T.line}"/>`,
    parts.join(''),
    '</svg>',
  ].join('')

  if (stripMemo.size >= 8) stripMemo.delete(stripMemo.keys().next().value as string)
  stripMemo.set(key, svg)
  return svg
}

// The charts: bars where the surface draws Svg, sparklines on the terminal.

const themedMemo = new Map<string, string>()

/**
 * charts.ts still draws in the first deck's palette and font: this lays its
 * output on the bench tokens (the instrument face with its `line` edge and
 * 4 px corners, Dust labels and grid, BoneDim title, Bahnschrift). A no-op
 * for each colour charts.ts already takes from the theme.
 */
function themed(svg: string, width: number, height: number): string {
  const known = themedMemo.get(svg)
  if (known !== undefined) return known

  let out = svg
  const swaps: readonly (readonly [string, string])[] = [
    [CHART.bg, T.bg],
    [CHART.grid, T.text3],
    [CHART.text, T.text3],
    [CHART.title, T.text2],
  ]
  for (const [from, to] of swaps) if (from !== to) out = out.split(from).join(to)
  out = out.replace(/font-family="[^"]*"/, `font-family="${T.fontLabel}"`)
  out = out.replace(
    `<rect width="${width}" height="${height}" fill="${T.bg}"/>`,
    `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="${RADIUS.face}" fill="${T.bg}" stroke="${T.line}"/>`,
  )

  if (themedMemo.size >= 8) themedMemo.delete(themedMemo.keys().next().value as string)
  themedMemo.set(svg, out)
  return out
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function heading(kit: Kit, title: string, note: string): RenderElement {
  const { Text } = kit
  return (
    <Text wrap="truncate-end">
      <Text bold>{title}</Text>
      <Text dimColor>{`  ${note}`}</Text>
    </Text>
  )
}

/** Tool calls and edits a minute over the last 30 minutes. */
function activityChart(kit: Kit, model: DeckModel): RenderElement {
  const { Box, Text } = kit
  const Svg = svgOf(kit)

  if (Svg) {
    // one slot a minute from 30 minutes ago to now, so the labels fall on whole fives
    const tools = series(model.data, model.now, 'tools', MINUTES + 1)
    const edits = series(model.data, model.now, 'edits', MINUTES + 1)
    const width = canvasWidth(kit)
    const labels = tools.map((_, i) => (i === MINUTES ? 'now' : `-${MINUTES - i}m`))
    const source = barsSvg(
      [
        { values: tools, color: T.text3, name: 'tool calls' },
        { values: edits, color: T.text1, name: 'edits' },
      ],
      labels,
      { width, height: CHART_HEIGHT },
      { labelEvery: 5, title: width >= 600 ? 'Activity · last 30 minutes' : 'Activity · 30 min' },
    )
    return (
      <Svg
        source={themed(source, width, CHART_HEIGHT)}
        alt={`Activity over the last 30 minutes: ${F.plural(sum(tools), 'tool call')} and ${F.plural(sum(edits), 'edit')}`}
      />
    )
  }

  const tools = series(model.data, model.now, 'tools', MINUTES)
  const edits = series(model.data, model.now, 'edits', MINUTES)
  return (
    <Box flexDirection="column">
      {heading(kit, 'Activity', 'last 30 minutes, a cell a minute')}
      <Text wrap="truncate-end">
        {F.sparkline(tools)}
        <Text dimColor>{`  ${F.plural(sum(tools), 'tool call')}`}</Text>
      </Text>
      <Text wrap="truncate-end">
        {F.sparkline(edits)}
        <Text dimColor>{`  ${F.plural(sum(edits), 'edit')}`}</Text>
      </Text>
    </Box>
  )
}

/** The lines agents added and removed each day of the last 7, from the history the deck keeps across sessions. */
function weekChart(kit: Kit, days: readonly DayRow[]): RenderElement {
  const { Box, Text } = kit
  const Svg = svgOf(kit)

  if (days.length === 0) {
    return (
      <Box flexDirection="column">
        {heading(kit, 'Lines changed by agents', 'last 7 days')}
        <Text {...NATIVE_TEXT.text4} wrap="truncate-end">
          No history yet: each turn's lines add up here by day.
        </Text>
      </Box>
    )
  }

  const added = days.map(day => day.added)
  const removed = days.map(day => day.removed)

  if (Svg) {
    const width = canvasWidth(kit)
    const source = barsSvg(
      [
        { values: added, color: T.ok, name: 'added' },
        { values: removed, color: T.err, name: 'removed' },
      ],
      days.map(day => F.weekday(day.day)),
      { width, height: CHART_HEIGHT },
      { title: width >= 640 ? 'Lines changed by agents · last 7 days' : 'Lines changed · 7 days' },
    )
    return (
      <Svg
        source={themed(source, width, CHART_HEIGHT)}
        alt={`Lines changed by agents over the last 7 days: ${days.map(day => `${F.weekday(day.day)} +${day.added} −${day.removed}`).join(', ')}`}
      />
    )
  }

  return (
    <Box flexDirection="column">
      {heading(kit, 'Lines changed by agents', 'last 7 days, a cell a day')}
      <Text wrap="truncate-end">
        <Text color={T.ok}>{F.sparkline(added)}</Text>
        <Text dimColor>{`  +${F.num(sum(added))} added`}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text color={T.err}>{F.sparkline(removed)}</Text>
        <Text dimColor>{`  −${F.num(sum(removed))} removed`}</Text>
      </Text>
    </Box>
  )
}
