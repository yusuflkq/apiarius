/**
 * Settings (key 6): the deck's own choices, top to bottom (the session's
 * depth, Inspect, is a tab of its own: ./inspect):
 *
 * - Avatar style: the ten styles of web/avatars.mjs, each its name beside
 *   the page's three sample agents drawn in it (one done, one at work, one
 *   waiting on you, each with its status dot; one character each on the
 *   terminal), the one drawn marked; a press draws every agent in it from
 *   now on, in every session and on the web page (`setAvatarStyle`, as
 *   `/deck avatars`);
 * - Web page: "Start the web page" (`/deck web`), then "Open in browser", a
 *   link to it, and how the page stands;
 * - Help: what each tab shows, and the few keys there are.
 *
 * Pure: Kit, the state, the deck model and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as AV from '../../../web/avatars.mjs'
import type { WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit, WebPane } from '../types'
import { isAiry } from './dash'
import { avatarAgentOf, avatarStyleOf, quiet, sectionHead, svgOf, terminalCell, type Face } from './look'
import { P } from './palette'
import { widthFor } from './parts'

/** Settings: the avatar style, the web page and help, each under its head. */
export function settingsTab(kit: Kit, state: WebStateV2, model: DeckModel, actions: DashActions): RenderElement {
  const { Box } = kit
  return (
    <Box key="settings" flexDirection="column" gap={isAiry(kit) ? 2 : 1}>
      {avatarsSection(kit, actions)}
      {webSection(kit, model.web, actions)}
      {helpSection(kit)}
    </Box>
  )
}

/** A section as Settings stacks it: its head, then what it holds, half a line apart where the surface lays gaps out in half lines. */
function section(kit: Kit, key: string, head: RenderElement, body: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      {head}
      {body}
    </Box>
  )
}

// The avatars' style.

/** Who each style's preview draws, as the page's (web/app.js `WELCOME`, seeded by the same ids): one done, one at work, one waiting on you. */
const SAMPLES: readonly Face[] = [
  { id: 'bob', title: 'bob', kind: 'agent', status: 'done', isStopped: false, todos: [] },
  { id: 'helper', title: 'helper', kind: 'agent', status: 'running', isStopped: false, todos: [] },
  { id: 'deck-1', title: 'deck', kind: 'agent', status: 'waiting', isStopped: false, todos: [] },
]

/** The one the terminal draws where the three do not fit: the one at work. */
const AT_WORK = SAMPLES[1] as Face

/** A sample's face in the picker, in px. */
const PICK_FACE = 24

/** The cells a chip asks for, about: where Svg draws, its three faces, its name and its tick; on the terminal, its mark, its faces and its name. */
const CHIP_CELLS = 28
const TERMINAL_CHIP_CELLS = 22

/** The colour that marks the style drawn: its ring and its tick. */
const PICKED = P.runText

/**
 * The avatars' style: the ten, in rows of as many as fit (about 28 cells
 * each where Svg draws, 22 on the terminal), the one drawn marked. Where Svg
 * draws, each a bordered chip, the three samples drawn in its style beside
 * its name, the one drawn ringed and ticked; on the terminal, each a radio
 * line (◉ the one drawn, ○ the rest) with the three's one-character faces
 * and marks where they fit, else the one at work. Each name is a plain
 * Button keyed `avatars:<style>`.
 */
function avatarsSection(kit: Kit, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const style = avatarStyleOf(kit)
  const perRow = Math.max(1, Math.min(5, Math.floor((kit.columns + 1) / (svgOf(kit) ? CHIP_CELLS : TERMINAL_CHIP_CELLS))))
  const width = widthFor(kit.columns, perRow)
  const rows: (typeof AV.STYLES)[number][][] = []
  AV.STYLES.forEach((one, i) => {
    if (i % perRow === 0) rows.push([])
    rows[rows.length - 1]?.push(one)
  })
  return section(kit, 'settings:avatars', sectionHead(kit, 'Avatar style', null, <Text color={P.muted2}>{AV.styleName(style)}</Text>), [
    ...rows.map((row, i) => (
      <Box key={`avatars:row:${i}`} flexDirection="row" columnGap={1}>
        {row.map(one => styleChip(kit, one.id, one.name, one.id === style, width, actions))}
      </Box>
    )),
    quiet(kit, 'Yours in every session, on the web page and in /deck demo. /deck avatars <style> picks one by name too.'),
  ])
}

/**
 * One of the samples drawn in style `id` with its status dot, by the same
 * library call as the page's: an image where Svg draws; on the terminal its
 * one-character face and its status's mark.
 */
function sampleFace(kit: Kit, id: AV.AvatarStyle, name: string, one: Face): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  const agent = avatarAgentOf(one)
  if (Svg) return <Svg source={AV.avatarSvg(id, agent, { size: PICK_FACE, dot: true, ground: P.ground })} alt={`${name}: ${one.title} drawn in it`} width={PICK_FACE} height={PICK_FACE} />
  const face = AV.terminalFace(agent, id)
  return (
    <Text>
      {terminalCell(kit, face)}
      <Text color={face.markColor}>{face.mark}</Text>
    </Text>
  )
}

