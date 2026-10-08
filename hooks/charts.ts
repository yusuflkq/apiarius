/**
 * Small SVG charts for the desktop's overview: activity per minute and the
 * last days' output. Pure strings; the terminal draws sparklines instead.
 */

function esc(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
}

export type BarSeries = { values: readonly number[]; color: string; name: string }

/**
 * Grouped bars over equal slots, with a light baseline grid, a legend and
 * an optional label under every `labelEvery`-th slot.
 */
export function barsSvg(
  series: readonly BarSeries[],
  labels: readonly string[],
  size: { width: number; height: number },
  options: { labelEvery?: number; title?: string } = {},
): string {
  const { width, height } = size
  const left = 30
  const right = 10
  const top = options.title ? 26 : 10
  const bottom = 22
  const slots = Math.max(1, ...series.map(one => one.values.length))
  const max = Math.max(1, ...series.flatMap(one => [...one.values]))
  const plotW = width - left - right
  const plotH = height - top - bottom
  const slotW = plotW / slots
  const barW = Math.max(1.5, (slotW * 0.78) / Math.max(1, series.length))
  const every = options.labelEvery ?? 1
  const parts: string[] = []

  for (let i = 0; i <= 2; i++) {
    const y = top + plotH - (plotH * i) / 2
    const value = Math.round((max * i) / 2)
    parts.push(`<line x1="${left}" x2="${width - right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#7f88a3" stroke-opacity=".18"/>`)
    parts.push(`<text x="${left - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#8a93a8">${value}</text>`)
  }

  series.forEach((one, s) => {
    one.values.forEach((value, i) => {
      if (value <= 0) return
      const h = Math.max(1.5, (value / max) * plotH)
      const x = left + i * slotW + (slotW - barW * series.length) / 2 + s * barW
      const y = top + plotH - h
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${one.color}"><title>${esc(`${labels[i] ?? ''} ${one.name}: ${value}`)}</title></rect>`)
    })
  })

  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return
    const x = left + i * slotW + slotW / 2
    parts.push(`<text x="${x.toFixed(1)}" y="${height - 7}" text-anchor="middle" font-size="9" fill="#8a93a8">${esc(label)}</text>`)
  })

  const legend = series
    .map((one, i) => `<g transform="translate(${width - right - 90 * (series.length - i)} 12)"><rect width="9" height="9" rx="2" fill="${one.color}"/><text x="13" y="8" font-size="10" fill="#8a93a8">${esc(one.name)}</text></g>`)
    .join('')

  const title = options.title ? `<text x="${left}" y="15" font-size="11" font-weight="600" fill="#8a93a8">${esc(options.title)}</text>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-sans-serif,system-ui,'Segoe UI',sans-serif">${title}${legend}${parts.join('')}</svg>`
}
