/**
 * Agent Deck's avatars: one library for every surface that draws an agent.
 *
 * Ten styles, each an SVG document on a 40 by 40 grid, as the owner reviewed
 * them (2026-10-21): robot (the default), mood, critter, pixel, mono, orbit,
 * bauhaus, ring, glyph and blob. `avatarSvg(style, agent, opts)` is one whole
 * document: the agent's face, its status dot at its foot (a progress ring
 * says its status with the ring), every id in it its own, nothing outside it
 * referenced. A robot's and a mood face's expression follow the status.
 *
 * With `animated`, a robot moves as its status does (CSS keyframes in the
 * document's own <style>, every name under its own prefix, all of it still
 * under prefers-reduced-motion): at work its visor eyes scan, its antenna
 * light blinks and it bobs; waiting on you its light pulses amber and it
 * looks up with a little hop every few seconds; done it settles once,
 * happy; failed it shakes once under its red visor; idle it breathes,
 * slow and dim. The other styles pulse their status dot while at work, and
 * a progress ring with no progress to show spins.
 *
 * Who draws it:
 * - the web page imports this module (web/app.js) and shows each document
 *   as an image;
 * - the mod imports it too (hooks/ui/v2/look.tsx): the Desktop pane draws an
 *   Svg element as an image of the same document;
 * - the terminal draws no SVG: `terminalFace` is its coloured glyph and
 *   status mark.
 *
 * A plain ES module with no DOM and no Node, so the mod's environment runs
 * it as a browser does (web/avatars.d.mts types it for the mod). Pure: the
 * same style, agent and options give the same string, so an image of it is
 * never loaded again while nothing about it changed.
 */

/** The styles, in the order a picker lists them, each with the name the owner saw it under. */
export const STYLES = [
  { id: 'robot', name: 'Robots' },
  { id: 'mood', name: 'Mood faces' },
  { id: 'critter', name: 'Critters' },
  { id: 'pixel', name: 'Pixel sprites' },
  { id: 'mono', name: 'Monogram tiles' },
  { id: 'orbit', name: 'Orbits' },
  { id: 'bauhaus', name: 'Bauhaus' },
  { id: 'ring', name: 'Progress rings' },
  { id: 'glyph', name: 'Terminal glyphs' },
  { id: 'blob', name: 'Blob faces' },
]

/** The style ids alone, in the pickers' order. */
export const STYLE_IDS = STYLES.map(one => one.id)

/** The style the deck draws until someone picks another. */
export const DEFAULT_STYLE = 'robot'

/** Each agent's two colours, picked by its seed: a deep one and a light one. */
export const PALETTE = [
  ['#7c3aed', '#f0abfc'],
  ['#2563eb', '#67e8f9'],
  ['#16a34a', '#bef264'],
  ['#ea580c', '#fde047'],
  ['#db2777', '#fbcfe8'],
  ['#0891b2', '#a5f3fc'],
  ['#4f46e5', '#c4b5fd'],
  ['#dc2626', '#fdba74'],
  ['#0d9488', '#6ee7b7'],
  ['#ca8a04', '#fef08a'],
]

/** Each look's hue: the status dot's, a ring's, a lit antenna's, the terminal's mark. */
export const LOOK_HUE = { running: '#3b82f6', waiting: '#f59e0b', done: '#22c55e', failed: '#ef4444', idle: '#a1a1aa' }

/** What the terminal draws for each look, after the agent's glyph: the deck's own status marks. */
export const LOOK_MARK = { running: '◐', waiting: '‖', done: '✓', failed: '✕', idle: '◌' }

/** The terminal's glyphs: one an agent, by its seed. */
export const GLYPHS = ['◆', '●', '▲', '■', '✦', '⬢', '★', '◉']

/** The ground a status dot is ringed in, as the gallery drew it: the deck's card. */
const GROUND = '#141414'
/** A face's dark ink. */
const INK = '#1a1a1a'

