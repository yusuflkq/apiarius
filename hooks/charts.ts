/**
 * Small SVG charts for the desktop's Stats tab: activity per minute and the
 * last days' output. Pure strings; the terminal draws sparklines instead.
 *
 * Each chart is laid out on a logical canvas about as wide as a pane (so its
 * text reads at a normal size) and declares a much larger width, so the
 * desktop scales it to fill whatever width the pane has, the height
 * following the aspect ratio. A background covers the whole canvas. The
 * same input gives the same string, so a redraw does not reload it.
 */

/** The width the markup declares: the surface draws it as wide as the pane allows. */
export const SVG_DRAWN_WIDTH = 2400

export const CHART = {
  bg: '#161824',
  grid: '#7f88a3',
  text: '#9aa3b8',
  title: '#c3cadb',
} as const

function esc(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
}

/** The `<svg>` open tag for a logical canvas of `width` by `height`, drawn `SVG_DRAWN_WIDTH` wide. */
export function svgOpen(width: number, height: number, extra = ''): string {
  const drawnHeight = Math.round((SVG_DRAWN_WIDTH * height) / width)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${SVG_DRAWN_WIDTH}" height="${drawnHeight}" preserveAspectRatio="xMidYMid meet"${extra}>`
}

export type BarSeries = { values: readonly number[]; color: string; name: string }

const memo = new Map<string, string>()

/**
 * Grouped bars over equal slots, with a light baseline grid, a legend and
 * an optional label under every `labelEvery`-th slot, on a logical canvas of
 * `size` (about 900 wide reads well).
 */
export function barsSvg(
  series: readonly BarSeries[],
  labels: readonly string[],
  size: { width: number; height: number },
  options: { labelEvery?: number; title?: string } = {},
): string {
  const key = JSON.stringify([series, labels, size, options])
  const known = memo.get(key)
  if (known !== undefined) return known

  const { width, height } = size
  const left = 40
  const right = 16
  const top = options.title ? 36 : 14
  const bottom = 28
  const slots = Math.max(1, ...series.map(one => one.values.length))
  const max = Math.max(1, ...series.flatMap(one => [...one.values]))
  const plotW = width - left - right
  const plotH = height - top - bottom
  const slotW = plotW / slots
  const barW = Math.max(2, (slotW * 0.74) / Math.max(1, series.length))
  const every = options.labelEvery ?? 1
  const parts: string[] = []

  for (let i = 0; i <= 2; i++) {
    const y = top + plotH - (plotH * i) / 2
    const value = Math.round((max * i) / 2)
    parts.push(`<line x1="${left}" x2="${width - right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${CHART.grid}" stroke-opacity=".22"/>`)
    parts.push(`<text x="${left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${CHART.text}">${value}</text>`)
  }

  series.forEach((one, s) => {
    one.values.forEach((value, i) => {
      if (value <= 0) return
      const h = Math.max(2, (value / max) * plotH)
      const x = left + i * slotW + (slotW - barW * series.length) / 2 + s * barW
      const y = top + plotH - h
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${one.color}"/>`)
    })
  })

  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return
    const x = left + i * slotW + slotW / 2
    parts.push(`<text x="${x.toFixed(1)}" y="${height - 9}" text-anchor="middle" font-size="12" fill="${CHART.text}">${esc(label)}</text>`)
  })

  const legend = series
    .map((one, i) => `<g transform="translate(${width - right - 120 * (series.length - i)} 14)"><rect width="12" height="12" rx="3" fill="${one.color}"/><text x="18" y="11" font-size="13" fill="${CHART.text}">${esc(one.name)}</text></g>`)
    .join('')

  const title = options.title ? `<text x="${left}" y="25" font-size="15" font-weight="600" fill="${CHART.title}">${esc(options.title)}</text>` : ''

  const svg = [
    svgOpen(width, height, ` font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"`),
    `<rect width="${width}" height="${height}" fill="${CHART.bg}"/>`,
    title,
    legend,
    parts.join(''),
    '</svg>',
  ].join('')

  if (memo.size >= 12) memo.delete(memo.keys().next().value as string)
  memo.set(key, svg)
  return svg
}
