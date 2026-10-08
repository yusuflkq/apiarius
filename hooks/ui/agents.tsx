/**
 * The Agents tab, the deck's default view, top to bottom: the status bar;
 * the banner (the one thing to notice now); the delegation map (an Svg Tree
 * or Wire on the desktop, a tree on quote rails on the terminal); the open
 * strip, the map's click target; the selected agent's summary and its
 * Diffs, Conversation or Activity; and the messages log.
 *
 * Pure: Kit, DeckModel and Actions come from the hooks module. No text here
 * moves with the clock alone: times are times of day, and an agent's
 * elapsed time is the coarse one the screen signature covers, so a redraw
 * that changes nothing draws the same tree and the same Svg string.
 */
import type { RenderElement } from 'claude-code'

import type { DeckAgent, DeckAgentPane, DeckEdit, DeckMapView, DeckShownStatus } from '../../types'
import { hunksOf } from '../diff'
import * as F from '../format'
import { MAIN, agentOf, bannerOf, labelOf, statusOf, talkOf, totalsOf } from '../model'
import { clockOf, elapsedLineOf, latestPromptOf, mapMessagesOf, mapNodesOf, mapTreeOf, nowLineOf, sizeOf, treeOrderOf, TAG_OF, type MapTree } from './adapt'
import { codeBlocks, emptyLine, fileHeader, fitsTree, glyph, nameOf, plusMinus, toggles, type ToggleItem } from './common'
import { treeSvg, wireSvg, type MapMessage, type MapNode } from './map'
import { N, NATIVE_TEXT } from './theme'
import type { Actions, ChatLine, DeckModel, Kit } from './types'

/** How much of each list a drawing holds: in full, and lean when the full one would not fit the host's bounds. */
type Room = { diffChars: number; files: number; editsPerFile: number; messages: number; chat: number; strip: number; tree: number }

const FULL: Room = { diffChars: 40_000, files: 12, editsPerFile: 6, messages: 14, chat: 12, strip: 30, tree: 40 }
const LEAN: Room = { diffChars: 8_000, files: 4, editsPerFile: 2, messages: 8, chat: 6, strip: 16, tree: 16 }

/** The summary's label column, in cells: "Talked to" and two spaces. */
const LABEL_WIDTH = 11
/** Agent nesting the terminal's rails draw; deeper agents sit at this depth. */
const RAIL_DEPTH = 8

const MAP_VIEWS: readonly ToggleItem<DeckMapView>[] = [
  { id: 'tree', label: 'Tree' },
  { id: 'wire', label: 'Wire' },
]

const DETAILS: readonly ToggleItem<DeckAgentPane>[] = [
  { id: 'edits', label: 'Diffs' },
  { id: 'chat', label: 'Conversation' },
  { id: 'activity', label: 'Activity' },
]

/** Native weight of a direction tag: ask and task bold, result plain, msg dim. */
const TAG_TEXT: Record<MapMessage['tag'], { bold?: true; dimColor?: true }> = {
  ask: { bold: true },
  task: { bold: true },
  result: {},
  msg: { dimColor: true },
}

/**
 * The Agents tab. Its lists and diffs are capped well inside the host's
 * bounds (about 50,000 characters of text at most); should a drawing still
 * pass them, it is drawn lean, with shorter diffs and lists, rather than refused.
 */
export function agentsTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const full = drawAgents(kit, model, actions, FULL)
  return fitsTree(full) ? full : drawAgents(kit, model, actions, LEAN)
}

function drawAgents(kit: Kit, model: DeckModel, actions: Actions, room: Room): RenderElement {
  const { Box } = kit
  const { data } = model
  const nodes = mapNodesOf(data, model.now)
  const tree = mapTreeOf(nodes)
  const selected = agentOf(data, model.view.agent) ?? agentOf(data, MAIN)
  const selectedId = selected?.id ?? MAIN

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {statusBar(kit, model)}
        {bannerLine(kit, model)}
      </Box>
      {mapOf(kit, model, actions, nodes, tree, selectedId, room)}
      {openStrip(kit, actions, treeOrderOf(tree), selectedId, room)}
      {selected ? detail(kit, model, actions, selected, room) : null}
      {messagesLog(kit, model, actions, room)}
    </Box>
  )
}

