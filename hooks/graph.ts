/**
 * The agent map, Obsidian style: you, the Orchestrator (the main loop),
 * every subagent and outside peer as nodes, spawns and messages as links
 * (files each agent edited as small satellite nodes), laid out by a force
 * simulation that warm-starts from the last layout so the picture stays put
 * as it grows, and spreads wide to match the canvas.
 *
 * Drawn as an interactive SVG for the desktop (hover a node to light its
 * links, tooltips, pulsing live agents, packets flowing along links that
 * carried a message lately) filling the pane's width, and as an indented
 * tree for the terminal.
 */
import type { DeckAgent, DeckData } from '../types'
import { svgOpen } from './charts'
import { baseName, hash, oneLine, trunc } from './format'
import { MAIN, YOU, isEnded, isLive, labelOf, linksOf, totalsOf } from './model'

export type GNodeKind = 'you' | 'main' | 'agent' | 'peer' | 'file'

export type GNode = {
  id: string
  kind: GNodeKind
  label: string
  color: string
  r: number
  isLive: boolean
  tip: string
  anchor?: string
}

export type GEdge = {
  a: string
  b: string
  kind: 'spawn' | 'talk' | 'file'
  ab: number
  ba: number
  isActive: boolean
  isWorking: boolean
}

export type Graph = { nodes: GNode[]; edges: GEdge[] }

export type Pt = { x: number; y: number }

export const ACTIVE_MS = 30_000

export const PALETTE = {
  you: '#f472b6',
  main: '#a78bfa',
  running: '#4ade80',
  waiting: '#facc15',
  done: '#60a5fa',
  failed: '#f87171',
  peer: '#fb923c',
  file: '#64748b',
  edge: '#3d4459',
  talk: '#8b7cf6',
  text: '#cdd6f4',
  dim: '#7f88a3',
  bg0: '#1c1e2b',
  bg1: '#11121a',
} as const

export function colorOf(agent: DeckAgent): string {
  if (agent.kind === 'you') return PALETTE.you
  if (agent.kind === 'main') return PALETTE.main
  if (agent.kind === 'peer') return PALETTE.peer
  if (agent.status === 'failed' || agent.status === 'killed') return PALETTE.failed
  if (agent.status === 'completed') return PALETTE.done
  if (agent.status === 'waiting' || agent.status === 'idle') return PALETTE.waiting
  return PALETTE.running
}

export function statusWord(agent: DeckAgent): string {
  if (agent.kind === 'you') return 'you'
  if (agent.kind === 'peer') return 'peer'
  switch (agent.status) {
    case 'completed':
      return 'done'
    case 'killed':
      return 'stopped'
    default:
      return agent.status
  }
}

/**
 * A node's tooltip: who it is and what it was asked, nothing that moves with
 * every tool call, so the drawing (and the frame showing it) stays the same
 * until something on the map changes. The Flow tab has the live numbers.
 */
function tipOf(agent: DeckAgent): string {
  const lines = [`${labelOf(agent)} · ${agent.kind === 'main' ? 'orchestrator' : agent.type}`]
  if (agent.kind !== 'you') lines.push(`status: ${statusWord(agent)}`)
  if (agent.description && agent.kind !== 'main' && agent.kind !== 'you') lines.push(`task: ${trunc(oneLine(agent.description), 80)}`)
  if (agent.model) lines.push(`model: ${agent.model}`)
  return lines.join('\n')
}

/** The line under the map: how many agents, messages and live ones. */
export function captionOf(data: DeckData): string {
  const totals = totalsOf(data)
  return `${totals.agents} agent${totals.agents === 1 ? '' : 's'} · ${totals.messages} message${totals.messages === 1 ? '' : 's'} · ${totals.live} live`
}

