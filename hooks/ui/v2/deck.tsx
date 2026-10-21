/**
 * The deck's pane on the v2 view model (web/CONTRACT.md v2), the same
 * design the web page and the terminal draw:
 *
 * - the header: the session's state in one word, your latest request in
 *   your words, `model · context % · $cost`, and `n` (the next thing that
 *   needs you, while something does), `i` (Inspect) and `h` (help);
 * - the tabs, `1` Now · `2` Chat · `3` Org · `4` Changes, and `m`
 *   (message), `j` and `k` (the focus down and up);
 * - under them the open tab (./now, ./chat, ./org, ./changes), or over it
 *   an agent's page (./page), Inspect or help (./inspect), `b` going back.
 *
 * Every key is a Button's hotkey: one digit or one lowercase letter, so it
 * presses while the pane has the keyboard; Enter presses the focused one.
 *
 * Pure: Kit, the state, its lazy files, the deck model and DashActions come
 * from the hooks module; whether help shows is this module's own.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import { MAIN } from '../../model'
import type { V2AgentRow, V2Files, WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit, WebPane } from '../types'
import { changesTab } from './changes'
import { chatTab, composerKey, draftFor, handleOf } from './chat'
import { helpPage, inspectPage } from './inspect'
import { keyButton } from './look'
import { nowFocusKeys, nowTab } from './now'
import { orgFocusKeys, orgTab, type OrgSpot } from './org'
import { agentPage } from './page'
import { P } from './palette'

/** Help shows over the screen (`h`; `b` or `h` again closes it), while the module lives. */
let isHelpOpen = false

/** The tabs, in their keys' order. */
export const TABS: readonly { id: DeckView2['tab']; label: string; hotkey: string }[] = [
  { id: 'now', label: 'Now', hotkey: '1' },
  { id: 'chat', label: 'Chat', hotkey: '2' },
  { id: 'org', label: 'Org', hotkey: '3' },
  { id: 'changes', label: 'Changes', hotkey: '4' },
]

/** How Org stands when the hooks module says nothing of it: its chart not failed, no agent marked. */
const ORG_FRESH: OrgSpot = { isDown: false, selected: null }

/** The whole v2 pane: the header, the tabs, and the tab or the page over it; `org` how Org's chart stands on this surface. */
export function v2Deck(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean, org: OrgSpot = ORG_FRESH): RenderElement {
  const { Box } = kit
  return (
    <Box key="deck" flexDirection="column" gap={1}>
      {header(kit, state, model.view.v2, actions)}
      {model.web ? webLine(kit, model.web) : null}
      {tabRow(kit, state, model, actions, org)}
      {bodyOf(kit, state, files, model, actions, isDemo, org)}
    </Box>
  )
}

const STATE_HUE: Readonly<Record<WebStateV2['header']['state'], string>> = { working: P.runText, waiting: P.waitText, idle: P.muted }
const STATE_DOT: Readonly<Record<WebStateV2['header']['state'], string>> = { working: P.run, waiting: P.wait, idle: P.idleDot }

/** The header: the state's word and your latest request, then `model · context % · $cost` and the keys n, i and h. */
function header(kit: Kit, state: WebStateV2, view2: DeckView2, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const head = state.header
  const goal = head.goal ? clean(head.goal.headline) : 'No request yet'
  const toggleHelp = () => {
    isHelpOpen = !isHelpOpen
    actions.redraw()
  }
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
      <Box flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={P.muted2} wrap="truncate-end">
            {head.line}
          </Text>
        </Box>
        <Box flexShrink={0} flexDirection="row" columnGap={2}>
          {state.needs.length > 0 ? keyButton(kit, 'key:n', 'n', 'Next need', () => {
            isHelpOpen = false
            actions.focusNeed()
          }, false) : null}
          {keyButton(kit, 'key:i', 'i', 'Inspect', () => {
            isHelpOpen = false
            actions.setV2View({ isInspectOpen: !view2.isInspectOpen })
          })}
          {keyButton(kit, 'key:h', 'h', 'Help', toggleHelp)}
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

/** The tabs (1 Now · 2 Chat · 3 Org · 4 Changes, the open one lit), then m, j and k at the right. A tab pressed on a page leaves it for that tab. */
function tabRow(kit: Kit, state: WebStateV2, model: DeckModel, actions: DashActions, org: OrgSpot): RenderElement {
  const { Box, Button } = kit
  const { view } = model
  const v2 = view.v2
  const isOver = view.page !== '' || v2.isInspectOpen || isHelpOpen
  const go = (tab: DeckView2['tab']) => {
    isHelpOpen = false
    actions.setV2View({ tab, isInspectOpen: false })
    if (view.page !== '') actions.back()
  }
  const files = state.changes.files.length
  const message = () => {
    const row = state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === view.page)
    const handle = row ? handleOf(row) : ''
    if (row && handle) draftFor(`@${handle} `)
    isHelpOpen = false
    actions.setV2View({ tab: 'chat', isInspectOpen: false, ...(row && row.id !== MAIN ? { chatFilter: row.id } : {}) })
    if (view.page !== '') actions.back()
    actions.focusNext(1, [composerKey()])
  }
  return (
    <Box key="deck:tabs" flexDirection="row" columnGap={2}>
      <Box flexGrow={1} flexShrink={1} flexDirection="row" columnGap={2}>
        {TABS.map(tab => {
          const label = tab.id === 'changes' && files > 0 ? `${tab.label} ${files}` : tab.label
          return <Button key={`tab:${tab.id}`} label={label} plain hotkey={tab.hotkey} dimColor={isOver || tab.id !== v2.tab} onPress={() => go(tab.id)} />
        })}
      </Box>
      <Box flexShrink={0} flexDirection="row" columnGap={2}>
        {keyButton(kit, 'key:m', 'm', 'Message', message)}
        {keyButton(kit, 'key:j', 'j', '↓', () => actions.focusNext(1, focusKeysOf(kit, state, model, org)))}
        {keyButton(kit, 'key:k', 'k', '↑', () => actions.focusNext(-1, focusKeysOf(kit, state, model, org)))}
      </Box>
    </Box>
  )
}

/** The rows `j` and `k` move among: Now's own (its needs, then its cards), Org's (the tree's agents; none over the chart); left out elsewhere, the v2 screen's own (W.focusKeysOf). */
function focusKeysOf(kit: Kit, state: WebStateV2, model: DeckModel, org: OrgSpot): readonly string[] | undefined {
  const { view } = model
  if (isHelpOpen || view.page !== '' || view.v2.isInspectOpen) return undefined
  if (view.v2.tab === 'now') return nowFocusKeys(state, view.collapsed)
  if (view.v2.tab === 'org') return orgFocusKeys(kit, state, org)
  return undefined
}

/** Help, else Inspect, else an agent's page, else the open tab. */
function bodyOf(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean, org: OrgSpot): RenderElement {
  const { view } = model
  const v2 = view.v2
  if (isHelpOpen) {
    return helpPage(kit, () => {
      isHelpOpen = false
      actions.redraw()
    })
  }
  if (v2.isInspectOpen) return inspectPage(kit, state, actions)
  if (view.page !== '') return agentPage(kit, state, files, view.page, actions)
  if (v2.tab === 'chat') return chatTab(kit, state, files, v2, actions, isDemo)
  if (v2.tab === 'changes') return changesTab(kit, state, files, model, actions, isDemo)
  if (v2.tab === 'org') return orgTab(kit, state, actions, org)
  return nowTab(kit, state, view.collapsed, actions, () => actions.setV2View({ tab: 'org', isInspectOpen: false }))
}
