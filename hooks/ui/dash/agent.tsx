/**
 * An agent's page, over the tab it was opened from (Back returns there),
 * as the web deck's agent page reads:
 *
 * - its avatar, name, type, who it reports to (a press opens that agent),
 *   its status pill, and when it started or how long it ran;
 * - its Now line behind a rail in its status's hue;
 * - its task (four lines, Show more for the rest) and its checklist;
 * - what it waits on you for, answerable here (./needs);
 * - its result once it ended (the Orchestrator's: its latest answer to you);
 * - its Diffs · Talk · Tool calls, the detail's own (detail.tsx
 *   `agentPanesBlock`), from the deck model of this session or the sample's.
 *
 * Pure: Kit, the state, the deck model and DashActions come from the hooks
 * module. The texts opened with Show more are this module's own.
 */
import type { RenderElement } from 'claude-code'

import type { DeckData, DeckTab, DeckView } from '../../../types'
import { clean } from '../../format'
import type { WebAgent, WebState } from '../../web'
import { agentPanesBlock } from '../detail'
import type { DashActions, Kit } from '../types'
import { agentOf, ago, agoText, cut, flat, isLive, isRunning, nowLine, plural, reportsTo, span } from './dashModel'
import { needsCards } from './needs'
import { P, toneOf } from './palette'
import { AVATAR, avatar, pill, quiet, sectionHead, tickTexts } from './parts'

/** The tab names Back says it returns to. */
const TAB_NAME: Readonly<Record<DeckTab, string>> = { dashboard: 'Dashboard', org: 'Org', plan: 'Plan', agents: 'Classic', changes: 'Changes', stats: 'Stats' }

/** The characters a task or result shows before Show more, and at most after it. */
const SHORT = 360
const LONG = 2400

const opened = new Set<string>()

/** The page of agent `view.page`: its header, Now, task and checklist, what it waits on you for, its result, and its Diffs · Talk · Tool calls. */
export function agentPage(kit: Kit, state: WebState, data: DeckData, view: DeckView, actions: DashActions, now: number): RenderElement {
  const { Box, Button } = kit
  const agent = agentOf(state, view.page)
  const back = (
    <Box flexDirection="row">
      <Button key="page:back" label={`← ${TAB_NAME[view.tab] ?? 'Back'}`} plain hotkey="b" onPress={() => actions.back()} />
    </Box>
  )
  if (!agent) {
    return (
      <Box flexDirection="column" gap={1}>
        {back}
        {quiet(kit, 'This agent is not in the session: it may belong to an earlier one.')}
      </Box>
    )
  }
  return (
    <Box key={`page:${agent.id}`} flexDirection="column" gap={1}>
      {back}
      {header(kit, state, agent, actions, now)}
      {nowStrip(kit, agent, now)}
      {taskBlock(kit, agent, actions)}
      {checklistBlock(kit, agent)}
      {needsCards(kit, state, actions, now, 'agent', agent.id)}
      {resultBlock(kit, agent, actions, now)}
      {agentPanesBlock(kit, data, view, agent.id, actions)}
    </Box>
  )
}

/** Avatar, name and pill; under the name its type and who it reports to, then when it started or how long it ran and its calls. */
function header(kit: Kit, state: WebState, agent: WebAgent, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const tone = toneOf(agent.status)
  const boss = reportsTo(state, agent)
  const ran = isLive(agent.status) ? `started ${agoText(agent.startedAt, now)}` : `ran ${span((agent.endedAt || now) - agent.startedAt)}`
  const meta = [ran, plural(agent.tools || 0, 'tool call'), agent.errors ? plural(agent.errors, 'error') : ''].filter(Boolean).join(' · ')
  const bossId = boss.id
  return (
    <Box key="page:head" flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, agent.avatar, AVATAR.page, agent.label, tone.hue)}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold color={P.text} wrap="truncate-end">
          {agent.label}
        </Text>
        <Box flexDirection="row" columnGap={1}>
          <Text color={P.muted} wrap="truncate-end">
            {`${agent.type || agent.kind} · reports to`}
          </Text>
          {bossId ? <Button key={`page:boss:${bossId}`} label={boss.name} plain onPress={() => actions.openAgent(bossId)} /> : <Text color={P.fg2}>{boss.name}</Text>}
        </Box>
        <Text color={P.muted2} wrap="truncate-end">
          {meta}
        </Text>
      </Box>
      <Box flexShrink={0}>{pill(kit, agent.status)}</Box>
    </Box>
  )
}