/** Nodes and links for the session as it stands; files only when `withFiles`. */
export function buildGraph(data: DeckData, now: number, withFiles: boolean): Graph {
  const nodes: GNode[] = []
  const edges = new Map<string, GEdge>()
  const ids = new Set<string>()

  for (const agent of data.agents) {
    const size =
      agent.kind === 'main' ? 18 : agent.kind === 'you' ? 14 : agent.kind === 'peer' ? 10 : 9 + Math.min(8, Math.round(Math.sqrt(agent.tools)))
    nodes.push({
      id: agent.id,
      kind: agent.kind === 'teammate' ? 'agent' : agent.kind,
      label: trunc(labelOf(agent), 22),
      color: colorOf(agent),
      r: size,
      isLive: agent.kind !== 'you' && agent.kind !== 'peer' && isLive(agent.status),
      tip: tipOf(agent),
      ...(agent.parentId ? { anchor: agent.parentId } : {}),
    })
    ids.add(agent.id)
  }

  const edgeOf = (a: string, b: string, kind: GEdge['kind']): GEdge => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const found = edges.get(key)
    if (found) return found
    const made: GEdge = { a, b, kind, ab: 0, ba: 0, isActive: false, isWorking: false }
    edges.set(key, made)
    return made
  }

  for (const agent of data.agents) {
    const parent = agent.parentId && ids.has(agent.parentId) ? agent.parentId : agent.kind === 'main' ? YOU : agent.kind === 'you' ? null : MAIN
    if (!parent || parent === agent.id) continue
    const edge = edgeOf(parent, agent.id, agent.kind === 'peer' ? 'talk' : 'spawn')
    edge.isWorking ||= agent.kind !== 'main' && isLive(agent.status)
  }

  for (const link of linksOf(data).values()) {
    if (!ids.has(link.a) || !ids.has(link.b)) continue
    const edge = edgeOf(link.a, link.b, 'talk')
    const isForward = edge.a === link.a
    edge.ab += isForward ? link.ab : link.ba
    edge.ba += isForward ? link.ba : link.ab
    const isChat = (link.kinds.message ?? 0) + (link.kinds.chat ?? 0) > 0
    if (isChat) edge.kind = 'talk'
    edge.isActive ||= now - link.last < ACTIVE_MS
  }

  if (withFiles) {
    const labels = new Map(nodes.map(node => [node.id, node.label]))
    const recent = new Map<string, { path: string; agents: Set<string>; last: number; count: number }>()
    for (const edit of data.edits) {
      const entry = recent.get(edit.path) ?? { path: edit.path, agents: new Set<string>(), last: 0, count: 0 }
      entry.agents.add(edit.agent)
      entry.last = Math.max(entry.last, edit.at)
      entry.count += 1
      recent.set(edit.path, entry)
    }
    const files = [...recent.values()].sort((x, y) => y.last - x.last).slice(0, 36)
    for (const file of files) {
      const id = `file:${file.path}`
      const owners = [...file.agents].filter(agent => ids.has(agent))
      if (owners.length === 0) continue
      nodes.push({
        id,
        kind: 'file',
        label: trunc(baseName(file.path), 18),
        color: PALETTE.file,
        r: 4 + Math.min(3, Math.round(file.count / 2)),
        isLive: false,
        tip: `${file.path}\nedited by ${owners.map(owner => labels.get(owner) ?? owner).join(', ')}`,
        anchor: owners[0] ?? MAIN,
      })
      ids.add(id)
      for (const owner of owners) {
        const edge = edgeOf(owner, id, 'file')
        edge.isActive ||= now - file.last < ACTIVE_MS
      }
    }
  }

  return { nodes, edges: [...edges.values()] }
}

/** A key that changes only when the graph's shape does (not its colors). */
export function shapeKeyOf(graph: Graph): string {
  return `${graph.nodes.map(node => node.id).join(',')}#${graph.edges.map(edge => `${edge.a}-${edge.b}`).join(',')}`
}

/** The ideal length of a link, in the layout's units. */
export const LINK_LENGTH = 120

/**
 * Pull towards the middle on each axis: weaker across than down, so the
 * layout spreads about as wide as the map's canvas is (1.7 to 1).
 */
const GRAVITY = { x: 0.03, y: 0.09 } as const

/**
 * Force layout (Fruchterman–Reingold with gravity), the Orchestrator pinned
 * at the origin; known nodes start where they were, new ones beside their
 * anchor.
 */