/** One style in the picker: the samples drawn in it and its name, marked when it is the one drawn. */
function styleChip(kit: Kit, id: AV.AvatarStyle, name: string, isOn: boolean, width: number, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const Svg = svgOf(kit)
  const pick = () => actions.setAvatarStyle(id)
  const label = <Button key={`avatars:${id}`} label={name} plain dimColor={!isOn} onPress={pick} />
  if (!Svg) {
    // its mark, the three (a face and a mark each, a cell apart), its name: or the one at work alone where they do not fit
    const three = SAMPLES.length * (AV.terminalCells(id) + 1) + SAMPLES.length - 1
    const isThree = width >= 3 + three + Array.from(name).length
    return (
      <Box key={`avatars:chip:${id}`} flexDirection="row" columnGap={1} width={width}>
        <Box flexShrink={0}>
          <Text color={isOn ? PICKED : P.muted2}>{isOn ? '◉' : '○'}</Text>
        </Box>
        <Box flexShrink={0} flexDirection="row" columnGap={1}>
          {isThree ? SAMPLES.map(one => sampleFace(kit, id, name, one)) : terminalCell(kit, AV.terminalFace(avatarAgentOf(AT_WORK), id))}
        </Box>
        <Box flexShrink={1} minWidth={0}>
          {label}
        </Box>
      </Box>
    )
  }
  return (
    <Box
      key={`avatars:chip:${id}`}
      flexDirection="row"
      columnGap={1}
      alignItems="center"
      width={width}
      borderStyle="round"
      borderColor={isOn ? PICKED : P.border}
      hover={{ borderColor: isOn ? PICKED : P.borderStrong }}
      paddingX={1}
      paddingY={0}
    >
      <Box flexShrink={0} flexDirection="row">
        {SAMPLES.map(one => sampleFace(kit, id, name, one))}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {label}
      </Box>
      {isOn ? (
        <Box flexShrink={0}>
          <Text color={PICKED}>✓</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// The web page.

/** What the web page's line says, by how it stands. */
function webNote(web: WebPane | undefined): { text: string; color: string } {
  if (!web || web.status === 'off') return { text: 'The same deck as a live page in your browser (/deck web).', color: P.muted2 }
  if (web.status === 'starting') return { text: 'Starting the web page…', color: P.muted2 }
  if (web.status === 'failed') return { text: web.note || 'The web page could not start.', color: P.failText }
  return { text: 'Live, on this machine only.', color: P.muted }
}

/**
 * The web page and how it stands. While it runs, "Open in browser" is a link
 * to it, which the surface opens itself (as the deck's top line is): the
 * Browser pane refuses a mod's preview_start. Until then a Button starts it
 * (as /deck web), and the link takes its place.
 */
function webSection(kit: Kit, web: WebPane | undefined, actions: DashActions): RenderElement {
  const { Box, Button, Markdown, Text } = kit
  const note = webNote(web)
  const isUp = web !== undefined && web.status === 'running' && web.url !== ''
  return section(kit, 'settings:web', sectionHead(kit, 'Web page', null), [
    <Box key="settings:web:row" flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>
        {isUp ? (
          <Markdown key="settings:web:link" text={`[Open in browser](${web.url})`} />
        ) : (
          <Button key="web:open" label={web?.status === 'starting' ? 'Starting…' : 'Start the web page'} onPress={() => actions.openWeb()} />
        )}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={note.color} wrap="wrap">
          {note.text}
        </Text>
      </Box>
    </Box>,
  ])
}

// Help.

/** What each tab shows, by its key. */
export const TAB_HELP: readonly (readonly [string, string, string])[] = [
  ['1', 'Dashboard', 'what needs you, the agents at work, the figures, the plan, recent activity and files'],
  ['2', 'Chat', 'the session as a group chat: pick Everyone or one agent, and your words go to the one picked, or @name another'],
  ['3', 'Org', 'who started whom: each agent under the one that started it; or the Timeline, each agent’s work, waits on you and idle time over the run'],
  ['4', 'Changes', 'git’s diff of each changed file, and the agents’ own edits'],
  ['5', 'Inspect', 'what fills the context and each compaction, every permission decision, what is loaded, and the spend'],
  ['6', 'Settings', 'the avatar style, the web page and this help'],
]

/** The keys, as the pane has them. */
export const KEYS: readonly (readonly [string, string])[] = [
  ['1 – 6', 'the tabs'],
  ['Enter', 'opens what has the focus: an agent, a fold, a need, a file'],
  ['b', 'back from an agent’s page'],
]

/** Help: the tabs, then the keys. */
function helpSection(kit: Kit): RenderElement {
  const { Box, Text } = kit
  const line = (key: string, name: string, does: string, width: number) => (
    <Box key={`help:${key}`} flexDirection="row" columnGap={2}>
      <Box flexShrink={0} width={width}>
        <Text bold color={P.text}>
          {name}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted} wrap="wrap">
          {does}
        </Text>
      </Box>
    </Box>
  )
  return section(kit, 'help', sectionHead(kit, 'Help', null), [
    <Box key="help:tabs" flexDirection="column">
      {TAB_HELP.map(([key, name, does]) => line(`tab:${key}`, `${key}  ${name}`, does, 13))}
    </Box>,
    <Box key="help:keys" flexDirection="column">
      {KEYS.map(([key, does]) => line(`key:${key}`, key, does, 13))}
    </Box>,
    quiet(kit, 'The keys work while the pane has the keyboard: click it, or press ctrl+x then tab. Esc stays Claude Code’s.'),
  ])
}
