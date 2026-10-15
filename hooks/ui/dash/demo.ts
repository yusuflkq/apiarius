/**
 * `/deck demo`: the native dashboard drawn from the web deck's fixture
 * (web/fixtures/state.json, the state a real session of six agents wrote),
 * so its design can be judged with every element showing: a question with
 * options, a permission, six agents, the plan, the KPI strip, the activity.
 *
 * `demoStateOf` checks the fixture's shape and moves every time in it on, so
 * its "now" is the moment the demo opened and its ages read as recent.
 * `demoDataOf` gives the agent pages what their Diffs, Talk and Tool calls
 * read (detail.tsx works on the deck's own model): the sample's agents, its
 * messages, and its edits with their patches (web/fixtures/patches).
 * `answerDemo` answers the sample's question in the sample alone.
 *
 * Pure: the hooks module reads the files and hands their text in.
 */
import type { DeckActivity, DeckData, DeckStatus } from '../../../types'
import * as M from '../../model'
import type { WebAgent, WebState, WebStatus } from '../../web'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The arrays and objects a state must hold for the dashboard to read it. */
function isStateShape(value: unknown): value is WebState {
  if (!isRecord(value) || value.v !== 1 || typeof value.now !== 'number') return false
  const lists = ['agents', 'messages', 'activity', 'files', 'edits', 'changes', 'commits', 'pending', 'acks']
  return lists.every(name => Array.isArray(value[name])) && isRecord(value.summary) && isRecord(value.plan) && Array.isArray(value.plan.steps) && isRecord(value.session) && isRecord(value.needs)
}

/** `at` moved on by `by`, a time the state left out (0, null) as it was. */
function moved(at: number | null | undefined, by: number): number {
  return typeof at === 'number' && at > 0 ? at + by : (at ?? 0)
}

/**
 * The fixture's text as a state whose times read as of `now`: each time it
 * holds (the goal's, each agent's start, end and last call, every message,
 * call, file, edit, commit, pending item and ack) moved on by `now` less the
 * state's own `now`. Null for text that is not a v1 state.
 */
export function demoStateOf(text: string, now: number): WebState | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isStateShape(value)) return null
  const state = value
  const by = now - state.now
  state.now = now
  state.session.startedAt = moved(state.session.startedAt, by)
  if (state.goal) {
    state.goal.at = moved(state.goal.at, by)
    state.goal.followUps = (state.goal.followUps ?? []).map(one => ({ ...one, at: moved(one.at, by) }))
  }
  for (const agent of state.agents) {
    agent.startedAt = moved(agent.startedAt, by)
    agent.endedAt = agent.endedAt ? moved(agent.endedAt, by) : null
    if (agent.lastAction) agent.lastAction.at = moved(agent.lastAction.at, by)
  }
  for (const list of [state.messages, state.activity, state.edits, state.commits, state.pending, state.acks] as { at: number }[][]) {
    for (const one of list) one.at = moved(one.at, by)
  }
  for (const file of state.files) file.lastAt = moved(file.lastAt, by)
  return state
}

/** The deck's own status for one the page draws. */
const DECK_STATUS: Readonly<Record<WebStatus, DeckStatus>> = { starting: 'starting', running: 'running', waiting: 'waiting', done: 'completed', failed: 'failed', idle: 'idle' }

/**
 * The sample as the deck's own model, for the agent pages' Diffs, Talk and
 * Tool calls: each agent with its calls, counts and tokens, the Orchestrator
 * as the main loop; the messages; the edits with their patches by edit id
 * (`patches`, the fixture's .diff files; one not read shows no lines).
 */
