/**
 * Every session on this machine (../../sessions, web/CONTRACT.md "All
 * sessions"), in the pane and the terminal: one deck at a time, any
 * session's, with no mode for another's.
 *
 * - The header's first line is the switcher (`headLine`): the state's dot
 *   and word, then the session's title with ▾, a press dropping the list in
 *   place over the tabs (▴ while it shows); at the right "◆ 1 needs you" in
 *   amber while another session waits on you, then the sessions on this
 *   machine (the web's layers icon, then "4 sessions"), which drops it too.
 *   `s` does the same everywhere: on a desktop through a Button kept out of
 *   sight, so no key cue shows beside the count; the terminal draws its cue
 *   ("s: 4 sessions"), as it draws each tab's.
 * - The list (`sessionsList`): a row a session, here's first, in an order
 *   that never moves with their states. Each row: its state's dot, its title
 *   (a press shows its deck, the list closing) and "here" on the session the
 *   deck belongs to; where it runs (its surface's icon, its place and its
 *   repository) and what it waits on you for (amber) or what it is doing;
 *   its agents' faces while they work (as its own deck draws them; none
 *   for the Orchestrator), its state's word, its spend (a fork's "incl.
 *   its parent's" under it) and how long since it changed. The one shown is
 *   lit. A quiet one (its deck not heard from lately) says when it was last
 *   heard, its dot hollow, no word, need or face.
 * - Another session's deck before its state is read (`pendingDeck`): the
 *   same switcher, from its row, and why nothing shows yet.
 *
 * The terminal draws the same rows with text for the icons and the tag.
 *
 * Pure: Kit, the list and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as AV from '../../../web/avatars.mjs'
import { facesOf, othersWaitingOf, type SessionRowV2, type SessionsV2 } from '../../sessions'
import type { DashActions, Kit } from '../types'
import { isAiry, listBox } from './dash'
import { advanceOf, avatarStyleOf, quiet, svgOf } from './look'
import { P, tagWidth } from './palette'
import { buttonSlack, cellsForPx, edgesOf, pressText, rule, wrapAdvanceOf } from './parts'
import { cellsOf, cutCells } from './text'

/** The key that drops the list, on every surface: one lowercase letter, as a pane's hotkey must be. */
export const SESSIONS_KEY = 's'

/** Each state's dot and word hue, as the header's. */
const DOT: Readonly<Record<SessionRowV2['state'], string>> = { working: P.run, waiting: P.wait, idle: P.idleDot }
const HUE: Readonly<Record<SessionRowV2['state'], string>> = { working: P.runText, waiting: P.waitText, idle: P.muted2 }
/** The header's word, as ./deck draws it: idle a shade brighter than a row's. */
const HEAD_HUE: Readonly<Record<SessionRowV2['state'], string>> = { working: P.runText, waiting: P.waitText, idle: P.muted }

/** The row of the session shown, lit as the web's rail lights it. */
const LIT = '#242424'

/** The icons the list draws (Lucide's laptop, square-terminal and layers, 24 px strokes, as the web's). */
const ICON_PATHS: Readonly<Record<'desktop' | 'terminal' | 'layers', string>> = {
  desktop: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  terminal: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
}

/** An icon as an SVG document, `px` square, its strokes in `color`. */
function iconSvg(name: keyof typeof ICON_PATHS, color: string, px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`
}

/** A surface's icon in a row, and the layers icon of the header's count, in px. */
const ICON = 12
const LAYERS = 14

/** Where a session draws, as an icon where Svg draws (a laptop for the Desktop, a prompt for a terminal); nothing on the terminal, whose words say it. */
function surfaceIcon(kit: Kit, row: SessionRowV2): RenderElement | null {
  const Svg = svgOf(kit)
  if (!Svg || row.surface === '') return null
  const which = row.surface === 'terminal' ? 'terminal' : 'desktop'
  return <Svg source={iconSvg(which, P.muted2, ICON)} alt={row.place} width={ICON} height={ICON} />
}

/** "here", quietly: a grey tag where Svg draws (the web's `.tag`), dim words on the terminal. */
function hereTag(kit: Kit): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (!Svg) return <Text color={P.muted2}>· here</Text>
  const width = tagWidth('here')
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18" viewBox="0 0 ${width} 18"><rect width="${width}" height="18" rx="9" fill="${P.chip}"/><text x="${width / 2}" y="13" text-anchor="middle" font-size="11" font-weight="500" fill="${P.muted}">here</text></svg>`
  return <Svg source={source} alt="here" width={width} height={18} />
}

