/**
 * The deck's drawings: the pane's five tabs (overview, agents, diffs,
 * commits, graph) and the live band above the prompt.
 *
 * Pure: each takes the surface's elements (Kit), the state to draw (DeckModel)
 * and the closures a press runs (Actions); the hooks module supplies all three.
 */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { DeckAgent, DeckAgentPane, DeckData, DeckMessage, DeckTab, DeckView } from '../types'
import { barsSvg } from './charts'
import { codeSourcesOf, hunksOf, type Hunk } from './diff'
import * as F from './format'
import type { CommitDetail, FileCode, FileDiff, FileRow, GitState } from './git'
import { statusWord, treeOf } from './graph'
import { MAIN, YOU, agentOf, editorsOf, isEnded, isLive, labelOf, series, totalsOf } from './model'

type TerminalTable = Elements['terminal']

export type Kit = {
  surface: RenderSurface
  Box: TerminalTable['Box']
  Text: TerminalTable['Text']
  Button: TerminalTable['Button']
  Code: TerminalTable['Code']
  Markdown: TerminalTable['Markdown']
  Input?: TerminalTable['Input']
  Select?: TerminalTable['Select']
  Svg?: Elements['desktop']['Svg']
  columns: number
}

export type ChatLine = { role: 'parent' | 'agent' | 'tool' | 'note'; who: string; text: string }

export type UsageInfo = {
  startedAt: number
  contextPercent?: number
  costUsd?: number
  limits: { kind: string; percentUsed: number }[]
}

export type DayRow = {
  day: string
  added: number
  removed: number
  tools: number
  tokens: number
  sessions: number
  activeMs: number
}

export type DeckModel = {
  data: DeckData
  view: DeckView
  git: GitState
  fileDiff: FileDiff | null
  commit: CommitDetail | null
  chat: ChatLine[] | null
  usage: UsageInfo | null
  days: DayRow[]
  graphSvg: string | null
  now: number
  cwd: string
}

export type Actions = {
  setTab: (tab: DeckTab) => void
  selectAgent: (id: string) => void
  setAgentPane: (pane: DeckAgentPane) => void
  selectFile: (path: string) => void
  selectCommit: (hash: string) => void
  setFilter: (filter: string) => void
  toggleFiles: () => void
  toggleBand: () => void
  refresh: () => void
  sendChat: (agentId: string, text: string) => void
  review: (text: string) => void
  open: (tab: DeckTab) => void
}

const C = {
  live: 'green',
  wait: 'yellow',
  done: 'cyan',
  fail: 'red',
  accent: 'magenta',
  add: 'green',
  del: 'red',
  peer: 'yellow',
} as const

/** Characters of diff text one drawing may carry, under the host's whole-tree cap. */
const DIFF_BUDGET = 60_000

export function dotOf(agent: DeckAgent): { glyph: string; color: string } {
  if (agent.kind === 'you') return { glyph: '◉', color: C.accent }
  if (agent.kind === 'main') return { glyph: '◆', color: agent.status === 'running' ? C.live : C.accent }
  if (agent.kind === 'peer') return { glyph: '◇', color: C.peer }
  switch (agent.status) {
    case 'running':
    case 'pending':
      return { glyph: '●', color: C.live }
    case 'waiting':
      return { glyph: '◐', color: C.wait }
    case 'idle':
      return { glyph: '○', color: C.wait }
    case 'completed':
      return { glyph: '✓', color: C.done }
    default:
      return { glyph: '✗', color: C.fail }
  }
}

function codeColor(code: FileCode): string {
  switch (code) {
    case 'N':
    case 'A':
      return C.add
    case 'D':
      return C.del
    case '!':
      return C.fail
    case 'R':
      return C.done
    default:
      return C.wait
  }
}

function activityLine(agent: DeckAgent, now: number): string {
  if (agent.current) return `${agent.current.tool} ${agent.current.target} · ${F.dur(now - agent.current.at)}`
  if (isEnded(agent.status)) {
    const took = agent.endedAt ? ` in ${F.dur(agent.endedAt - agent.startedAt)}` : ''
    return `${statusWord(agent)}${took}${agent.answer ? ` · ${F.oneLine(agent.answer)}` : ''}`
  }
  const last = agent.recent[agent.recent.length - 1]
  if (last) return `last: ${last.tool} ${last.target} · ${F.ago(now - last.at)}`
  return agent.description ? F.oneLine(agent.description) : 'waiting for work'
}

function nameOf(data: DeckData, id: string): string {
  const agent = agentOf(data, id)
  return agent ? labelOf(agent) : id
}

function elapsedOf(agent: DeckAgent, now: number): string {
  return F.dur((agent.endedAt ?? now) - agent.startedAt)
}

function rule(kit: Kit) {
  const { Text } = kit
  return <Text dimColor>{'─'.repeat(Math.max(8, Math.min(kit.columns, 160)))}</Text>
}

function heading(kit: Kit, text: string, note = '') {
  const { Text } = kit
  return (
    <Text>
      <Text bold>{text}</Text>
      {note ? <Text dimColor>{`  ${note}`}</Text> : null}
    </Text>
  )
}

function plusMinus(kit: Kit, added: number, removed: number) {
  const { Text } = kit
  return (
    <Text>
      <Text color={C.add}>{`+${F.num(added)}`}</Text> <Text color={C.del}>{`−${F.num(removed)}`}</Text>
    </Text>
  )
}