/** Each status the deck names, as a look: starting reads as running, and a stopped agent as idle. */
const LOOKS = { starting: 'running', running: 'running', waiting: 'waiting', done: 'done', failed: 'failed', idle: 'idle', stopped: 'idle' }

/** A status as the look it draws: running, waiting, done, failed or idle (idle for one the deck does not name). */
export function lookOf(status) {
  return Object.prototype.hasOwnProperty.call(LOOKS, status) ? LOOKS[status] : 'idle'
}

/** Whether `value` names one of the styles. */
export function isStyle(value) {
  return typeof value === 'string' && STYLE_IDS.includes(value)
}

/** `value` when it names a style, else the default. */
export function styleOf(value) {
  return isStyle(value) ? value : DEFAULT_STYLE
}

/** A style's name as a picker shows it ("Robots"); the default's for a style it does not know. */
export function styleName(style) {
  return (STYLES.find(one => one.id === style) ?? STYLES[0]).name
}

/** FNV-1a over the text's UTF-16 units, as the mod's own hash (hooks/format.ts): the same id, the same number, everywhere. */
export function hash(text) {
  const s = String(text)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A text's hash with its bits stirred (murmur3's finaliser), so every
 * character moves every pick. FNV-1a's own low decimal digit repeats across
 * ids alike: five of the sample's eight agents would share one colour.
 */
export function pickOf(text) {
  let h = hash(text)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** What an agent's look is seeded by: its id, which never changes, else its name. */
function seedOf(agent) {
  const id = agent && typeof agent.id === 'string' ? agent.id : ''
  const name = agent && typeof agent.name === 'string' ? agent.name : ''
  return id || name || '?'
}

/** An agent's palette index, 0 to 9, by its seed: the state's `avatar`. */
export function paletteIndexOf(agent) {
  return pickOf(seedOf(agent)) % PALETTE.length
}

/** An agent's two colours, deep then light: the palette's at its index. */
export function colorsOf(agent) {
  return PALETTE[paletteIndexOf(agent)]
}

/** How far through its own TodoWrite list an agent is, 0 to 1; undefined with no list. */
export function progressOf(todos) {
  const list = Array.isArray(todos) ? todos : []
  if (list.length === 0) return undefined
  return list.filter(one => one && one.status === 'done').length / list.length
}

/** Text with each lone surrogate (half a pair, which no URL or document can encode) as U+FFFD. */
function wellFormed(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    const next = text.charCodeAt(i + 1)
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += text[i] + text[i + 1]
      i++
    } else out += unit >= 0xd800 && unit <= 0xdfff ? String.fromCharCode(0xfffd) : text[i]
  }
  return out
}