export function layoutOf(graph: Graph, previous: ReadonlyMap<string, Pt>): Map<string, Pt> {
  const nodes = graph.nodes
  const count = nodes.length
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  const K = LINK_LENGTH
  let known = 0

  nodes.forEach((node, i) => {
    const was = previous.get(node.id)
    if (was) {
      xs[i] = was.x
      ys[i] = was.y
      known += 1
      return
    }
    const anchor = node.anchor ? previous.get(node.anchor) : undefined
    const angle = ((hash(node.id) % 360) * Math.PI) / 180
    const reach = node.kind === 'file' ? K * 0.45 : K
    xs[i] = (anchor?.x ?? 0) + Math.cos(angle) * reach * 1.4
    ys[i] = (anchor?.y ?? 0) + Math.sin(angle) * reach * 0.8
  })

  const pinned = index.get(MAIN)
  const isWarm = known >= count * 0.6 && known > 0
  const rounds = isWarm ? 90 : 260
  let heat = isWarm ? K * 0.19 : K * 0.95

  const springs = graph.edges
    .map(edge => {
      const a = index.get(edge.a)
      const b = index.get(edge.b)
      if (a === undefined || b === undefined) return null
      const weight = edge.kind === 'file' ? 0.7 : edge.kind === 'talk' ? 1.2 + Math.log1p(edge.ab + edge.ba) * 0.25 : 1
      const length = edge.kind === 'file' ? K * 0.5 : K
      return { a, b, weight, length }
    })
    .filter((spring): spring is { a: number; b: number; weight: number; length: number } => spring !== null)

  const dx = new Float64Array(count)
  const dy = new Float64Array(count)
  const mass = nodes.map(node => (node.kind === 'file' ? 0.45 : 1))

  for (let round = 0; round < rounds; round++) {
    dx.fill(0)
    dy.fill(0)

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let ex = (xs[i] ?? 0) - (xs[j] ?? 0)
        let ey = (ys[i] ?? 0) - (ys[j] ?? 0)
        let d2 = ex * ex + ey * ey
        if (d2 < 0.01) {
          ex = ((i * 7 + j * 13) % 11) - 5 || 1
          ey = ((i * 5 + j * 3) % 9) - 4 || 1
          d2 = ex * ex + ey * ey
        }
        const d = Math.sqrt(d2)
        const force = ((K * K) / d) * (mass[i] ?? 1) * (mass[j] ?? 1)
        const fx = (ex / d) * force
        const fy = (ey / d) * force
        dx[i] = (dx[i] ?? 0) + fx
        dy[i] = (dy[i] ?? 0) + fy
        dx[j] = (dx[j] ?? 0) - fx
        dy[j] = (dy[j] ?? 0) - fy
      }
    }

    for (const spring of springs) {
      const ex = (xs[spring.a] ?? 0) - (xs[spring.b] ?? 0)
      const ey = (ys[spring.a] ?? 0) - (ys[spring.b] ?? 0)
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01
      const force = ((d * d) / spring.length) * spring.weight
      const fx = (ex / d) * force
      const fy = (ey / d) * force
      dx[spring.a] = (dx[spring.a] ?? 0) - fx
      dy[spring.a] = (dy[spring.a] ?? 0) - fy
      dx[spring.b] = (dx[spring.b] ?? 0) + fx
      dy[spring.b] = (dy[spring.b] ?? 0) + fy
    }

    for (let i = 0; i < count; i++) {
      if (i === pinned) continue
      const gx = (dx[i] ?? 0) - (xs[i] ?? 0) * GRAVITY.x
      const gy = (dy[i] ?? 0) - (ys[i] ?? 0) * GRAVITY.y
      const length = Math.sqrt(gx * gx + gy * gy) || 0.01
      const step = Math.min(length, heat)
      xs[i] = (xs[i] ?? 0) + (gx / length) * step
      ys[i] = (ys[i] ?? 0) + (gy / length) * step
    }

    if (pinned !== undefined) {
      xs[pinned] = 0
      ys[pinned] = 0
    }

    heat = Math.max(K / 120, heat * (isWarm ? 0.96 : 0.975))
  }

  const out = new Map<string, Pt>()
  nodes.forEach((node, i) => out.set(node.id, { x: xs[i] ?? 0, y: ys[i] ?? 0 }))
  return out
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

