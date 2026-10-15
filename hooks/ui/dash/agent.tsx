/**
 * An agent's page, over the tab it was opened from (Back returns there),
 * as the web deck's agent page reads (web/app.js `AgentPage`):
 *
 * - its avatar, name, type, who it reports to (a press opens that agent),
 *   its status pill, when it started or how long it ran, its calls, and its
 *   errors in red;
 * - its Now line behind a rail in its status's hue;
 * - four figures in bordered boxes: its model (and what it is), its tokens
 *   (in · out · cache), the lines it changed (+a −r, and its files), its
 *   tool calls (and its errors, in red); four a row at the pane's 84 cells,
 *   two below;
 * - its task, folded to about four rows (Show more for the rest), and its
 *   checklist (done of total, a bar, each item, the one in hand in its own
 *   words under it): side by side at 84 cells, the checklist under the task
 *   below that;
 * - what it waits on you for, answerable here (./needs);
 * - its result once it ended (the Orchestrator's: its latest answer to you);
 * - its Diffs · Activity · Talk in the web deck's names and order, a count
 *   after each as the web counts them (the files it edited, its calls and
 *   its messages the state holds), the one open the view's: Diffs, its exact
 *   patches from the deck model of this session or the sample's (detail.tsx
 *   `agentDiffsBlock`); Activity, its calls as the web's tab rows them
 *   (./activity); Talk, its messages as the web's chat bubbles and the box
 *   that sends (./talk). A press on Talk takes the pane to its end.
 *
 * Pure: Kit, the state, the deck model and DashActions come from the hooks
 * module. The texts opened with Show more are this module's own.
 */
import type { BoxProps, RenderElement } from 'claude-code'

import type { DeckAgentPane, DeckData, DeckTab, DeckView } from '../../../types'
import { clean } from '../../format'
import type { WebAgent, WebState } from '../../web'
import { agentDiffsBlock } from '../detail'
import type { DashActions, Kit } from '../types'
import { activityTab } from './activity'
import { agentOf, ago, agoText, cut, flat, foldText, isLive, isRunning, nowLine, num, plural, reportsTo, span, tokensOf } from './dashModel'
import { needsCards } from './needs'
import { P, barSvg, mix, toneOf, type IconName } from './palette'
import { AVATAR, CARD_CHROME, avatar, icon, notePagePane, openAgentPage, pill, quiet, svgOf, tickTexts, widthFor } from './parts'
import { talkTab } from './talk'

/** The tab names Back says it returns to. */
const TAB_NAME: Readonly<Record<DeckTab, string>> = { dashboard: 'Dashboard', org: 'Org', plan: 'Plan', agents: 'Classic', changes: 'Changes', stats: 'Stats' }

/** From this many cells (the pane at its widest, 84, less the cell the deck keeps) the four figures share a row and the checklist stands beside the task. */
export const PAGE_WIDE = 83

/** The rows a task shows before Show more; the characters a result shows before it; the most either shows after it. */
const TASK_ROWS = 4
const SHORT = 360
const LONG = 2400

const opened = new Set<string>()

/** The page of agent `view.page`: its header, Now, figures, task and checklist, what it waits on you for, its result, and its Diffs · Activity · Talk. */
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
      {statsRow(kit, agent)}
      {workBlock(kit, agent, actions)}
      {needsCards(kit, state, actions, now, 'agent', agent.id)}
      {resultBlock(kit, agent, actions, now)}
      {panesBlock(kit, state, data, view, agent, actions, now)}
    </Box>
  )
}

/** The page's tabs, in the web deck's order, with the hotkeys that press them. */
const PAGE_TABS: readonly { id: DeckAgentPane; name: string; hotkey: string }[] = [
  { id: 'edits', name: 'Diffs', hotkey: 'd' },
  { id: 'activity', name: 'Activity', hotkey: 'a' },
  { id: 'chat', name: 'Talk', hotkey: 't' },
]

