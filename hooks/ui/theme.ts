/**
 * The deck's visual tokens: a "bench" palette (its
 * own values), as the approved specimen uses it: warm
 * graphite, four levels of bone text, one copper accent, muted status
 * colours. `.interface-design/system.md` documents the decisions behind them.
 *
 * `T` holds the exact colours and fonts. SVG takes all of them; native Text
 * takes the status hues, the add and remove hues and copper as given (hex),
 * and carries the four text levels as weight and dim (`NATIVE_TEXT`), so
 * they follow the host's theme. Every value in `T` is a 6-digit hex: the
 * emulator's translucent lines are flattened onto `Panel` here.
 */

export const T = {
  /** Graphite: the ground of the map and the charts (the instrument face). */
  bg: '#161615',
  /** Panel: agent plates, metric cards. */
  panel: '#1d1d1b',
  /** Raised: the You plate, Wire lane headers. */
  raised: '#242422',
  /** CopperWash (copper at 12%) on Panel: the selected plate's fill. */
  selected: '#322921',
  /** Track: the fill of the ask and task direction tags. */
  track: '#3a3935',
  /** HairlineStrong (bone at 14%) on Panel: plate edges, the face's edge, lane lifelines. */
  line: '#3a3936',
  /** Outline (bone at 18%) on Panel: tree wires, outlined and dashed tags. */
  lineStrong: '#42413d',
  /** Bone: names, values that lead. */
  text1: '#e9e4d8',
  /** BoneDim: the now line, message text. */
  text2: '#b9b3a6',
  /** Dust: labels, times, counts, arrows in Wire. */
  text3: '#8a857b',
  /** Ash: placeholders, zero counts, the "earlier" marker. */
  text4: '#5e5a53',
  /** Copper: selection and "look here", nothing else. */
  copper: '#c9824f',
  /** Sage: running; lines added. */
  ok: '#86a973',
  /** Ochre: waiting on you. */
  warn: '#d9b44a',
  /** Oxide: failed; lines removed. */
  err: '#d2614e',
  /** Steel: done. */
  info: '#7d9bb5',
  fontLabel: "Bahnschrift,'Segoe UI',system-ui,sans-serif",
  fontMono: "'Cascadia Mono',Consolas,'Courier New',monospace",
} as const

/** The SVG type scale (~1.2) in logical px, as the emulator's FontSize keys. */
export const SIZE = { caption: 11, label: 12, body: 13, title: 15, large: 18 } as const

/** Corner radii in px: direction tags, plates and cards, the map's face. Status squares stay square. */
export const RADIUS = { tag: 2, plate: 3, face: 4 } as const

export type Status = 'running' | 'waiting' | 'done' | 'failed' | 'idle'

/** The status square's colour: green running, amber waiting, blue done, red failed, grey idle. */
export const STATUS_COLOR: Record<Status, string> = {
  running: T.ok,
  waiting: T.warn,
  done: T.info,
  failed: T.err,
  idle: T.text3,
}

/** The status square as native text: filled, except idle, which is hollow (drawn as an outline in SVG too). */
export const STATUS_GLYPH: Record<Status, string> = {
  running: '■',
  waiting: '■',
  done: '■',
  failed: '■',
  idle: '□',
}

/** The four text levels as native Text props: no font or size natively, so weight and dim carry the ramp. */
export const NATIVE_TEXT = {
  text1: { bold: true },
  text2: {},
  text3: { dimColor: true },
  text4: { dimColor: true, italic: true },
} as const