// 1. The status bar: the deck, the repository and branch it follows; what is uncommitted and who runs.

function statusBar(kit: Kit, model: DeckModel): RenderElement {
  const { Box, Text } = kit
  const { git, data } = model
  const branch = git.branch === '' || git.branch === 'HEAD' ? 'detached' : git.branch
  // git that failed in a repository says so; the counts on the right are then the agents' own exact edits
  const isBroken = git.isRepo === false && git.root !== ''
  const where = git.isRepo === null ? 'reading git…' : git.isRepo ? `${F.baseName(git.root)} · ${branch}` : isBroken ? F.baseName(git.root) : 'no repository'
  const totals = totalsOf(data)
  const added = git.isRepo ? git.added : totals.added
  const removed = git.isRepo ? git.removed : totals.removed
  const files = git.isRepo ? git.files.length : totals.files
  const running = data.agents.filter(agent => agent.kind !== 'you' && agent.kind !== 'peer' && statusOf(agent) === 'running').length
  const counts = plusMinus(kit, added, removed)

  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text wrap="truncate-end">
        <Text bold>Agent deck</Text>
        <Text dimColor>{` · ${where}`}</Text>
        {isBroken ? <Text dimColor> · </Text> : null}
        {isBroken ? <Text color={N.err}>git failed</Text> : null}
      </Text>
      <Box flexDirection="row" flexShrink={0}>
        <Text wrap="truncate-end">
          {counts}
          {counts ? <Text dimColor> · </Text> : null}
          <Text dimColor>{files > 0 ? F.plural(files, 'file') : git.isRepo ? 'clean' : 'no edits'}</Text>
          <Text dimColor> · </Text>
          {running > 0 ? glyph(kit, 'running') : <Text dimColor>{'□'}</Text>}
          {running > 0 ? <Text>{` ${running} running`}</Text> : <Text dimColor> none running</Text>}
        </Text>
      </Box>
    </Box>
  )
}

// 2. The banner: exactly one line. A copper (accent) bar only when something failed or waits on you.

function bannerLine(kit: Kit, model: DeckModel): RenderElement {
  const { Box, Text } = kit
  const shown = bannerOf(model.data, model.git, model.now)
  if (shown.tone !== 'alert' && shown.tone !== 'attention') {
    return (
      <Box paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          {shown.text}
        </Text>
      </Box>
    )
  }
  const cut = shown.text.indexOf(': ')
  const subject = cut > 0 ? shown.text.slice(0, cut) : shown.text
  const rest = cut > 0 ? shown.text.slice(cut) : ''
  return (
    <Box borderStyle="quote" borderColor={N.accent} paddingLeft={1}>
      <Text wrap="truncate-end">
        {glyph(kit, shown.tone === 'alert' ? 'failed' : 'waiting')}
        <Text bold>{` ${subject}`}</Text>
        {rest ? <Text>{rest}</Text> : null}
      </Text>
    </Box>
  )
}

// 3. The delegation map: Svg on the desktop with a Tree | Wire toggle; quote rails on the terminal.

function mapOf(kit: Kit, model: DeckModel, actions: Actions, nodes: MapNode[], tree: MapTree, selectedId: string, room: Room): RenderElement {
  const { Box, Svg } = kit
  const { data, view } = model
  const prompt = latestPromptOf(data)
  if (!Svg) return railTree(kit, tree, selectedId, prompt, room.tree)

  const agents = nodes.filter(node => node.kind === 'agent' || node.kind === 'peer').length
  const isWire = view.map === 'wire'
  const source = isWire ? wireSvg(nodes, mapMessagesOf(data), { selected: selectedId }) : treeSvg(nodes, { selected: selectedId, prompt })
  const alt = isWire
    ? `Messages between You, the Orchestrator and ${F.plural(agents, 'agent')}, oldest at the top`
    : `Delegation tree: You, the Orchestrator and ${F.plural(agents, 'agent')} under it`

  return (
    <Box flexDirection="column">
      {toggles(kit, 'map', MAP_VIEWS, view.map, map => actions.setMapView(map))}
      <Svg source={source} alt={alt} />
    </Box>
  )
}

