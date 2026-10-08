import { expect, test } from 'claude-code/testing'

import { type MapMessage, type MapNode, treeSvg, wireSvg } from '../hooks/ui/map'
import { T } from '../hooks/ui/theme'

const HINT = 'Agents appear here as the Orchestrator delegates work'
const SVG_LIMIT = 131_072

function node(id: string, extra: Partial<MapNode> = {}): MapNode {
  return { id, name: id, kind: 'agent', status: 'running', elapsed: '2m', now: 'Edit src/app.ts', added: 0, removed: 0, ...extra }
}

const YOU = node('you', { name: 'You', kind: 'you', status: 'idle', elapsed: '', now: '' })
const ORCH = node('main', { name: 'Orchestrator', kind: 'orchestrator', elapsed: '12m', now: 'Delegating' })

function message(i: number, from: string, to: string, tag: MapMessage['tag'] = 'task', text = `message ${String(i).padStart(2, '0')}`): MapMessage {
  return { id: `m${i}`, at: `10:${String(i).padStart(2, '0')}`, from, to, tag, text }
}

type Plate = { id: string; x: number; y: number; w: number; h: number; stroke: string }

/** The plates a tree drew, by the node id on their group. */
function plates(svg: string): Plate[] {
  const re = /<g data-id="([^"]*)">(?:<title>[^<]*<\/title>)?<rect class="plate" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*? stroke="([^"]+)"/g
  return [...svg.matchAll(re)].map(m => ({ id: m[1] ?? '', x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]), stroke: m[6] ?? '' }))
}

function viewBox(svg: string): { w: number; h: number } {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  return { w: Number(m?.[1]), h: Number(m?.[2]) }
}

function overlaps(a: Plate, b: Plate): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Every pair of plates apart, and every plate inside the canvas. */
function expectApart(svg: string): void {
  const all = plates(svg)
  const box = viewBox(svg)
  for (const plate of all) {
    expect(plate.x >= 0 && plate.y >= 0 && plate.x + plate.w <= box.w && plate.y + plate.h <= box.h).toBe(true)
  }
  const clashes: string[] = []
  all.forEach((a, i) => all.slice(i + 1).forEach(b => overlaps(a, b) && clashes.push(`${a.id}/${b.id}`)))
  expect(clashes).toEqual([])
}

/** Where a path's subpath starts and ends, from its "M x y" and "H"/"V" steps. */
function ends(sub: string): { from: [number, number]; to: [number, number] } {
  const [x0, y0] = sub.trim().split(/[\sHV]/).map(Number)
  let x = x0 ?? NaN
  let y = y0 ?? NaN
  for (const step of sub.matchAll(/([HV])([-\d.]+)/g)) {
    if (step[1] === 'H') x = Number(step[2])
    else y = Number(step[2])
  }
  return { from: [x0 ?? NaN, y0 ?? NaN], to: [x, y] }
}

test('the same input draws the identical string, memo or not', async () => {
  const nodes = [YOU, ORCH, node('lead', { added: 12, removed: 3 }), node('helper', { parent: 'lead', status: 'done' })]
  const messages = [message(1, 'you', 'main', 'ask'), message(2, 'main', 'lead'), message(3, 'lead', 'helper'), message(4, 'helper', 'lead', 'result')]
  const tree = treeSvg(nodes, { selected: 'helper', prompt: 'Fix the login bug' })
  const wire = wireSvg(nodes, messages, { selected: 'helper' })

  // Push both out of the memo, then draw them again from copies.
  for (let i = 0; i < 12; i++) {
    treeSvg([...nodes, node(`x${i}`)], { selected: '' })
    wireSvg([...nodes, node(`x${i}`)], messages, { selected: '' })
  }
  const copy = JSON.parse(JSON.stringify(nodes)) as MapNode[]
  expect(treeSvg(copy, { selected: 'helper', prompt: 'Fix the login bug' })).toBe(tree)
  expect(wireSvg(copy, JSON.parse(JSON.stringify(messages)) as MapMessage[], { selected: 'helper' })).toBe(wire)

  expect(tree).toStartWith('<svg')
  expect(tree).toEndWith('</svg>')
  expect(tree).toContain('Fix the login bug')
  expect(treeSvg(nodes, { selected: 'lead' })).not.toBe(treeSvg(nodes, { selected: 'helper' }))
})