/** The count after each tab, as the web's: the files the agent edited, its calls and the messages to and from it, of those the state holds. */
export function paneCountsOf(state: WebState, id: string): Record<DeckAgentPane, number> {
  return {
    edits: new Set(state.edits.filter(edit => edit.agent === id).map(edit => edit.path)).size,
    activity: state.activity.filter(call => call.agent === id).length,
    chat: state.messages.filter(message => message.from === id || message.to === id).length,
  }
}

/**
 * Diffs · Activity · Talk, a count after each, then the pane open (the
 * view's; a press on a tab opens it, and its page opens on it next time;
 * a press on Talk takes the pane to its end, the newest message and the box).
 */
function panesBlock(kit: Kit, state: WebState, data: DeckData, view: DeckView, agent: WebAgent, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const open: DeckAgentPane = view.agentPane === 'activity' || view.agentPane === 'chat' ? view.agentPane : 'edits'
  const counts = paneCountsOf(state, agent.id)
  const pick = (pane: DeckAgentPane) => {
    notePagePane(agent.id, pane)
    actions.setAgentPane(pane)
    if (pane === 'chat') actions.followTalk()
  }
  const body =
    open === 'activity'
      ? activityTab(kit, state, agent, now)
      : open === 'chat'
        ? talkTab(kit, state, agent, view, actions, now)
        : (agentDiffsBlock(kit, data, agent.id) ?? quiet(kit, `${agent.label} did not edit any files.`))
  return (
    <Box key="page:panes" flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={3}>
        {PAGE_TABS.map(tab => {
          const isOn = tab.id === open
          const n = num(counts[tab.id])
          return (
            <Button key={`detail:${tab.id}`} label={`${tab.name} ${n}`} plain dimColor={!isOn} hotkey={tab.hotkey} onPress={() => pick(tab.id)}>
              <Text bold={isOn} underline={isOn}>
                {tab.name}
              </Text>
              <Text color={P.muted2}>{` ${n}`}</Text>
            </Button>
          )
        })}
      </Box>
      {body}
    </Box>
  )
}

