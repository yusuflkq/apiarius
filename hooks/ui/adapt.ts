/**
 * The delegation map's input, read off the deck's live data: one `MapNode`
 * per agent and one `MapMessage` per message, in the shapes `./map` draws,
 * and the same hierarchy as a tree for the terminal's railed fallback.
 *
 * Pure. Nothing here reads a clock but the `now` it is handed, and every
 * text it makes changes only when the screen signature does (an agent's
 * status, now text and coarse elapsed time, `agentsKeyOf` in the model), so
 * equal data gives equal nodes and the map's memo returns the same string.
 */
import type { DeckAgent, DeckData, DeckMessageKind } from '../../types'
import { firstLine } from '../format'
import { MAIN, YOU, elapsedOf, isLive, labelOf, nowOf, parentIdOf, statusOf } from '../model'
import type { MapMessage, MapNode } from './map'

/** A message's direction tag: you ask, an agent hands a task down, a result comes back, the rest are messages. */
export const TAG_OF: Readonly<Record<DeckMessageKind, MapMessage['tag']>> = {
  prompt: 'ask',
  spawn: 'task',
  result: 'result',
  message: 'msg',
  chat: 'msg',
}

/** The time of day `ms` falls at, `HH:MM` in the local zone: the same text for the life of the message. */
export function clockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/**
 * What the agent is doing, as its plate and its summary say it: the call or
 * todo in hand while it runs; "Waiting on you: …" while the engine waits on
 * the person for it; "Failed: …", "Stopped" or "Done: …" once it ended,
 * with the first line of its answer; "Idle" between turns; '' for you.
 */
export function nowLineOf(agent: DeckAgent): string {
  if (agent.kind === 'you') return ''
  if (agent.kind === 'peer') return 'A session outside this one'
  const doing = nowOf(agent)
  const said = agent.answer ? firstLine(agent.answer) : ''
  switch (statusOf(agent)) {
    case 'waiting':
      if (agent.needs) return `Waiting on you: ${agent.needs.text}`
      return doing ? `Waiting: ${doing}` : 'Waiting'
    case 'failed':
      if (agent.status === 'killed') return 'Stopped'
      return said || doing ? `Failed: ${said || doing}` : 'Failed'
    case 'done':
      return said ? `Done: ${said}` : 'Done'
    case 'idle':
      return 'Idle'
    default:
      return doing || 'Working'
  }
}

/**
 * How long the agent has been at it, as its plate shows it: coarse while it
 * runs, its run's length once it ended, and nothing otherwise (the
 * Orchestrator, an idle teammate), so time passing never changes it unseen.
 */
export function elapsedLineOf(agent: DeckAgent, now: number): string {
  if (agent.kind !== 'agent' && agent.kind !== 'teammate') return ''
  return isLive(agent.status) || agent.endedAt !== undefined ? elapsedOf(agent, now) : ''
}

function kindOf(agent: DeckAgent): MapNode['kind'] {
  switch (agent.kind) {
    case 'you':
      return 'you'
    case 'main':
      return 'orchestrator'
    case 'peer':
      return 'peer'
    default:
      return 'agent'
  }
}

/** Every agent as a map node, in the data's order (spawn order, oldest first): the map's input. */
export function mapNodesOf(data: DeckData, now: number): MapNode[] {
  return data.agents.map(agent => {
    const parent = parentIdOf(data, agent)
    return {
      id: agent.id,
      name: labelOf(agent),
      kind: kindOf(agent),
      status: statusOf(agent),
      ...(parent !== undefined ? { parent } : {}),
      elapsed: elapsedLineOf(agent, now),
      now: nowLineOf(agent),
      added: agent.added,
      removed: agent.removed,
    }
  })
}

/** Every message as the wire draws it, oldest first, its time as `HH:MM`. */
export function mapMessagesOf(data: DeckData): MapMessage[] {
  return data.messages.map(message => ({
    id: message.id,
    at: clockOf(message.at),
    from: message.from,
    to: message.to,
    tag: TAG_OF[message.kind],
    text: message.text,
  }))
}

/** The latest prompt you gave the Orchestrator, which labels the You → Orchestrator edge; '' before the first. */
export function latestPromptOf(data: DeckData): string {
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const message = data.messages[i]
    if (message && message.kind === 'prompt' && message.to === MAIN) return message.text
  }
  return ''
}

/** One node of the map's hierarchy with the nodes under it, oldest first. */
export type MapTree = { node: MapNode; kids: MapTree[] }

function standIn(id: string, name: string, kind: 'you' | 'orchestrator'): MapNode {
  return { id, name, kind, status: 'idle', elapsed: '', now: '', added: 0, removed: 0 }
}

/**
 * The map's hierarchy as a tree, as `treeSvg` lays it out: You at the root,
 * the Orchestrator its one child, every other node under its parent when that
 * is another known node, else under the Orchestrator. A loop of parents is
 * cut where it closes.
 */
export function mapTreeOf(nodes: readonly MapNode[]): MapTree {
  const you = nodes.find(node => node.kind === 'you') ?? standIn(YOU, 'You', 'you')
  const orch = nodes.find(node => node.kind === 'orchestrator') ?? standIn(MAIN, 'Orchestrator', 'orchestrator')
  const rest = nodes.filter(node => node !== you && node !== orch)
  const ids = new Set(rest.map(node => node.id))

  const parentOf = new Map<string, string>()
  for (const node of rest) {
    const parent = node.parent
    parentOf.set(node.id, parent !== undefined && parent !== node.id && ids.has(parent) ? parent : orch.id)
  }
  for (const node of rest) {
    const seen = new Set<string>()
    for (let at = node.id; at !== orch.id; at = parentOf.get(at) ?? orch.id) {
      if (seen.has(at)) {
        parentOf.set(node.id, orch.id)
        break
      }
      seen.add(at)
    }
  }

  const root: MapTree = { node: orch, kids: [] }
  const items = new Map<string, MapTree>()
  for (const node of rest) if (!items.has(node.id)) items.set(node.id, { node, kids: [] })
  for (const [id, item] of items) (items.get(parentOf.get(id) ?? '') ?? root).kids.push(item)
  return { node: you, kids: [root] }
}

/** The tree's nodes depth-first, You left out: the order of the open strip. */
export function treeOrderOf(tree: MapTree): MapNode[] {
  const out: MapNode[] = []
  const walk = (item: MapTree) => {
    if (item.node.kind !== 'you') out.push(item.node)
    for (const kid of item.kids) walk(kid)
  }
  walk(tree)
  return out
}

/** How many nodes the tree holds under and including `item`. */
export function sizeOf(item: MapTree): number {
  return item.kids.reduce((sum, kid) => sum + sizeOf(kid), 1)
}