/** Narrower than this, the header's "◆ 1 needs you" says "◆ 1" alone, as the page's header does when narrow. */
const NEED_WORDS_FROM = 64
/** Narrower than this, the count says its number alone. */
const COUNT_WORD_FROM = 48

/** What the header's first line leads with: the state of the session shown in a word, and its title. */
export type Head = { state: SessionRowV2['state']; stateText: string; title: string }

/**
 * The header's first line: the state's dot and word, then the switcher (the
 * session's title and ▾, ▴ while the list shows; a press drops the list or
 * closes it) cut to the room the right leaves, and at the right "◆ 1 needs
 * you" while another session waits on you, then the sessions' count with the
 * layers icon, which drops it too. With no list (the registry off), the
 * title alone, as words.
 */
export function headLine(kit: Kit, head: Head, view: SessionsV2 | undefined, shownId: string, isOpen: boolean, actions: Pick<DashActions, 'openSessions'>): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const right = view ? countCluster(kit, view, shownId, actions) : null
  // the switcher's room: the line less the dot, the word, the right's cells and the gaps between
  const room = kit.columns - 2 - cellsOf(head.stateText, adv) - 1 - (right ? right.cells + 2 : 0) - buttonSlack(kit) - 1
  const mark = isOpen ? '▴' : '▾'
  const title = cutCells(head.title, Math.max(4, room - cellsOf(` ${mark}`, adv)), adv)
  return (
    <Box key="deck:headline" flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>
        <Text color={DOT[head.state]}>●</Text>
      </Box>
      <Box flexShrink={0}>
        <Text bold color={HEAD_HUE[head.state]}>
          {head.stateText}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row">
        {view ? (
          <Box flexShrink={1} minWidth={0}>
            <Button key="sessions:switch" label={`${title} ${mark}`} plain onPress={() => actions.openSessions()} />
          </Box>
        ) : (
          <Text color={P.fg2} wrap="truncate-end">
            {head.title}
          </Text>
        )}
      </Box>
      {right ? <Box flexShrink={0}>{right.el}</Box> : null}
    </Box>
  )
}

/**
 * The header's right: "◆ 1 needs you ·" in amber while a session other than
 * the one shown waits on you ("◆ 1 ·" where narrow), then the layers icon
 * and "4 sessions" (a press drops the list). `s` presses it on every
 * surface: a desktop draws a hotkey's cue beside its Button, so there the
 * hotkey sits on a Button kept out of sight; the terminal draws its cue as
 * it does each tab's ("s: 4 sessions"). Its cells, for the switcher's room.
 */
function countCluster(kit: Kit, view: SessionsV2, shownId: string, actions: Pick<DashActions, 'openSessions'>): { el: RenderElement; cells: number } {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const Svg = svgOf(kit)
  const n = view.rows.length
  const waiting = othersWaitingOf(view, shownId)
  const need = waiting > 0 ? `◆ ${waiting}${kit.columns >= NEED_WORDS_FROM ? ` ${waiting === 1 ? 'needs' : 'need'} you` : ''} ·` : ''
  const count = kit.columns >= COUNT_WORD_FROM ? `${n} ${n === 1 ? 'session' : 'sessions'}` : String(n)
  const isHidden = kit.surface === 'desktop'
  const press = () => actions.openSessions()
  const cells = (need !== '' ? cellsOf(need, adv) + 1 : 0) + (Svg ? cellsForPx(LAYERS) + 1 : 0) + cellsOf(count, adv) + buttonSlack(kit) + (isHidden ? 0 : 3)
  const el = (
    <Box key="deck:sessions" flexDirection="row" columnGap={1} alignItems="center">
      {need !== '' ? (
        <Box flexShrink={0}>
          <Text color={P.waitText}>{need}</Text>
        </Box>
      ) : null}
      {Svg ? (
        <Box flexShrink={0}>
          <Svg source={iconSvg('layers', P.muted, LAYERS)} alt="Sessions" width={LAYERS} height={LAYERS} />
        </Box>
      ) : null}
      <Box flexShrink={0}>
        <Button key={isHidden ? 'sessions:count' : 'key:s'} label={count} plain dimColor {...(isHidden ? {} : { hotkey: SESSIONS_KEY })} onPress={press} />
      </Box>
      {isHidden ? (
        <Box display="none">
          <Button key="key:s" label="All sessions" plain hotkey={SESSIONS_KEY} onPress={press} />
        </Box>
      ) : null}
    </Box>
  )
  return { el, cells }
}

/** The rows the list draws at most; past them, a line says how many more (the web page lists them all). */
export const MOST_SESSION_ROWS = 12

