/**
 * The deck's pane on the v2 view model (web/CONTRACT.md v2), the same
 * design the web page and the terminal draw:
 *
 * - the header: the session's state in one word, your latest request in
 *   your words, then `model · context % · $cost`;
 * - the tabs, `1` Dashboard · `2` Chat · `3` Org · `4` Changes · `5`
 *   Settings (the Dashboard's id stays `now`);
 * - under them the open tab (./now, ./chat, ./org, ./changes, ./settings),
 *   or over it an agent's page (./page), `b` going back.
 *
 * Each tab is a Button with its digit as its hotkey, so it presses while the
 * pane has the keyboard; Enter presses the focused one. Inspect and Help are
 * sections of Settings, so the header carries no keys of its own.
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
import { nowTab } from './now'
import { orgTab, type OrgSpot } from './org'
import { agentPage } from './page'
import { P } from './palette'
import { settingsTab } from './settings'

/** The tabs, in their keys' order. */
export const TABS: readonly { id: DeckView2['tab']; label: string; hotkey: string }[] = [
  { id: 'now', label: 'Dashboard', hotkey: '1' },
  { id: 'chat', label: 'Chat', hotkey: '2' },
  { id: 'org', label: 'Org', hotkey: '3' },
  { id: 'changes', label: 'Changes', hotkey: '4' },
  { id: 'settings', label: 'Settings', hotkey: '5' },
]

/** How Org stands when the hooks module says nothing of it: its chart not failed, no agent marked. */
const ORG_FRESH: OrgSpot = { isDown: false, selected: null }

/** The whole v2 pane: the header, the tabs, and the tab or the page over it; `org` how Org's chart stands on this surface. */
export function v2Deck(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean, org: OrgSpot = ORG_FRESH): RenderElement {
  const { Box } = kit
  return (
    <Box key="deck" flexDirection="column" gap={1}>
      {header(kit, state)}
      {model.web ? webLine(kit, model.web) : null}
      {tabRow(kit, state, model, actions)}
      {bodyOf(kit, state, files, model, actions, isDemo, org)}
    </Box>
  )
}

const STATE_HUE: Readonly<Record<WebStateV2['header']['state'], string>> = { working: P.runText, waiting: P.waitText, idle: P.muted }
const STATE_DOT: Readonly<Record<WebStateV2['header']['state'], string>> = { working: P.run, waiting: P.wait, idle: P.idleDot }

/** The header: the state's word and your latest request, then `model · context % · $cost`. */
function header(kit: Kit, state: WebStateV2): RenderElement {
  const { Box, Text } = kit
  const head = state.header
  const goal = head.goal ? clean(head.goal.headline) : 'No request yet'
  return (
    <Box key="deck:header" flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>
          <Text color={STATE_DOT[head.state]}>●</Text>
        </Box>
        <Box flexShrink={0}>
          <Text bold color={STATE_HUE[head.state]}>
            {head.stateText}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={head.goal ? P.fg2 : P.muted2} wrap="truncate-end">
            {goal}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={P.muted2} wrap="truncate-end">
            {head.line}
          </Text>
        </Box>
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

/** The tabs (1 Dashboard · 2 Chat · 3 Org · 4 Changes · 5 Settings, the open one lit). A tab pressed on a page leaves it for that tab. */
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
  if (view.page !== '') return agentPage(kit, state, files, view.page, actions)
  if (v2.tab === 'chat') return chatTab(kit, state, files, v2, actions, isDemo)
  if (v2.tab === 'changes') return changesTab(kit, state, files, model, actions, isDemo)
  if (v2.tab === 'org') return orgTab(kit, state, actions, org)
  if (v2.tab === 'settings') return settingsTab(kit, state, model, actions)
  return nowTab(kit, state, view.collapsed, actions, () => actions.setV2View({ tab: 'org' }))
}