/** The colour a now line takes: waiting on you and failed carry their status; the rest stay plain. */
function nowTone(status: DeckShownStatus, text: string): { color?: string } {
  if (status === 'waiting') return { color: N.warn }
  if (status === 'failed' && text !== 'Stopped') return { color: N.err }
  return {}
}

/**
 * The terminal's map: one truncated line per agent (glyph, name, now text,
 * elapsed time at the right), each level of delegation one more quote rail
 * in. The You line carries your latest prompt, as the Svg's edge label does.
 */
function railTree(kit: Kit, tree: MapTree, selectedId: string, prompt: string, most: number): RenderElement {
  const { Box, Text } = kit
  let shown = 0
  let hidden = 0

  const line = (node: MapNode): RenderElement => {
    // a row shows at most the pane's width: what lies past it is never drawn, so it is not carried
    const said = F.trunc(node.kind === 'you' ? F.firstLine(prompt) : node.now, kit.columns)
    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          {glyph(kit, node.status)}
          <Text bold {...(node.id === selectedId ? { color: N.accent } : {})}>{` ${node.name}`}</Text>
          {said ? <Text {...(node.kind === 'you' ? NATIVE_TEXT.text3 : nowTone(node.status, said))}>{`  ${said}`}</Text> : null}
        </Text>
        {node.elapsed ? (
          <Box flexShrink={0}>
            <Text dimColor>{node.elapsed}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  const branch = (item: MapTree, depth: number): RenderElement => {
    shown += 1
    const kids: RenderElement[] = []
    for (const kid of item.kids) {
      if (shown >= most) hidden += sizeOf(kid)
      else kids.push(branch(kid, depth + 1))
    }
    if (item.node.kind === 'orchestrator' && item.kids.length === 0) kids.push(emptyLine(kit, 'No agents yet; delegated work shows here as it starts.'))
    if (kids.length === 0) return line(item.node)
    return (
      <Box flexDirection="column">
        {line(item.node)}
        {depth < RAIL_DEPTH ? (
          <Box flexDirection="column" borderStyle="quote" borderDimColor paddingLeft={1}>
            {kids}
          </Box>
        ) : (
          kids
        )}
      </Box>
    )
  }

  const root = branch(tree, 0)
  return (
    <Box flexDirection="column">
      {root}
      {hidden > 0 ? emptyLine(kit, `${F.plural(hidden, 'more agent')} not shown.`) : null}
    </Box>
  )
}

// 4. The open strip: one Button per agent in tree order, after its glyph. The selected one is the primary plate.

function openStrip(kit: Kit, actions: Actions, order: MapNode[], selectedId: string, room: Room): RenderElement {
  const { Box, Text, Button } = kit
  const list = order.slice(0, room.strip)
  const picked = order.find(node => node.id === selectedId)
  if (picked && !list.includes(picked)) list[list.length - 1] = picked
  const hidden = order.length - list.length

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {list.map(node => {
        const isOn = node.id === selectedId
        return (
          <Box flexDirection="row" columnGap={1}>
            {glyph(kit, node.status)}
            <Button
              key={`agent:${node.id}`}
              label={node.name}
              dimColor={!isOn}
              {...(isOn ? { variant: 'primary' as const } : {})}
              onPress={() => actions.selectAgent(node.id)}
            />
          </Box>
        )
      })}
      {hidden > 0 ? <Text dimColor>{`+${hidden} more`}</Text> : null}
    </Box>
  )
}

// 5. The selected agent: its summary, then its Diffs, Conversation or Activity.

function detail(kit: Kit, model: DeckModel, actions: Actions, agent: DeckAgent, room: Room): RenderElement {
  const { Box } = kit
  const pane = model.view.agentPane
  const body = pane === 'chat' ? conversation(kit, model, actions, agent, room) : pane === 'activity' ? activity(kit, agent) : diffs(kit, model, agent, room)
  return (
    <Box flexDirection="column" gap={1}>
      {summary(kit, model, agent)}
      <Box flexDirection="column">
        {toggles(kit, 'detail', DETAILS, pane, one => actions.setAgentPane(one))}
        {body}
      </Box>
    </Box>
  )
}

/** One row of the summary: the label dim in its column, the value beside it. */
function field(kit: Kit, label: string, value: RenderElement): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row">
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {value}
      </Box>
    </Box>
  )
}

