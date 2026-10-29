/**
 * The deck's colours, as the web deck's (web/app.css,
 * web/app.js), so the pane, the terminal and the page look alike: neutral
 * greys for structure, colour only for status, the status glyphs; and the
 * web's small shapes as SVG documents a desktop draws as images: a status
 * pill, an icon. The avatars are the deck's avatar library's
 * (web/avatars.mjs, drawn by ./look).
 *
 * Native Text and Box take these hex values as given. Nothing here paints
 * the pane's own background: the host's dark theme shows through.
 */
import type { V2Status } from '../../web'

/** The web deck's tokens, flattened to hex. */
export const P = {
  /** Names, values that lead. */
  text: '#fafafa',
  /** A target, a step's words: a little under `text`. */
  fg2: '#d9d9d9',
  /** Labels, the live call, verbs. */
  muted: '#a1a1a1',
  /** Times, model lines, counts. */
  muted2: '#737373',
  muted3: '#4d4d4d',
  /** A card's resting edge. */
  border: '#2a2a2a',
  /** The card ground the web mixes its tints over; for mixing only. */
  card: '#171717',
  run: '#3b82f6',
  wait: '#f59e0b',
  done: '#22c55e',
  fail: '#ef4444',
  idle: '#a8aeb2',
  runText: '#60a5fa',
  waitText: '#fbbf24',
  doneText: '#4ade80',
  failText: '#f87171',
  /** What needs you: its title and its notes. */
  waitTitle: '#fef3c7',
  waitNote: '#fde68a',
  /** A chip's ground: a question's header, a code span. */
  chip: '#262626',
  /** The pane's own ground as the desktop's dark theme draws it: for mixing only. */
  ground: '#1a1a1a',
  /** An idle agent's status dot (the web's `.avd-dot.hue-idle`). */
  idleDot: '#6b7075',
  /** A card's edge under the pointer, for a status with no hue of its own. */
  borderStrong: '#4a4a4a',
  /** An agent card's step box: a shade lighter than the pane, and its soft edge. */
  stepBox: '#212121',
  stepEdge: '#2e2e2e',
  /** A list row under the pointer: the web's hover wash over the pane. */
  rowHover: '#222222',
  /** An agent's words in its log: a shade off the list's ground, so they stand apart from its calls. */
  saidBox: '#1d1d1d',
} as const

/** `a` blended toward `b` by `t` (0 is all `a`, 1 all `b`), as hex: how the web's translucent edges flatten here. */
export function mix(a: string, b: string, t: number): string {
  const read = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
  const x = read(a)
  const y = read(b)
  return `#${x.map((one, i) => Math.round(one + ((y[i] ?? one) - one) * t).toString(16).padStart(2, '0')).join('')}`
}

/**
 * What a status is drawn in: its hue (the dot), its pill (dark tint behind
 * the hue's light text), an agent card's edge at rest and under the pointer,
 * its word.
 */
export type Tone = { hue: string; pillBg: string; pillFg: string; edge: string; hot: string; word: string }

const RUN: Tone = { hue: P.run, pillBg: '#172554', pillFg: P.runText, edge: mix(P.run, P.card, 0.5), hot: P.run, word: 'running' }

/** Each status's tone: running and waiting cards carry their hue's edge, a failed one a red edge, the rest grey; every card lights in its hue under the pointer. */
export const TONE: Readonly<Record<V2Status, Tone>> = {
  running: RUN,
  starting: { ...RUN, word: 'starting' },
  waiting: { hue: P.wait, pillBg: '#451a03', pillFg: P.waitText, edge: mix(P.wait, P.card, 0.5), hot: P.wait, word: 'waiting' },
  done: { hue: P.done, pillBg: '#052e16', pillFg: P.doneText, edge: P.border, hot: mix(P.done, P.card, 0.35), word: 'done' },
  failed: { hue: P.fail, pillBg: '#450a0a', pillFg: P.failText, edge: mix(P.fail, P.card, 0.55), hot: P.fail, word: 'failed' },
  idle: { hue: P.idleDot, pillBg: '#262626', pillFg: P.idle, edge: P.border, hot: P.borderStrong, word: 'idle' },
}

