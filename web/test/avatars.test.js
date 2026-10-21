/**
 * The avatar library (web/avatars.mjs), as every surface takes it: each of
 * the ten styles a well-formed, self-contained SVG document for every
 * status, its ids its own, the same agent the same look, the status dot
 * where the gallery put it, and the terminal's glyph and mark.
 */
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')

const A = require('../avatars.mjs')

const STATUSES = ['starting', 'running', 'waiting', 'done', 'failed', 'idle', 'stopped', 'no-such-status']
const AGENTS = [
  { id: 'main', name: 'Orchestrator', role: 'main' },
  { id: 'b81c6f3e2a9d4c17', name: 'builder' },
  { id: 'a3f9c2e1b7d4058e', name: 'researcher', progress: 0.4 },
  { id: 'f1e2d3c4b5a6978c', name: 'scout <& "x">' },
  { id: '', name: '' },
]

/** The tags of an XML document in order, each `{ close, name, attrs, self }`; throws where it is not well formed. */
function tagsOf(xml) {
  const tags = []
  const stack = []
  let at = 0
  const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y
  while (at < xml.length) {
    const lt = xml.indexOf('<', at)
    const text = lt < 0 ? xml.slice(at) : xml.slice(at, lt)
    assert.ok(!/&(?!#\d+;|amp;|lt;|gt;|quot;)/.test(text), `a bare & in text: ${text}`)
    if (lt < 0) break
    TAG.lastIndex = lt
    const m = TAG.exec(xml)
    assert.ok(m, `not a tag at ${lt}: ${xml.slice(lt, lt + 60)}`)
    const [, close, name, rawAttrs, self] = m
    const attrs = {}
    for (const one of rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      assert.ok(!(one[1] in attrs), `attribute ${one[1]} twice on <${name}>`)
      attrs[one[1]] = one[2]
    }
    if (close) assert.equal(stack.pop(), name, `</${name}> closes what it did not open`)
    else if (!self) stack.push(name)
    tags.push({ close: close === '/', name, attrs, self: self === '/' })
    at = TAG.lastIndex
  }
  assert.deepEqual(stack, [], 'every tag closed')
  return tags
}

/** Checks one document: well formed, one <svg> root on the 40 grid at `size`, nothing outside it referenced, every id once, every url(#id) its own. */
function checkDocument(svg, size) {
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'an SVG root with its namespace')
  assert.ok(svg.endsWith('</svg>'))
  const tags = tagsOf(svg)
  assert.equal(tags[0].name, 'svg')
  assert.equal(tags.filter(t => t.name === 'svg' && !t.close).length, 1, 'one root')
  assert.equal(tags[0].attrs.viewBox, '0 0 40 40')
  assert.equal(tags[0].attrs.width, String(size))
  assert.equal(tags[0].attrs.height, String(size))
  for (const t of tags) {
    assert.ok(!['script', 'image', 'foreignObject', 'use', 'a', 'iframe'].includes(t.name), `no <${t.name}>`)
    for (const [key, value] of Object.entries(t.attrs)) {
      if (key === 'xmlns') continue
      assert.ok(!/^on/i.test(key) && !/href$/i.test(key), `no ${key}`)
      assert.ok(!/url\((?!#)/.test(value) && !/(?:https?|data|file):/i.test(value), `nothing outside: ${key}="${value}"`)
    }
  }
  const ids = tags.filter(t => t.attrs.id).map(t => t.attrs.id)
  assert.equal(new Set(ids).size, ids.length, 'every id once')
  for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref[1]), `url(#${ref[1]}) is its own`)
  return { tags, ids }
}

test('every style draws every status as a well-formed, self-contained SVG document, with and without its dot, still or moving, at any size', () => {
  assert.deepEqual(A.STYLE_IDS, ['robot', 'mood', 'critter', 'pixel', 'mono', 'orbit', 'bauhaus', 'ring', 'glyph', 'blob'])
  assert.equal(A.DEFAULT_STYLE, 'robot')
  assert.equal(A.styleName('robot'), 'Robots')
  let count = 0
  for (const style of A.STYLE_IDS) {
    for (const agent of AGENTS) {
      for (const status of STATUSES) {
        for (const opts of [{}, { size: 22, dot: true }, { size: 18, dot: false, animated: true }, { size: 32, animated: true, ground: '#1a1a1a' }]) {
          checkDocument(A.avatarSvg(style, { ...agent, status }, opts), opts.size ?? 40)
          count++
        }
      }
    }
  }
  assert.equal(count, 10 * AGENTS.length * STATUSES.length * 4)
  // a style it does not know draws the default's
  assert.equal(A.avatarSvg('nope', { id: 'x', status: 'done' }), A.avatarSvg('robot', { id: 'x', status: 'done' }))
})

test('the status dot sits where the gallery put it, in its status`s hue, ringed in the ground; a mood face and a progress ring say it themselves', () => {
  const dot = (hue, ground = '#141414') => `cx="33" cy="33" r="6" fill="${hue}" stroke="${ground}" stroke-width="3"`
  for (const style of A.STYLE_IDS) {
    for (const [status, look] of [['starting', 'running'], ['running', 'running'], ['waiting', 'waiting'], ['done', 'done'], ['failed', 'failed'], ['idle', 'idle'], ['stopped', 'idle']]) {
      const svg = A.avatarSvg(style, { id: 'b81c6f3e2a9d4c17', name: 'builder', status }, { dot: true })
      assert.equal(svg.includes(dot(A.LOOK_HUE[look])), style !== 'mood' && style !== 'ring', `${style} ${status}`)
      assert.ok(!A.avatarSvg(style, { id: 'b81c6f3e2a9d4c17', status }, { dot: false }).includes('cx="33" cy="33" r="6"'))
    }
  }
  assert.ok(A.avatarSvg('robot', { id: 'x', status: 'done' }, { ground: '#1a1a1a' }).includes(dot(A.LOOK_HUE.done, '#1a1a1a')))
  // a progress ring fills to the agent's progress, in its status's hue
  const ring = A.avatarSvg('ring', { id: 'x', name: 'x', status: 'running', progress: 0.5 })
  assert.match(ring, /stroke="#3b82f6" stroke-width="3.5" stroke-dasharray="47.12 94.25"/)
  assert.equal(A.progressOf([{ status: 'done' }, { status: 'active' }, { status: 'pending' }, { status: 'done' }]), 0.5)
  assert.equal(A.progressOf([]), undefined)
})

test('a robot`s face says its status: eyes at work, eyes up and an amber light waiting, ^ ^ and a green light done, a red visor and ✕ eyes failed, closed eyes dimmed idle', () => {
  const robot = status => A.avatarSvg('robot', { id: 'a3f9c2e1b7d4058e', name: 'researcher', status }, { dot: false })
  assert.ok(robot('waiting').includes('<g transform="translate(0 -2)">'), 'eyes up')
  assert.ok(robot('waiting').includes(`fill="${A.LOOK_HUE.waiting}"`), 'an amber light')
  assert.ok(robot('done').includes('q2.5-4.4 5 0'), 'arc eyes')
  assert.ok(robot('done').includes(`fill="${A.LOOK_HUE.done}"`), 'a green light')
  assert.ok(robot('failed').includes('fill="#4c0d0d" stroke="#ef4444"'), 'a red visor')
  assert.ok(robot('failed').includes('l3.8 3.8'), '✕ eyes')
  assert.ok(robot('idle').includes('M13 19h5M22 19h5') && robot('idle').includes('opacity=".8"'), 'closed eyes, dimmed')
  assert.equal(robot('stopped'), robot('idle'))
  assert.equal(robot('starting'), robot('running'))
  assert.notEqual(robot('running'), robot('waiting'))
})

test('an agent keeps its look: seeded by its id (its name only without one), the same document for the same input, its colours the state`s avatar index', () => {
  for (const style of A.STYLE_IDS) {
    const one = A.avatarSvg(style, { id: 'c4d7e8f9a0b1263d', name: 'tester', status: 'done' })
    assert.equal(A.avatarSvg(style, { id: 'c4d7e8f9a0b1263d', name: 'tester', status: 'done' }), one)
    if (!['mono', 'ring'].includes(style)) assert.equal(A.avatarSvg(style, { id: 'c4d7e8f9a0b1263d', name: 'renamed', status: 'done' }), one, `${style} follows the id, not the name`)
  }
  assert.equal(A.avatarSvg('robot', { name: 'builder', status: 'idle' }), A.avatarSvg('robot', { name: 'builder', status: 'idle' }))
  const [c1, c2] = A.colorsOf({ id: 'main' })
  assert.deepEqual([c1, c2], A.PALETTE[A.paletteIndexOf({ id: 'main' })])
  assert.ok(A.avatarSvg('robot', { id: 'main', status: 'running' }).includes(`fill="${c1}"`))
  // the picks spread: the sample's eight agents show at least five colours
  const ids = ['main', 'b81c6f3e2a9d4c17', 'c4d7e8f9a0b1263d', 'd2e3f4a5b6c7089a', 'aa11bb22cc33dd44', 'a3f9c2e1b7d4058e', 'e5f6a7b8c9d0142b', 'f1e2d3c4b5a6978c']
  assert.ok(new Set(ids.map(id => A.paletteIndexOf({ id }))).size >= 5)
})

test('ids are each document`s own: two agents, two statuses or two sizes never share one, and `id` names the prefix', () => {
  const idsOf = svg => [...svg.matchAll(/ (?:id|class)="([^"]+)"/g)].map(m => m[1].split('-')[0])
  for (const style of ['bauhaus', 'blob', 'robot']) {
    const seen = new Map()
    for (const agent of AGENTS.slice(0, 4)) {
      for (const status of ['running', 'done']) {
        for (const size of [18, 22]) {
          const svg = A.avatarSvg(style, { ...agent, status }, { size, dot: true, animated: true })
          for (const id of new Set(idsOf(svg))) {
            assert.ok(!seen.has(id) || seen.get(id) === svg, `${style}: ${id} in two documents`)
            seen.set(id, svg)
          }
        }
      }
    }
  }
  const named = A.avatarSvg('blob', { id: 'x', status: 'done' }, { id: 'card-7' })
  assert.match(named, /<linearGradient id="card-7-fill"/)
  assert.match(named, /fill="url\(#card-7-fill\)"/)
  assert.match(A.avatarSvg('bauhaus', { id: 'x' }, { id: '9 bad id!' }), /<clipPath id="av9badid-clip">/)
})

test('words in a face are escaped: a monogram`s and a ring`s letters, never markup', () => {
  const mono = A.avatarSvg('mono', { id: 'q', name: '<b>&co', status: 'done' })
  checkDocument(mono, 40)
  assert.match(mono, />&#60;b<\/text>/)
  assert.match(A.avatarSvg('mono', { id: 'q', name: 'builder' }), />Bl<\/text>/)
  assert.match(A.avatarSvg('ring', { id: 'q', name: '&x' }), />&#38;<\/text>/)
  // half a surrogate pair could not be encoded in a URL: it is replaced
  const lone = A.avatarSvg('mono', { id: 'q', name: String.fromCharCode(0xd83d) + 'x' })
  assert.doesNotThrow(() => A.dataUrl(lone))
})

test('the editors` stack: each face on a plate of the ground, a grey disc for one the state does not hold, its width as the pane counts it', () => {
  const svg = A.avatarStackSvg('robot', [{ id: 'main', status: 'running' }, null, { id: 'b81c6f3e2a9d4c17', status: 'done' }], { size: 20, ground: '#1a1a1a' })
  const tags = tagsOf(svg)
  assert.equal(tags[0].attrs.width, String(A.stackWidth(3, 20)))
  assert.equal(A.stackWidth(3, 20), 50)
  assert.equal((svg.match(/<rect width="40" height="40" rx="13" fill="#1a1a1a"\/>/g) ?? []).length, 3)
  assert.ok(svg.includes('<circle cx="20" cy="20" r="15" fill="#262626"/>'))
  assert.ok(!svg.includes('cx="33" cy="33"'), 'no status dots in a stack')
  const ids = tags.filter(t => t.attrs.id).map(t => t.attrs.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(A.avatarStackSvg('blob', []), '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="20" viewBox="0 0 0 20"></svg>')
})

test('the terminal draws no SVG: an agent`s glyph from ◆●▲■✦⬢★◉ in its deep colour, then its status`s mark in its hue', () => {
  assert.deepEqual(A.GLYPHS, ['◆', '●', '▲', '■', '✦', '⬢', '★', '◉'])
  const seen = new Set()
  for (const id of ['main', 'b81c6f3e2a9d4c17', 'c4d7e8f9a0b1263d', 'd2e3f4a5b6c7089a', 'aa11bb22cc33dd44', 'a3f9c2e1b7d4058e', 'e5f6a7b8c9d0142b', 'f1e2d3c4b5a6978c']) {
    const face = A.terminalFace({ id, status: 'running' })
    assert.equal(face.glyph, A.GLYPHS[A.pickOf(id) % 8])
    assert.equal(face.color, A.colorsOf({ id })[0])
    seen.add(face.glyph)
  }
  assert.ok(seen.size >= 3)
  assert.deepEqual(['starting', 'running', 'waiting', 'done', 'failed', 'idle', 'stopped'].map(status => A.terminalFace({ id: 'x', status }).mark), ['◐', '◐', '‖', '✓', '✕', '◌', '◌'])
  assert.equal(A.terminalFace({ id: 'x', status: 'failed' }).markColor, A.LOOK_HUE.failed)
})

test('a robot moves as its status does, only when animated: scanning eyes, a blinking light and a bob at work; a pulsing amber light and a hop waiting; one settle done; one shake failed; a slow breath idle', () => {
  const robot = (status, animated = true) => A.avatarSvg('robot', { id: 'b81c6f3e2a9d4c17', name: 'builder', status }, { size: 22, dot: true, animated })
  const styleOf = svg => /<style>(.*)<[/]style>/.exec(svg)?.[1] ?? ''
  const prefix = svg => /^<svg [^>]*class="([^"]+)"/.exec(svg)[1]
  const rules = {
    running: ['-bob{animation:', '-eyes{animation:', '-scan 2.8s ease-in-out infinite', '-lt{animation:', '-blink 1.2s linear infinite', 'translateX(-2.6px)', 'translateY(-1.2px)'],
    starting: ['-scan 2.8s ease-in-out infinite', '-blink 1.2s linear infinite'],
    waiting: ['-hop 3.2s ease-in-out infinite', '-look 3.2s', '-pulse 1.6s ease-in-out infinite', '-halo{animation:', '-glow 1.6s'],
    done: ['-settle .9s ease-out 1 both'],
    failed: ['-shake .6s ease-in-out 1}'],
    idle: ['-breathe 4.8s ease-in-out infinite'],
    stopped: ['-breathe 4.8s ease-in-out infinite'],
  }
  for (const [status, wants] of Object.entries(rules)) {
    const svg = robot(status)
    const css = styleOf(svg)
    const u = prefix(svg)
    for (const want of wants) assert.ok(css.includes(want), `${status}: ${want}`)
    // every class and keyframe under the document's own prefix, and none of it under reduced motion
    for (const m of css.matchAll(/(?:^|[{}])[.]([\w-]+)|@keyframes ([\w-]+)/g)) {
      const name = m[1] ?? m[2]
      assert.ok(name.startsWith(`${u}-`) || name === u, `${status}: ${name} is under ${u}`)
    }
    assert.ok(css.endsWith(`@media (prefers-reduced-motion:reduce){.${u} *{animation:none!important}}`), `${status}: still under reduced motion`)
    // still: the same face, no rules at all
    assert.ok(!robot(status, false).includes('<style>'), `${status} still`)
    assert.equal(robot(status, false).replace(/class="av\w+/g, ''), svg.replace(/<style>.*<[/]style>/, '').replace(/class="av\w+/g, ''), `${status}: motion is all the difference`)
  }
  // the one-time motions play once; the loops loop
  assert.ok(!styleOf(robot('done')).includes('infinite'))
  assert.ok(!styleOf(robot('failed')).includes('infinite'))
})

test('the other styles move lightly, only when animated: their status dot pulses while at work, and a progress ring with no progress to show spins', () => {
  for (const style of A.STYLE_IDS.filter(one => one !== 'robot')) {
    for (const status of ['waiting', 'done', 'failed', 'idle']) {
      const svg = A.avatarSvg(style, { id: 'q', name: 'q', status }, { dot: true, animated: true })
      assert.ok(!svg.includes('<style>'), `${style} ${status} is still`)
    }
    const running = A.avatarSvg(style, { id: 'q', name: 'q', status: 'running' }, { dot: true, animated: true })
    const isDotted = style !== 'mood' && style !== 'ring'
    assert.equal(running.includes('-ping 1.8s ease-in-out infinite'), isDotted, `${style}: its dot pulses`)
    assert.ok(!A.avatarSvg(style, { id: 'q', name: 'q', status: 'running' }, { dot: true }).includes('<style>'), `${style} still unless animated`)
  }
  assert.ok(A.avatarSvg('ring', { id: 'q', name: 'q', status: 'running' }, { animated: true }).includes('-spin 1.6s linear infinite'))
  assert.ok(!A.avatarSvg('ring', { id: 'q', name: 'q', status: 'running', progress: 0.25 }, { animated: true }).includes('<style>'), 'a ring with progress to show holds still')
})

test('a document changes only with what its style draws: a robot`s todo list moving on, or its name, leaves it as it was (its image or frame never loads again for that); a ring`s progress and a monogram`s name change theirs', () => {
  for (const style of A.STYLE_IDS) {
    const one = A.avatarSvg(style, { id: 'x', name: 'builder', status: 'running', progress: 0.25 }, { size: 22, dot: true, animated: true })
    const moved = A.avatarSvg(style, { id: 'x', name: 'builder', status: 'running', progress: 0.75 }, { size: 22, dot: true, animated: true })
    assert.equal(one === moved, style !== 'ring', style)
    const renamed = A.avatarSvg(style, { id: 'x', name: 'tester', status: 'running', progress: 0.25 }, { size: 22, dot: true, animated: true })
    assert.equal(one === renamed, style !== 'ring' && style !== 'mono', style)
  }
})