function codeBlocks(kit: Kit, hunks: readonly Hunk[], path: string, budget: { chars: number }) {
  const { Code, Text } = kit
  if (hunks.length === 0) return [<Text dimColor italic>no line changes to show</Text>]
  const { sources, isCut, used } = codeSourcesOf(hunks, budget.chars)
  budget.chars -= used
  const blocks = sources.map(source => <Code source={source} format="diff" path={path.slice(-200)} />)
  if (isCut) blocks.push(<Text dimColor italic>… cut to fit the pane</Text>)
  return blocks
}

function svgWidth(kit: Kit): number {
  return Math.round(Math.max(320, Math.min(1100, kit.columns * 8)))
}

/** The whole pane: title, tabs, then the open tab's body. */
export function deckView(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const totals = totalsOf(model.data)
  const { git } = model

  const tabs: { id: DeckTab; label: string; hotkey: string }[] = [
    { id: 'overview', label: 'Overview', hotkey: '1' },
    { id: 'agents', label: totals.live > 0 ? `Agents ${totals.live}●` : `Agents ${totals.agents}`, hotkey: '2' },
    { id: 'diffs', label: git.isRepo ? `Diffs ${git.files.length}` : 'Diffs', hotkey: '3' },
    { id: 'commits', label: 'Commits', hotkey: '4' },
    { id: 'graph', label: 'Graph', hotkey: '5' },
  ]

  const where =
    git.isRepo === null
      ? 'reading git…'
      : git.isRepo
        ? `${F.baseName(git.root)} ⎇ ${git.branch || 'detached'}${git.upstream ? ` ↑${git.ahead} ↓${git.behind}` : ''}`
        : 'not a git repository'

  let body: RenderElement
  switch (model.view.tab) {
    case 'agents':
      body = agentsTab(kit, model, actions)
      break
    case 'diffs':
      body = diffsTab(kit, model, actions)
      break
    case 'commits':
      body = commitsTab(kit, model, actions)
      break
    case 'graph':
      body = graphTab(kit, model, actions)
      break
    default:
      body = overviewTab(kit, model, actions)
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold color={C.accent}>
          ◆ Agent Deck
        </Text>
        <Text dimColor wrap="truncate-end">
          {where}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {tabs.map(tab => {
          const isOn = model.view.tab === tab.id
          return (
            <Button
              key={`tab:${tab.id}`}
              label={tab.label}
              hotkey={tab.hotkey}
              plain
              dimColor={!isOn}
              {...(isOn ? { variant: 'primary' as const } : {})}
              onPress={() => actions.setTab(tab.id)}
            />
          )
        })}
        <Button key="refresh" label="↻" hotkey="r" plain dimColor onPress={() => actions.refresh()} />
      </Box>
      {rule(kit)}
      {body}
    </Box>
  )
}

function overviewTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button, Svg } = kit
  const { data, git, now } = model
  const t = totalsOf(data)
  const sessionMs = now - (model.usage?.startedAt ?? data.startedAt)
  const main = agentOf(data, MAIN)
  const inputAll = t.tokensIn + t.cacheRead
  const cacheShare = inputAll > 0 ? Math.round((t.cacheRead / inputAll) * 100) : 0
  const failShare = t.tools > 0 ? Math.round((t.errors / t.tools) * 100) : 0

  const cards: { label: string; value: string; sub: string; color?: string }[] = [
    { label: 'Session', value: F.dur(sessionMs), sub: `${F.dur(data.turnMs)} working · ${data.turns} turns` },
    { label: 'Tool calls', value: F.num(t.tools), sub: t.errors ? `${t.errors} failed (${failShare}%)` : 'none failed', color: 'cyan' },
    { label: 'Lines by agents', value: `+${F.num(t.added)} −${F.num(t.removed)}`, sub: `${t.files} files edited`, color: C.add },
    {
      label: 'Uncommitted',
      value: git.isRepo ? F.plural(git.files.length, 'file') : '—',
      sub: git.isRepo ? `+${F.num(git.added)} −${F.num(git.removed)} vs HEAD` : 'no repository',
      color: C.wait,
    },
    {
      label: 'Commits',
      value: git.isRepo ? `${git.sessionCommits} this session` : '—',
      sub: git.isRepo ? `${git.today.commits} today · +${F.num(git.today.added)} −${F.num(git.today.removed)}` : '',
    },
    { label: 'Agents', value: String(t.agents), sub: `${t.live} live · ${t.done} done${t.failed ? ` · ${t.failed} failed` : ''}`, color: C.accent },
    { label: 'Tokens', value: F.num(inputAll + t.tokensOut), sub: `${F.num(t.tokensOut)} out · ${cacheShare}% cached`, color: 'blue' },
    {
      label: 'Cost',
      value: F.money(model.usage?.costUsd),
      sub: model.usage?.contextPercent !== undefined ? `context ${Math.round(model.usage.contextPercent)}% full` : '',
    },
  ]

  const perRow = kit.columns >= 100 ? 4 : kit.columns >= 66 ? 3 : 2
  const cardWidth = Math.max(16, Math.floor((kit.columns - (perRow - 1)) / perRow))
  const cardRows: (typeof cards)[] = []
  for (let i = 0; i < cards.length; i += perRow) cardRows.push(cards.slice(i, i + perRow))

  const tools = series(data, now, 'tools', 30)
  const edits = series(data, now, 'edits', 30)
  const minuteLabels = tools.map((_, i) => (i === 29 ? 'now' : `-${29 - i}m`))

  const live = data.agents.filter(agent => (agent.kind === 'agent' || agent.kind === 'teammate' || agent.kind === 'main') && isLive(agent.status))
  const topTools = Object.entries(t.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const toolMax = Math.max(1, ...topTools.map(([, count]) => count))
  const barWidth = Math.max(6, Math.min(30, kit.columns - 24))

  const hot: { path: string; code: FileCode | '✎'; added: number; removed: number }[] = git.isRepo
    ? git.files.slice(0, 6).map(file => ({ path: file.path, code: file.code, added: file.added, removed: file.removed }))
    : fileTotals(data).slice(0, 6).map(file => ({ ...file, code: '✎' as const }))

  const days = model.days.slice(-7)
  const daysMax = Math.max(1, ...days.map(day => day.added + day.removed))

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {cardRows.map(row => (
          <Box flexDirection="row" columnGap={1}>
            {row.map(card => (
              <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={cardWidth}>
                <Text dimColor wrap="truncate-end">
                  {card.label}
                </Text>
                <Text bold wrap="truncate-end" {...(card.color ? { color: card.color } : {})}>
                  {card.value}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {card.sub || ' '}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      {Svg ? (
        <Svg
          source={barsSvg(
            [
              { values: tools, color: '#4ade80', name: 'tool calls' },
              { values: edits, color: '#a78bfa', name: 'edits' },
            ],
            minuteLabels,
            { width: svgWidth(kit), height: 130 },
            { labelEvery: 5, title: 'Activity · last 30 minutes' },
          )}
          alt={`Activity over the last 30 minutes: ${tools.reduce((a, b) => a + b, 0)} tool calls, ${edits.reduce((a, b) => a + b, 0)} edits`}
          isInteractive
        />
      ) : (
        <Box flexDirection="column">
          {heading(kit, 'Activity', 'last 30 minutes, one cell a minute')}
          <Text>
            <Text color={C.live}>{F.sparkline(tools)}</Text>
            <Text dimColor>{`  ${tools.reduce((a, b) => a + b, 0)} tool calls`}</Text>
          </Text>
          <Text>
            <Text color={C.accent}>{F.sparkline(edits)}</Text>
            <Text dimColor>{`  ${edits.reduce((a, b) => a + b, 0)} edits`}</Text>
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        {heading(kit, 'Working now', main?.status === 'running' ? 'main loop is in a turn' : '')}
        {live.length === 0 ? (
          <Text dimColor>Nobody is running right now.</Text>
        ) : (
          live.slice(0, 8).map(agent => {
            const dot = dotOf(agent)
            return (
              <Box flexDirection="row" columnGap={1}>
                <Text color={dot.color}>{dot.glyph}</Text>
                <Button
                  key={`ov:agent:${agent.id}`}
                  label={labelOf(agent)}
                  plain
                  onPress={() => {
                    actions.selectAgent(agent.id)
                    actions.setTab('agents')
                  }}
                />
                <Text dimColor wrap="truncate-end">
                  {activityLine(agent, now)}
                </Text>
              </Box>
            )
          })
        )}
      </Box>

      {topTools.length > 0 ? (
        <Box flexDirection="column">
          {heading(kit, 'Top tools')}
          {topTools.map(([tool, count]) => (
            <Text wrap="truncate-end">
              <Text>{F.trunc(tool, 14).padEnd(15)}</Text>
              <Text color="cyan">{F.bar(count, toolMax, barWidth)}</Text>
              <Text dimColor>{` ${count}`}</Text>
            </Text>
          ))}
        </Box>
      ) : null}

      {hot.length > 0 ? (
        <Box flexDirection="column">
          {heading(kit, git.isRepo ? 'Hot files' : 'Files edited', git.isRepo ? 'uncommitted, biggest first' : '')}
          {hot.map(file => {
            const who = editorsOf(data, file.path).map(labelOf)
            return (
              <Text wrap="truncate-end">
                <Text color={file.code === '✎' ? C.wait : codeColor(file.code)}>{file.code}</Text>
                {` ${F.truncStart(file.path, Math.max(16, kit.columns - 30))} `}
                {plusMinus(kit, file.added, file.removed)}
                <Text dimColor>{who.length ? `  ${who.join(', ')}` : ''}</Text>
              </Text>
            )
          })}
        </Box>
      ) : null}

      {days.length > 0 ? (
        Svg ? (
          <Svg
            source={barsSvg(
              [
                { values: days.map(day => day.added), color: '#4ade80', name: 'added' },
                { values: days.map(day => day.removed), color: '#f87171', name: 'removed' },
              ],
              days.map(day => F.weekday(day.day)),
              { width: svgWidth(kit), height: 120 },
              { title: 'Lines changed by agents · last days' },
            )}
            alt={`Lines changed per day: ${days.map(day => `${day.day} +${day.added} -${day.removed}`).join(', ')}`}
            isInteractive
          />
        ) : (
          <Box flexDirection="column">
            {heading(kit, 'Last days', 'lines changed by agents')}
            {days.map(day => (
              <Text wrap="truncate-end">
                <Text>{`${F.weekday(day.day)} `}</Text>
                <Text color={C.add}>{F.bar(day.added + day.removed, daysMax, Math.max(6, Math.min(20, kit.columns - 40)))}</Text>
                <Text dimColor>{` +${F.num(day.added)} −${F.num(day.removed)} · ${F.num(day.tools)} tools · ${F.dur(day.activeMs)}`}</Text>
              </Text>
            ))}
          </Box>
        )
      ) : null}

      <Box flexDirection="row" columnGap={2}>
        <Button
          key="band"
          label={model.view.isBandHidden ? 'Show the live band above the prompt' : 'Hide the live band above the prompt'}
          plain
          dimColor
          onPress={() => actions.toggleBand()}
        />
      </Box>
    </Box>
  )
}

function fileTotals(data: DeckData): { path: string; added: number; removed: number }[] {
  const byPath = new Map<string, { path: string; added: number; removed: number }>()
  for (const edit of data.edits) {
    const row = byPath.get(edit.path) ?? { path: edit.path, added: 0, removed: 0 }
    row.added += edit.added
    row.removed += edit.removed
    byPath.set(edit.path, row)
  }
  return [...byPath.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed))
}

function orderedAgents(data: DeckData): DeckAgent[] {
  const rank = (agent: DeckAgent) => (agent.kind === 'main' ? 0 : isLive(agent.status) ? 1 : agent.kind === 'peer' ? 3 : 2)
  return data.agents
    .filter(agent => agent.kind !== 'you')
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? (b.endedAt ?? b.lastAt) - (a.endedAt ?? a.lastAt) : a.startedAt - b.startedAt))
}

function agentsTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const { data, now } = model
  const list = orderedAgents(data)
  const selected = agentOf(data, model.view.agent) ?? agentOf(data, MAIN)
  const t = totalsOf(data)

  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {`${t.agents} subagent${t.agents === 1 ? '' : 's'} · ${t.live} live · ${t.done} done${t.failed ? ` · ${t.failed} failed` : ''} · ${t.messages} messages`}
      </Text>
      {list.slice(0, 36).map(agent => {
        const dot = dotOf(agent)
        const isOn = agent.id === selected?.id
        const meta = [
          agent.kind === 'main' ? (agent.model ?? 'main loop') : agent.type,
          `${agent.tools} tools`,
          agent.added || agent.removed ? `+${agent.added} −${agent.removed}` : '',
          agent.kind === 'peer' ? '' : elapsedOf(agent, now),
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Text color={dot.color}>{`${isOn ? '▸' : ' '}${dot.glyph}`}</Text>
              <Button key={`agent:${agent.id}`} label={labelOf(agent)} plain dimColor={!isOn} onPress={() => actions.selectAgent(agent.id)} />
              <Text color={dot.color}>{statusWord(agent)}</Text>
              <Text dimColor wrap="truncate-end">
                {meta}
              </Text>
            </Box>
            <Text dimColor wrap="truncate-end">{`    ↳ ${activityLine(agent, now)}`}</Text>
          </Box>
        )
      })}
      {list.length > 36 ? <Text dimColor>{`… ${list.length - 36} more`}</Text> : null}
      {rule(kit)}
      {selected ? agentDetail(kit, model, selected, actions) : <Text dimColor>Pick an agent above.</Text>}
    </Box>
  )
}

function agentDetail(kit: Kit, model: DeckModel, agent: DeckAgent, actions: Actions): RenderElement {
  const { Box, Text, Button, Markdown } = kit
  const { data, now } = model
  const dot = dotOf(agent)
  const pane = model.view.agentPane
  const edits = data.edits.filter(edit => edit.agent === agent.id)
  const tokens = agent.tokensIn + agent.cacheRead + agent.tokensOut

  const facts = [
    agent.kind === 'main' ? 'main loop' : agent.type,
    `${statusWord(agent)} ${elapsedOf(agent, now)}`,
    agent.model ? `model ${agent.model}` : '',
    `${agent.tools} tool calls${agent.errors ? ` (${agent.errors} failed)` : ''}`,
    agent.files.length ? `+${agent.added} −${agent.removed} in ${F.plural(agent.files.length, 'file')}` : '',
    tokens ? `${F.num(tokens)} tokens over ${agent.requests} requests` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const task = agent.prompt || agent.description
  const reviewText =
    agent.kind === 'main'
      ? 'Review the changes made in this session so far and point out any bugs or loose ends.'
      : `Review the work of the subagent "${labelOf(agent)}" (${agent.type}): its edits to ${agent.files.slice(0, 8).join(', ') || 'no files'}. Point out any bugs or loose ends.`

  const panes: { id: DeckAgentPane; label: string; hotkey: string }[] = [
    { id: 'activity', label: 'Activity', hotkey: 'a' },
    { id: 'edits', label: `Diffs ${edits.length}`, hotkey: 'e' },
    { id: 'chat', label: 'Chat', hotkey: 'c' },
  ]

  let content: RenderElement
  if (pane === 'edits') content = agentEdits(kit, model, agent)
  else if (pane === 'chat') content = agentChat(kit, model, agent, actions)
  else content = agentActivity(kit, model, agent)

  return (
    <Box flexDirection="column">
      <Text bold color={dot.color} wrap="truncate-end">
        {`${dot.glyph} ${agent.name}${agent.kind !== 'main' && agent.description && agent.description !== agent.name ? ` — ${agent.description}` : ''}`}
      </Text>
      <Text dimColor wrap="wrap">
        {facts}
      </Text>
      {task && agent.kind !== 'main' ? (
        <Text wrap="wrap">
          <Text bold>Task </Text>
          {F.trunc(F.oneLine(task), 420)}
        </Text>
      ) : null}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {panes.map(one => (
          <Button
            key={`ap:${one.id}`}
            label={one.label}
            hotkey={one.hotkey}
            plain
            dimColor={pane !== one.id}
            {...(pane === one.id ? { variant: 'primary' as const } : {})}
            onPress={() => actions.setAgentPane(one.id)}
          />
        ))}
        {agent.kind !== 'peer' ? <Button key="ap:review" label="Ask main to review" plain dimColor onPress={() => actions.review(reviewText)} /> : null}
      </Box>
      {content}
      {agent.answer && pane !== 'chat' ? (
        <Box flexDirection="column" borderStyle="round" borderColor={C.done} paddingX={1}>
          <Text bold color={C.done}>
            Final answer
          </Text>
          <Markdown text={F.clean(F.trunc(agent.answer, 1400))} />
        </Box>
      ) : null}
    </Box>
  )
}

function agentActivity(kit: Kit, model: DeckModel, agent: DeckAgent): RenderElement {
  const { Box, Text } = kit
  const { now } = model
  const recent = [...agent.recent].reverse()
  const counts = Object.entries(agent.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tool, count]) => `${tool} ${count}`)
    .join(' · ')

  return (
    <Box flexDirection="column">
      {agent.current ? (
        <Text wrap="truncate-end">
          <Text color={C.live}>● now </Text>
          <Text bold>{agent.current.tool}</Text>
          <Text>{` ${agent.current.target}`}</Text>
          <Text dimColor>{` · ${F.dur(now - agent.current.at)}`}</Text>
        </Text>
      ) : (
        <Text dimColor>{isEnded(agent.status) ? `Finished ${agent.endedAt ? F.ago(now - agent.endedAt) : ''}.` : 'Between tool calls.'}</Text>
      )}
      {recent.length === 0 ? <Text dimColor>No tool calls yet.</Text> : null}
      {recent.map(act => {
        const glyph = act.ok === undefined ? '…' : act.ok ? '✓' : '✗'
        const color = act.ok === undefined ? C.live : act.ok ? C.done : C.fail
        return (
          <Text wrap="truncate-end">
            <Text color={color}>{glyph}</Text>
            <Text>{` ${act.tool}`}</Text>
            <Text dimColor>{` ${act.target}${act.ms !== undefined ? ` · ${F.dur(act.ms)}` : ''} · ${F.ago(now - act.at)}`}</Text>
          </Text>
        )
      })}
      {counts ? <Text dimColor wrap="wrap">{`All calls: ${counts}`}</Text> : null}
    </Box>
  )
}

function agentEdits(kit: Kit, model: DeckModel, agent: DeckAgent): RenderElement {
  const { Box, Text } = kit
  const edits = model.data.edits.filter(edit => edit.agent === agent.id).reverse()
  const budget = { chars: DIFF_BUDGET }

  if (edits.length === 0) {
    return <Text dimColor>{agent.kind === 'peer' ? 'Peers edit outside this session.' : 'No file edits by this agent yet.'}</Text>
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>{`Exactly what ${labelOf(agent)} changed, newest first (from its Edit and Write calls):`}</Text>
      {edits.slice(0, 14).map(edit => (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={C.wait}>{edit.isNew ? 'new ' : `${edit.tool} `}</Text>
            <Text bold>{F.truncStart(edit.path, Math.max(16, kit.columns - 30))}</Text>
            <Text> </Text>
            {plusMinus(kit, edit.added, edit.removed)}
            <Text dimColor>{` · ${F.ago(model.now - edit.at)}`}</Text>
          </Text>
          {budget.chars > 400 ? codeBlocks(kit, hunksOf(edit.patch), edit.path, budget) : null}
        </Box>
      ))}
      {edits.length > 14 ? <Text dimColor>{`… ${edits.length - 14} older edits`}</Text> : null}
    </Box>
  )
}

function agentChat(kit: Kit, model: DeckModel, agent: DeckAgent, actions: Actions): RenderElement {
  const { Box, Text, Input } = kit
  const name = labelOf(agent)
  const lines = model.chat
  const canChat = agent.kind === 'main' || agent.kind === 'agent' || agent.kind === 'teammate'

  return (
    <Box flexDirection="column">
      {lines === null ? <Text dimColor>Loading the conversation…</Text> : null}
      {lines !== null && lines.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
      {(lines ?? []).slice(-12).map(line => bubble(kit, line))}
      {canChat && Input ? (
        <Input
          key={`chat:${agent.id}`}
          label={`To ${name}`}
          placeholder={agent.kind === 'main' ? 'Queue a prompt for the main loop…' : `Message ${name}…`}
          value=""
          submitLabel="send"
          onSubmit={text => {
            if (text.trim()) actions.sendChat(agent.id, text.trim())
          }}
        />
      ) : null}
      <Text dimColor italic wrap="wrap">
        {agent.kind === 'main'
          ? 'Sends as your own prompt; it waits for the current turn to end.'
          : canChat
            ? `Goes to ${name} through SendMessage. A finished agent is resumed to answer; its reply shows here and in the main transcript.`
            : 'This node is a peer outside the session.'}
      </Text>
    </Box>
  )
}

function bubble(kit: Kit, line: ChatLine) {
  const { Box, Text, Markdown } = kit
  if (line.role === 'tool') {
    return <Text dimColor wrap="truncate-end">{`   ⚙ ${line.text}`}</Text>
  }
  if (line.role === 'note') {
    return (
      <Text dimColor italic wrap="wrap">
        {line.text}
      </Text>
    )
  }
  const isAgent = line.role === 'agent'
  const color = isAgent ? C.accent : 'cyan'
  return (
    <Box flexDirection="row" justifyContent={isAgent ? 'flex-start' : 'flex-end'}>
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width="90%">
        <Text bold color={color}>
          {line.who}
        </Text>
        <Markdown text={F.clean(F.trunc(line.text, 1600))} />
      </Box>
    </Box>
  )
}

function diffsTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Select, Button } = kit
  const { git, view, data } = model
  const editors = data.agents.filter(agent => data.edits.some(edit => edit.agent === agent.id))
  const options = [
    { value: 'all', label: git.isRepo === false ? 'All edits this session' : 'All uncommitted changes' },
    ...editors.map(agent => ({ value: agent.id, label: `${labelOf(agent)} · its exact edits` })),
  ]
  const filter = options.some(option => option.value === view.filter) ? view.filter : 'all'

  const picker = Select ? (
    <Select key="diff-filter" label="Show" options={options} value={filter} onSelect={value => actions.setFilter(value)} />
  ) : (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {options.map(option => (
        <Button key={`filter:${option.value}`} label={option.label} plain dimColor={option.value !== filter} onPress={() => actions.setFilter(option.value)} />
      ))}
    </Box>
  )

  let content: RenderElement
  if (filter !== 'all') {
    const agent = agentOf(data, filter)
    content = agent ? agentEdits(kit, model, agent) : <Text dimColor>That agent is gone.</Text>
  } else if (git.isRepo === null) {
    content = <Text dimColor>Reading the repository…</Text>
  } else if (!git.isRepo) {
    content = editsByFile(kit, model, actions)
  } else if (git.files.length === 0) {
    const last = git.commits[0]
    content = (
      <Box flexDirection="column">
        <Text color={C.add}>✓ Working tree clean — nothing uncommitted.</Text>
        {last ? <Text dimColor wrap="truncate-end">{`Last commit ${last.short} ${last.subject} · ${F.ago(model.now - last.at)}`}</Text> : null}
      </Box>
    )
  } else {
    content = gitFiles(kit, model, actions)
  }

  return (
    <Box flexDirection="column">
      {git.isRepo ? (
        <Text wrap="truncate-end">
          <Text bold>{`⎇ ${git.branch || 'detached'}`}</Text>
          <Text dimColor>{git.upstream ? ` → ${git.upstream} ↑${git.ahead} ↓${git.behind}` : ' · no upstream'}</Text>
          <Text dimColor>{` · ${F.plural(git.files.length, 'file')} `}</Text>
          {plusMinus(kit, git.added, git.removed)}
          <Text dimColor>{` vs ${git.head ? git.head.slice(0, 7) : 'empty tree'}`}</Text>
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end">{git.isRepo === false ? `No git repository at ${model.cwd}; showing the edits agents made.` : ''}</Text>
      )}
      {picker}
      {content}
    </Box>
  )
}

