/**
 * Background: what runs when no agent is talking, and what the deck may stop.
 *
 * - **The record** (`data.background`): background shells, monitors,
 *   workflows and background agents Claude Code holds as tasks, and the crons
 *   and wakeups scheduled to wake the session. A row comes the moment the
 *   call that starts it is seen (`noteStart`: Bash or PowerShell with
 *   `run_in_background`, Monitor, Workflow, CronCreate, ScheduleWakeup),
 *   attributed to the loop whose call it is, and takes Claude Code's own id
 *   when that call ends (`noteEnd`). Claude Code's snapshots (`noteSnapshot`:
 *   the `background_tasks` and `session_crons` of classic Stop and
 *   SubagentStop) add what the deck did not see start and drop what they no
 *   longer list. A row goes, too, when its stop is seen: TaskStop or
 *   CronDelete of it, a task notification that it ended (`noteTaskEnds`), a
 *   one-shot schedule firing (`noteFired`).
 * - **The verdicts** (`data.verdicts`): what Claude Code's permission check
 *   (`$.tool.check`, no classifier asked) said of each stopping call the deck
 *   could make: TaskStop of a background agent, a teammate or a task,
 *   CronDelete of a schedule. Stop and Cancel show only where the newest says
 *   `allow` (`stopOf`); the hooks module asks again before every press.
 * - **The view model**: v2's `background` (`backgroundOf`), each agent row's
 *   `stop` (`withStops`) and the band's counts (`bandPartsOf`).
 *
 * Nothing here is made up: titles, notes, statuses, schedules and next runs
 * are Claude Code's own words and times. What the deck words itself (a row's
 * kind, "running" before any snapshot names a status, "scheduled", the ages)
 * is said so in web/CONTRACT.md.
 *
 * Pure, like the model: the hooks module (register.tsx) records and asks.
 */
import type { DeckBackground, DeckData, DeckVerdict } from '../types'
import * as F from './format'
import * as M from './model'

/** The rows the record keeps, and the verdicts: the oldest go past these. */
export const MOST_BACKGROUND = 50
export const MOST_VERDICTS = 100

/** How long a verdict stands before the hooks module asks again. */
export const VERDICT_MS = 60_000

/** A snapshot drops only rows seen before it by this much: a call that started the moment it was taken stays. */
export const SNAPSHOT_GRACE_MS = 2_000

/** The longest title and note kept. */
const MOST_TITLE = 300

/** The tools that stop: TaskStop a task (an agent, a shell, a monitor, a workflow), CronDelete a schedule. */
export type StopTool = 'TaskStop' | 'CronDelete'

type Row = DeckBackground
type Kind = DeckBackground['kind']

const SCHEDULES: ReadonlySet<Kind> = new Set(['cron', 'wakeup'])