function fixed(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}

export type SvgSize = { width: number; height: number }

/**
 * The map's logical canvas: about a pane wide, so 13px labels read as 13px
 * where the pane is that wide; the markup declares a far larger width, so
 * the desktop scales it to the pane's full width.
 */
export const MAP_SIZE: SvgSize = { width: 960, height: 560 }

/** The most a layout unit is magnified, so a map of two nodes is not drawn edge to edge. */
const MAX_SCALE = 2.4

/** The graph as a self-contained interactive SVG document filling `size` (the map's canvas by default). */
export function svgOf(graph: Graph, positions: ReadonlyMap<string, Pt>, size: SvgSize = MAP_SIZE, caption = ''): string {
  const { width, height } = size
  const padX = 74
  const top = caption ? 48 : 30
  const bottom = 58
  const points = graph.nodes.map(node => positions.get(node.id) ?? { x: 0, y: 0 })
  const minX = Math.min(...points.map(p => p.x), 0)
  const maxX = Math.max(...points.map(p => p.x), 0)
  const minY = Math.min(...points.map(p => p.y), 0)
  const maxY = Math.max(...points.map(p => p.y), 0)
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const scale = Math.min((width - padX * 2) / spanX, (height - top - bottom) / spanY, MAX_SCALE)
  const offX = (width - spanX * scale) / 2 - minX * scale
  const offY = top + (height - top - bottom - spanY * scale) / 2 - minY * scale
  const at = (id: string): Pt => {
    const p = positions.get(id) ?? { x: 0, y: 0 }
    return { x: p.x * scale + offX, y: p.y * scale + offY }
  }

  const index = new Map(graph.nodes.map((node, i) => [node.id, i]))
  const radius = new Map(graph.nodes.map(node => [node.id, node.r]))
  const neighbors = graph.nodes.map((_, i) => new Set<number>([i]))
  for (const edge of graph.edges) {
    const a = index.get(edge.a)
    const b = index.get(edge.b)
    if (a === undefined || b === undefined) continue
    neighbors[a]?.add(b)
    neighbors[b]?.add(a)
  }

  const css: string[] = [
    `.e{fill:none;stroke:${PALETTE.edge};opacity:.75;transition:opacity .15s,stroke .15s}`,
    `.e.talk{stroke:${PALETTE.talk};opacity:.85}`,
    `.e.file{stroke:#2c3244;stroke-dasharray:2 3}`,
    `.e.work{stroke:${PALETTE.running};opacity:.6}`,
    `.n{transition:opacity .15s}`,
    `.n text{fill:${PALETTE.text};font-size:13px;paint-order:stroke;stroke:${PALETTE.bg1};stroke-width:4px;stroke-linejoin:round}`,
    `.n.file text{fill:${PALETTE.dim};font-size:11px}`,
    `.n.main text,.n.you text{font-weight:600;font-size:14px}`,
    `.n:hover .core{stroke:#fff;stroke-width:2}`,
    `.pk{fill:#ddd6fe}`,
    `.cap{fill:${PALETTE.dim};font-size:13px}`,
    `.lg text{fill:${PALETTE.dim};font-size:12px}`,
    `svg:has(.n:hover) .n{opacity:.22}`,
    `svg:has(.n:hover) .e{opacity:.07}`,
    `svg:has(.n:hover) .pk{opacity:.15}`,
  ]
  graph.nodes.forEach((_, i) => {
    css.push(`svg:has(#n${i}:hover) .q${i}{opacity:1}`, `svg:has(#n${i}:hover) .l${i}{opacity:1;stroke:#e2e8f0}`)
  })

  const edgeMarkup: string[] = []
  const packets: string[] = []

  graph.edges.forEach(edge => {
    const ia = index.get(edge.a)
    const ib = index.get(edge.b)
    if (ia === undefined || ib === undefined) return
    const p = at(edge.a)
    const q = at(edge.b)
    const ex = q.x - p.x
    const ey = q.y - p.y
    const d = Math.sqrt(ex * ex + ey * ey) || 1
    const ra = (radius.get(edge.a) ?? 6) + 2
    const rb = (radius.get(edge.b) ?? 6) + 2
    const sx = p.x + (ex / d) * ra
    const sy = p.y + (ey / d) * ra
    const tx = q.x - (ex / d) * rb
    const ty = q.y - (ey / d) * rb
    const bend = edge.kind === 'talk' ? Math.min(28, d * 0.12) : 0
    const cx = (sx + tx) / 2 + (-ey / d) * bend
    const cy = (sy + ty) / 2 + (ex / d) * bend
    const path = bend ? `M${fixed(sx)} ${fixed(sy)}Q${fixed(cx)} ${fixed(cy)} ${fixed(tx)} ${fixed(ty)}` : `M${fixed(sx)} ${fixed(sy)}L${fixed(tx)} ${fixed(ty)}`
    const back = bend ? `M${fixed(tx)} ${fixed(ty)}Q${fixed(cx)} ${fixed(cy)} ${fixed(sx)} ${fixed(sy)}` : `M${fixed(tx)} ${fixed(ty)}L${fixed(sx)} ${fixed(sy)}`
    const total = edge.ab + edge.ba
    const width = edge.kind === 'file' ? 1 : Math.min(5, 1.2 + Math.log2(1 + total) * 0.9)
    const classes = ['e', edge.kind === 'talk' ? 'talk' : edge.kind === 'file' ? 'file' : edge.isWorking ? 'work' : '', `l${ia}`, `l${ib}`]
      .filter(Boolean)
      .join(' ')
    const dash = edge.kind === 'talk' && edge.isActive ? ' stroke-dasharray="7 5"' : edge.kind === 'spawn' && edge.isWorking ? ' stroke-dasharray="3 4"' : ''
    const flow =
      dash !== ''
        ? `<animate attributeName="stroke-dashoffset" from="${edge.kind === 'talk' ? 24 : 14}" to="0" dur="${edge.kind === 'talk' ? '0.9s' : '1.4s'}" repeatCount="indefinite"/>`
        : ''
    const marker = edge.kind === 'spawn' ? ' marker-end="url(#arr)"' : edge.kind === 'talk' && edge.ab > 0 && edge.ba === 0 ? ' marker-end="url(#arrt)"' : edge.kind === 'talk' && edge.ba > 0 && edge.ab === 0 ? ' marker-start="url(#arrs)"' : ''
    const title = edge.kind === 'file' ? '' : `<title>${esc(edgeTitle(graph, edge))}</title>`
    edgeMarkup.push(`<path class="${classes}" d="${path}" stroke-width="${fixed(width)}"${dash}${marker}>${title}${flow}</path>`)

    if (edge.kind === 'talk' && edge.isActive) {
      const dur = (1.2 + d / 260).toFixed(2)
      if (edge.ab > 0) packets.push(`<circle class="pk l${ia} l${ib}" r="3"><animateMotion dur="${dur}s" repeatCount="indefinite" path="${path}"/></circle>`)
      if (edge.ba > 0) packets.push(`<circle class="pk l${ia} l${ib}" r="3"><animateMotion dur="${dur}s" begin="${(Number(dur) / 2).toFixed(2)}s" repeatCount="indefinite" path="${back}"/></circle>`)
    }
  })

  const nodeMarkup = graph.nodes.map((node, i) => {
    const p = at(node.id)
    const near = [...(neighbors[i] ?? [])].map(j => `q${j}`).join(' ')
    const halo = node.isLive
      ? `<circle r="${fixed(node.r + 4)}" fill="${node.color}" opacity=".25"><animate attributeName="r" values="${fixed(node.r + 2)};${fixed(node.r + 12)};${fixed(node.r + 2)}" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".35;0;.35" dur="1.8s" repeatCount="indefinite"/></circle>`
      : ''
    const glow = node.kind === 'file' ? '' : ' filter="url(#glow)"'
    const label = `<text y="${fixed(node.r + 17)}" text-anchor="middle">${esc(node.label)}</text>`
    return `<g class="n ${node.kind} ${near}" id="n${i}" transform="translate(${fixed(p.x)} ${fixed(p.y)})"><title>${esc(node.tip)}</title>${halo}<circle class="core" r="${fixed(node.r)}" fill="${node.color}"${glow}/>${label}</g>`
  })

  let x = 20
  const legend = [
    ['you', PALETTE.you],
    ['orchestrator', PALETTE.main],
    ['running', PALETTE.running],
    ['waiting', PALETTE.waiting],
    ['done', PALETTE.done],
    ['failed', PALETTE.failed],
    ['file', PALETTE.file],
  ]
    .map(([name = '', color = '']) => {
      const item = `<g transform="translate(${x} ${height - 18})"><circle r="5.5" fill="${color}"/><text x="11" y="4.5">${name}</text></g>`
      x += 26 + name.length * 7
      return item
    })
    .join('')

  const links = `<g transform="translate(${Math.max(x + 16, width - 230)} ${height - 18})"><path d="M0 0H26" stroke="${PALETTE.edge}" stroke-width="2.5"/><text x="32" y="4.5">delegated</text><path d="M110 0H136" stroke="${PALETTE.talk}" stroke-width="2.5" stroke-dasharray="7 5"/><text x="142" y="4.5">talking</text></g>`

  return [
    svgOpen(width, height, ` font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"`),
    '<defs>',
    `<radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${PALETTE.bg0}"/><stop offset="1" stop-color="${PALETTE.bg1}"/></radialGradient>`,
    '<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    `<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1L10 5L0 9z" fill="${PALETTE.edge}"/></marker>`,
    `<marker id="arrt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1L10 5L0 9z" fill="${PALETTE.talk}"/></marker>`,
    `<marker id="arrs" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M10 1L0 5L10 9z" fill="${PALETTE.talk}"/></marker>`,
    '</defs>',
    `<style>${css.join('')}</style>`,
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    caption ? `<text class="cap" x="20" y="28">${esc(caption)}</text>` : '',
    `<g>${edgeMarkup.join('')}</g>`,
    `<g>${packets.join('')}</g>`,
    `<g>${nodeMarkup.join('')}</g>`,
    `<g class="lg">${legend}${links}</g>`,
    '</svg>',
  ].join('')
}