/** Text for an SVG document: markup characters escaped, a lone surrogate replaced. */
function esc(text) {
  return wellFormed(String(text)).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

/** A number for markup: two decimals at most. */
const n2 = value => String(Math.round(value * 100) / 100)

/** An id fit for markup and CSS: letters, digits, `_` and `-`, led by a letter. */
function idOf(value) {
  const clean = String(value).replace(/[^A-Za-z0-9_-]/g, '')
  return /^[A-Za-z]/.test(clean) ? clean : `av${clean}`
}

// ------------------------------------------------------------------ styles
//
// Each draws one face on the 40 grid from `c`: { c1, c2, seed, h (the seed's
// hash), look, name, role, progress, u (the document's own id prefix), animated },
// as { defs, body, isDotted, css, isSpun }: its gradients and clips, its shapes,
// whether the status dot goes on it, its own motion's rules (when animated), and
// whether a ring spins.

/**
 * A robot's motion for its look: its rules and keyframes, every name under
 * the document's prefix `u` (the classes the robot's groups carry: `-bob`
 * the whole robot, `-eyes`, `-lt` its antenna lights, `-halo` their glow).
 */
function robotMotion(u, look) {
  const at = name => `${u}-${name}`
  if (look === 'running') {
    return [
      `.${at('bob')}{animation:${at('bob')} 1.4s ease-in-out infinite}`,
      `.${at('eyes')}{animation:${at('scan')} 2.8s ease-in-out infinite}`,
      `.${at('lt')}{animation:${at('blink')} 1.2s linear infinite}`,
      `@keyframes ${at('bob')}{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.2px)}}`,
      `@keyframes ${at('scan')}{0%,100%{transform:translateX(0)}25%{transform:translateX(-2.6px)}75%{transform:translateX(2.6px)}}`,
      `@keyframes ${at('blink')}{0%,49%{opacity:1}50%,100%{opacity:.25}}`,
    ].join('')
  }
  if (look === 'waiting') {
    return [
      `.${at('bob')}{animation:${at('hop')} 3.2s ease-in-out infinite}`,
      `.${at('eyes')}{animation:${at('look')} 3.2s ease-in-out infinite}`,
      `.${at('lt')}{animation:${at('pulse')} 1.6s ease-in-out infinite}`,
      `.${at('halo')}{animation:${at('glow')} 1.6s ease-in-out infinite}`,
      `@keyframes ${at('hop')}{0%,70%,100%{transform:translateY(0)}77%{transform:translateY(-2.2px)}84%{transform:translateY(0)}90%{transform:translateY(-1px)}96%{transform:translateY(0)}}`,
      `@keyframes ${at('look')}{0%,68%,100%{transform:translateY(0)}76%,90%{transform:translateY(-1px)}}`,
      `@keyframes ${at('pulse')}{0%,100%{opacity:1}50%{opacity:.45}}`,
      `@keyframes ${at('glow')}{0%,100%{opacity:.08}50%{opacity:.6}}`,
    ].join('')
  }
  if (look === 'done') {
    return `.${at('bob')}{animation:${at('settle')} .9s ease-out 1 both}@keyframes ${at('settle')}{0%{transform:translateY(-2.4px)}55%{transform:translateY(.6px)}100%{transform:translateY(0)}}`
  }
  if (look === 'failed') {
    return `.${at('bob')}{animation:${at('shake')} .6s ease-in-out 1}@keyframes ${at('shake')}{0%,100%{transform:translateX(0)}20%{transform:translateX(-1.6px)}40%{transform:translateX(1.6px)}60%{transform:translateX(-1px)}80%{transform:translateX(.8px)}}`
  }
  return `.${at('bob')}{animation:${at('breathe')} 4.8s ease-in-out infinite}@keyframes ${at('breathe')}{0%,100%{opacity:.8;transform:translateY(0)}50%{opacity:.6;transform:translateY(.7px)}}`
}

/** The robot's eyes, open, as its seed has them: two bars or two round lamps. */
function robotEyes(c2, isBar) {
  return isBar
    ? `<rect x="13" y="17" width="5" height="3" rx="1.5" fill="${c2}"/><rect x="22" y="17" width="5" height="3" rx="1.5" fill="${c2}"/>`
    : `<circle cx="15.5" cy="18.5" r="2.4" fill="${c2}"/><circle cx="24.5" cy="18.5" r="2.4" fill="${c2}"/>`
}

function robot(c) {
  const { c1, c2, h, look, u } = c
  const ant = h % 3
  const isBar = ((h >> 3) & 1) === 1
  // the antenna light: its own colour at work, the status hue when it waits, is done or failed, dim when idle
  const light = look === 'running' ? c2 : look === 'idle' ? '#71717a' : LOOK_HUE[look]
  const lamps = ant === 0 ? [[20, 4, 2.4]] : ant === 1 ? [[12, 4, 2], [28, 4, 2]] : [[20, 5.4, 1.7]]
  const stalk =
    ant === 0
      ? `<line x1="20" y1="9" x2="20" y2="4" stroke="${c1}" stroke-width="2"/>`
      : ant === 1
        ? `<line x1="15" y1="9" x2="12" y2="4" stroke="${c1}" stroke-width="2"/><line x1="25" y1="9" x2="28" y2="4" stroke="${c1}" stroke-width="2"/>`
        : `<path d="M16 9q4-7 8 0" stroke="${c1}" stroke-width="2" fill="none"/>`
  const halo = look === 'waiting' ? lamps.map(([x, y, r]) => `<circle class="${u}-halo" cx="${x}" cy="${y}" r="${n2(r + 2.2)}" fill="${light}" opacity=".3"/>`).join('') : ''
  const bulbs = lamps.map(([x, y, r]) => `<circle class="${u}-lt" cx="${x}" cy="${y}" r="${r}" fill="${light}"/>`).join('')
  const visor =
    look === 'failed'
      ? '<rect x="10" y="13" width="20" height="11" rx="5" fill="#4c0d0d" stroke="#ef4444" stroke-width="1"/>'
      : `<rect x="10" y="13" width="20" height="11" rx="5" fill="${look === 'idle' ? '#18181b' : '#111'}"/>`
  const eyes =
    look === 'done'
      ? `<path d="M13 20.2q2.5-4.4 5 0M22 20.2q2.5-4.4 5 0" stroke="${c2}" stroke-width="2" fill="none" stroke-linecap="round"/>`
      : look === 'failed'
        ? '<path d="M13.6 16.6l3.8 3.8M17.4 16.6l-3.8 3.8M22.6 16.6l3.8 3.8M26.4 16.6l-3.8 3.8" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round"/>'
        : look === 'idle'
          ? `<path d="M13 19h5M22 19h5" stroke="${c2}" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>`
          : look === 'waiting'
            ? `<g transform="translate(0 -2)">${robotEyes(c2, isBar)}</g>`
            : robotEyes(c2, isBar)
  const parts = [
    stalk,
    halo,
    bulbs,
    `<rect x="7" y="9" width="26" height="22" rx="7" fill="${c1}"/>`,
    visor,
    `<g class="${u}-eyes">${eyes}</g>`,
    '<rect x="15" y="27" width="10" height="2" rx="1" fill="#111" opacity=".5"/>',
  ].join('')
  return { body: `<g class="${u}-bob"${look === 'idle' ? ' opacity=".8"' : ''}>${parts}</g>`, isDotted: true, css: c.animated ? robotMotion(u, look) : '' }
}

function mood(c) {
  const { c1, c2, look } = c
  const k = INK
  let face
  if (look === 'done') face = `<path d="M11 18q3-4 6 0M23 18q3-4 6 0" stroke="${k}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M14 25q6 6 12 0" stroke="${k}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  else if (look === 'failed') face = `<path d="M12 15l4 4M16 15l-4 4M24 15l4 4M28 15l-4 4" stroke="${k}" stroke-width="2" stroke-linecap="round"/><path d="M14 28q6-5 12 0" stroke="${k}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  else if (look === 'waiting') face = `<path d="M11 12l5-1M24 11l5 1" stroke="${k}" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="18" r="2.2" fill="${k}"/><circle cx="26" cy="18" r="2.2" fill="${k}"/><circle cx="20" cy="27" r="2.6" fill="none" stroke="${k}" stroke-width="2"/>`
  else if (look === 'idle') face = `<path d="M11 19h6M23 19h6" stroke="${k}" stroke-width="2" stroke-linecap="round"/><path d="M16 27h8" stroke="${k}" stroke-width="2" stroke-linecap="round"/><text x="29" y="10" font-size="8" fill="${c1}" font-family="sans-serif">z</text>`
  else face = `<circle cx="16" cy="18" r="2.2" fill="${k}"/><circle cx="27" cy="18" r="2.2" fill="${k}"/><path d="M16 26h9" stroke="${k}" stroke-width="2" stroke-linecap="round"/>`
  return { body: `<circle cx="20" cy="20" r="17" fill="${c2}"/><circle cx="20" cy="20" r="17" fill="none" stroke="${c1}" stroke-width="2.5"/>${face}`, isDotted: false }
}

function critter(c) {
  const { c1, c2, seed } = c
  const k = INK
  const t = pickOf(`${seed}c`) % 6
  const ears = [
    `<polygon points="8,15 11,4 17,11" fill="${c1}"/><polygon points="32,15 29,4 23,11" fill="${c1}"/>`,
    `<circle cx="10" cy="10" r="5" fill="${c1}"/><circle cx="30" cy="10" r="5" fill="${c1}"/>`,
    `<rect x="11" y="1" width="6" height="15" rx="3" fill="${c1}"/><rect x="23" y="1" width="6" height="15" rx="3" fill="${c1}"/>`,
    `<polygon points="9,12 6,3 15,9" fill="${c1}"/><polygon points="31,12 34,3 25,9" fill="${c1}"/>`,
    '',
    `<polygon points="7,16 13,2 19,12" fill="${c1}"/><polygon points="33,16 27,2 21,12" fill="${c1}"/>`,
  ][t]
  const face =
    t === 4
      ? `<circle cx="13" cy="13" r="6" fill="${c1}"/><circle cx="27" cy="13" r="6" fill="${c1}"/><circle cx="13" cy="13" r="3" fill="#fff"/><circle cx="27" cy="13" r="3" fill="#fff"/><circle cx="13" cy="13" r="1.6" fill="${k}"/><circle cx="27" cy="13" r="1.6" fill="${k}"/>`
      : t === 3
        ? `<circle cx="15" cy="20" r="3.4" fill="#fff"/><circle cx="25" cy="20" r="3.4" fill="#fff"/><circle cx="15" cy="20" r="1.8" fill="${k}"/><circle cx="25" cy="20" r="1.8" fill="${k}"/>`
        : `<circle cx="15" cy="20" r="1.9" fill="${k}"/><circle cx="25" cy="20" r="1.9" fill="${k}"/>`
  const snout = t === 5 ? `<path d="M14 26q6 6 12 0z" fill="${c2}"/><circle cx="20" cy="26" r="1.5" fill="${k}"/>` : `<ellipse cx="20" cy="26" rx="4" ry="2.6" fill="${c2}"/><circle cx="20" cy="25.4" r="1.2" fill="${k}"/>`
  return { body: `${ears}<ellipse cx="20" cy="22" rx="14" ry="13" fill="${c1}"/>${face}${snout}`, isDotted: true }
}

function pixel(c) {
  const { c1, c2, seed } = c
  const h = pickOf(`${seed}#`)
  let out = '<rect x="2" y="2" width="36" height="36" rx="9" fill="#232323"/>'
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!((h >> (y * 3 + x)) & 1)) continue
      const fill = (h >> (15 + y)) & 1 ? c2 : c1
      for (const col of x === 2 ? [2] : [x, 4 - x]) out += `<rect x="${n2(7 + col * 5.2)}" y="${n2(7 + y * 5.2)}" width="5.2" height="5.2" fill="${fill}"/>`
    }
  }
  return { body: out, isDotted: true }
}