function gitFiles(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const { git, data, view } = model
  const budget = { chars: DIFF_BUDGET }
  const pathWidth = Math.max(16, kit.columns - 28)

  return (
    <Box flexDirection="column">
      {git.files.slice(0, 60).map((file: FileRow) => {
        const isOpen = view.file === file.path
        const who = editorsOf(data, file.path).map(labelOf)
        const flags = [file.isStaged ? 'staged' : '', file.isUnstaged && file.isStaged ? 'partly' : '', file.isBinary ? 'binary' : '', file.oldPath ? `from ${file.oldPath}` : '']
          .filter(Boolean)
          .join(', ')
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Text bold color={codeColor(file.code)}>
                {file.code}
              </Text>
              <Button key={`file:${file.path}`} label={F.truncStart(file.path, pathWidth)} plain dimColor={!isOpen} onPress={() => actions.selectFile(file.path)} />
              {plusMinus(kit, file.added, file.removed)}
              <Text dimColor wrap="truncate-end">
                {[flags, who.length ? `by ${who.join(', ')}` : ''].filter(Boolean).join(' · ')}
              </Text>
            </Box>
            {isOpen ? fileDetail(kit, model, file, budget, actions) : null}
          </Box>
        )
      })}
      {git.files.length > 60 ? <Text dimColor>{`… ${git.files.length - 60} more files`}</Text> : null}
      <Text dimColor italic>
        Press a file to open its diff.
      </Text>
    </Box>
  )
}