/** The tone of a status the state names; idle for one it does not. */
export function toneOf(status: string): Tone {
  return TONE[status as V2Status] ?? TONE.idle
}

/** The glyphs of the web's status family (web/app.js GLYPH): a plan item's, a call's. */
export type GlyphName = 'done' | 'active' | 'failed' | 'waiting' | 'idle' | 'pending'

/** The idle and pending glyphs' grey: the idle hue at 62%, as the web's `.glyph.hue-idle`. */
const IDLE_INK = mix(P.idle, P.ground, 0.38)

/** Each glyph: its icon where Svg draws, and the character the terminal draws in its place. */
export const GLYPH: Readonly<Record<GlyphName, { icon: IconName; hue: string; mark: string }>> = {
  done: { icon: 'circleCheck', hue: P.done, mark: '✓' },
  active: { icon: 'progress', hue: P.run, mark: '◐' },
  failed: { icon: 'circleX', hue: P.fail, mark: '✕' },
  waiting: { icon: 'circlePause', hue: P.wait, mark: '‖' },
  idle: { icon: 'circleDashed', hue: IDLE_INK, mark: '◌' },
  pending: { icon: 'circle', hue: IDLE_INK, mark: '○' },
}

/** A glyph by name; pending for a name the family does not hold. */
export function glyphOf(name: string): { icon: IconName; hue: string; mark: string } {
  return GLYPH[name as GlyphName] ?? GLYPH.pending
}

const shapeMemo = new Map<string, string>()

/** `make()` once per `key` while the module lives (the newest 200 kept): the same shape gives the same string, so its image is never drawn anew. */
function memo(key: string, make: () => string): string {
  const known = shapeMemo.get(key)
  if (known !== undefined) return known
  const made = make()
  if (shapeMemo.size >= 200) shapeMemo.delete(shapeMemo.keys().next().value as string)
  shapeMemo.set(key, made)
  return made
}

/** Words for an SVG document, its markup characters escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

/** A status pill's height in CSS px, as the web's `.pill`. */
export const PILL_HEIGHT = 20

/** A status pill's width in CSS px: its word at 12 px (about 6 px a letter) with 9 px and the ring either side. */
export function pillWidth(word: string): number {
  return Math.max(44, Math.min(80, Math.ceil(Array.from(word).length * 6.2 + 20)))
}

/**
 * A status pill as the web draws it (`.pill`): its word in `hue` lifted
 * toward white, on an 18% wash of the hue, ringed in it at 48%, fully
 * rounded, the word centred. It names no font, so the desktop draws the
 * word in its own.
 */
export function pillSvg(word: string, hue: string): string {
  const width = pillWidth(word)
  const height = PILL_HEIGHT
  return memo(`pill|${word}|${hue}`, () =>
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="${(height - 1) / 2}" fill="${hue}" fill-opacity=".18" stroke="${hue}" stroke-opacity=".48"/>`,
      `<text x="${width / 2}" y="14" text-anchor="middle" font-size="12" font-weight="500" fill="${mix(hue, '#ffffff', 0.22)}">${esc(word)}</text>`,
      '</svg>',
    ].join(''),
  )
}

/** The px a tag of `word` takes across: its words at 11 px and 8 px either side, as the web's `.tag`. */
export function tagWidth(word: string): number {
  return Math.round(Array.from(word).length * 6.4 + 18)
}

/** A tag as the web's `.tag-wait` (a file more than one agent edited, "shared"): its word in amber on a 12% amber wash, fully rounded, 20 px high. */
export function tagSvg(word: string): string {
  const width = tagWidth(word)
  const height = 20
  return memo(`tag|${word}`, () =>
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" rx="${height / 2}" fill="${P.wait}" fill-opacity=".12"/>`,
      `<text x="${width / 2}" y="14" text-anchor="middle" font-size="11" font-weight="500" fill="${P.waitText}">${esc(word)}</text>`,
      '</svg>',
    ].join(''),
  )
}

/** A divider between a list's rows, as the web's `.list` rule: a line 1 px high in `color`, drawn wider than any slot so it fills the one it is given. */
export function ruleSvg(color: string): string {
  return memo(`rule|${color}`, () => `<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="1" viewBox="0 0 4096 1" preserveAspectRatio="none"><rect width="4096" height="1" fill="${color}"/></svg>`)
}