/** A monogram's two letters: the name's first, then its second consonant (else its second letter), as "Bl" for builder. */
function monogramOf(name) {
  const letters = Array.from(String(name).trim())
  if (letters.length === 0) return '?'
  const consonants = letters.filter(ch => !/[aeiou]/i.test(ch))
  const second = consonants[1] ?? letters[1] ?? ''
  return `${letters[0].toUpperCase()}${second.toLowerCase()}`
}

function mono(c) {
  const { c1, name } = c
  return {
    body: `<rect x="3" y="3" width="34" height="34" rx="10" fill="${c1}"/><text x="20" y="25.5" text-anchor="middle" font-size="14" font-weight="500" fill="#fff" font-family="sans-serif">${esc(monogramOf(name))}</text>`,
    isDotted: true,
  }
}

function orbit(c) {
  const { c1, c2, h, role } = c
  if (role === 'main') {
    let rays = ''
    for (let i = 0; i < 8; i++) {
      const t = (i * Math.PI) / 4
      rays += `<line x1="${n2(20 + Math.cos(t) * 11)}" y1="${n2(20 + Math.sin(t) * 11)}" x2="${n2(20 + Math.cos(t) * 16)}" y2="${n2(20 + Math.sin(t) * 16)}" stroke="${c2}" stroke-width="2.4" stroke-linecap="round"/>`
    }
    return { body: `${rays}<circle cx="20" cy="20" r="8" fill="${c1}"/>`, isDotted: true }
  }
  const ang = ((h % 360) * Math.PI) / 180
  return {
    body: `<ellipse cx="20" cy="20" rx="16" ry="7" fill="none" stroke="${c2}" stroke-width="1.6" transform="rotate(-25 20 20)"/><circle cx="20" cy="20" r="8.5" fill="${c1}"/><circle cx="${n2(20 + Math.cos(ang) * 15)}" cy="${n2(20 + Math.sin(ang) * 7)}" r="2.6" fill="${c2}"/>`,
    isDotted: true,
  }
}