/** Avatar, name and pill; under the name its type and who it reports to, then when it started or how long it ran, its calls and its errors. */
function header(kit: Kit, state: WebState, agent: WebAgent, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const tone = toneOf(agent.status)
  const boss = reportsTo(state, agent)
  const ran = isLive(agent.status) ? `started ${agoText(agent.startedAt, now)}` : `ran ${span((agent.endedAt || now) - agent.startedAt)}`
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
          {bossId ? <Button key={`page:boss:${bossId}`} label={boss.name} plain onPress={() => openAgentPage(actions, state, bossId)} /> : <Text color={P.fg2}>{boss.name}</Text>}
        </Box>
        <Text color={P.muted2} wrap="truncate-end">
          {`${ran} · ${plural(agent.tools || 0, 'tool call')}`}
          {agent.errors ? <Text color={P.muted2}> · </Text> : null}
          {agent.errors ? <Text color={P.failText}>{plural(agent.errors, 'error')}</Text> : null}
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

/** One figure in a bordered box, as the web's stat cards: its icon and label, its value, a line under it. */
function statBox(kit: Kit, key: string, mark: IconName, label: string, value: RenderElement, sub: RenderElement, width: number): RenderElement {
  const { Box, Text } = kit
  const glyph = icon(kit, mark, P.muted2, 14)
  return (
    <Box key={`stat:${key}`} flexDirection="column" width={width} borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        {glyph ? <Box flexShrink={0}>{glyph}</Box> : null}
        <Text color={P.muted} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      {value}
      {sub}
    </Box>
  )
}

/** The four figures: model, tokens, lines changed, tool calls; four a row at the pane's widest, else two. */
function statsRow(kit: Kit, agent: WebAgent): RenderElement {
  const { Box, Text } = kit
  const width = widthFor(kit.columns, kit.columns >= PAGE_WIDE ? 4 : 2)
  const t = agent.tokens
  const files = agent.files.length
  return (
    <Box key="page:stats" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      {statBox(
        kit,
        'model',
        'cpu',
        'Model',
        <Text bold color={P.text} wrap="truncate-end">
          {agent.model || '—'}
        </Text>,
        <Text color={P.muted2} wrap="wrap">
          {agent.kind === 'orchestrator' ? 'the main loop' : agent.kind}
        </Text>,
        width,
      )}
      {statBox(
        kit,
        'tokens',
        'coins',
        'Tokens',
        <Text bold color={P.text} wrap="truncate-end">
          {num(tokensOf(agent))}
        </Text>,
        <Text color={P.muted2} wrap="wrap">
          {`${num(t.in)} in · ${num(t.out)} out · ${num(t.cacheRead)} cache`}
        </Text>,
        width,
      )}
      {statBox(
        kit,
        'lines',
        'diff',
        'Lines changed',
        <Text bold wrap="truncate-end">
          <Text color={P.doneText}>{`+${agent.added || 0}`}</Text>
          <Text> </Text>
          <Text color={P.failText}>{`−${agent.removed || 0}`}</Text>
        </Text>,
        <Text color={P.muted2} wrap="wrap">
          {files > 0 ? plural(files, 'file') : isLive(agent.status) ? 'no files yet' : 'no files changed'}
        </Text>,
        width,
      )}
      {statBox(
        kit,
        'calls',
        'wrench',
        'Tool calls',
        <Text bold color={P.text} wrap="truncate-end">
          {String(agent.tools || 0)}
        </Text>,
        <Text color={agent.errors ? P.failText : P.muted2} wrap="wrap">
          {agent.errors ? plural(agent.errors, 'error') : 'no errors'}
        </Text>,
        width,
      )}
    </Box>
  )
}

/** Show more (or Show less) for the text `key` names: a press opens or folds it, and draws again. */
function moreButton(kit: Kit, key: string, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  const isOpen = opened.has(key)
  const toggle = () => {
    if (opened.has(key)) opened.delete(key)
    else opened.add(key)
    actions.redraw()
  }
  return (
    <Box flexDirection="row">
      <Button key={`page:more:${key}`} label={isOpen ? 'Show less' : 'Show more'} plain dimColor onPress={toggle} />
    </Box>
  )
}

/** A bordered card of the page's, `width` cells across where given (else the page's); a red edge for a failed agent's result. */
function cardProps(width: number | undefined, edge: string = P.border): BoxProps {
  return { flexDirection: 'column', borderStyle: 'round', borderColor: edge, paddingX: 1, ...(width === undefined ? {} : { width }) }
}

/** The task: "Task" and its scope, then what it was given, folded to about four rows with Show more; the Orchestrator's is the goal, or your prompts. */
function taskCard(kit: Kit, agent: WebAgent, actions: DashActions, width: number | undefined): RenderElement {
  const { Box, Text } = kit
  const text = clean(String(agent.task || '')).trim()
  const scope = flat(agent.scope || '')
  const key = `task:${agent.id}`
  const fold = foldText(text, (width ?? kit.columns) - CARD_CHROME, TASK_ROWS)
  return (
    <Box key="page:task" {...cardProps(width)}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexShrink={0}>
          <Text bold color={P.text}>
            Task
          </Text>
        </Box>
        {scope ? (
          <Box flexShrink={1}>
            <Text color={P.muted2} wrap="truncate-end">
              {scope}
            </Text>
          </Box>
        ) : null}
      </Box>
      {text ? (
        <Text color={P.fg2} wrap="wrap">
          {opened.has(key) ? cut(text, LONG) : fold.text}
        </Text>
      ) : (
        quiet(kit, agent.kind === 'orchestrator' ? 'Your prompts in the Claude Code conversation.' : 'No task recorded.')
      )}
      {text && fold.isCut ? moreButton(kit, key, actions) : null}
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

/** What the item in hand says it is doing, in its agent's hue: blue while it runs, amber while it waits, red once it failed, grey once it stopped. */
function doingHue(agent: WebAgent): string {
  if (agent.status === 'waiting') return P.waitText
  if (agent.status === 'failed') return P.failText
  return isRunning(agent.status) ? P.runText : P.muted
}

/** A thin bar of `done` of `total`: an image where Svg draws (blue, green once all are done), else a run of cells. */
function progressBar(kit: Kit, done: number, total: number, cells: number): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (Svg) return <Svg source={barSvg(done, total, Math.max(64, cells * 8))} alt={`${done} of ${total} done`} />
  const filled = total > 0 ? Math.round((Math.max(0, cells) * Math.min(done, total)) / total) : 0
  return (
    <Text wrap="truncate-end">
      <Text color={done >= total ? P.done : P.run}>{'━'.repeat(filled)}</Text>
      <Text color={P.track}>{'━'.repeat(Math.max(0, cells - filled))}</Text>
    </Text>
  )
}

/** The checklist: "Checklist" and done of total, the bar, then each item with its mark, the one in hand bold with what it is doing under it. */
function checklistCard(kit: Kit, agent: WebAgent, width: number | undefined): RenderElement | null {
  const { Box, Text } = kit
  const list = agent.checklist
  if (!list || list.items.length === 0) return null
  const inner = Math.max(8, (width ?? kit.columns) - CARD_CHROME)
  return (
    <Box key="page:checklist" {...cardProps(width)}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text bold color={P.text}>
          Checklist
        </Text>
        <Text color={P.muted}>{`${list.done}/${list.total}`}</Text>
      </Box>
      {list.total > 0 ? progressBar(kit, list.done, list.total, inner) : null}
      {list.items.map((item, i) => (
        <Box key={`check:${i}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>{itemMark(kit, agent, item.status)}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold={item.status === 'active'} color={item.status === 'active' ? P.text : item.status === 'done' || item.status === 'pending' ? P.muted : P.fg2} wrap="wrap">
              {flat(item.text)}
            </Text>
            {item.status === 'active' && item.doing ? (
              <Text color={doingHue(agent)} wrap="wrap">
                {flat(item.doing)}
              </Text>
            ) : null}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** The task and the checklist: side by side at the pane's widest (the task the wider, as the web's), the checklist under the task below that; the task alone while there is no checklist. */
function workBlock(kit: Kit, agent: WebAgent, actions: DashActions): RenderElement {
  const { Box } = kit
  if (agent.checklist.items.length === 0) return taskCard(kit, agent, actions, undefined)
  if (kit.columns >= PAGE_WIDE) {
    const taskWidth = Math.round(((kit.columns - 1) * 1.4) / 2.4)
    return (
      <Box key="page:work" flexDirection="row" columnGap={1} alignItems="flex-start">
        {taskCard(kit, agent, actions, taskWidth)}
        {checklistCard(kit, agent, kit.columns - 1 - taskWidth)}
      </Box>
    )
  }
  return (
    <Box key="page:work" flexDirection="column" gap={1}>
      {taskCard(kit, agent, actions, undefined)}
      {checklistCard(kit, agent, undefined)}
    </Box>
  )
}

/** Its result once it ended, as Markdown in a card (the Orchestrator's: its latest answer to you), Show more past SHORT characters; a failed one's edge and head say so. */
function resultBlock(kit: Kit, agent: WebAgent, actions: DashActions, now: number): RenderElement | null {
  const { Box, Text, Markdown } = kit
  const text = clean(String(agent.result || '')).trim()
  if (!text) return null
  const isFailed = agent.status === 'failed' && agent.kind !== 'orchestrator'
  const title = agent.kind === 'orchestrator' ? 'Latest answer' : isFailed ? 'Result · failed' : 'Result'
  const key = `result:${agent.id}`
  const isLong = Array.from(text).length > SHORT
  return (
    <Box key="page:result" {...cardProps(undefined, isFailed ? mix(P.fail, P.card, 0.55) : P.border)}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold color={isFailed ? P.failText : P.text}>
          {title}
        </Text>
        {agent.endedAt ? <Text color={P.muted2}>{agoText(agent.endedAt, now)}</Text> : null}
      </Box>
      <Markdown text={opened.has(key) ? cut(text, LONG) : cut(text, SHORT)} />
      {isLong ? moreButton(kit, key, actions) : null}
    </Box>
  )
}