test('the selected plate and its path up to You are copper', async () => {
  const nodes = [YOU, ORCH, node('lead'), node('helper', { parent: 'lead' }), node('other')]
  const svg = treeSvg(nodes, { selected: 'helper', prompt: 'Ship it' })
  const all = plates(svg)
  expect(all.map(plate => plate.id)).toEqual(['you', 'main', 'lead', 'helper', 'other'])
  expect(all.filter(plate => plate.stroke === T.copper).map(plate => plate.id)).toEqual(['helper'])
  expect(all.filter(plate => plate.stroke !== T.copper).every(plate => plate.stroke === T.line)).toBe(true)

  const path = /<path class="path" d="([^"]+)"[^>]*? stroke="([^"]+)"/.exec(svg)
  expect(path?.[2]).toBe(T.copper)
  const subs = (path?.[1] ?? '').split('M').filter(Boolean)
  expect(subs).toHaveLength(3)
  const you = all.find(plate => plate.id === 'you')!
  const helper = all.find(plate => plate.id === 'helper')!
  expect(ends(subs[0]!).from).toEqual([you.x + you.w / 2, you.y + you.h])
  expect(ends(subs[2]!).to).toEqual([helper.x + helper.w / 2, helper.y])

  // Nothing selected: no copper anywhere.
  expect(treeSvg(nodes, { selected: '' })).not.toContain(T.copper)
})

test('nine children wrap into rows of four with no plates overlapping', async () => {
  const kids = Array.from({ length: 9 }, (_, i) => node(`agent${i + 1}`, { now: 'Bash npm test', added: i * 7, removed: i }))
  const svg = treeSvg([YOU, ORCH, ...kids], { selected: 'agent9' })
  const all = plates(svg)
  expect(all).toHaveLength(11)
  expectApart(svg)

  const rows = new Map<number, number>()
  for (const plate of all.slice(2)) rows.set(plate.y, (rows.get(plate.y) ?? 0) + 1)
  expect([...rows.values()]).toEqual([4, 4, 1])
  const orch = all[1]!
  expect(Math.min(...rows.keys())).toBeGreaterThan(orch.y + orch.h)

  // A wrapped fan-out under a wrapped fan-out still keeps clear.
  const nested = [YOU, ORCH, ...kids, ...Array.from({ length: 7 }, (_, i) => node(`sub${i}`, { parent: 'agent2' }))]
  expectApart(treeSvg(nested, { selected: 'sub6' }))
})

test('the wire caps its lanes at seven, folding the oldest finished agents into "+N done"', async () => {
  const done = Array.from({ length: 5 }, (_, i) => node(`done${i + 1}`, { status: 'done' }))
  const live = Array.from({ length: 3 }, (_, i) => node(`live${i + 1}`))
  const nodes = [YOU, ORCH, ...done, ...live]
  const messages = [message(1, 'main', 'done1'), message(2, 'done1', 'main', 'result'), message(3, 'main', 'live3'), message(4, 'live1', 'live3', 'msg')]
  const svg = wireSvg(nodes, messages, { selected: 'live3' })

  expect(svg.match(/class="lane"/g)).toHaveLength(7)
  expect(svg).toContain('+4 done')
  for (const name of ['You', 'Orchestrator', 'done5', 'live1', 'live2', 'live3']) expect(svg).toContain(`>${name}</text>`)
  for (const name of ['done1', 'done2', 'done3', 'done4']) expect(svg).not.toContain(`>${name}</text>`)
  expect(svg.match(/class="msg"/g)).toHaveLength(4)

  // The selected lane is solid copper; the arrows touching it are copper too.
  expect(svg.match(new RegExp(`class="life"[^>]*stroke="${T.copper}"`, 'g'))).toHaveLength(1)
  const arrows = svg.split('<g class="msg">').slice(1)
  expect(arrows.map(arrow => arrow.includes(T.copper))).toEqual([false, false, true, true])
})

test('the wire draws the newest fourteen messages under an "earlier messages" marker', async () => {
  const nodes = [YOU, ORCH, node('a'), node('b')]
  const tags: MapMessage['tag'][] = ['task', 'result', 'msg', 'ask']
  const messages = Array.from({ length: 20 }, (_, i) => message(i + 1, i % 2 ? 'a' : 'main', i % 3 ? 'b' : 'a', tags[i % 4]))
  const svg = wireSvg(nodes, messages, { selected: 'a' })
  expect(svg.match(/class="msg"/g)).toHaveLength(14)
  expect(svg).toContain('6 earlier messages')
  expect(svg).toContain('message 07')
  expect(svg).not.toContain('message 06')

  // Rows run oldest first, top to bottom.
  expect(svg.indexOf('message 07')).toBeLessThan(svg.indexOf('message 20'))

  // Each tag draws its own way: dashed messages, outlined result heads.
  expect(svg).toContain('stroke-dasharray="5 4"')
  expect(svg).toContain(`fill="${T.bg}" stroke="`)

  const few = wireSvg(nodes, messages.slice(0, 14), { selected: 'a' })
  expect(few).not.toContain('earlier message')
  expect(few.match(/class="msg"/g)).toHaveLength(14)
})