function bauhaus(c) {
  const { c1, c2, seed, u } = c
  const h = pickOf(`${seed}b`)
  const clip = `${u}-clip`
  const shape = [
    `<rect x="20" y="0" width="20" height="40" fill="${c2}"/>`,
    `<polygon points="0,40 40,40 20,14" fill="${c2}"/>`,
    `<circle cx="20" cy="40" r="16" fill="${c2}"/>`,
    `<rect x="0" y="0" width="20" height="20" fill="${c2}"/><rect x="20" y="20" width="20" height="20" fill="${c2}"/>`,
  ][(h >> 4) % 4]
  return {
    defs: `<clipPath id="${clip}"><circle cx="20" cy="20" r="17"/></clipPath>`,
    body: `<g clip-path="url(#${clip})"><rect width="40" height="40" fill="${c1}"/><g transform="rotate(${(h % 4) * 90} 20 20)">${shape}</g><circle cx="${12 + ((h >> 7) % 16)}" cy="${12 + ((h >> 9) % 16)}" r="3.5" fill="#141414"/></g>`,
    isDotted: true,
  }
}

function ring(c) {
  const { c1, look, name, progress, u } = c
  const length = 2 * Math.PI * 15
  const known = typeof progress === 'number' && Number.isFinite(progress)
  const frac = known ? Math.min(1, Math.max(0, progress)) : look === 'done' || look === 'failed' ? 1 : look === 'idle' ? 0 : 0.5
  const initial = Array.from(String(name).trim())[0] ?? '?'
  const arc = frac > 0 ? `<g class="${u}-spin"><circle cx="20" cy="20" r="15" fill="none" stroke="${LOOK_HUE[look]}" stroke-width="3.5" stroke-dasharray="${n2(length * frac)} ${n2(length)}" transform="rotate(-90 20 20)" stroke-linecap="round"/></g>` : ''
  return {
    body: `<circle cx="20" cy="20" r="15" fill="#1f1f1f" stroke="#333" stroke-width="3.5"/>${arc}<text x="20" y="25" text-anchor="middle" font-size="13" font-weight="500" fill="${c1}" font-family="sans-serif">${esc(initial.toUpperCase())}</text>`,
    isDotted: false,
    isSpun: !known && look === 'running',
  }
}