/**
 * The list, dropped in place over the tabs: a row a session, the one shown
 * lit, and under it what it holds and how to leave it. A press on a title
 * shows that session's deck; `s` closes the list.
 */
export function sessionsList(kit: Kit, view: SessionsV2, shownId: string, actions: Pick<DashActions, 'openSession'>): RenderElement {
  const { Box, Text } = kit
  const shown = view.rows.slice(0, MOST_SESSION_ROWS)
  const more = view.rows.length - shown.length
  const rows = shown.flatMap((row, i) => [i > 0 ? rule(kit) : null, sessionRow(kit, row, row.id === shownId, actions)])
  if (more > 0) rows.push(rule(kit), <Box key="sessions:more" paddingX={1}><Text color={P.muted2}>{`and ${more} more: /deck web lists them all`}</Text></Box>)
  const note =
    view.rows.length > 1
      ? kit.surface === 'terminal'
        ? 'Every session here whose deck runs. Enter shows one; s closes.'
        : 'Every Claude Code session on this machine whose deck runs. A press shows its deck here; s closes the list.'
      : 'No other session here runs Agent Deck now. Each one that does shows here, Desktop and terminal alike.'
  return (
    <Box key="sessions" flexDirection="column" gap={isAiry(kit) ? 1 : 0}>
      {listBox(kit, 'sessions:list', rows)}
      {quiet(kit, note)}
    </Box>
  )
}

/** The cells the faces, the state's word, the spend and the age take at a row's right. */
const FACES = 5
const WORD = 15
const COST = 7
const AGE = 4

/** Narrower than these cells a row leaves out its faces and its spend, then its state's word (its dot says it), as the page's list does: its title and what it says keep the room. */
const COST_FROM = 64
const WORD_FROM = 48

/** How much faster what a session says gives way than where it runs when its line runs short: as on the page, its place and repository are cut only once it has gone. A quiet one the other way round: when it was last heard is what it says now. */
const SAY_SHRINK = 100

/** A face in a row's stack, in px. */
const FACE = 16

/**
 * The cells a row's second line has, about (a cell under, to be sure):
 * the list's width less its edges, the row's padding, its dot, the columns
 * shown at its right and the surface's icon. Where it runs keeps its whole
 * width up to this, so it cuts only where it alone does not fit.
 */
function lineRoom(kit: Kit, isFaces: boolean, isWord: boolean, isCost: boolean, hasIcon: boolean): number {
  const right = (isFaces ? FACES + 1 : 0) + (isWord ? WORD + 1 : 0) + (isCost ? COST + 1 : 0) + AGE + 1
  return Math.max(0, Math.floor(kit.columns - edgesOf(kit) - 2 - 2 - right - (hasIcon ? cellsForPx(ICON) + 1 : 0) - 1))
}

/** A row's faces while its agents work (./sessions `facesOf`): each as its session's own deck draws it (its id the seed, its title the name), one stacked image; nothing for the Orchestrator alone, whose dot says it works, nor where Svg does not draw, whose words count them. */
function rowFaces(kit: Kit, row: SessionRowV2): RenderElement | null {
  const { Box, Text } = kit
  const Svg = svgOf(kit)
  const { faces, more } = facesOf(row)
  if (!Svg || faces.length === 0) return null
  const agents = faces.map(face => ({ id: face.id, name: face.title, role: '', status: face.status, progress: face.progress }))
  return (
    <Box flexDirection="row" alignItems="center">
      <Svg source={AV.avatarStackSvg(avatarStyleOf(kit), agents, { size: FACE, ground: P.ground })} alt={`${row.working} at work`} width={AV.stackWidth(faces.length, FACE)} height={FACE} />
      {more > 0 ? <Text color={P.muted2}>{`+${more}`}</Text> : null}
    </Box>
  )
}

/**
 * One session: its dot (hollow while quiet); its title (the press that
 * shows its deck) cut to the room "here" leaves, then where it runs and what
 * it says, each cut before it reaches the next; its faces, word, spend and
 * age, the faces and spend and then the word left out where the pane is
 * narrow. A fork's spend says under it that it counts its parent's ("incl.
 * its parent's"), its line under the word and the spend, ending where the
 * spend does. The one shown lit.
 */
