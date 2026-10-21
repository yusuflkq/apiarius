/**
 * The deck's colours and avatars, as the web deck's (web/app.css,
 * web/app.js), so the pane, the terminal and the page look alike: neutral
 * greys for structure, colour only for status, the status glyphs, and the
 * ten gradient persona avatars (a gumdrop with a small face, indexed by a
 * row's `avatar`); and the web's small shapes as SVG documents a desktop
 * draws as images: a status pill, an icon.
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

// The avatars (web/app.js: AV, BLOB, AV_HTML).

/** Paperclip's ten persona gradients, top colour then bottom. */
export const AVATARS: readonly (readonly [string, string])[] = [
  ['#f7cfdc', '#1f7a3a'],
  ['#c9a9e8', '#ee79a1'],
  ['#28164b', '#7a1530'],
  ['#f3e6c4', '#e3a21a'],
  ['#1f4dd6', '#3aa35c'],
  ['#e94b27', '#5a1122'],
  ['#7eb6e3', '#ee79a1'],
  ['#9ce8a7', '#bd7ff0'],
  ['#f3b49e', '#1f4ed4'],
  ['#f2d95f', '#4fbcba'],
]

/** The gumdrop's outline on a 32 by 32 grid. */
const BLOB = 'M16 2.6c7.1 0 12.4 5.3 12.4 12.4v9.2a5.2 5.2 0 0 1-5.2 5.2H8.8a5.2 5.2 0 0 1-5.2-5.2V15C3.6 7.9 8.9 2.6 16 2.6z'

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0)
}

/** An avatar index as the state gives it, folded into 0 to 9. */
export function avatarIndex(avatar: number): number {
  const i = Math.trunc(Number(avatar) || 0) % AVATARS.length
  return i < 0 ? i + AVATARS.length : i
}

/** The colour that stands for an avatar where no image draws (the terminal): its gradient's middle. */
export function avatarColor(avatar: number): string {
  const [top, bottom] = AVATARS[avatarIndex(avatar)] ?? ['#888888', '#444444']
  return mix(top, bottom, 0.5)
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

/**
 * One avatar as a whole SVG document: the gradient gumdrop with its sheen
 * and face (eyes and a smile, light on a dark gradient, dark on a light one),
 * `px` CSS pixels square; with `dot`, a status dot at its foot as the web's
 * rows draw it, ringed in the pane's ground. Each document carries its own
 * gradients: it is drawn as an image of its own.
 */
export function avatarSvg(avatar: number, px: number, dot?: string): string {
  const i = avatarIndex(avatar)
  return memo(`avatar|${i}|${px}|${dot ?? ''}`, () => {
    const [top, bottom] = AVATARS[i] ?? ['#888888', '#444444']
    const face = (luminance(top) + luminance(bottom)) / 2 < 0.18 ? 'rgba(255,255,255,.92)' : 'rgba(23,23,28,.82)'
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">`,
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
      '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>',
      `<path d="${BLOB}" fill="url(#g)"/><path d="${BLOB}" fill="url(#s)"/>`,
      `<circle cx="12.3" cy="16.4" r="1.45" fill="${face}"/><circle cx="19.7" cy="16.4" r="1.45" fill="${face}"/>`,
      `<path d="M14.3 20.3q1.7 1.3 3.4 0" fill="none" stroke="${face}" stroke-width="1.2" stroke-linecap="round"/>`,
      dot ? `<circle cx="27" cy="27.5" r="4.6" fill="${dot}" stroke="${P.ground}" stroke-width="2.4"/>` : '',
      '</svg>',
    ].join('')
  })
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

/** The px a stack of `n` faces `px` square takes across: each after the first 5 px over the one before. */
export function stackWidth(n: number, px: number): number {
  return n <= 0 ? 0 : px + (n - 1) * (px - 5)
}

/**
 * The editors' faces stacked as the web's `.stack`: each `px` square, each
 * after the first 5 px over the one before, ringed in the pane's ground so
 * they read apart; an editor the state does not hold (null) a grey disc, as
 * the web's ghost. One document, a gradient a face.
 */
export function stackSvg(avatars: readonly (number | null)[], px: number): string {
  const indices = avatars.map(one => (one === null ? null : avatarIndex(one)))
  return memo(`stack|${px}|${indices.map(i => i ?? '-').join(',')}`, () => {
    const width = stackWidth(indices.length, px)
    const scale = px / 32
    const ring = (3 / scale).toFixed(2)
    const stops = indices.map((i, j) => {
      const [top, bottom] = (i === null ? undefined : AVATARS[i]) ?? ['#888888', '#444444']
      return `<linearGradient id="g${j}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`
    })
    const faces = indices.map((i, j) => {
      if (i === null) return `<g transform="translate(${j * (px - 5)} 0) scale(${scale})"><circle cx="16" cy="16" r="12.4" fill="#262626" stroke="${P.ground}" stroke-width="${ring}" paint-order="stroke"/></g>`
      const [top, bottom] = AVATARS[i] ?? ['#888888', '#444444']
      const ink = (luminance(top) + luminance(bottom)) / 2 < 0.18 ? 'rgba(255,255,255,.92)' : 'rgba(23,23,28,.82)'
      return [
        `<g transform="translate(${j * (px - 5)} 0) scale(${scale})">`,
        `<path d="${BLOB}" fill="url(#g${j})" stroke="${P.ground}" stroke-width="${ring}" paint-order="stroke"/><path d="${BLOB}" fill="url(#s)"/>`,
        `<circle cx="12.3" cy="16.4" r="1.45" fill="${ink}"/><circle cx="19.7" cy="16.4" r="1.45" fill="${ink}"/>`,
        `<path d="M14.3 20.3q1.7 1.3 3.4 0" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linecap="round"/>`,
        '</g>',
      ].join('')
    })
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${px}" viewBox="0 0 ${width} ${px}">`,
      `<defs>${stops.join('')}<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`,
      faces.join(''),
      '</svg>',
    ].join('')
  })
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
}

/** An icon as a whole SVG document, its strokes in `color`, `px` CSS pixels square. */
export function iconSvg(name: IconName, color: string, px: number): string {
  return memo(`icon|${name}|${color}|${px}`, () => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`)
}