function glyph(c) {
  const { c1, h } = c
  return {
    body: `<rect x="3" y="3" width="34" height="34" rx="6" fill="#0c0c0c" stroke="#2b2b2b"/><text x="20" y="27" text-anchor="middle" font-size="19" fill="${c1}" font-family="monospace">${GLYPHS[h % GLYPHS.length]}</text>`,
    isDotted: true,
  }
}

function blob(c) {
  const { c1, c2, u } = c
  const fill = `${u}-fill`
  return {
    defs: `<linearGradient id="${fill}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`,
    body: `<path d="M20 4c9 0 15 6 15 15v15c0 2-2 3-3 2l-3-2-3 2-3-2-3 2-3-2-3 2-3-2-3 2c-1 1-3 0-3-2V19C5 10 11 4 20 4z" fill="url(#${fill})"/><ellipse cx="15" cy="19" rx="2.6" ry="3.2" fill="#fff"/><ellipse cx="25" cy="19" rx="2.6" ry="3.2" fill="#fff"/><circle cx="15.6" cy="19.6" r="1.4" fill="#1a1a1a"/><circle cx="25.6" cy="19.6" r="1.4" fill="#1a1a1a"/>`,
    isDotted: true,
  }
}

const DRAW = { robot, mood, critter, pixel, mono, orbit, bauhaus, ring, glyph, blob }