/** The heading (glyph, name, what it is, `+a −r`) and four plain lines: Task, Now, Result, Talked to. */
function summary(kit: Kit, model: DeckModel, agent: DeckAgent): RenderElement {
  const { Box, Text } = kit
  const { data, now } = model
  const status = statusOf(agent)
  const what = agent.kind === 'main' ? 'main loop' : agent.kind === 'you' ? 'person' : agent.type
  const facts = [what, agent.model ? F.shortModel(agent.model) : '', elapsedLineOf(agent, now)].filter(Boolean).join(' · ')
  const counts = plusMinus(kit, agent.added, agent.removed)
  const task = agent.kind === 'main' ? latestPromptOf(data) : agent.prompt || agent.description
  const doing = nowLineOf(agent)
  const result = agent.answer ? F.firstLine(agent.answer) : ''
  const talk = talkOf(data, agent.id).slice(0, 6)
  const width = Math.max(12, kit.columns - LABEL_WIDTH)
  const none = (text: string) => <Text {...NATIVE_TEXT.text4}>{text}</Text>

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          {glyph(kit, status)}
          <Text bold>{` ${labelOf(agent)}`}</Text>
          {facts ? <Text dimColor>{`  ${facts}`}</Text> : null}
        </Text>
        {counts ? <Box flexShrink={0}>{counts}</Box> : null}
      </Box>
      {field(
        kit,
        'Task',
        task ? (
          <Text wrap="wrap">{F.trunc(F.oneLine(task), Math.floor(width * 1.8))}</Text>
        ) : (
          none(agent.kind === 'main' ? 'No prompt yet' : '—')
        ),
      )}
      {field(
        kit,
        'Now',
        doing ? (
          <Text wrap="truncate-end" {...nowTone(status, doing)}>
            {doing}
          </Text>
        ) : (
          none('—')
        ),
      )}
      {field(kit, 'Result', result ? <Text wrap="truncate-end">{result}</Text> : none('—'))}
      {field(
        kit,
        'Talked to',
        talk.length === 0 ? (
          none('Nobody yet')
        ) : (
          <Text wrap="truncate-end">
            {talk.flatMap((one, i) => [
              i > 0 ? <Text dimColor> · </Text> : null,
              <Text>{nameOf(data, one.id)}</Text>,
              <Text dimColor>{` ×${one.sent + one.received}`}</Text>,
            ])}
          </Text>
        ),
      )}
    </Box>
  )
}

type FileGroup = { path: string; edits: DeckEdit[]; last: number; added: number; removed: number; isNew: boolean }

/** The agent's edits by file, the file edited last first; each file's edits oldest first. */
function groupsOf(edits: readonly DeckEdit[]): FileGroup[] {
  const byPath = new Map<string, FileGroup>()
  for (const edit of edits) {
    const group = byPath.get(edit.path) ?? { path: edit.path, edits: [], last: 0, added: 0, removed: 0, isNew: false }
    group.edits.push(edit)
    group.last = Math.max(group.last, edit.at)
    group.added += edit.added
    group.removed += edit.removed
    group.isNew ||= edit.isNew
    byPath.set(edit.path, group)
  }
  return [...byPath.values()].sort((a, b) => b.last - a.last)
}