// The web's icons (web/app.js IC: Lucide-style 24 px strokes) the deck draws.

/** The icon names the deck draws. */
export type IconName =
  | 'help'
  | 'shield'
  | 'bell'
  | 'circleCheck'
  | 'circle'
  | 'circleX'
  | 'circlePause'
  | 'circleDashed'
  | 'progress'
  | 'bot'
  | 'listChecks'
  | 'dollar'
  | 'hand'
  | 'file'
  | 'chevronRight'
  | 'chevronDown'
  | 'said'
  | 'thought'
  | 'eye'
  | 'pencil'
  | 'filePlus'
  | 'terminal'
  | 'search'
  | 'folder'
  | 'globe'
  | 'message'
  | 'sparkles'
  | 'wrench'
  | 'arrowRight'
  | 'arrowUp'
  | 'arrowDown'

const ICONS: Readonly<Record<IconName, string>> = {
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  circlePause: '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>',
  circleDashed:
    '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  progress: '<circle cx="12" cy="12" r="10" pathLength="100" stroke-dasharray="78 22"/>',
  // Now's figures, each at its right, and its Files list
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  // an agent's words between its calls (a speech bubble), and its thinking as Claude Code shows it (a cloud)
  said: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  thought: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  // a tool call's chip (the web's TOOL_ICON), and an agent page's Message, Chat with and the links between its calls and its edits
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
}

/** An icon as a whole SVG document, its strokes in `color`, `px` CSS pixels square. */
export function iconSvg(name: IconName, color: string, px: number): string {
  return memo(`icon|${name}|${color}|${px}`, () => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`)
}

/** Each tool's icon on its chip, as the web's TOOL_ICON; a wrench for any other. */
const TOOL_ICON: Readonly<Record<string, IconName>> = {
  Read: 'eye',
  Edit: 'pencil',
  MultiEdit: 'pencil',
  NotebookEdit: 'pencil',
  Write: 'filePlus',
  Bash: 'terminal',
  PowerShell: 'terminal',
  Grep: 'search',
  Glob: 'folder',
  WebFetch: 'globe',
  WebSearch: 'globe',
  Agent: 'bot',
  Task: 'bot',
  SendMessage: 'message',
  TodoWrite: 'listChecks',
  TaskCreate: 'listChecks',
  TaskUpdate: 'listChecks',
  TaskGet: 'listChecks',
  TaskList: 'listChecks',
  ToolSearch: 'search',
  Skill: 'sparkles',
  AskUserQuestion: 'help',
}

/** The icon on tool `tool`'s chip: the web's, a wrench for a tool it names none for. */
export function toolIconOf(tool: string): IconName {
  return TOOL_ICON[tool] ?? 'wrench'
}

/** A tool chip's height in CSS px, as the web's `.tooltag`. */
export const TOOL_TAG_HEIGHT = 20

/** A tool chip's width in CSS px: 7 px of padding, its 12 px icon and a gap, its name at 11.5 px of a monospaced face (about 7 px a letter), and 7 px. */
export function toolTagWidth(tool: string): number {
  return Math.ceil(7 + 12 + 5 + Array.from(tool).length * 6.9 + 7)
}

/**
 * A tool call's chip as the web draws it (`.tooltag`): the tool's icon, dim,
 * then its name in a monospaced face, on a faint ground ringed in the cards'
 * edge, rounded.
 */
export function toolTagSvg(tool: string): string {
  const width = toolTagWidth(tool)
  const height = TOOL_TAG_HEIGHT
  return memo(`tooltag|${tool}`, () =>
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="5.5" fill="#ffffff" fill-opacity=".03" stroke="#ffffff" stroke-opacity=".09"/>`,
      `<g transform="translate(7 4) scale(.5)" fill="none" stroke="${P.muted}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[toolIconOf(tool)]}</g>`,
      `<text x="24" y="14" font-family="Cascadia Mono, Consolas, ui-monospace, monospace" font-size="11.5" font-weight="500" fill="${P.fg2}">${esc(tool)}</text>`,
      '</svg>',
    ].join(''),
  )
}