function edgeTitle(graph: Graph, edge: GEdge): string {
  const name = (id: string) => graph.nodes.find(node => node.id === id)?.label ?? id
  if (edge.ab + edge.ba === 0) return `${name(edge.a)} delegated to ${name(edge.b)}`
  return `${name(edge.a)} → ${name(edge.b)}: ${edge.ab}\n${name(edge.b)} → ${name(edge.a)}: ${edge.ba}`
}

export type TreeRow = { agent: DeckAgent; prefix: string; depth: number }

/** The agents as a tree from you, by who spawned whom; peers last. */
export function treeOf(data: DeckData): TreeRow[] {
  const ids = new Set(data.agents.map(agent => agent.id))
  const children = new Map<string, DeckAgent[]>()
  const roots: DeckAgent[] = []

  for (const agent of data.agents) {
    const parent = agent.kind === 'you' ? undefined : agent.parentId && ids.has(agent.parentId) && agent.parentId !== agent.id ? agent.parentId : agent.kind === 'main' ? YOU : agent.kind === 'peer' ? undefined : MAIN
    if (parent === undefined) {
      roots.push(agent)
      continue
    }
    const list = children.get(parent) ?? []
    list.push(agent)
    children.set(parent, list)
  }

  const rows: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (agent: DeckAgent, lead: string, isLast: boolean, depth: number) => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    rows.push({ agent, prefix: depth === 0 ? '' : `${lead}${isLast ? '└─ ' : '├─ '}`, depth })
    const kids = children.get(agent.id) ?? []
    kids.forEach((kid, i) => walk(kid, depth === 0 ? '' : `${lead}${isLast ? '   ' : '│  '}`, i === kids.length - 1, depth + 1))
  }

  roots.sort((a, b) => (a.kind === 'you' ? -1 : b.kind === 'you' ? 1 : 0))
  roots.forEach(root => walk(root, '', true, 0))
  return rows
}

export function isQuiet(agent: DeckAgent): boolean {
  return isEnded(agent.status) || agent.status === 'idle'
}