/** Diffs: exactly what the agent changed, from its own Edit and Write calls, grouped by file. */
function diffs(kit: Kit, model: DeckModel, agent: DeckAgent, room: Room): RenderElement {
  const { Box } = kit
  const name = labelOf(agent)
  const edits = model.data.edits.filter(edit => edit.agent === agent.id)
  if (edits.length === 0) {
    if (agent.kind === 'peer') return emptyLine(kit, 'A peer edits outside this session; its messages show below.')
    if (agent.kind === 'you') return emptyLine(kit, 'Pick an agent in the strip above to see what it changed.')
    return emptyLine(kit, `No edits by ${name} yet. Its Edit and Write calls show here as exact diffs.`)
  }

  const groups = groupsOf(edits)
  const budget = { chars: room.diffChars }
  const drawn: RenderElement[] = []
  let left = 0
  for (const group of groups) {
    if (drawn.length >= room.files || budget.chars < 400) {
      left += 1
      continue
    }
    const kept = group.edits.slice(-room.editsPerFile)
    const earlier = group.edits.length - kept.length
    const blocks: RenderElement[] = []
    let cut = 0
    for (const edit of kept) {
      if (budget.chars < 400) cut += 1
      else blocks.push(...codeBlocks(kit, hunksOf(edit.patch), edit.path, budget))
    }
    drawn.push(
      <Box flexDirection="column">
        {fileHeader(kit, group.path, group.added, group.removed, kit.columns, group.isNew ? 'new' : '')}
        {earlier > 0 ? emptyLine(kit, `${F.plural(earlier, 'earlier edit')} not shown.`) : null}
        {blocks}
        {cut > 0 ? emptyLine(kit, `${F.plural(cut, 'later edit')} cut to fit the pane.`) : null}
      </Box>,
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {drawn}
      {left > 0 ? emptyLine(kit, `${F.plural(left, 'more file')} not shown, to fit the pane.`) : null}
    </Box>
  )
}

/** A chat line: the agent's words left and yours right in quiet frames, its tool calls as dim lines under them. */
function bubble(kit: Kit, line: ChatLine): RenderElement {
  const { Box, Text, Markdown } = kit
  if (line.role === 'tool') {
    return (
      <Box paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          {line.text}
        </Text>
      </Box>
    )
  }
  if (line.role === 'note') return emptyLine(kit, line.text)
  const isAgent = line.role === 'agent'
  const who = line.who === MAIN ? 'Orchestrator' : line.who
  return (
    <Box flexDirection="row" justifyContent={isAgent ? 'flex-start' : 'flex-end'}>
      <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1} width="88%">
        <Text {...(isAgent ? NATIVE_TEXT.text1 : NATIVE_TEXT.text3)} wrap="truncate-end">
          {who}
        </Text>
        <Markdown text={F.clean(F.trunc(line.text, 1600))} />
      </Box>
    </Box>
  )
}

/** Conversation: the agent's transcript as bubbles, and a field that sends it a message (the Orchestrator: your next prompt). */
function conversation(kit: Kit, model: DeckModel, actions: Actions, agent: DeckAgent, room: Room): RenderElement {
  const { Box, Text, Input } = kit
  const name = labelOf(agent)
  const lines = model.chat
  const canSend = agent.kind === 'main' || agent.kind === 'agent' || agent.kind === 'teammate'
  const how =
    agent.kind === 'main'
      ? 'Sent as your next prompt; it runs when the current turn ends.'
      : canSend
        ? `Goes to ${name} through SendMessage; a finished agent wakes to answer.`
        : 'Only agents of this session take messages from here.'

  return (
    <Box flexDirection="column" gap={1}>
      {lines === null ? (
        <Text dimColor>Reading the conversation…</Text>
      ) : lines.length === 0 ? (
        emptyLine(kit, `No messages with ${name} yet.`)
      ) : (
        <Box flexDirection="column">{lines.slice(-room.chat).map(line => bubble(kit, line))}</Box>
      )}
      {canSend && Input ? (
        <Box flexDirection="column">
          <Input
            key={`chat:${agent.id}`}
            label={`To ${name}`}
            placeholder={agent.kind === 'main' ? 'Your next prompt for the Orchestrator…' : `Message ${name}…`}
            value=""
            submitLabel="send"
            onSubmit={text => {
              const said = text.trim()
              if (said) actions.sendChat(agent.id, said)
            }}
          />
          <Text dimColor wrap="truncate-end">
            {how}
          </Text>
        </Box>
      ) : (
        emptyLine(kit, how)
      )}
    </Box>
  )
}

