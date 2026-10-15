/**
 * The native dashboard's colours and avatars, taken from the web deck
 * (web/app.css, web/app.js) so the pane and the page look alike: neutral
 * greys for structure, colour only for status, tinted pills, and the ten
 * gradient persona avatars (a gumdrop with a small face, indexed by
 * `WebAgent.avatar`).
 *
 * Native Text and Box take these hex values as given. Nothing here paints
 * the pane's own background: the host's dark theme shows through.
 */
import type { WebStatus } from '../../web'

/** The web deck's tokens, flattened to hex. */
export const P = {
  /** Names, values that lead. */
  text: '#fafafa',
  /** A target, a step's words: a little under `text`. */
  fg2: '#d9d9d9',
  /** Labels, the now line, verbs. */
  muted: '#a1a1a1',
  /** Times, model lines, counts. */
  muted2: '#737373',
  muted3: '#4d4d4d',
  /** A card's resting edge. */
  border: '#2a2a2a',
  /** A card's edge under the pointer, for a status with no hue of its own. */
  borderStrong: '#4a4a4a',
  /** A pending plan step's track. */
  track: '#2e2e2e',
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
  /** A question's header chip. */
  chip: '#262626',
} as const

/** `a` blended toward `b` by `t` (0 is all `a`, 1 all `b`), as hex: how the web's translucent edges flatten here. */
export function mix(a: string, b: string, t: number): string {
  const read = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
  const x = read(a)
  const y = read(b)
  return `#${x.map((one, i) => Math.round(one + ((y[i] ?? one) - one) * t).toString(16).padStart(2, '0')).join('')}`
}

/** What a status is drawn in: its hue, its pill (dark tint behind the hue's light text), its card edge at rest and under the pointer, its word. */
export type Tone = { hue: string; pillBg: string; pillFg: string; edge: string; hot: string; word: string }

const RUN: Tone = { hue: P.run, pillBg: '#172554', pillFg: P.runText, edge: mix(P.run, P.card, 0.5), hot: P.run, word: 'running' }

/** Each status's tone: running and waiting cards carry their hue's edge, a failed one a red edge, the rest grey; every card lights in its hue under the pointer. */
export const TONE: Readonly<Record<WebStatus, Tone>> = {
  running: RUN,
  starting: { ...RUN, word: 'starting' },
  waiting: { hue: P.wait, pillBg: '#451a03', pillFg: P.waitText, edge: mix(P.wait, P.card, 0.5), hot: P.wait, word: 'waiting' },
  done: { hue: P.done, pillBg: '#052e16', pillFg: P.doneText, edge: P.border, hot: mix(P.done, P.card, 0.35), word: 'done' },
  failed: { hue: P.fail, pillBg: '#450a0a', pillFg: P.failText, edge: mix(P.fail, P.card, 0.55), hot: P.fail, word: 'failed' },
  idle: { hue: P.idle, pillBg: '#262626', pillFg: P.idle, edge: P.border, hot: P.borderStrong, word: 'idle' },
}

/** The tone of a status the state names; idle for one it does not. */
export function toneOf(status: string): Tone {
  return TONE[status as WebStatus] ?? TONE.idle
}

/** A plan step's segment colour: done green, in hand blue, failed red, not started the grey track. */
export const STEP_HUE: Readonly<Record<string, string>> = { done: P.done, active: P.run, failed: P.fail, pending: P.track }

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

const avatarMemo = new Map<string, string>()

/**
 * One avatar as a whole SVG document: the gradient gumdrop with its sheen
 * and face (eyes and a smile, light on a dark gradient, dark on a light one),
 * `px` CSS pixels square; with `dot`, a status dot at its foot as the web's
 * cards draw it, ringed in the card ground. Each document carries its own
 * gradients: it is drawn as an image of its own.
 */
export function avatarSvg(avatar: number, px: number, dot?: string): string {
  const i = avatarIndex(avatar)
  const key = `${i}|${px}|${dot ?? ''}`
  const known = avatarMemo.get(key)
  if (known !== undefined) return known
  const [top, bottom] = AVATARS[i] ?? ['#888888', '#444444']
  const face = (luminance(top) + luminance(bottom)) / 2 < 0.18 ? 'rgba(255,255,255,.92)' : 'rgba(23,23,28,.82)'
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
    '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>',
    `<path d="${BLOB}" fill="url(#g)"/><path d="${BLOB}" fill="url(#s)"/>`,
    `<circle cx="12.3" cy="16.4" r="1.45" fill="${face}"/><circle cx="19.7" cy="16.4" r="1.45" fill="${face}"/>`,
    `<path d="M14.3 20.3q1.7 1.3 3.4 0" fill="none" stroke="${face}" stroke-width="1.2" stroke-linecap="round"/>`,
    dot ? `<circle cx="27" cy="27.5" r="4.6" fill="${dot}" stroke="${P.card}" stroke-width="2.4"/>` : '',
    '</svg>',
  ].join('')
  if (avatarMemo.size >= 120) avatarMemo.delete(avatarMemo.keys().next().value as string)
  avatarMemo.set(key, svg)
  return svg
}

/**
 * The plan's progress bar as an SVG document: one rounded segment a step in
 * its status colour, `width` logical px across (the slot's cells times 8,
 * as Stats lays its images out: the desktop scales it to fill the slot) and
 * 8 high, so it reads as the web's thin segmented bar.
 */
export function stepsSvg(statuses: readonly string[], width: number): string {
  const n = Math.max(1, statuses.length)
  const gap = 4
  const height = 8
  const seg = (width - gap * (n - 1)) / n
  const rects = statuses.map((status, i) => {
    const x = Math.round(i * (seg + gap) * 10) / 10
    return `<rect x="${x}" y="1" width="${Math.max(1, Math.round(seg * 10) / 10)}" height="6" rx="3" fill="${STEP_HUE[status] ?? P.track}"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects.join('')}</svg>`
}

/**
 * A progress bar as an SVG document, as the web's checklist draws it: a
 * thin rounded track with `done` of `total` filled, blue while some are
 * left and green once all are done; `width` logical px across (the slot's
 * cells times 8: the desktop scales it to fill the slot), 8 high.
 */
export function barSvg(done: number, total: number, width: number): string {
  const height = 8
  const fraction = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  const fill = Math.round(width * fraction * 10) / 10
  const hue = total > 0 && done >= total ? P.done : P.run
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="2" width="${width}" height="4" rx="2" fill="${P.track}"/>`,
    fill > 0 ? `<rect x="0" y="2" width="${Math.max(4, fill)}" height="4" rx="2" fill="${hue}"/>` : '',
    '</svg>',
  ].join('')
}

// The web's icons (web/app.js IC: Lucide-style 24 px strokes) the dashboard draws.

const ICONS: Readonly<Record<string, string>> = {
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  octagon: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  cornerDownRight: '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
}

/** The icon names the dashboard draws. */
export type IconName = 'help' | 'shield' | 'target' | 'hand' | 'octagon' | 'circleCheck' | 'bot' | 'listChecks' | 'dollar' | 'cornerDownRight' | 'cpu' | 'coins' | 'diff' | 'wrench' | 'file'

const iconMemo = new Map<string, string>()

/** An icon as a whole SVG document, its strokes in `color`, `px` CSS pixels square. */
export function iconSvg(name: IconName, color: string, px: number): string {
  const key = `${name}|${color}|${px}`
  const known = iconMemo.get(key)
  if (known !== undefined) return known
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`
  if (iconMemo.size >= 60) iconMemo.delete(iconMemo.keys().next().value as string)
  iconMemo.set(key, svg)
  return svg
}