function sessionRow(kit: Kit, row: SessionRowV2, isShown: boolean, actions: Pick<DashActions, 'openSession'>): RenderElement {
  const { Box, Text } = kit
  const show = () => actions.openSession(row.id)
  // in a column Box beside the tag: the title's line is then no wider than the room the tag leaves, and cuts there
  const words = <Text bold color={P.text} wrap="truncate-end">{row.title}</Text>
  const title = row.isMe || row.canOpen ? pressText(kit, `session:${row.id}`, [words], show) : words
  const icon = surfaceIcon(kit, row)
  const isCost = kit.columns >= COST_FROM
  const isWord = kit.columns >= WORD_FROM
  const isFaces = isCost && svgOf(kit) !== undefined
  // where it runs stays whole while the line has room for it: what it says gives way first (a quiet one's "Last heard 2m ago" stays, and where it runs gives way)
  const room = lineRoom(kit, isFaces, isWord, isCost, icon !== null)
  const whereWidth = row.isQuiet ? 0 : Math.min(Math.ceil(cellsOf(row.where, wrapAdvanceOf(kit))), room)
  const sayWidth = row.isQuiet ? Math.min(Math.ceil(cellsOf(`· ${row.say}`, wrapAdvanceOf(kit))), room) : 0
  const right = [
    isFaces ? (
      <Box flexShrink={0} width={FACES} justifyContent="flex-end">
        {rowFaces(kit, row)}
      </Box>
    ) : null,
    isWord ? (
      <Box flexShrink={0} width={WORD} justifyContent="flex-end">
        <Text color={HUE[row.state]}>{row.stateText}</Text>
      </Box>
    ) : null,
    isCost ? (
      <Box flexShrink={0} width={COST} justifyContent="flex-end">
        <Text color={P.muted2}>{row.cost}</Text>
      </Box>
    ) : null,
    <Box flexShrink={0} width={AGE} justifyContent="flex-end">
      <Text color={P.muted2}>{row.age}</Text>
    </Box>,
  ]
  const noted =
    isCost && row.costNote !== '' ? (
      <Box key={`session-cost:${row.id}`} flexDirection="column" flexShrink={0} alignItems="flex-end">
        <Box flexDirection="row" columnGap={1}>
          {right}
        </Box>
        <Box paddingRight={AGE + 1}>
          <Text color={P.muted2}>{row.costNote}</Text>
        </Box>
      </Box>
    ) : null
  return (
    <Box key={`session-row:${row.id}`} flexDirection="row" columnGap={1} alignItems="center" paddingX={1} paddingY={isAiry(kit) ? 1 : 0} {...(isShown ? { backgroundColor: LIT } : {})} hover={{ backgroundColor: P.rowHover }}>
      <Box flexShrink={0}>
        <Text color={row.isQuiet ? P.muted3 : DOT[row.state]}>{row.isQuiet ? '○' : '●'}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Box flexDirection="column" flexShrink={1} minWidth={0}>
            {title}
          </Box>
          {row.isMe ? <Box flexShrink={0}>{hereTag(kit)}</Box> : null}
        </Box>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {icon ? <Box flexShrink={0}>{icon}</Box> : null}
          <Box flexShrink={row.isQuiet ? SAY_SHRINK : 1} minWidth={whereWidth}>
            <Text color={P.muted2} wrap="truncate-end">
              {row.where}
            </Text>
          </Box>
          {row.say !== '' ? (
            <Box flexShrink={row.isQuiet ? 1 : SAY_SHRINK} minWidth={sayWidth}>
              <Text color={row.need !== null ? P.waitNote : P.muted} italic={row.isQuiet} wrap="truncate-end">
                {`· ${row.say}`}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
      {noted ?? right}
    </Box>
  )
}

/**
 * Another session's deck before its state is read: the switcher, from its
 * row in the list (its state, its title; "Another session" when the list
 * holds it no more), the list while it is dropped, and, where its deck will
 * be, why nothing shows yet.
 */
export function pendingDeck(kit: Kit, id: string, row: SessionRowV2 | null, view: SessionsV2 | null, isOpen: boolean, note: string, actions: Pick<DashActions, 'openSessions' | 'openSession'>): RenderElement {
  const { Box, Text } = kit
  const head: Head = row ? { state: row.isQuiet ? 'idle' : row.state, stateText: row.isQuiet ? row.say : row.stateText, title: row.title } : { state: 'idle', stateText: 'Reading', title: 'Another session' }
  return (
    <Box key="deck" flexDirection="column" gap={1}>
      <Box key="deck:header" flexDirection="column">
        {headLine(kit, head, view ?? undefined, id, isOpen, actions)}
        {row && row.where !== '' ? (
          <Text color={P.muted2} wrap="truncate-end">
            {row.where}
          </Text>
        ) : null}
      </Box>
      {isOpen && view ? sessionsList(kit, view, id, actions) : null}
      {quiet(kit, note || 'Reading its deck…')}
    </Box>
  )
}