function fileDetail(kit: Kit, model: DeckModel, file: FileRow, budget: { chars: number }, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const diff = model.fileDiff && model.fileDiff.path === file.path ? model.fileDiff : null
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {diff === null ? (
        <Text dimColor>Loading diff…</Text>
      ) : diff.isBinary ? (
        <Text dimColor>Binary file — no line diff.</Text>
      ) : diff.note ? (
        <Text dimColor>{diff.note}</Text>
      ) : (
        codeBlocks(kit, diff.hunks, file.path, budget)
      )}
      <Box flexDirection="row" columnGap={2}>
        <Button
          key={`review:${file.path}`}
          label="Ask Claude to review"
          plain
          dimColor
          onPress={() => actions.review(`Review my uncommitted changes in ${file.path} (git diff HEAD -- ${file.path}) and point out bugs or risky edits.`)}
        />
        <Button key={`close:${file.path}`} label="Close" plain dimColor onPress={() => actions.selectFile(file.path)} />
      </Box>
    </Box>
  )
}

function editsByFile(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const files = fileTotals(model.data)
  const budget = { chars: DIFF_BUDGET }
  if (files.length === 0) return <Text dimColor>No edits yet this session.</Text>
  return (
    <Box flexDirection="column">
      {files.slice(0, 40).map(file => {
        const isOpen = model.view.file === file.path
        const edits = model.data.edits.filter(edit => edit.path === file.path)
        const who = editorsOf(model.data, file.path).map(labelOf)
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Text color={C.wait}>✎</Text>
              <Button key={`file:${file.path}`} label={F.truncStart(file.path, Math.max(16, kit.columns - 28))} plain dimColor={!isOpen} onPress={() => actions.selectFile(file.path)} />
              {plusMinus(kit, file.added, file.removed)}
              <Text dimColor wrap="truncate-end">{`by ${who.join(', ')}`}</Text>
            </Box>
            {isOpen ? (
              <Box flexDirection="column" paddingLeft={2}>
                {edits.reverse().slice(0, 10).map(edit => (
                  <Box flexDirection="column">
                    <Text dimColor>{`${edit.tool} by ${nameOf(model.data, edit.agent)} · ${F.ago(model.now - edit.at)}`}</Text>
                    {codeBlocks(kit, hunksOf(edit.patch), edit.path, budget)}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

function commitsTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const { git, data, now, view } = model

  if (git.isRepo === null) return <Text dimColor>Reading the repository…</Text>
  if (!git.isRepo) return <Text dimColor>{`No git repository at ${model.cwd}.`}</Text>
  if (git.commits.length === 0) return <Text dimColor>No commits yet on this branch.</Text>

  const subjectWidth = Math.max(16, kit.columns - 12)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{`Today ${F.plural(git.today.commits, 'commit')}`}</Text>
        <Text dimColor> · </Text>
        {plusMinus(kit, git.today.added, git.today.removed)}
        <Text dimColor>{` · this session ${git.sessionCommits}`}</Text>
      </Text>
      {git.commits.slice(0, 25).map(commit => {
        const isOpen = view.commit === commit.hash
        const by = data.commitsBy[commit.hash]
        const byAgent = by ? agentOf(data, by) : undefined
        const isSession = commit.at >= data.startedAt - 60_000
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Text color={C.wait}>{commit.short}</Text>
              <Button key={`commit:${commit.hash}`} label={F.trunc(commit.subject || '(no subject)', subjectWidth)} plain dimColor={!isOpen} onPress={() => actions.selectCommit(commit.hash)} />
            </Box>
            <Text dimColor wrap="truncate-end">
              {`        ${commit.author} · ${F.ago(now - commit.at)} · `}
              <Text color={C.add}>{`+${commit.added}`}</Text>
              <Text> </Text>
              <Text color={C.del}>{`−${commit.removed}`}</Text>
              {` · ${F.plural(commit.files, 'file')}`}
              {isSession ? <Text color={C.accent}> ★ this session</Text> : null}
              {byAgent ? <Text color={C.live}>{` by ${labelOf(byAgent)}`}</Text> : null}
            </Text>
            {isOpen ? commitDetail(kit, model, commit.hash, actions) : null}
          </Box>
        )
      })}
    </Box>
  )
}

function commitDetail(kit: Kit, model: DeckModel, hash: string, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const detail = model.commit?.hash === hash ? model.commit : null
  if (!detail) return <Text dimColor>    Loading commit…</Text>

  const budget = { chars: DIFF_BUDGET }
  const patches = filePatchesOfDetail(detail)

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text wrap="wrap">{F.trunc(F.clean(detail.body), 1200)}</Text>
      <Text dimColor>{`${detail.author} <${detail.email}> · ${new Date(detail.at).toLocaleString()}`}</Text>
      {detail.files.slice(0, 30).map(file => (
        <Text wrap="truncate-end">
          {plusMinus(kit, file.added, file.removed)}
          <Text>{` ${F.truncStart(file.path, Math.max(16, kit.columns - 20))}`}</Text>
          <Text dimColor>{file.isBinary ? ' (binary)' : ''}</Text>
        </Text>
      ))}
      {patches.map(patch => (
        <Box flexDirection="column">
          <Text bold>{F.truncStart(patch.path, Math.max(16, kit.columns - 6))}</Text>
          {budget.chars > 400 ? codeBlocks(kit, patch.hunks, patch.path, budget) : <Text dimColor>…</Text>}
        </Box>
      ))}
      {detail.isPatchCut ? <Text dimColor italic>… the rest of this commit's patch was cut to fit</Text> : null}
      <Button
        key={`review-commit:${detail.hash}`}
        label="Ask Claude to review this commit"
        plain
        dimColor
        onPress={() => actions.review(`Review commit ${detail.hash.slice(0, 10)} ("${F.oneLine(detail.body).slice(0, 80)}") with git show, and point out bugs or risky changes.`)}
      />
    </Box>
  )
}

function filePatchesOfDetail(detail: CommitDetail): { path: string; hunks: Hunk[] }[] {
  const out: { path: string; hunks: Hunk[] }[] = []
  let path = ''
  let lines: string[] = []
  const flush = () => {
    if (path) out.push({ path, hunks: hunksOf(lines.join('\n')) })
    lines = []
  }
  for (const line of detail.patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      path = match?.[2] ?? line.slice(11)
      continue
    }
    lines.push(line)
  }
  flush()
  return out.filter(patch => patch.hunks.length > 0).slice(0, 20)
}

const KIND_ICON: Record<DeckMessage['kind'], { glyph: string; color: string }> = {
  prompt: { glyph: '›', color: 'cyan' },
  spawn: { glyph: '⇢', color: C.live },
  result: { glyph: '⇠', color: C.done },
  message: { glyph: '✉', color: C.accent },
  chat: { glyph: '✎', color: 'cyan' },
}

function feed(kit: Kit, model: DeckModel, count: number) {
  const { Text } = kit
  const { data, now } = model
  const name = (id: string) => nameOf(data, id)
  const recent = data.messages.slice(-count).reverse()
  if (recent.length === 0) return [<Text dimColor>No messages between agents yet.</Text>]
  return recent.map(message => {
    const icon = KIND_ICON[message.kind]
    return (
      <Text wrap="truncate-end">
        <Text color={icon.color}>{icon.glyph}</Text>
        <Text>{` ${name(message.from)}`}</Text>
        <Text dimColor> → </Text>
        <Text>{name(message.to)}</Text>
        <Text dimColor>{` · ${F.ago(now - message.at)} · `}</Text>
        <Text>{F.trunc(F.oneLine(message.text), 140)}</Text>
      </Text>
    )
  })
}

function graphTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box, Text, Button, Svg } = kit
  const { data, now, view } = model
  const t = totalsOf(data)
  const counts = new Map<string, number>()
  for (const message of data.messages) {
    counts.set(message.from, (counts.get(message.from) ?? 0) + 1)
    counts.set(message.to, (counts.get(message.to) ?? 0) + 1)
  }

  const canvas =
    Svg && model.graphSvg ? (
      <Svg source={model.graphSvg} alt={`Agent graph: ${data.agents.length} nodes, ${t.messages} messages`} isInteractive />
    ) : (
      <Box flexDirection="column">
        {treeOf(data).slice(0, 60).map(row => {
          const dot = dotOf(row.agent)
          const talk = counts.get(row.agent.id) ?? 0
          const line =
            row.agent.kind === 'you'
              ? ''
              : ` ${statusWord(row.agent)} · ${row.agent.tools} tools${row.agent.added || row.agent.removed ? ` · +${row.agent.added} −${row.agent.removed}` : ''}${row.agent.current ? ` · ${row.agent.current.tool} ${row.agent.current.target}` : ''}`
          return (
            <Text wrap="truncate-end">
              <Text dimColor>{row.prefix}</Text>
              <Text color={dot.color}>{dot.glyph}</Text>
              <Text bold={row.agent.kind === 'main' || row.agent.kind === 'you'}>{` ${labelOf(row.agent)}`}</Text>
              <Text dimColor>{line}</Text>
              {talk ? <Text color={C.accent}>{`  ⇄ ${talk}`}</Text> : null}
            </Text>
          )
        })}
      </Box>
    )

  const chips = data.agents.filter(agent => agent.kind === 'agent' || agent.kind === 'teammate').slice(-12)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text dimColor>{`${data.agents.length - 1} agents · ${t.messages} messages · ${t.live} live`}</Text>
        <Button key="graph:files" label={view.showFiles ? 'Hide file nodes' : 'Show file nodes'} hotkey="f" plain dimColor onPress={() => actions.toggleFiles()} />
      </Box>
      {canvas}
      {Svg && model.graphSvg ? <Text dimColor italic>Hover a node to light up who it talks to; hover nodes and links for details.</Text> : null}
      {chips.length > 0 ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text dimColor>Open:</Text>
          {chips.map(agent => {
            const dot = dotOf(agent)
            return (
              <Button
                key={`chip:${agent.id}`}
                label={`${dot.glyph} ${labelOf(agent)}`}
                plain
                dimColor={!isLive(agent.status)}
                onPress={() => {
                  actions.selectAgent(agent.id)
                  actions.setTab('agents')
                }}
              />
            )
          })}
        </Box>
      ) : null}
      {rule(kit)}
      {heading(kit, "Who's talking", `newest first · ${now - (data.messages[data.messages.length - 1]?.at ?? now) < 30_000 ? 'live' : 'quiet'}`)}
      {feed(kit, model, 14)}
    </Box>
  )
}

/** The band above the prompt while subagents work: who, doing what, and a way in. */
export function bandView(kit: Kit, model: DeckModel, actions: Actions, theirs: RenderElement | null): RenderElement | null {
  const { Box, Text, Button } = kit
  const { data, now } = model
  const live = data.agents.filter(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && isLive(agent.status))
  if (live.length === 0) return null

  const room = Math.max(20, Math.floor((kit.columns - 40) / Math.min(3, live.length)))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold color={C.accent}>
          {`◆ ${live.length} agent${live.length === 1 ? '' : 's'} working`}
        </Text>
        {live.slice(0, 3).map(agent => (
          <Text wrap="truncate-end">
            <Text color={C.live}>●</Text>
            <Text>{` ${labelOf(agent)} `}</Text>
            <Text dimColor>{F.trunc(agent.current ? `${agent.current.tool} ${agent.current.target}` : activityLine(agent, now), room)}</Text>
          </Text>
        ))}
        {live.length > 3 ? <Text dimColor>{`+${live.length - 3} more`}</Text> : null}
        <Button key="band:open" label="Open deck" plain onPress={() => actions.open('agents')} />
        <Button key="band:graph" label="Graph" plain dimColor onPress={() => actions.open('graph')} />
        <Button key="band:hide" label="Hide" plain dimColor onPress={() => actions.toggleBand()} />
      </Box>
      {theirs}
    </Box>
  )
}

export function isYou(id: string): boolean {
  return id === YOU
}
