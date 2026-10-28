/**
 * Settings (key 6): the deck's own choices, top to bottom (the session's
 * depth, Inspect, is a tab of its own: ./inspect):
 *
 * - Avatar style: the ten styles of web/avatars.mjs, each its name beside a
 *   small face drawn in it where Svg draws (the Orchestrator at work), the
 *   one drawn marked; a press draws every agent in it from now on, in every
 *   session and on the web page (`setAvatarStyle`, as `/deck avatars`);
 * - Web page: "Open in browser" (`/deck web`) and how the page stands;
 * - Help: what each tab shows, and the few keys there are.
 *
 * Pure: Kit, the state, the deck model and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as AV from '../../../web/avatars.mjs'
import { MAIN } from '../../model'
import type { WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit, WebPane } from '../types'
import { isAiry } from './dash'
import { avatarStyleOf, quiet, sectionHead, svgOf, type Face } from './look'
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

/** Who each style's face draws: the Orchestrator at work. */
const SAMPLE: Face = { id: MAIN, title: 'Orchestrator', kind: 'orchestrator', status: 'running', isStopped: false }

/** A style's face in the picker, in px. */
const PICK_FACE = 24

/** The colour that marks the style drawn: its ring and its tick. */
const PICKED = P.runText

/**
 * The avatars' style: the ten, in rows of as many as fit (about 22 cells
 * each), the one drawn marked. Where Svg draws, each a bordered chip, its
 * face drawn in its style beside its name, the one drawn ringed and ticked;
 * on the terminal, which draws no faces, each a radio line (◉ the one drawn,
 * ○ the rest). Each name is a plain Button keyed `avatars:<style>`.
 */
function avatarsSection(kit: Kit, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const style = avatarStyleOf(kit)
  const perRow = Math.max(1, Math.min(5, Math.floor((kit.columns + 1) / 22)))
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

/** One style in the picker: its face and its name, marked when it is the one drawn. */
function styleChip(kit: Kit, id: AV.AvatarStyle, name: string, isOn: boolean, width: number, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const Svg = svgOf(kit)
  const pick = () => actions.setAvatarStyle(id)
  const label = <Button key={`avatars:${id}`} label={name} plain dimColor={!isOn} onPress={pick} />
  if (!Svg) {
    return (
      <Box key={`avatars:chip:${id}`} flexDirection="row" columnGap={1} width={width}>
        <Box flexShrink={0}>
          <Text color={isOn ? PICKED : P.muted2}>{isOn ? '◉' : '○'}</Text>
        </Box>
        <Box flexShrink={1} minWidth={0}>
          {label}
        </Box>
      </Box>
    )
  }
  const source = AV.avatarSvg(id, { id: SAMPLE.id, name: SAMPLE.title, role: 'main', status: SAMPLE.status }, { size: PICK_FACE, dot: false, ground: P.ground })
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
      <Box flexShrink={0}>
        <Svg source={source} alt={`${name}: the Orchestrator drawn in it`} width={PICK_FACE} height={PICK_FACE} />
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
  if (!web || web.status === 'off') return { text: 'The same deck as a page in the Browser pane, live: /deck web.', color: P.muted2 }
  if (web.status === 'starting') return { text: 'Starting the web deck…', color: P.muted2 }
  if (web.status === 'failed') return { text: web.note || 'The web deck could not start.', color: P.failText }
  return { text: web.opened === 'failed' && web.url !== '' ? `Running at ${web.url}: the Browser pane could not open it.` : 'Running: Open in browser shows it again.', color: P.muted }
}

/** The web page: "Open in browser" (as /deck web: started if need be, opened in the Browser pane), and how it stands. */
function webSection(kit: Kit, web: WebPane | undefined, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const note = webNote(web)
  return section(kit, 'settings:web', sectionHead(kit, 'Web page', null), [
    <Box key="settings:web:row" flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>
        <Button key="web:open" label="Open in browser" onPress={() => actions.openWeb()} />
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
  ['3', 'Org', 'who started whom: each agent under the one that started it'],
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