/** Whether a row is a schedule (a cron or a wakeup), not a task. */
export function isSchedule(row: Pick<Row, 'kind'>): boolean {
  return SCHEDULES.has(row.kind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function timeOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function textOf(value: unknown): string {
  return F.trunc(str(value).trim(), MOST_TITLE)
}

/** The record as it stands (made, empty, on first use). */
export function rowsOf(data: DeckData): Row[] {
  if (!Array.isArray(data.background)) data.background = []
  return data.background
}

/** The record as it stands, read only: none where the data keeps none (the view model never writes the data). */
function shownRowsOf(data: DeckData): readonly Row[] {
  return Array.isArray(data.background) ? data.background : []
}

function keep(data: DeckData) {
  const rows = rowsOf(data)
  if (rows.length > MOST_BACKGROUND) rows.splice(0, rows.length - MOST_BACKGROUND)
}

function drop(data: DeckData, gone: (row: Row) => boolean): boolean {
  const rows = rowsOf(data)
  const kept = rows.filter(row => !gone(row))
  if (kept.length === rows.length) return false
  data.background = kept
  return true
}

/**
 * A snapshot's or an earlier build's record, each row kept only in its own
 * shape (`healData` keeps fields it does not know as they came); the
 * verdicts too. Run once on a restored snapshot.
 */
export function heal(data: DeckData): void {
  const kinds: readonly Kind[] = ['shell', 'monitor', 'workflow', 'agent', 'other', 'cron', 'wakeup']
  const rows = Array.isArray(data.background) ? (data.background as unknown[]) : []
  data.background = rows.filter(isRecord).flatMap(one => {
    const id = str(one.id)
    const kind = kinds.includes(one.kind as Kind) ? (one.kind as Kind) : undefined
    const at = timeOf(one.at)
    if (id === '' || !kind || at === undefined) return []
    const nextAt = timeOf(one.nextAt)
    const row: Row = {
      id,
      isBound: one.isBound === true,
      kind,
      type: str(one.type),
      status: str(one.status),
      title: str(one.title),
      note: str(one.note),
      prompt: str(one.prompt),
      schedule: str(one.schedule),
      recurring: one.recurring === true,
      ...(nextAt !== undefined ? { nextAt } : {}),
      by: str(one.by),
      call: str(one.call),
      at,
      seenAt: timeOf(one.seenAt) ?? 0,
    }
    return [row]
  })
  keep(data)
  const verdicts: Record<string, DeckVerdict> = {}
  if (isRecord(data.verdicts)) {
    for (const [key, one] of Object.entries(data.verdicts)) {
      if (!isRecord(one) || !['allow', 'ask', 'deny'].includes(str(one.decision)) || timeOf(one.at) === undefined) continue
      verdicts[key] = { decision: one.decision as DeckVerdict['decision'], ...(str(one.reason) ? { reason: str(one.reason) } : {}), at: one.at as number }
    }
  }
  data.verdicts = verdicts
}

// The calls that start background work, and the calls that stop it.

/** What a tool call says, as the hooks module hands it in. */
export type Call = { toolUseId: string; tool: string; input: Record<string, unknown>; by: string; at: number }

/** Whether a shell call asks to run in the background. */
function isBackgroundShell(tool: string, input: Record<string, unknown>): boolean {
  return M.SHELL_TOOLS.includes(tool) && input.run_in_background === true
}

/** Whether `tool` called with `input` starts background work as it runs: a shell with `run_in_background`, Monitor, Workflow, CronCreate, ScheduleWakeup (not its `stop`). */
export function startsBackground(tool: string, input: Record<string, unknown>): boolean {
  if (isBackgroundShell(tool, input)) return true
  if (tool === 'Monitor' || tool === 'Workflow' || tool === 'CronCreate') return true
  return tool === 'ScheduleWakeup' && input.stop !== true
}

/** What a starting call says of the row it makes: its kind, title, note, prompt and schedule, as given. */
function startOf(tool: string, input: Record<string, unknown>): Pick<Row, 'kind' | 'title' | 'note' | 'prompt' | 'schedule' | 'recurring'> {
  const none = { note: '', prompt: '', schedule: '', recurring: false }
  if (M.SHELL_TOOLS.includes(tool)) return { ...none, kind: 'shell', title: textOf(input.command), note: textOf(input.description) }
  if (tool === 'Monitor') {
    const ws = isRecord(input.ws) ? textOf(input.ws.url) : ''
    return { ...none, kind: 'monitor', title: textOf(input.description) || textOf(input.command) || ws }
  }
  if (tool === 'Workflow') return { ...none, kind: 'workflow', title: textOf(input.name) || (typeof input.script === 'string' ? (M.workflowMetaOf(input.script)?.name ?? '') : '') }
  if (tool === 'CronCreate') return { kind: 'cron', title: F.firstLine(str(input.prompt)), note: '', prompt: textOf(input.prompt), schedule: textOf(input.cron), recurring: input.recurring !== false }
  return { kind: 'wakeup', title: textOf(input.reason) || F.firstLine(str(input.prompt)), note: '', prompt: textOf(input.prompt), schedule: '', recurring: false }
}

/**
 * A call that starts background work started (`startsBackground`): its row,
 * at once, keyed by the call until its end names Claude Code's id. Answers
 * whether the record changed.
 */
export function noteStart(data: DeckData, call: Call): boolean {
  if (!startsBackground(call.tool, call.input) || call.toolUseId === '') return false
  const rows = rowsOf(data)
  if (rows.some(row => row.call === call.toolUseId)) return false
  rows.push({ id: call.toolUseId, isBound: false, type: '', status: '', by: call.by, call: call.toolUseId, at: call.at, seenAt: 0, ...startOf(call.tool, call.input) })
  keep(data)
  return true
}

/** A call as it ended: whether it ran, and its structured result. */
export type Ended = Call & { ok: boolean; result: unknown }

/** The row Claude Code's id names, a task's or a schedule's, once bound. */
function boundRow(data: DeckData, id: string, isScheduleId: boolean): Row | undefined {
  return rowsOf(data).find(row => row.isBound && row.id === id && isSchedule(row) === isScheduleId)
}

/** The call's row takes Claude Code's id; a row a snapshot made under that id first gives way to it, keeping what the snapshot said. */
function bind(data: DeckData, row: Row, id: string): void {
  const twin = boundRow(data, id, isSchedule(row))
  if (twin && twin !== row) {
    row.type ||= twin.type
    row.status ||= twin.status
    row.seenAt = Math.max(row.seenAt, twin.seenAt)
    data.background = rowsOf(data).filter(one => one !== twin)
  }
  row.id = id
  row.isBound = true
}

/**
 * A call ended. One that started background work binds its row to Claude
 * Code's id (a shell's `backgroundTaskId`, Monitor's and Workflow's
 * `taskId`, CronCreate's `id`, its schedule in words and next run;
 * ScheduleWakeup's next run), or drops it when it did not run, or ran in
 * the foreground after all. A shell call Claude Code moved to the
 * background (Ctrl+B, its timeout) makes its row now. TaskStop and
 * CronDelete of a row take it down, and so does ScheduleWakeup's `stop` for
 * the wakeups. Answers whether the record changed.
 */
export function noteEnd(data: DeckData, call: Ended): boolean {
  const record = isRecord(call.result) ? call.result : {}
  const own = rowsOf(data).find(row => row.call === call.toolUseId && call.toolUseId !== '')
  if (call.tool === 'TaskStop') {
    const id = str(call.input.task_id) || str(call.input.shell_id)
    return call.ok && id !== '' && drop(data, row => !isSchedule(row) && row.isBound && row.id === id)
  }
  if (call.tool === 'CronDelete') {
    const id = str(call.input.id)
    return call.ok && id !== '' && drop(data, row => isSchedule(row) && row.isBound && row.id === id)
  }
  if (call.tool === 'ScheduleWakeup' && call.input.stop === true) return call.ok && drop(data, row => row.kind === 'wakeup')
  if (!call.ok) return own ? drop(data, row => row === own) : false
  if (M.SHELL_TOOLS.includes(call.tool)) {
    const id = str(record.backgroundTaskId)
    if (id === '') return own ? drop(data, row => row === own) : false
    if (own) {
      bind(data, own, id)
      return true
    }
    // moved to the background by Claude Code (Ctrl+B, its timeout): a row of its own now
    const made: Row = { id: call.toolUseId, isBound: false, type: '', status: '', by: call.by, call: call.toolUseId, at: call.at, seenAt: 0, ...startOf(call.tool, call.input) }
    rowsOf(data).push(made)
    bind(data, made, id)
    keep(data)
    return true
  }
  if (!own) return false
  if (call.tool === 'Monitor' || call.tool === 'Workflow') {
    const id = str(record.taskId)
    if (id === '') return drop(data, row => row === own)
    if (call.tool === 'Workflow' && str(record.workflowName)) own.title = textOf(record.workflowName)
    bind(data, own, id)
    return true
  }
  if (call.tool === 'CronCreate') {
    const id = str(record.id)
    if (id === '') return drop(data, row => row === own)
    own.note = textOf(record.humanSchedule)
    if (typeof record.recurring === 'boolean') own.recurring = record.recurring
    const nextAt = timeOf(record.nextFireAt)
    if (nextAt !== undefined) own.nextAt = nextAt
    bind(data, own, id)
    return true
  }
  if (call.tool === 'ScheduleWakeup') {
    // a wakeup's id comes with the next snapshot; its next run now
    const nextAt = timeOf(record.scheduledFor)
    if (nextAt !== undefined) own.nextAt = nextAt
    return true
  }
  return false
}

// Claude Code's snapshots: the `background_tasks` and `session_crons` of Stop and SubagentStop.

/** A snapshot task's kind, by its type label: shell, monitor, workflow, a subagent, else other. */
function kindOfType(type: string): Kind {
  const said = type.toLowerCase()
  if (said === 'bash' || said.includes('shell')) return 'shell'
  if (said.includes('monitor')) return 'monitor'
  if (said.includes('workflow')) return 'workflow'
  if (said.includes('agent')) return 'agent'
  return 'other'
}

/** What a snapshot says of a task: its title and its note, as given. */
function snapshotWordsOf(kind: Kind, task: Record<string, unknown>): { title: string; note: string } {
  const description = textOf(task.description)
  if (kind === 'shell') {
    const command = textOf(task.command)
    return { title: command || description, note: command && description !== command ? description : '' }
  }
  const server = [str(task.server), str(task.tool)].filter(Boolean)
  if (kind === 'monitor') return { title: description || server.join(' '), note: server.join(' · ') }
  if (kind === 'workflow') return { title: textOf(task.name) || description, note: '' }
  if (kind === 'agent') return { title: description, note: textOf(task.agent_type) }
  return { title: description, note: '' }
}

/** What a Stop or SubagentStop hook's input carried: its lists as given (absent from an engine that sends none), when it came, and the agents the tree holds (a background agent shows there, not here). */
export type Snapshot = { tasks?: unknown; crons?: unknown; at: number; agents: ReadonlySet<string> }

/** The wakeup or cron a listed schedule is, among the rows the deck made from calls whose id no snapshot gave yet: the one with its prompt. */
function scheduleFor(data: DeckData, prompt: string, isRecurring: boolean, taken: ReadonlySet<Row>): Row | undefined {
  const said = prompt.trim()
  if (said === '') return undefined
  return rowsOf(data).find(row => isSchedule(row) && !row.isBound && !taken.has(row) && row.recurring === isRecurring && row.prompt.trim() === said)
}

/**
 * One of Claude Code's snapshots of the background work: each task and
 * schedule it lists updated (its type and status as it says them) or added
 * (unattributed: the deck did not see it start); each the deck holds that
 * it no longer lists, and seen before it, gone. A wakeup the deck saw start
 * takes the id of the listed one with its prompt. A list the input leaves
 * out is left alone. Answers whether the record changed.
 */
export function noteSnapshot(data: DeckData, snap: Snapshot): boolean {
  let isChanged = false
  const before = snap.at - SNAPSHOT_GRACE_MS
  if (Array.isArray(snap.tasks)) {
    const listed = new Set<string>()
    for (const task of snap.tasks) {
      if (!isRecord(task) || str(task.id) === '') continue
      const id = str(task.id)
      const type = str(task.type)
      const kind = kindOfType(type)
      // a background agent the tree holds is a row of its own there
      if (kind === 'agent' && snap.agents.has(id)) continue
      listed.add(id)
      const words = snapshotWordsOf(kind, task)
      const row = boundRow(data, id, false)
      if (row) {
        if (row.type !== type || row.status !== str(task.status)) isChanged = true
        row.type = type
        row.status = str(task.status)
        if (row.title === '') row.title = words.title
        if (row.note === '') row.note = words.note
        row.seenAt = snap.at
        continue
      }
      rowsOf(data).push({ id, isBound: true, kind, type, status: str(task.status), title: words.title, note: words.note, prompt: '', schedule: '', recurring: false, by: '', call: '', at: snap.at, seenAt: snap.at })
      isChanged = true
    }
    isChanged = drop(data, row => !isSchedule(row) && row.isBound && !listed.has(row.id) && row.at <= before) || isChanged
  }
  if (Array.isArray(snap.crons)) {
    const listed = new Set<string>()
    const taken = new Set<Row>()
    for (const cron of snap.crons) {
      if (!isRecord(cron) || str(cron.id) === '') continue
      const id = str(cron.id)
      const recurring = cron.recurring === true
      listed.add(id)
      let row = boundRow(data, id, true)
      if (!row) {
        row = scheduleFor(data, str(cron.prompt), recurring, taken)
        if (row) {
          bind(data, row, id)
          isChanged = true
        }
      }
      if (row) {
        taken.add(row)
        if (row.schedule === '' && str(cron.schedule) !== '') {
          row.schedule = textOf(cron.schedule)
          isChanged = true
        }
        row.seenAt = snap.at
        continue
      }
      const prompt = textOf(cron.prompt)
      const made: Row = { id, isBound: true, kind: recurring ? 'cron' : 'wakeup', type: '', status: '', title: F.firstLine(prompt), note: '', prompt, schedule: textOf(cron.schedule), recurring, by: '', call: '', at: snap.at, seenAt: snap.at }
      rowsOf(data).push(made)
      taken.add(made)
      isChanged = true
    }
    // a schedule the deck held and the list no longer holds (fired, or cancelled), seen before it
    isChanged = drop(data, row => isSchedule(row) && !taken.has(row) && row.at <= before) || isChanged
  }
  if (isChanged) keep(data)
  return isChanged
}

/** A task notification's status that says its task ended. */
const ENDED = /^(completed|complete|done|failed|killed|stopped|cancell?ed|timed[ _-]?out|errored|error|exited)$/i

/** The task notifications in `text` (`M.taskNoticesOf`) that say a task ended: its row goes. Answers whether the record changed. */
export function noteTaskEnds(data: DeckData, text: string): boolean {
  const ended = new Set(M.taskNoticesOf(text).flatMap(notice => (notice.taskId && ENDED.test(notice.status ?? '') ? [notice.taskId] : [])))
  if (ended.size === 0) return false
  return drop(data, row => !isSchedule(row) && row.isBound && ended.has(row.id))
}

/**
 * A schedule fired (`prompt.submit` from a `scheduled-trigger`, its stored
 * prompt): a one-shot one is done and goes; a recurring one's next run is
 * no longer known. Answers whether the record changed.
 */
export function noteFired(data: DeckData, prompt: string): boolean {
  const said = prompt.trim()
  if (said === '') return false
  let isChanged = false
  for (const row of rowsOf(data)) {
    if (!isSchedule(row) || !row.recurring || row.prompt.trim() !== said || row.nextAt === undefined) continue
    delete row.nextAt
    isChanged = true
  }
  return drop(data, row => isSchedule(row) && !row.recurring && row.prompt.trim() === said) || isChanged
}

// The verdicts: whether Claude Code's permission check allows the deck's stopping calls.

/** The key a stopping call's verdict is kept under: `<tool>:<id>`. */
export function verdictKeyOf(tool: StopTool, id: string): string {
  return `${tool}:${id}`
}

/** A call the deck may make to stop something: the tool, its input as Claude Code takes it, and its verdict's key. */
export type StopCall = { tool: StopTool; id: string; input: Record<string, string>; key: string }

/** TaskStop of task or agent `id`, or CronDelete of schedule `id`. */
export function stopCallOf(tool: StopTool, id: string): StopCall {
  return { tool, id, input: tool === 'TaskStop' ? { task_id: id } : { id }, key: verdictKeyOf(tool, id) }
}

/** Whether an agent may take TaskStop: a background agent or a teammate, at work (never the Orchestrator, which Stop turn stops). */
export function isStoppableAgent(agent: Pick<DeckData['agents'][number], 'kind' | 'background' | 'status'>): boolean {
  return (agent.kind === 'teammate' || (agent.kind === 'agent' && agent.background === true)) && M.isLive(agent.status)
}

/** Every stopping call the deck could make now: TaskStop of each stoppable agent and each task Claude Code gave an id, CronDelete of each schedule it did. */
export function stopCallsOf(data: DeckData): StopCall[] {
  const agents = data.agents.filter(isStoppableAgent).map(agent => stopCallOf('TaskStop', agent.id))
  const rows = shownRowsOf(data)
    .filter(row => row.isBound)
    .map(stopCallOfRow)
  return [...agents, ...rows]
}

/** The stopping calls whose verdict is missing or older than VERDICT_MS at `now`: the ones to ask Claude Code about. */
export function staleCallsOf(data: DeckData, now: number): StopCall[] {
  const verdicts = data.verdicts ?? {}
  return stopCallsOf(data).filter(call => {
    const one = verdicts[call.key]
    return !one || now - one.at > VERDICT_MS
  })
}

/**
 * Keeps Claude Code's verdict on stopping call `key`; the verdicts of calls
 * the deck can no longer make go, and past MOST_VERDICTS the oldest.
 * Answers whether what shows changed (the decision or its reason).
 */
export function noteVerdict(data: DeckData, key: string, verdict: { decision: DeckVerdict['decision']; reason?: string }, at: number): boolean {
  const verdicts = data.verdicts ?? {}
  const was = verdicts[key]
  const reason = F.trunc(F.oneLine(verdict.reason ?? ''), 200)
  verdicts[key] = { decision: verdict.decision, ...(reason ? { reason } : {}), at }
  const live = new Set(stopCallsOf(data).map(call => call.key))
  const kept = Object.keys(verdicts)
    .filter(one => live.has(one))
    .sort((a, b) => (verdicts[a]?.at ?? 0) - (verdicts[b]?.at ?? 0))
    .slice(-MOST_VERDICTS)
  data.verdicts = Object.fromEntries(kept.map(one => [one, verdicts[one] as DeckVerdict]))
  return was?.decision !== verdict.decision || (was?.reason ?? '') !== reason
}

// The view model: v2's `background`, the agent rows' `stop`, the band's counts.

/**
 * Whether a Stop or Cancel shows, and why not where it does not: `tool`
 * the call it makes (TaskStop, CronDelete), `label` its button, `can` true
 * only while Claude Code's newest verdict on that call is `allow`, `why`
 * one line where it is not ('' where it is).
 */
export type V2Stop = { tool: StopTool; label: 'Stop' | 'Cancel'; can: boolean; why: string }

/** The Stop or Cancel of stopping call `tool` on `id`, from its verdict. */
export function stopOf(data: DeckData, tool: StopTool, id: string): V2Stop {
  const label = tool === 'CronDelete' ? 'Cancel' : 'Stop'
  const verb = label.toLowerCase()
  const verdict = data.verdicts?.[verdictKeyOf(tool, id)]
  if (!verdict) return { tool, label, can: false, why: `Not asked yet whether Claude Code allows ${tool} here` }
  if (verdict.decision === 'allow') return { tool, label, can: true, why: '' }
  if (verdict.decision === 'ask') return { tool, label, can: false, why: `Claude Code asks you before ${tool} here: ${verb} it in Claude Code` }
  return { tool, label, can: false, why: `Claude Code's permissions deny ${tool} here${verdict.reason ? `: ${verdict.reason}` : ''}` }
}

/** What an agent row is to `withStops`: its id, kind, status, whether it runs in the background, whether it was stopped. */
type AgentLike = { row: string; id: string; kind?: string; status?: string; background?: boolean; isStopped?: boolean }

/** The Orchestrator's line while its turn runs, and a foreground agent's at work: neither takes TaskStop. */
const ORCHESTRATOR_STOP: V2Stop = { tool: 'TaskStop', label: 'Stop', can: false, why: 'The Orchestrator stops with its turn: Stop turn ends it' }
const FOREGROUND_STOP: V2Stop = { tool: 'TaskStop', label: 'Stop', can: false, why: "Claude Code's TaskStop takes no foreground agent: it ends with its caller's turn" }

/**
 * Agent rows with their `stop`: a background agent or a teammate at work, a
 * Stop as Claude Code's verdict on TaskStop of it allows; a foreground one
 * at work, none, and why (it ends with its caller's turn); the Orchestrator
 * while its turn runs, none (Stop turn ends it). Rows that are none of these
 * stay as they were.
 */
export function withStops<R extends AgentLike>(rows: readonly R[], data: DeckData): R[] {
  return rows.map(row => {
    if (row.row !== 'agent' || row.isStopped) return row
    if (row.status !== 'running' && row.status !== 'starting' && row.status !== 'waiting') return row
    if (row.kind === 'orchestrator') return data.mainTurnId !== undefined ? { ...row, stop: ORCHESTRATOR_STOP } : row
    if (row.kind === 'teammate' || (row.kind === 'agent' && row.background === true)) return { ...row, stop: stopOf(data, 'TaskStop', row.id) }
    if (row.kind === 'agent') return { ...row, stop: FOREGROUND_STOP }
    return row
  })
}

/** One row of the Dashboard's Background. */
export type V2BackgroundRow = {
  /** `[A-Za-z0-9_-]`: the `stopBackground` command's `bgId`. */
  id: string
  kind: DeckBackground['kind']
  /** Its kind in a word, then what else Claude Code said of it: "Shell · npm run dev" (a shell titled by its description), "Monitor · github", "Cron · Every weekday at 9:00", "Wakeup". */
  what: string
  /** A shell's own description, else its command from the real command on (`realCommandOf`); a monitor's or an agent's description, a workflow's name, a schedule's prompt (a wakeup's reason): its first line, as given. */
  title: string
  /** A task's status as Claude Code's snapshot says it (`running`, `pending`), "running" before one does; a schedule's "scheduled". */
  status: string
  /** The loop whose call started it (`main` or an agent's id); null when the deck first saw it in a snapshot. */
  by: string | null
  /** That loop's row title ("Orchestrator"); '' with none. */
  byName: string
  /** When its call started it, or a snapshot first listed it (`by` null). */
  at: number
  /** A schedule's next run, as Claude Code said it; null when not said, or past for a recurring one. */
  nextAt: number | null
  /** A cron's expression as given; '' for a task. */
  schedule: string
  recurring: boolean
  /** A task's age since its call started it ("18m"), a schedule's next run ("in 20m"; "due" once a one-shot's time passed); '' when not known (a task first seen in a snapshot). */
  when: string
  /** Its Stop (TaskStop) or Cancel (CronDelete); null while its call has not given Claude Code's id. */
  stop: V2Stop | null
}

/** The Dashboard's Background: its rows (tasks oldest first, then schedules soonest first), its counts, and its folded line. */
export type V2Background = {
  rows: V2BackgroundRow[]
  /** The tasks: what runs in the background. */
  tasks: number
  /** The crons and wakeups. */
  scheduled: number
  /** "2 shells · 1 monitor · 2 scheduled"; '' with none. */
  text: string
}

/** Nothing in the background: the Background section is gone. */
export const NO_BACKGROUND: V2Background = { rows: [], tasks: 0, scheduled: 0, text: '' }

/** A row's id as the page sends it back (`[A-Za-z0-9_-]`), as `W.webIdOf` makes one. */
export function bgIdOf(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, ch => `-${ch.charCodeAt(0).toString(16)}`)
}

const KIND_WORD: Readonly<Record<Kind, string>> = { shell: 'Shell', monitor: 'Monitor', workflow: 'Workflow', agent: 'Agent', other: 'Task', cron: 'Cron', wakeup: 'Wakeup' }

/** A leading assignment to the environment: `NAME=value`, its value quoted or a word with no `(` or backtick in it (no command runs in it), `export ` before it. */
const ASSIGN = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s;&|()`'"]*)(?=\s|;|&&|$)\s*/
/** PowerShell's: `$env:NAME = value`. */
const PS_ASSIGN = /^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"(?:[^"`]|`.)*"|'[^']*'|[^\s;&|()`'"]+)\s*/i
/** A leading change of directory and what joins it to the command after it: `cd repo &&`, `cd /d C:\repo &&`, `Set-Location repo;`, `pushd repo &&`. */
const CHDIR = /^(?:cd|chdir|pushd|Set-Location|sl)\s+(?:\/d\s+)?(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/i
/** What joins one command to the next, left leading once the one before it is cut. */
const JOIN = /^(?:&&|;)\s*/

/**
 * A shell command from its real command on: the environment assignments and
 * changes of directory that lead it cut (`L="C:/…/log.txt" node x.js` reads
 * `node x.js`, `cd repo && npm test` reads `npm test`); the command as given
 * when nothing would be left.
 */
export function realCommandOf(command: string): string {
  let rest = command.trimStart()
  for (let i = 0; i < 20; i++) {
    const lead = CHDIR.exec(rest) ?? PS_ASSIGN.exec(rest) ?? ASSIGN.exec(rest) ?? JOIN.exec(rest)
    if (!lead || lead[0] === '') break
    rest = rest.slice(lead[0].length)
  }
  return rest.trim() === '' ? command : rest
}

/**
 * A row's title and the words after its kind: a shell by its own description
 * (the call's, or its snapshot's), its command from the real command on after
 * the kind, or by that command alone where it has none; a cron's schedule in
 * words, else its expression; any other's note as given. A row with no words
 * of its own goes by its prompt, else its id.
 */
function wordsOf(row: Row): { title: string; note: string } {
  const named = F.firstLine(row.title) || F.firstLine(row.prompt) || row.id
  if (row.kind === 'shell') {
    const command = F.firstLine(realCommandOf(row.title))
    const description = F.firstLine(row.note)
    return description ? { title: description, note: command } : { title: command || named, note: '' }
  }
  return { title: named, note: row.kind === 'cron' ? row.note || row.schedule : row.note }
}

/** "in 20m", "in 3h", "in 2d"; "in <1m" under a minute. */
function untilOf(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'in <1m'
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `in ${h}h` : `in ${Math.floor(h / 24)}d`
}

/** When a row says it runs: a task's age (none for one first seen in a snapshot: when it started is not known), a schedule's next run. */
function whenOf(row: Row, now: number): string {
  if (!isSchedule(row)) return row.call === '' ? '' : F.since(now - row.at)
  if (row.nextAt === undefined) return ''
  if (row.nextAt > now) return untilOf(row.nextAt - now)
  return row.recurring ? '' : 'due'
}

const COUNT_WORDS: readonly [Kind, string, string][] = [
  ['shell', 'shell', 'shells'],
  ['monitor', 'monitor', 'monitors'],
  ['workflow', 'workflow', 'workflows'],
  ['agent', 'agent', 'agents'],
  ['other', 'task', 'tasks'],
]

/**
 * v2's `background`, from the record at `now`: each row in the page's
 * words (`what`, `when`, its starter's name from `rows`, the state's agent
 * rows), its Stop or Cancel by Claude Code's verdict; tasks oldest first,
 * then schedules soonest first. A one-shot schedule whose time passed a
 * minute ago is no longer shown: Claude Code has fired it.
 */
export function backgroundOf(data: DeckData, rows: readonly { row: string; id: string; title?: string }[], now: number): V2Background {
  const names = new Map(rows.flatMap(row => (row.row === 'agent' ? [[row.id, row.title ?? '']] : [])))
  const shown = shownRowsOf(data).filter(row => !(isSchedule(row) && !row.recurring && row.nextAt !== undefined && row.nextAt < now - 60_000))
  const tasks = shown.filter(row => !isSchedule(row)).sort((a, b) => a.at - b.at)
  const schedules = shown.filter(isSchedule).sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.at - b.at)
  const out = [...tasks, ...schedules].map((row): V2BackgroundRow => {
    const tool: StopTool = isSchedule(row) ? 'CronDelete' : 'TaskStop'
    const words = wordsOf(row)
    const stop: V2Stop | null = row.isBound
      ? stopOf(data, tool, row.id)
      : row.kind === 'wakeup'
        ? { tool, label: 'Cancel', can: false, why: 'Claude Code names a wakeup the next time Claude or an agent stops: Cancel shows then' }
        : null
    return {
      id: bgIdOf(row.id),
      kind: row.kind,
      what: [KIND_WORD[row.kind], words.note].filter(Boolean).join(' · '),
      title: words.title,
      status: isSchedule(row) ? 'scheduled' : row.status || 'running',
      by: row.by === '' ? null : row.by,
      byName: row.by === '' ? '' : (names.get(row.by) ?? (row.by === M.MAIN ? M.ORCHESTRATOR : '')),
      at: row.at,
      nextAt: row.nextAt !== undefined && (row.nextAt > now || !row.recurring) ? row.nextAt : null,
      schedule: row.schedule,
      recurring: row.recurring,
      when: whenOf(row, now),
      stop,
    }
  })
  const counts = COUNT_WORDS.flatMap(([kind, one, many]) => {
    const n = tasks.filter(row => row.kind === kind).length
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : []
  })
  if (schedules.length > 0) counts.push(`${schedules.length} scheduled`)
  return { rows: out, tasks: tasks.length, scheduled: schedules.length, text: counts.join(' · ') }
}

