/**
 * How the deck's screens word figures and fit text: coarse ages and spans,
 * counts, cuts and folds, and how much room text takes where it is drawn (a
 * cell a character on the terminal; less, and by the letter, in a desktop's
 * proportional face). The v2 state words most of what it says itself
 * (web/CONTRACT.md v2: a row's `elapsed`, a need's `age`); these are for
 * what it leaves to a surface (a chat row's time, a call's length).
 *
 * Pure.
 */

/** A coarse age: "now", "4m", "2h", "3d". */
export function ago(at: number, now: number): string {
  if (!at) return ''
  const s = Math.max(0, (now - at) / 1000)
  if (s < 45) return 'now'
  const m = Math.max(1, Math.floor(s / 60))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/** A coarse duration: "<1m", "4m", "1h 12m", "2d 3h". */
export function span(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

/** 842, 4.2k, 48k, 1.2M. */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n < 1e5) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1e6) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

/** The session's spend, "≈$6.42": /cost's estimate at API list prices, never a bill; "—" while it is not known. */
export function usd(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `≈$${x.toFixed(2)}`
}

/** A call's time: "840ms", "2.4s", "12s", then minutes; '' when not known. */
export function msText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return span(ms)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** `text` cut to `max` characters with an ellipsis. */
export function cut(text: string, max: number): string {
  const chars = Array.from(text)
  if (max <= 1) return chars.slice(0, Math.max(0, max)).join('')
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** One line: control characters and runs of white space become one space. */
export function flat(text: string): string {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `text` folded to about `rows` rows of a column `width` cells wide, as a
 * wrapping Text lays it out (its own lines kept, each taking a row or more),
 * and whether anything was left out. A line cut part way ends in "…".
 */
export function foldText(text: string, width: number, rows: number): { text: string; isCut: boolean } {
  const perRow = Math.max(2, Math.floor(width) - 2)
  const lines = String(text ?? '').split('\n')
  const shown: string[] = []
  let left = Math.max(1, rows)
  for (const [i, line] of lines.entries()) {
    const need = Math.max(1, Math.ceil(Array.from(line).length / perRow))
    if (need > left) {
      shown.push(cut(line, Math.max(2, left * perRow)))
      return { text: shown.join('\n'), isCut: true }
    }
    shown.push(line)
    left -= need
    if (left === 0 && i < lines.length - 1) return { text: shown.join('\n'), isCut: lines.slice(i + 1).some(rest => rest.trim() !== '') }
  }
  return { text: shown.join('\n'), isCut: false }
}

// How much room text takes.

/** The cells one character takes where it is drawn. */
export type Advance = (ch: string) => number

/** A monospace surface's: a cell a character, as the terminal draws them. */
export const monoAdvance: Advance = () => 1

/** Code points a proportional face draws two cells wide: the wide East Asian scripts and the emoji. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/**
 * The desktop's UI face, Anthropic Sans at 13 px: each printable ASCII
 * character's advance from " " to "~", in widths of its "0" (the desktop's
 * cell, `1ch`), as measured from the face the Desktop app ships, each rounded up.
 */
const UI_ASCII =
  '.36 .4 .68 1.06 .87 1.65 1.14 .4 .67 .67 .81 1.06 .4 .6 .4 .56 1 .62 .97 .93 1.02 .94 .95 .89 .93 .95 .4 .4 1.06 1.06 1.06 .9 1.45 1.22 1.09 1.27 1.23 1.06 .99 1.32 1.23 .46 .9 1.14 .96 1.56 1.31 1.36 1.02 1.36 1.13 .98 .96 1.21 1.22 1.68 1.12 1.13 1.1 .67 .56 .67 1.06 .83 .83 .91 1.03 .92 1.03 .96 .66 .92 .99 .42 .42 .94 .42 1.45 .99 .97 1.03 1.03 .67 .85 .66 .98 .94 1.37 .95 .95 .84 .67 .51 .67 1.06'
    .split(' ')
    .map(Number)

/** The same for the marks the deck writes beyond ASCII. */
const UI_MORE: Readonly<Record<string, number>> = { '·': 0.4, '→': 1.36, '←': 1.36, '↑': 1, '↓': 1, '…': 1.66, '—': 1.66, '–': 0.83, '◐': 1.41, '✕': 1.36, '✓': 1.24, '‖': 0.47, '•': 0.83, '●': 1, '−': 1.06, '▸': 0.8, '▾': 0.8, '“': 0.68, '”': 0.68, '’': 0.4, '‘': 0.4 }

/**
 * A desktop's: its UI face is proportional and its cell is that face's "0",
 * so a space takes about a third of a cell and an m nearly one and a half.
 * ASCII and the deck's own marks as measured; East Asian scripts and emoji
 * two cells; any other letter about one.
 */
export const uiAdvance: Advance = ch => {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 32 && code < 127) return UI_ASCII[code - 32] ?? 1
  return UI_MORE[ch] ?? (isWide(code) ? 2 : 1.05)
}

/** The cells `text` takes, each character as `advance` has it. */
export function cellsOf(text: string, advance: Advance = monoAdvance): number {
  let cells = 0
  for (const ch of Array.from(String(text ?? ''))) cells += advance(ch)
  return cells
}

/** `text` cut with an ellipsis to fit `cells`, each character as `advance` has it; as `cut` on a monospace surface. */
export function cutCells(text: string, cells: number, advance: Advance = monoAdvance): string {
  if (cellsOf(text, advance) <= cells) return text
  const dots = advance('…')
  const kept: string[] = []
  let used = 0
  for (const ch of Array.from(text)) {
    const next = advance(ch)
    if (used + next + dots > cells) break
    kept.push(ch)
    used += next
  }
  if (kept.length === 0) return used + dots <= cells ? '…' : ''
  return `${kept.join('').trimEnd()}…`
}