/** Activity: the agent's recent tool calls, newest last; the one in flight green, a failed one red. */
function activity(kit: Kit, agent: DeckAgent): RenderElement {
  const { Box, Text } = kit
  const recent = agent.recent
  if (recent.length === 0) return emptyLine(kit, `No tool calls by ${labelOf(agent)} yet. Each call shows here as it runs.`)
  const counted = [F.plural(agent.tools, 'call'), agent.errors > 0 ? `${agent.errors} failed` : '', recent.length < agent.tools ? `the last ${recent.length} below` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {counted}
      </Text>
      {recent.map(call => {
        const isLive = call.ms === undefined
        const mark = isLive ? glyph(kit, 'running') : call.ok === false ? glyph(kit, 'failed') : <Text dimColor>■</Text>
        const what = call.description || call.target
        return (
          <Box flexDirection="row" columnGap={1}>
            <Box width={1} flexShrink={0}>
              {mark}
            </Box>
            <Box width={5} flexShrink={0}>
              <Text dimColor>{clockOf(call.at)}</Text>
            </Box>
            <Box width={12} flexShrink={0}>
              <Text wrap="truncate-end">{call.tool.startsWith('mcp__') ? 'MCP' : call.tool}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {what ? (
                <Text dimColor wrap="truncate-end">
                  {what}
                </Text>
              ) : null}
            </Box>
            <Box flexShrink={0}>
              <Text dimColor>{isLive ? 'running' : F.dur(call.ms ?? 0)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

// 6. The messages log: who handed what to whom, newest last. A press opens the agent a message went to.

function messagesLog(kit: Kit, model: DeckModel, actions: Actions, room: Room): RenderElement {
  const { Box, Text, Button } = kit
  const { data, view } = model
  const all = data.messages
  const shown = all.slice(-room.messages)
  const earlier = all.length - shown.length
  const routes = shown.map(message => `${nameOf(data, message.from)} → ${nameOf(data, message.to)}`)
  const widest = Math.max(0, ...routes.map(route => Array.from(route).length))
  const routeWidth = Math.max(10, Math.min(widest, Math.floor(kit.columns * 0.4)))

  return (
    <Box flexDirection="column">
      <Text bold>Messages</Text>
      {all.length === 0 ? emptyLine(kit, 'No messages yet. Prompts, hand-offs and replies show here in order.') : null}
      {earlier > 0 ? (
        <Box paddingLeft={2}>
          <Text dimColor>{`${F.num(earlier)} earlier`}</Text>
        </Box>
      ) : null}
      {shown.map((message, i) => {
        const isOn = message.id === view.message
        const tag = TAG_OF[message.kind]
        return (
          <Box flexDirection="row" columnGap={1}>
            <Box width={1} flexShrink={0}>
              {isOn ? <Text color={N.accent}>▌</Text> : null}
            </Box>
            <Box width={5} flexShrink={0}>
              <Text dimColor>{clockOf(message.at)}</Text>
            </Box>
            <Box width={routeWidth} flexShrink={0}>
              <Button key={`msg:${message.id}`} label={F.trunc(routes[i] ?? '', routeWidth)} plain onPress={() => actions.selectMessage(message.id)} />
            </Box>
            <Box width={6} flexShrink={0}>
              <Text {...TAG_TEXT[tag]}>{tag}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor={!isOn} wrap="truncate-end">
                {F.trunc(F.firstLine(message.text), kit.columns) || '—'}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