test('with only You and the Orchestrator both views draw them and the hint', async () => {
  const tree = treeSvg([YOU, ORCH], { selected: '', prompt: 'Hello' })
  expect(tree).toContain(HINT)
  expect(plates(tree).map(plate => plate.id)).toEqual(['you', 'main'])

  const wire = wireSvg([YOU, ORCH], [message(1, 'you', 'main', 'ask', 'Hello')], { selected: '' })
  expect(wire).toContain(HINT)
  expect(wire.match(/class="lane"/g)).toHaveLength(2)
  expect(wire.match(/class="msg"/g)).toHaveLength(1)

  // With nothing at all, stand-ins for both are drawn.
  const bare = treeSvg([], { selected: '' })
  expect(bare).toContain(HINT)
  expect(bare).toContain('>You</text>')
  expect(bare).toContain('>Orchestrator</text>')
  expect(wireSvg([], [], { selected: '' })).toContain(HINT)

  // Agents without messages say so instead.
  expect(wireSvg([YOU, ORCH, node('a')], [], { selected: '' })).toContain('No messages yet')
})

test('text is escaped and cleaned of characters XML cannot hold', async () => {
  const evil = '<script>alert("x")</script> & \'q\' \u0000\u0007\ud800'
  const nodes = [YOU, ORCH, node('bad"id', { name: evil, now: evil, elapsed: '<1s' })]
  const tree = treeSvg(nodes, { selected: 'bad"id', prompt: evil })
  const wire = wireSvg(nodes, [message(1, 'main', 'bad"id', 'task', evil), message(2, 'bad"id', 'main', 'result', `## ${evil}`)], { selected: 'bad"id' })
  for (const svg of [tree, wire]) {
    expect(svg).not.toContain('<script')
    expect(svg).toContain('&lt;script&gt;')
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(svg)).toBe(false)
    expect(svg.includes('\ud800')).toBe(false)
    // Every "<" opens one of the elements the builders write.
    expect(svg.match(/<(?!\/?(svg|rect|path|text|tspan|g|title)[\s>/])/g)).toBeNull()
  }
  expect(tree).toContain('data-id="bad&quot;id"')
  expect(tree).toContain('&lt;1s')
  expect(plates(tree).find(plate => plate.id === 'bad&quot;id')?.stroke).toBe(T.copper)
})

test('unknown parents hang under the Orchestrator and a loop of parents cannot hang the layout', async () => {
  const nodes = [YOU, ORCH, node('orphan', { parent: 'gone' }), node('a', { parent: 'b' }), node('b', { parent: 'a' }), node('self', { parent: 'self' })]
  const svg = treeSvg(nodes, { selected: 'b' })
  const all = plates(svg)
  expect(all).toHaveLength(6)
  expectApart(svg)
  const orch = all.find(plate => plate.id === 'main')!
  const firstRow = all.filter(plate => plate.y === orch.y + orch.h + 32).map(plate => plate.id)
  expect(firstRow).toEqual(['orphan', 'a', 'self'])
  expect(all.find(plate => plate.id === 'b')!.y).toBeGreaterThan(all.find(plate => plate.id === 'a')!.y)
})

test('thirty agents with long text stay under the Svg limit and apart', async () => {
  const long = 'Reading every file under src/components to find the place the token refresh is wired '.repeat(20)
  const nodes: MapNode[] = [YOU, ORCH]
  for (let i = 0; i < 30; i++) {
    const parent = i < 10 ? undefined : `agent${i % 10}`
    nodes.push(node(`agent${i}`, { name: `agent-${i}-${'w'.repeat(40)}`, now: long, elapsed: '1h 05m', parent, added: 123_456, removed: 98_765, status: i % 3 ? 'running' : 'done' }))
  }
  const messages = Array.from({ length: 200 }, (_, i) => message(i, i % 2 ? 'main' : `agent${i % 30}`, `agent${(i * 7) % 30}`, 'msg', `${'&<>"'.repeat(400)} ${long}`))
  const tree = treeSvg(nodes, { selected: 'agent29', prompt: long })
  const wire = wireSvg(nodes, messages, { selected: 'agent29' })
  expect(tree.length).toBeLessThan(SVG_LIMIT)
  expect(wire.length).toBeLessThan(SVG_LIMIT)
  expect(plates(tree)).toHaveLength(32)
  expectApart(tree)
  expect(wire.match(/class="lane"/g)).toHaveLength(7)
})