/** What a style draws for `agent` with `opts`: its context, then its parts (see the styles above). */
function partsOf(style, agent, opts) {
  const which = styleOf(style)
  const seed = seedOf(agent)
  const h = pickOf(seed)
  const [c1, c2] = PALETTE[h % PALETTE.length]
  const look = lookOf(agent && agent.status)
  const name = agent && typeof agent.name === 'string' && agent.name.trim() ? agent.name : seed
  const role = agent && agent.role === 'main' ? 'main' : ''
  const progress = agent && typeof agent.progress === 'number' && Number.isFinite(agent.progress) ? agent.progress : undefined
  const animated = opts.animated === true
  const isDotted = opts.dot !== false
  const ground = typeof opts.ground === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(opts.ground) ? opts.ground : GROUND
  const size = typeof opts.size === 'number' && opts.size > 0 && Number.isFinite(opts.size) ? opts.size : 40
  const u = opts.id ? idOf(opts.id) : `av${hash([which, seed, look, which === 'mono' || which === 'ring' ? name : '', role, which === 'ring' ? progress ?? '' : '', size, animated, isDotted, ground].join('|')).toString(36)}`
  // the prefix names only what this style draws: a robot whose todo list moves on keeps its document, so its image or frame never loads again for it
  const c = { c1, c2, seed, h, look, name, role, progress, u, animated }
  const drawn = DRAW[which](c)
  const dotted = isDotted && drawn.isDotted
  // the other styles' light motion: a dot that pulses while at work, a ring with no progress to show that spins
  const extra = !animated
    ? ''
    : [
        dotted && look === 'running' && which !== 'robot' ? `.${u}-dot{animation:${u}-ping 1.8s ease-in-out infinite}@keyframes ${u}-ping{0%,100%{fill-opacity:1}50%{fill-opacity:.4}}` : '',
        drawn.isSpun ? `.${u}-spin{transform-origin:20px 20px;animation:${u}-spin 1.6s linear infinite}@keyframes ${u}-spin{to{transform:rotate(360deg)}}` : '',
      ].join('')
  const motion = (drawn.css ?? '') + extra
  // asked for less motion, the reader gets none: every animation in the document stops
  const css = motion ? `${motion}@media (prefers-reduced-motion:reduce){.${u} *{animation:none!important}}` : ''
  return { ...drawn, c, isDotted: dotted, ground, size, css }
}

/** The status dot, as the gallery drew it: at the face's foot, ringed in the ground. */
function dotOf(c, ground) {
  return `<circle class="${c.u}-dot" cx="33" cy="33" r="6" fill="${LOOK_HUE[c.look]}" stroke="${ground}" stroke-width="3"/>`
}

const made = new Map()

/** `make()` once per `key` while the module lives (the newest 400 kept). */
function memo(key, make) {
  const known = made.get(key)
  if (known !== undefined) return known
  const value = make()
  if (made.size >= 400) made.delete(made.keys().next().value)
  made.set(key, value)
  return value
}

