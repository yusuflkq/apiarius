/**
 * The deck's pane on the v2 view model, the same
 * design the web page and the terminal draw:
 *
 * - the header: the session's state in one word, your latest request in
 *   your words (the switcher, ./sessions: a press drops every session on
 *   this machine over the tabs), how many sessions there are and whether
 *   another needs you; then `model · permission mode · context % · ≈$cost`,
 *   the mode in amber (bypass permissions in red) as Claude Code's footer
 *   marks it, and Stop turn while a turn runs;
 * - the tabs, `1` Dashboard · `2` Chat · `3` Org · `4` Changes · `5`
 *   Inspect · `6` Settings (the Dashboard's id stays `now`);
 * - under them the open tab (./now, ./chat, ./org, ./changes, ./inspect,
 *   ./settings), or over it an agent's page (./page), `b` going back.
 *
 * Each tab is a Button with its digit as its hotkey, so it presses while the
 * pane has the keyboard; Enter presses the focused one. Help is a section of
 * Settings; the header's one key is `s` (./sessions: every session on this
 * machine, dropped over the tabs).
 *
 * Any session's deck is drawn so, this one's or another's (its state then
 * marked `peer`): there is no mode for another's.
 *
 * Pure: Kit, the state, its lazy files, the deck model and DashActions come
 * from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import type { V2Files, WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit, WebPane } from '../types'
import { changesTab } from './changes'
import { chatTab } from './chat'
import { FEWEST_ROWS, rowsOf } from './fit'
import { inspectTab } from './inspect'
import { nowTab } from './now'
import { orgTab, type OrgSpot } from './org'
import { agentPage } from './page'
import { P } from './palette'
import { headLine, sessionsList } from './sessions'
import { settingsTab } from './settings'
import { stopTurnButton } from './stop'

/** The tabs, in their keys' order. */
export const TABS: readonly { id: DeckView2['tab']; label: string; hotkey: string }[] = [
  { id: 'now', label: 'Dashboard', hotkey: '1' },
  { id: 'chat', label: 'Chat', hotkey: '2' },
  { id: 'org', label: 'Org', hotkey: '3' },
  { id: 'changes', label: 'Changes', hotkey: '4' },
  { id: 'inspect', label: 'Inspect', hotkey: '5' },
  { id: 'settings', label: 'Settings', hotkey: '6' },
]

/** How Org stands when the hooks module says nothing of it: its chart not failed, no agent marked. */
const ORG_FRESH: OrgSpot = { isDown: false, selected: null }

/** The whole v2 pane: the header, the list of sessions while it is dropped, the tabs, and the tab or the page over it; `org` how Org's chart stands on this surface. */
export function v2Deck(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean, org: OrgSpot = ORG_FRESH): RenderElement {
  const { Box } = kit
  const list = model.isSessionsOpen === true && state.sessions ? sessionsList(kit, state.sessions, state.session.id, actions) : null
  const top = [header(kit, state, model, actions), list, model.web ? webLine(kit, model.web) : null, tabRow(kit, state, model, actions)].filter(one => one !== null)
  // the terminal: the tab gets the rows the header, the tabs and the gaps between leave it
  const rows = kit.rows === undefined ? undefined : Math.max(FEWEST_ROWS / 2, kit.rows - rowsOf(top, kit.columns) - top.length)
  return (
    <Box key="deck" flexDirection="column" gap={1}>
      {top}
      {bodyOf(rows === undefined ? kit : { ...kit, rows }, state, files, model, actions, isDemo, org)}
    </Box>
  )
}