/** The background row the page's `bgId` names: a task or schedule Claude Code gave an id; undefined for none. */
export function rowByBgId(data: DeckData, bgId: unknown): Row | undefined {
  if (typeof bgId !== 'string' || bgId === '') return undefined
  return shownRowsOf(data).find(row => row.isBound && bgIdOf(row.id) === bgId)
}

/** The stopping call a background row takes: TaskStop of a task, CronDelete of a schedule. */
export function stopCallOfRow(row: Row): StopCall {
  return stopCallOf(isSchedule(row) ? 'CronDelete' : 'TaskStop', row.id)
}

/** What "You stopped …" names for a background row: its title as Background shows it (`wordsOf`), cut after a word at 60. */
export function rowNameOf(row: Row): string {
  return M.cutAtWord(wordsOf(row).title, 60)
}

/** One of the band's background parts: the tasks ("◐ 3 in the background"), the schedules ("◷ 2 scheduled"). */
export type BandPart = { kind: 'background' | 'scheduled'; glyph: '◐' | '◷'; count: number; text: string }

/** The band's background parts, the tasks then the schedules; none for none. */
export function bandPartsOf(background: V2Background | undefined): BandPart[] {
  if (!background) return []
  const parts: BandPart[] = []
  if (background.tasks > 0) parts.push({ kind: 'background', glyph: '◐', count: background.tasks, text: `${background.tasks} in the background` })
  if (background.scheduled > 0) parts.push({ kind: 'scheduled', glyph: '◷', count: background.scheduled, text: `${background.scheduled} scheduled` })
  return parts
}