/**
 * One agent's avatar in `style` as a whole SVG document.
 *
 * `agent`: `{ id, name, role, status, progress? }`. It is seeded by its id
 * (else its name), so an agent keeps its look; `role` 'main' is the
 * Orchestrator; `status` is the deck's (starting, running, waiting, done,
 * failed, idle, or stopped); `progress` (0 to 1) fills a progress ring.
 *
 * `opts`: `animated` (its status's motion; off by default), `size` (CSS px
 * square; 40), `dot` (false leaves the status dot off), `id` (the document's
 * id prefix; by default one made from everything it draws, so two documents
 * that differ never share an id), `ground` (the colour the dot is ringed in).
 */
export function avatarSvg(style, agent, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {}
  const key = JSON.stringify([style, agent && agent.id, agent && agent.name, agent && agent.role, agent && agent.status, agent && agent.progress, options.animated, options.size, options.dot, options.id, options.ground])
  return memo(key, () => {
    const p = partsOf(style, agent, options)
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" class="${p.c.u}" width="${n2(p.size)}" height="${n2(p.size)}" viewBox="0 0 40 40">`,
      p.css ? `<style>${p.css}</style>` : '',
      p.defs ? `<defs>${p.defs}</defs>` : '',
      p.body,
      p.isDotted ? dotOf(p.c, p.ground) : '',
      '</svg>',
    ].join('')
  })
}

/** The px a stack of `n` faces `size` square takes across, each after the first `overlap` px over the one before. */
export function stackWidth(n, size, overlap = 5) {
  return n <= 0 ? 0 : size + (n - 1) * (size - overlap)
}

/**
 * Faces side by side in one SVG document, each after the first `overlap` px
 * over the one before and set on a plate of `ground` so they read apart: an
 * editors' stack. A null is a grey disc (one the state does not hold). Still,
 * with no status dots.
 */
export function avatarStackSvg(style, agents, opts = {}) {
  const list = Array.isArray(agents) ? agents : []
  const size = typeof opts.size === 'number' && opts.size > 0 ? opts.size : 20
  const overlap = typeof opts.overlap === 'number' ? opts.overlap : 5
  const ground = typeof opts.ground === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(opts.ground) ? opts.ground : GROUND
  const width = stackWidth(list.length, size, overlap)
  const k = n2(size / 40)
  const faces = list.map((agent, i) => {
    const at = `translate(${n2(i * (size - overlap))} 0) scale(${k})`
    const plate = `<rect width="40" height="40" rx="13" fill="${ground}"/>`
    if (!agent) return `<g transform="${at}">${plate}<circle cx="20" cy="20" r="15" fill="#262626"/></g>`
    const p = partsOf(style, agent, { dot: false, id: `${opts.id ? idOf(opts.id) : 'st'}${i}-${hash(seedOf(agent)).toString(36)}` })
    return `<g transform="${at}">${plate}<g transform="translate(2.5 2.5) scale(.875)">${p.defs ? `<defs>${p.defs}</defs>` : ''}${p.body}</g></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(width)}" height="${n2(size)}" viewBox="0 0 ${n2(width)} ${n2(size)}">${faces.join('')}</svg>`
}

/**
 * What the terminal draws for an agent, which draws no SVG: its glyph
 * ('◆●▲■✦⬢★◉', by its seed) in its deep colour, and its status's mark in
 * the status's hue (◐ at work, ‖ waiting on you, ✓ done, ✕ failed, ◌ idle).
 */
export function terminalFace(agent) {
  const seed = seedOf(agent)
  const h = pickOf(seed)
  const look = lookOf(agent && agent.status)
  return { glyph: GLYPHS[h % GLYPHS.length], color: PALETTE[h % PALETTE.length][0], mark: LOOK_MARK[look], markColor: LOOK_HUE[look] }
}

/** An SVG document as a `data:` URL, the way an image of it is drawn. */
export function dataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