/** The header: the state's word and your latest request, the switcher once the sessions on this machine are known (./sessions `headLine`), then `model · mode · context % · ≈$cost`, the mode lit, and Stop turn at its right while the main loop's turn runs (./stop; another session's says where to stop it). */
function header(kit: Kit, state: WebStateV2, model: DeckModel, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const head = state.header
  const goal = head.goal ? clean(head.goal.headline) : 'No request yet'
  // the permission mode in the line, lit as Claude Code's footer lights it (a state of an earlier build names none)
  const mode = typeof head.mode === 'string' ? head.mode : ''
  const at = mode !== '' ? head.line.indexOf(mode) : -1
  // three parts in a row, so the mode keeps its own colour and the line cuts at its end: the model and the mode whole, the rest cut to the room left; in a pane too narrow even for them, their row cuts them, never drawing under Stop turn
  const lineParts =
    at < 0
      ? [
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {head.line}
            </Text>
          </Box>,
        ]
      : [
          <Box flexShrink={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {head.line.slice(0, at)}
            </Text>
          </Box>,
          <Box flexShrink={0}>
            <Text color={mode === 'bypass permissions' ? P.failText : P.waitText} wrap="truncate-end">
              {mode}
            </Text>
          </Box>,
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {head.line.slice(at + mode.length)}
            </Text>
          </Box>,
        ]
  return (
    <Box key="deck:header" flexDirection="column">
      {headLine(kit, { state: head.state, stateText: head.stateText, title: goal }, state.sessions, state.session.id, model.isSessionsOpen === true, actions)}
      <Box flexDirection="row" columnGap={2} alignItems="center">
        <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" overflow="hidden">
          {lineParts}
        </Box>
        {stopTurnButton(kit, state, actions)}
      </Box>
    </Box>
  )
}

/**
 * The web deck (`/deck web`) in one line, while it is on and has something
 * to say: starting, why it could not start, or its link where the Browser
 * pane could not open it. Nothing once the page is open, or while it is off.
 */
function webLine(kit: Kit, web: WebPane): RenderElement | null {
  const { Text, Markdown } = kit
  if (web.status === 'starting') return <Text color={P.muted2}>Starting the web deck…</Text>
  if (web.status === 'failed') {
    return (
      <Text color={P.failText} wrap="wrap">
        {web.note || 'The web deck could not start.'}
      </Text>
    )
  }
  if (web.status !== 'running' || web.url === '' || web.opened === 'opened') return null
  return <Markdown key="web:link" text={`[Open Agent Deck](${web.url}) in the Browser pane`} />
}

/** The tabs (1 Dashboard · 2 Chat · 3 Org · 4 Changes · 5 Inspect · 6 Settings, the open one lit). A tab pressed on a page leaves it for that tab, and closes the list of sessions. */
function tabRow(kit: Kit, state: WebStateV2, model: DeckModel, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  const { view } = model
  const v2 = view.v2
  const isOver = view.page !== ''
  const go = (tab: DeckView2['tab']) => {
    actions.setV2View({ tab })
    if (view.page !== '') actions.back()
  }
  const files = state.changes.files.length
  return (
    <Box key="deck:tabs" flexDirection="row" columnGap={2} flexWrap="wrap">
      {TABS.map(tab => {
        const label = tab.id === 'changes' && files > 0 ? `${tab.label} ${files}` : tab.label
        return <Button key={`tab:${tab.id}`} label={label} plain hotkey={tab.hotkey} dimColor={isOver || tab.id !== v2.tab} onPress={() => go(tab.id)} />
      })}
    </Box>
  )
}

/** An agent's page, else the open tab. */
function bodyOf(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean, org: OrgSpot): RenderElement {
  const { view } = model
  const v2 = view.v2
  if (view.page !== '') return agentPage(kit, state, files, view.page, actions, v2.activityView, isDemo)
  if (v2.tab === 'chat') return chatTab(kit, state, files, v2, actions, isDemo)
  if (v2.tab === 'changes') return changesTab(kit, state, files, model, actions, isDemo)
  if (v2.tab === 'org') return orgTab(kit, state, actions, org, { files, ...(v2.orgView ? { orgView: v2.orgView } : {}) })
  if (v2.tab === 'inspect') return inspectTab(kit, state, v2, actions)
  if (v2.tab === 'settings') return settingsTab(kit, state, model, actions)
  return nowTab(kit, state, view.collapsed, actions, () => actions.setV2View({ tab: 'org' }), v2.openFolds)
}