/** Now: its line behind a rail in its status's hue; a live call's age at the right. */
function nowStrip(kit: Kit, agent: WebAgent, now: number): RenderElement {
  const { Box, Text } = kit
  const tone = toneOf(agent.status)
  const live = agent.lastAction?.isLive === true && isRunning(agent.status) ? agent.lastAction : null
  const said = live ? `${live.tool} \`${live.text}\`` : nowLine(agent) || (isRunning(agent.status) ? 'Working' : '—')
  return (
    <Box key="page:now" flexDirection="row" columnGap={2} borderStyle="quote" borderColor={tone.hue} paddingLeft={1}>
      <Box flexShrink={0}>
        <Text bold color={tone.pillFg}>
          Now
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">{tickTexts(kit, cut(flat(said), Math.max(40, kit.columns * 2)), P.fg2)}</Text>
      </Box>
      {live ? (
        <Box flexShrink={0}>
          <Text color={P.muted2}>{ago(live.at, now)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** A text cut to SHORT characters with Show more beside it while there is more; opened, the whole of it (up to LONG). */
function expandable(kit: Kit, key: string, text: string, actions: DashActions, draw: (shown: string) => RenderElement): RenderElement[] {
  const { Box, Button } = kit
  const isOpen = opened.has(key)
  const hasMore = Array.from(text).length > SHORT
  const shown = isOpen ? cut(text, LONG) : cut(text, SHORT)
  const toggle = () => {
    if (opened.has(key)) opened.delete(key)
    else opened.add(key)
    actions.redraw()
  }
  return [
    draw(shown),
    ...(hasMore
      ? [
          <Box flexDirection="row">
            <Button key={`page:more:${key}`} label={isOpen ? 'Show less' : 'Show more'} plain dimColor onPress={toggle} />
          </Box>,
        ]
      : []),
  ]
}

/** The task: what it was given, its scope beside the head; the Orchestrator's is the goal, or your prompts. */
function taskBlock(kit: Kit, agent: WebAgent, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const text = clean(String(agent.task || '')).trim()
  const scope = flat(agent.scope || '')
  return (
    <Box key="page:task" flexDirection="column">
      {sectionHead(kit, 'Task', null, scope ? <Text color={P.muted2}>{cut(scope, Math.max(12, Math.floor(kit.columns / 2)))}</Text> : null)}
      {text
        ? expandable(kit, `task:${agent.id}`, text, actions, shown => (
            <Text color={P.fg2} wrap="wrap">
              {shown}
            </Text>
          ))
        : quiet(kit, agent.kind === 'orchestrator' ? 'Your prompts in the Claude Code conversation.' : 'No task recorded.')}
    </Box>
  )
}

/** The mark of a checklist item: ✓ done, ◐ in hand (in the agent's hue while it waits or failed), ○ not started. */
function itemMark(kit: Kit, agent: WebAgent, status: string): RenderElement {
  const { Text } = kit
  if (status === 'done') return <Text color={P.doneText}>✓</Text>
  if (status === 'active') return <Text color={agent.status === 'waiting' ? P.waitText : agent.status === 'failed' ? P.failText : P.runText}>◐</Text>
  return <Text color={P.muted3}>○</Text>
}

/** The checklist: done of total beside the head, then each item with its mark, the one in hand in its own words beside it. */
function checklistBlock(kit: Kit, agent: WebAgent): RenderElement | null {
  const { Box, Text } = kit
  const list = agent.checklist
  if (!list || list.items.length === 0) return null
  return (
    <Box key="page:checklist" flexDirection="column">
      {sectionHead(kit, 'Checklist', null, <Text color={P.muted2}>{`${list.done}/${list.total}`}</Text>)}
      {list.items.map((item, i) => (
        <Box key={`check:${i}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>{itemMark(kit, agent, item.status)}</Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">
              <Text color={item.status === 'done' ? P.muted : item.status === 'active' ? P.text : P.fg2}>{flat(item.text)}</Text>
              {item.status === 'active' && item.doing ? <Text color={P.muted}>{`  ${flat(item.doing)}`}</Text> : null}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Its result once it ended, as Markdown (the Orchestrator's: its latest answer to you); a failed one's head says so. */
function resultBlock(kit: Kit, agent: WebAgent, actions: DashActions, now: number): RenderElement | null {
  const { Box, Text, Markdown } = kit
  const text = clean(String(agent.result || '')).trim()
  if (!text) return null
  const title = agent.kind === 'orchestrator' ? 'Latest answer' : agent.status === 'failed' ? 'Result · failed' : 'Result'
  return (
    <Box key="page:result" flexDirection="column">
      {sectionHead(kit, title, null, agent.endedAt ? <Text color={P.muted2}>{agoText(agent.endedAt, now)}</Text> : null)}
      {expandable(kit, `result:${agent.id}`, text, actions, shown => (
        <Markdown text={shown} />
      ))}
    </Box>
  )
}