export function demoDataOf(state: WebState, patches: Readonly<Record<string, string>>): DeckData {
  const data = M.emptyData(state.session.startedAt)
  const calls = new Map<string, DeckActivity[]>()
  state.activity.forEach((x, i) => {
    const call: DeckActivity = { id: `demo-${i}`, tool: x.tool, target: x.target, at: x.at, ...(typeof x.ms === 'number' ? { ms: x.ms } : {}), ...(typeof x.ok === 'boolean' ? { ok: x.ok } : {}) }
    calls.set(x.agent, [...(calls.get(x.agent) ?? []), call])
  })
  const own = (agent: WebAgent) => ({
    status: DECK_STATUS[agent.status] ?? 'idle',
    model: agent.model,
    startedAt: agent.startedAt,
    lastAt: agent.lastAction?.at ?? agent.startedAt,
    ...(agent.endedAt ? { endedAt: agent.endedAt } : {}),
    tools: agent.tools,
    errors: agent.errors,
    files: [...agent.files],
    added: agent.added,
    removed: agent.removed,
    tokensIn: agent.tokens.in,
    tokensOut: agent.tokens.out,
    cacheRead: agent.tokens.cacheRead,
    recent: (calls.get(agent.id) ?? []).slice(-M.LIMITS.recent),
    ...(agent.result ? { answer: agent.result } : {}),
  })
  for (const agent of state.agents) {
    if (agent.kind === 'orchestrator') {
      const main = M.agentOf(data, M.MAIN)
      if (main) Object.assign(main, own(agent))
      continue
    }
    const kind = agent.kind === 'teammate' ? 'teammate' : agent.kind === 'peer' ? 'peer' : 'agent'
    data.agents.push(
      M.newAgent(agent.id, kind, agent.label, agent.startedAt, {
        ...own(agent),
        type: agent.type,
        label: agent.label,
        scope: agent.scope,
        description: agent.scope || agent.label,
        prompt: agent.task,
        parentId: agent.parent ?? M.MAIN,
      }),
    )
  }
  data.messages = state.messages.map(message => ({
    id: message.id,
    from: message.from,
    to: message.to,
    kind: message.kind,
    text: message.text,
    at: message.at,
    ...(message.ackId ? { ackId: message.ackId } : {}),
    ...(message.callId ? { callId: message.callId } : {}),
  }))
  data.edits = state.edits.map(edit => {
    const patch = (patches[edit.id] ?? '').replace(/\r\n/g, '\n')
    return { id: edit.id, agent: edit.agent, tool: edit.tool, path: edit.path, abs: edit.path, at: edit.at, added: edit.added, removed: edit.removed, patch, isNew: /^@@ -0,0 /.test(patch) }
  })
  return data
}

/**
 * The sample's question answered in the sample alone (nothing reaches
 * Claude): taken down, "You answered: …" in the asking agent's Talk, and
 * that agent carrying on once nothing else of its waits on you; the
 * needs-you line moves to what still waits. The words answered; '' when the
 * sample holds no such question.
 */
export function answerDemo(state: WebState, data: DeckData, callId: string, answers: Readonly<Record<string, string>>, now: number): string {
  const at = state.pending.findIndex(item => item.id === callId && item.kind === 'question')
  const item = state.pending[at]
  if (at < 0 || !item) return ''
  state.pending.splice(at, 1)
  const words = M.answeredOf(item.questions ?? [], answers)
  const message = { id: `demo-choice-${now}`, at: now, from: M.YOU, to: item.agentId, kind: 'choice' as const, text: `You answered: ${words}`, callId }
  state.messages.push(message)
  data.messages.push({ ...message })
  const agent = state.agents.find(one => one.id === item.agentId)
  if (agent && !state.pending.some(one => one.agentId === agent.id)) {
    if (agent.status === 'waiting') {
      agent.status = 'running'
      state.summary.waiting = Math.max(0, state.summary.waiting - 1)
      state.summary.running += 1
    }
    agent.needsYou = null
    agent.now = 'Carrying on with your answer'
  }
  if (state.needs.agentId === item.agentId) {
    const next = state.pending[0]
    const asker = next ? state.agents.find(one => one.id === next.agentId) : undefined
    state.needs =
      next && asker?.needsYou
        ? { tone: 'attention', kind: 'blocked', text: `${asker.label} ${asker.needsYou}`, agentId: asker.id }
        : { tone: 'quiet', kind: 'working', text: `${state.summary.running} running` }
  }
  return words
}
