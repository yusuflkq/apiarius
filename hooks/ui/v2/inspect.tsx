/**
 * Inspect (`i`), the session's depth on demand: for now its context, its
 * spend and each agent's tokens, requests, tool calls and errors, as the
 * v2 state's `inspect` holds them (Phase 2 adds what fills the context,
 * what is loaded, the permission decisions and the background work). And
 * Help (`h`): the keys, the same on every surface, and the avatars' style
 * ("Style: Robots ▸" steps to the next of web/avatars.mjs's ten).
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as AV from '../../../web/avatars.mjs'
import type { WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { avatar, avatarStyleOf, keyButton, quiet, sectionHead, type Face } from './look'
import { P } from './palette'
import { num, usd } from './text'

function backRow(kit: Kit, onBack: () => void): RenderElement {
  const { Box } = kit
  return <Box flexDirection="row">{keyButton(kit, 'key:b', 'b', '← Back', onBack, false)}</Box>
}

/** Inspect: the context and the spend, then a line an agent. */
export function inspectPage(kit: Kit, state: WebStateV2, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const { inspect } = state
  const figures = [inspect.contextPercent !== null ? `context ${Math.round(inspect.contextPercent)}%` : '', inspect.costUsd !== null ? `${usd(inspect.costUsd)} spent` : ''].filter(one => one !== '')
  return (
    <Box key="inspect" flexDirection="column" gap={1}>
      {backRow(kit, () => actions.setV2View({ isInspectOpen: false }))}
      <Box flexDirection="column">
        {sectionHead(kit, 'Inspect', null)}
        <Text color={P.fg2}>{figures.length > 0 ? figures.join(' · ') : 'The context and the spend show once Claude Code reports them.'}</Text>
      </Box>
      <Box key="inspect:agents" flexDirection="column">
        {sectionHead(kit, 'Tokens by agent', inspect.agents.length)}
        {inspect.agents.length === 0 ? quiet(kit, 'No agent has made a request yet.') : null}
        {inspect.agents.map(agent => (
          <Box key={`inspect:${agent.id}`} flexDirection="row" columnGap={2}>
            <Box flexShrink={0} width={Math.min(22, Math.max(10, Math.floor(kit.columns / 4)))}>
              <Text bold color={P.text} wrap="truncate-end">
                {agent.title}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text color={P.muted} wrap="wrap">
                {[agent.model, `${num(agent.tokens.in)} in · ${num(agent.tokens.out)} out · ${num(agent.tokens.cacheRead)} cache`, `${agent.requests} requests`, `${agent.tools} tools`].filter(one => one !== '').join(' · ')}
                {agent.errors > 0 ? <Text color={P.failText}>{` · ${agent.errors} ${agent.errors === 1 ? 'error' : 'errors'}`}</Text> : null}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** The keys, as every surface has them. */
const KEYS: readonly (readonly [string, string])[] = [
  ['1 2 3 4', 'Now · Chat · Org · Changes'],
  ['j k', 'move the focus down, up'],
  ['Enter', 'open what has the focus: an agent, a fold, a need, a file'],
  ['b', 'back, from an agent’s page, Inspect or this help'],
  ['n', 'the next thing that needs you'],
  ['f', 'filter Chat: All · You · Between agents · each agent'],
  ['m', 'message: the composer (on an agent’s page, @ that agent)'],
  ['i', 'Inspect: the context, the spend, each agent’s tokens'],
  ['h', 'this help'],
]

/** The faces the avatars' section shows its style on: the Orchestrator at work, one waiting on you, one done. */
const SAMPLES: readonly Face[] = [
  { id: 'main', title: 'Orchestrator', kind: 'orchestrator', status: 'running', isStopped: false },
  { id: 'helper', title: 'helper', kind: 'agent', status: 'waiting', isStopped: false },
  { id: 'bob', title: 'bob', kind: 'agent', status: 'done', isStopped: false },
]

/** The style after `style` in the pickers' order, round to the first. */
export function nextAvatarStyle(style: string): AV.AvatarStyle {
  const at = AV.STYLE_IDS.indexOf(AV.styleOf(style))
  return AV.STYLE_IDS[(at + 1) % AV.STYLE_IDS.length] ?? AV.DEFAULT_STYLE
}

/**
 * The avatars' style: three faces drawn in it where Svg draws, then "Style:
 * Robots ▸" (keyed `avatars:next`), which steps to the next style; `/deck
 * avatars <style>` picks one by name.
 */
function avatarsSection(kit: Kit, onStyle: (style: string) => void): RenderElement {
  const { Box, Button, Text } = kit
  const style = avatarStyleOf(kit)
  return (
    <Box key="help:avatars" flexDirection="column">
      {sectionHead(kit, 'Avatars', null)}
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {kit.surface === 'terminal' ? null : SAMPLES.map(one => <Box flexShrink={0}>{avatar(kit, one, 22, { dot: true })}</Box>)}
        <Box flexShrink={0}>
          <Button key="avatars:next" label={`Style: ${AV.styleName(style)} ▸`} plain onPress={() => onStyle(nextAvatarStyle(style))} />
        </Box>
        <Box flexShrink={1} minWidth={0}>
          <Text color={P.muted2} wrap="truncate-end">
            {`${AV.STYLE_IDS.indexOf(style) + 1} of ${AV.STYLE_IDS.length}`}
          </Text>
        </Box>
      </Box>
      {quiet(kit, 'Each press draws the next style, here, on the web page and in /deck demo, in every session. /deck avatars <style> picks one by name; the web page’s Help shows them all.')}
    </Box>
  )
}

/** Help: the key table, then the avatars' style. */
export function helpPage(kit: Kit, onBack: () => void, onStyle: (style: string) => void = () => undefined): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key="help" flexDirection="column" gap={1}>
      {backRow(kit, onBack)}
      <Box flexDirection="column">
        {sectionHead(kit, 'Keys', null)}
        {KEYS.map(([keys, does]) => (
          <Box key={`help:${keys}`} flexDirection="row" columnGap={2}>
            <Box flexShrink={0} width={6}>
              <Text bold color={P.text}>
                {keys}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text color={P.muted} wrap="wrap">
                {does}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
      {quiet(kit, 'The keys work while the pane has the keyboard: click it, or ctrl+x tab. Esc stays Claude Code’s.')}
      {avatarsSection(kit, onStyle)}
    </Box>
  )
}
