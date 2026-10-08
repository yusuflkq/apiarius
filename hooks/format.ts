/**
 * Small formatting helpers shared by the views: durations, counts, money,
 * one-line text, and the block-character sparklines the terminal draws.
 *
 * Times are coarse on purpose (no seconds past a minute), so a redraw that
 * changes nothing else draws the same text and nothing on screen moves.
 */

const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** How long ago, to the minute: "just now", "3m ago", "2h ago", "4d ago". */
export function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** The same as a short column: "now", "3m", "2h", "4d". */
export function since(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** A duration: seconds under a minute, whole minutes under an hour, then hours and minutes. */
export function dur(ms: number): string {
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export function num(n: number): string {
  const a = Math.abs(n)
  if (a < 1000) return String(Math.round(n))
  if (a < 1_000_000) return `${(n / 1000).toFixed(a < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(a < 10_000_000 ? 2 : 1)}M`
}

export function money(usd: number | undefined): string {
  if (usd === undefined) return '—'
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(1)}`
}

/** Collapses whitespace and strips control characters so text fits one row. */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The first line of text that says something, on one row: markdown's
 * heading, list and quote marks and bold stars dropped.
 */
export function firstLine(text: string): string {
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~|---+\s*$)/.test(raw)) continue
    const line = oneLine(raw.replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+)/, '').replace(/\*\*|__|`/g, ''))
    if (line !== '') return line
  }
  return ''
}

/** A model id without the vendor prefix and date: `claude-haiku-4-5-20251001` is `haiku-4-5`. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[[^\]]*\]$/, '')
}

/** Removes control characters a Text leaf may not hold, keeping newlines and tabs. */
export function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

export function trunc(text: string, max: number): string {
  if (max <= 1) return text.slice(0, Math.max(0, max))
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** Cuts from the left, so the end of a path stays readable. */
export function truncStart(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `…${chars.slice(chars.length - max + 1).join('')}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`
}

export function sparkline(values: readonly number[]): string {
  const max = Math.max(0, ...values)
  if (max === 0) return values.map(() => '·').join('')
  return values
    .map(v => (v <= 0 ? '·' : SPARKS[Math.min(7, Math.floor((v / max) * 7.999))] ?? '█'))
    .join('')
}

export function bar(value: number, max: number, width: number): string {
  if (max <= 0 || width <= 0) return ''
  const cells = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width))
  return '█'.repeat(cells) + '░'.repeat(Math.max(0, width - cells))
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function weekday(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()] ?? day
}

/** A stable small hash of a string, for deterministic jitter and color picks. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
