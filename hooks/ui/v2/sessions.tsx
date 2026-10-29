/**
 * Every session on this machine (../../sessions, web/CONTRACT.md "All
 * sessions"), in the pane and the terminal:
 *
 * - the header's way in (`sessionsButton`): "All sessions", its hotkey `s`,
 *   after "◆ 1 other session needs you" in amber while another session
 *   waits on you;
 * - the list (`sessionsPage`), over the tab as an agent's page is (`b` goes
 *   back): a row a session, this chat first. Each row: its state's dot, its
 *   title (a press opens its deck) and "this chat"; where it runs (its
 *   surface's icon, its place and its repository) and what it waits on you
 *   for (amber) or what it is doing; its state's word, its spend (a fork's
 *   "incl. its parent's" under it) and how long since it changed;
 * - over another session's deck (`viewingBar`): "Viewing <title>", where it
 *   runs, whether its deck takes answers from here, and Back to this chat.
 *
 * The terminal draws the same rows with text for the icons and the tag.
 *
 * Pure: Kit, the list and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { SessionRowV2, SessionsV2 } from '../../sessions'
import type { DashActions, Kit } from '../types'
import { listBox, listRow } from './dash'
import { keyButton, quiet, svgOf } from './look'
import { P } from './palette'
import { cellsForPx, edgesOf, pressText, rule, tag, wrapAdvanceOf } from './parts'
import { cellsOf } from './text'

/** The key that opens the list, on every surface: one lowercase letter, as a pane's hotkey must be. */
export const SESSIONS_KEY = 's'

/** Each state's dot and word hue, as the header's. */
const DOT: Readonly<Record<SessionRowV2['state'], string>> = { working: P.run, waiting: P.wait, idle: P.idleDot }
const HUE: Readonly<Record<SessionRowV2['state'], string>> = { working: P.runText, waiting: P.waitText, idle: P.muted2 }

/** The surfaces' icons (Lucide's laptop and square-terminal, 24 px strokes, as the web's). */
const SURFACE_PATHS: Readonly<Record<'desktop' | 'terminal', string>> = {
  desktop: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  terminal: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
}

/** A surface's icon as an SVG document, `px` square, its strokes in `color`. */
function surfaceSvg(surface: 'desktop' | 'terminal', color: string, px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SURFACE_PATHS[surface]}</svg>`
}

/** Where a session draws, as an icon where Svg draws (a laptop for the Desktop, a prompt for a terminal); nothing on the terminal, whose words say it. */
function surfaceIcon(kit: Kit, row: SessionRowV2): RenderElement | null {
  const Svg = svgOf(kit)
  if (!Svg || row.surface === '') return null
  const which = row.surface === 'terminal' ? 'terminal' : 'desktop'
  return <Svg source={surfaceSvg(which, P.muted2, ICON)} alt={row.place} width={ICON} height={ICON} />
}

/** Narrower than this, the header's way in says "◆ 1" alone, as the page's header does when narrow. */
const NEED_WORDS_FROM = 64

/**
 * The header's way in: "All sessions" (hotkey `s`), after "◆ 1 other
 * session needs you" in amber while another session waits on you ("◆ 1"
 * where the pane is narrow). Nothing before the registry was read.
 */
export function sessionsButton(kit: Kit, view: SessionsV2 | undefined, actions: DashActions): RenderElement | null {
  const { Box, Text } = kit
  if (!view) return null
  const waiting = view.others.waiting
  const words = kit.columns >= NEED_WORDS_FROM ? ` other ${waiting === 1 ? 'session needs' : 'sessions need'} you` : ''
  return (
    <Box key="deck:sessions" flexDirection="row" columnGap={1} flexShrink={0} alignItems="center">
      {waiting > 0 ? (
        <Box flexShrink={0}>
          <Text color={P.waitText}>{`◆ ${waiting}${words}`}</Text>
        </Box>
      ) : null}
      <Box flexShrink={0}>{keyButton(kit, 'key:s', SESSIONS_KEY, 'All sessions', () => actions.openSessions(), waiting === 0)}</Box>
    </Box>
  )
}

/** The list over the tab: its head (Back, "All sessions" and how they stand), a row a session, and what the list holds. */
export function sessionsPage(kit: Kit, view: SessionsV2 | undefined, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const back = keyButton(kit, 'key:b', 'b', '← Back', () => actions.closeSessions(), false)
  const head = (
    <Box key="sessions:head" flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>{back}</Box>
      <Box flexShrink={0}>
        <Text bold color={P.text}>
          All sessions
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {view ? view.text : ''}
        </Text>
      </Box>
    </Box>
  )
  if (!view) {
    return (
      <Box key="sessions" flexDirection="column" gap={1}>
        {head}
        {quiet(kit, 'Reading the sessions on this machine…')}
      </Box>
    )
  }
  const rows = view.rows.map(row => sessionRow(kit, row, actions))
  return (
    <Box key="sessions" flexDirection="column" gap={1}>
      {head}
      {listBox(kit, 'sessions:list', rows.flatMap((one, i) => [i > 0 ? rule(kit) : null, one]))}
      {quiet(kit, view.rows.length > 1 ? 'Every Claude Code session here whose Agent Deck runs. A press opens its deck; this chat’s is yours already.' : 'No other session here runs Agent Deck now. Each one that does shows here, Desktop and terminal alike.')}
    </Box>
  )
}

/** The cells the state's word, the spend and the age take at a row's right. */
const WORD = 15
const COST = 7
const AGE = 4

/** Narrower than these cells a row leaves out its spend, then its state's word (its dot says it), as the page's list does: its title and what it says keep the room. */
const COST_FROM = 64
const WORD_FROM = 48

/** How much faster what a session says gives way than where it runs when its line runs short: as on the page, its place and repository are cut only once it has gone. */
const SAY_SHRINK = 100

/** A surface's icon in a row, in px. */
const ICON = 12

/**
 * The cells a row's second line has, about (a cell under, to be sure):
 * the list's width less its edges, the row's padding, its dot, the columns
 * shown at its right and the surface's icon. Where it runs keeps its whole
 * width up to this, so it cuts only where it alone does not fit.
 */
function lineRoom(kit: Kit, isWord: boolean, isCost: boolean, hasIcon: boolean): number {
  const right = (isWord ? WORD + 1 : 0) + (isCost ? COST + 1 : 0) + AGE + 1
  return Math.max(0, Math.floor(kit.columns - edgesOf(kit) - 2 - 2 - right - (hasIcon ? cellsForPx(ICON) + 1 : 0) - 1))
}

/**
 * One session: its dot; its title (its deck's Open), cut to the room
 * "this chat" leaves, then where it runs and what it says, each cut before
 * it reaches the next; its word, spend and age, the spend and then the word
 * left out where the pane is narrow. A fork's spend says under it that it
 * counts its parent's ("incl. its parent's"), its line under the word and
 * the spend, ending where the spend does.
 */
function sessionRow(kit: Kit, row: SessionRowV2, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const open = () => (row.isMe ? actions.closeSessions() : actions.openSession(row.id))
  // in a column Box beside the tag: the title's line is then no wider than the room the tag leaves, and cuts there
  const title = row.isMe || row.canOpen ? pressText(kit, `session:${row.id}`, [<Text bold color={P.text} wrap="truncate-end">{row.title}</Text>], open) : <Text bold color={P.text} wrap="truncate-end">{row.title}</Text>
  const where = [row.place, row.repo].filter(part => part !== '').join(' · ')
  const icon = surfaceIcon(kit, row)
  const isWord = kit.columns >= WORD_FROM
  const isCost = kit.columns >= COST_FROM
  // where it runs stays whole while the line has room for it: what it says gives way first
  const whereWidth = Math.min(Math.ceil(cellsOf(where, wrapAdvanceOf(kit))), lineRoom(kit, isWord, isCost, icon !== null))
  const right = [
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
  return listRow(kit, `session-row:${row.id}`, [
    <Box flexShrink={0}>
      <Text color={DOT[row.state]}>●</Text>
    </Box>,
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          {title}
        </Box>
        {row.isMe ? <Box flexShrink={0}>{tag(kit, 'this chat')}</Box> : null}
      </Box>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {icon ? <Box flexShrink={0}>{icon}</Box> : null}
        <Box flexShrink={1} minWidth={whereWidth}>
          <Text color={P.muted2} wrap="truncate-end">
            {where}
          </Text>
        </Box>
        {row.say !== '' ? (
          <Box flexShrink={SAY_SHRINK} minWidth={0}>
            <Text color={row.need !== null ? P.waitNote : P.muted} wrap="truncate-end">
              {`· ${row.say}`}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>,
    ...(noted ? [noted] : right),
  ])
}

/** What a deck viewing another session shows over it: its row (when the list holds it), whether its deck takes answers from here, and why it is not shown yet. */
export type Viewing = { id: string; row: SessionRowV2 | null; canSteer: boolean; note: string }

/** Narrower than this, the bar's All sessions and Back to this chat go on a line of their own, under "Viewing" and the title. */
const BAR_LINE_FROM = 64

/**
 * The bar over another session's deck: "Viewing" and its title, where it
 * runs (cut first, then the title, where the bar is short), then what can
 * be done from here (answers and messages go to its own deck, or "Answer it
 * in its window"), with All sessions (`s`) and Back to this chat, beside
 * the title or, where the pane is narrow, under it.
 */
export function viewingBar(kit: Kit, viewing: Viewing, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const row = viewing.row
  const where = row ? [row.place, row.repo].filter(part => part !== '').join(' · ') : ''
  const steer = viewing.canSteer ? 'Read-only: answers and messages go through its own deck.' : 'Read-only: answer it in its window.'
  const title = (
    <Box flexDirection="row" columnGap={2} flexGrow={1} flexShrink={1} minWidth={0} alignItems="center">
      <Box flexShrink={0}>
        <Text bold color={P.runText} backgroundColor="#172554">
          {' Viewing '}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text bold color={P.text} wrap="truncate-end">
          {row ? row.title : 'Another session'}
        </Text>
      </Box>
      {where !== '' ? (
        <Box flexShrink={SAY_SHRINK} minWidth={0}>
          <Text color={P.muted2} wrap="truncate-end">
            {where}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
  const presses = (
    <Box flexDirection="row" columnGap={2} flexShrink={0} alignItems="center">
      <Box flexShrink={0}>{keyButton(kit, 'key:s', SESSIONS_KEY, 'All sessions', () => actions.openSessions())}</Box>
      <Box flexShrink={0}>
        <Button key="viewing:back" label="Back to this chat" variant="primary" onPress={() => actions.backToThisChat()} />
      </Box>
    </Box>
  )
  const isOneLine = kit.columns >= BAR_LINE_FROM
  return (
    <Box key="viewing:head" flexDirection="column">
      {isOneLine ? (
        <Box flexDirection="row" columnGap={2} alignItems="center">
          {title}
          {presses}
        </Box>
      ) : (
        title
      )}
      {isOneLine ? null : presses}
      <Text color={P.muted} wrap="wrap">
        {viewing.note !== '' ? viewing.note : steer}
      </Text>
    </Box>
  )
}
