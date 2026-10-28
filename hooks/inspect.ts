/**
 * Inspect's half of the model (web/CONTRACT.md v2, "Inspect"): what Claude
 * Code says of the session's depth, recorded as it says it, and the v2
 * state's `inspect` built from that.
 *
 * - **Permissions.** Every `tool.check` verdict on a real call (never the
 *   deck's own, nor a question or a plan to approve, whose dialog is the
 *   person's own say), how an ask was settled (its dialog shown, auto mode's
 *   refusal, a PermissionRequest hook's answer) and how the call ended: the
 *   newest 100. A refused call is marked in Recent activity ("⊘ denied",
 *   "⊘ blocked").
 * - **The permission mode and effort,** as the classic hooks' inputs name
 *   them (`permission_mode`, `effort.level`), the main loop's.
 * - **Compactions** (`session.compact`): whose context, the trigger, its
 *   size before and after; each one a chat row of its own (`compaction`),
 *   its words the summary the loop goes on from.
 * - **The context** as /context breaks it down
 *   (`$.session.usage({ breakdown: 'summary' })`).
 * - **What is loaded:** the model, the output style, the instruction and
 *   memory files, the skills (and those the Skill tool ran), the MCP servers
 *   whose tools the context carries, and the settings' hooks.
 *
 * Nothing here is read into the work: a row says what the engine said, and
 * the few words that rest on more than one fact say which ("ran with no
 * dialog"). Pure, and plain TypeScript Node runs as it is: the hooks module
 * (./inspectHooks, register.tsx) hands it what the engine said and `now`;
 * web.ts hands the builder its names.
 */
import type {
  DeckCompaction,
  DeckCompactionFacts,
  DeckContext,
  DeckContextRow,
  DeckData,
  DeckDecision,
  DeckHook,
  DeckInspect,
  DeckInstruction,
  DeckLoaded,
} from '../types'
import * as F from './format'
import * as M from './model'
import { num, plural, usd } from './ui/v2/text'

/** How much Inspect keeps: decisions, compactions, a summary's and a refusal's characters, files, skills' names, servers, hooks, a hook's command. */
export const INSPECT_CAPS = { decisions: 100, compactions: 20, summary: 300, refusal: 300, reason: 300, instructions: 60, skills: 300, mcp: 40, hooks: 60, command: 160 } as const

/** The tools whose dialog is the person's own say (a question, a plan to approve): never a permission decision. */
export const PERSON_TOOLS: readonly string[] = ['AskUserQuestion', 'ExitPlanMode']

/** Inspect's records as a fresh session has them: nothing heard yet. */
export function emptyInspect(): DeckInspect {
  return { mode: '', effort: '', decisions: [], compactions: [], context: null, loaded: null, skillsUsed: {}, mcpCalls: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** `value` as Inspect's records, every field in its own shape (a snapshot of an earlier build, or none, starts empty). */
export function healInspect(value: unknown): DeckInspect {
  const base = emptyInspect()
  if (!isRecord(value)) return base
  return {
    mode: typeof value.mode === 'string' ? value.mode : '',
    effort: typeof value.effort === 'string' ? value.effort : '',
    decisions: Array.isArray(value.decisions) ? (value.decisions.filter(one => isRecord(one) && typeof one.id === 'string' && typeof one.tool === 'string') as DeckDecision[]) : [],
    compactions: Array.isArray(value.compactions) ? (value.compactions.filter(one => isRecord(one) && typeof one.at === 'number' && typeof one.agent === 'string') as DeckCompaction[]) : [],
    context: isRecord(value.context) && Array.isArray(value.context.rows) ? (value.context as DeckContext) : null,
    loaded: isRecord(value.loaded) && Array.isArray(value.loaded.instructions) && Array.isArray(value.loaded.mcp) && Array.isArray(value.loaded.hooks) ? (value.loaded as DeckLoaded) : null,
    skillsUsed: isRecord(value.skillsUsed) ? (value.skillsUsed as DeckInspect['skillsUsed']) : {},
    mcpCalls: isRecord(value.mcpCalls) ? (value.mcpCalls as DeckInspect['mcpCalls']) : {},
  }
}

/** Whether `value` holds Inspect's records in their shape, so it is read (and written) as it is. */
function isWhole(value: DeckInspect | undefined): value is DeckInspect {
  return !!value && Array.isArray(value.decisions) && Array.isArray(value.compactions) && isRecord(value.skillsUsed) && isRecord(value.mcpCalls)
}

/** The records as they stand, for reading: `data.inspect`, or empty ones while it holds none. */
export function inspectOf(data: DeckData): DeckInspect {
  return isWhole(data.inspect) ? data.inspect : healInspect(data.inspect)
}

/** The records to write to: `data.inspect`, made (or mended) on first use. */
function own(data: DeckData): DeckInspect {
  if (isWhole(data.inspect)) return data.inspect
  data.inspect = healInspect(data.inspect)
  return data.inspect
}

/** `text` on one line, cut to `most` characters; '' for none. */
function said(text: unknown, most: number): string {
  return typeof text === 'string' ? F.trunc(F.oneLine(text), most) : ''
}

// The mode and the effort.

/**
 * What a classic hook's input says of the loop it fired in: its
 * `permission_mode` and `effort.level`, kept as the main loop's (an input
 * with an `agent_id` is a subagent's, which may run in its own mode).
 * Whether anything changed.
 */
export function noteMode(data: DeckData, input: { permission_mode?: unknown; effort?: unknown; agent_id?: unknown }): boolean {
  if (typeof input.agent_id === 'string' && input.agent_id !== '') return false
  const mode = typeof input.permission_mode === 'string' ? input.permission_mode.trim() : ''
  const level = isRecord(input.effort) && typeof input.effort.level === 'string' ? input.effort.level.trim() : ''
  const records = inspectOf(data)
  if ((mode === '' || mode === records.mode) && (level === '' || level === records.effort)) return false
  const kept = own(data)
  if (mode !== '') kept.mode = mode
  if (level !== '') kept.effort = level
  return true
}

/** A permission mode in the words Claude Code's own footer uses: `auto` is "auto mode", `acceptEdits` "accept edits"; '' for none. */
export function modeText(mode: string): string {
  const words: Readonly<Record<string, string>> = { auto: 'auto mode', plan: 'plan mode', acceptEdits: 'accept edits', bypassPermissions: 'bypass permissions', dontAsk: 'don’t ask', default: 'default mode' }
  return words[mode] ?? mode
}

/** The mode as the header's line names it: every mode but `default`, which Claude Code's own footer leaves unsaid too; '' for that and for none heard. */
export function headerModeOf(data: DeckData): string {
  const mode = inspectOf(data).mode
  return mode === '' || mode === 'default' ? '' : modeText(mode)
}

// Permissions.

/** One `tool.check` on a real call, as the hooks module hands it over: the call, the engine's verdict, who answers its asks. */
export type CheckIn = {
  id: string
  tool: string
  input: unknown
  agentId: string
  verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string; hook?: string; setting?: string; plugin?: string }
  approver?: string
  at: number
  root: string | null
}

/** The decision noted for call `id`, if any. */
function decisionOf(data: DeckData, id: string): DeckDecision | undefined {
  const list = inspectOf(data).decisions
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.id === id) return list[i]
  return undefined
}

/**
 * Records a call's `tool.check` verdict, as the engine gave it: what the
 * call was aimed at (a shell's command whole on one line, else its target),
 * the verdict, its reason, the rule, hook, option or plugin behind it, and
 * the mode the session ran in. A second check of the same call replaces the
 * first. Nothing for a call with no id (a query), or one whose dialog is the
 * person's own say.
 */
export function noteCheck(data: DeckData, check: CheckIn): DeckDecision | undefined {
  if (check.id === '' || PERSON_TOOLS.includes(check.tool)) return undefined
  const input = isRecord(check.input) ? check.input : {}
  const call = M.activityOf(check.id, check.tool, input, check.root, check.at)
  const command = M.SHELL_TOOLS.includes(check.tool) && typeof input.command === 'string' ? said(input.command, 200) : ''
  const v = check.verdict
  const records = own(data)
  const reason = said(v.reason, INSPECT_CAPS.reason)
  const rule = said(v.rule, 200)
  const hook = said(v.hook, 60)
  const setting = said(v.setting, 120)
  const plugin = said(v.plugin, 80)
  const made: DeckDecision = {
    id: check.id,
    at: check.at,
    agent: check.agentId || M.MAIN,
    tool: check.tool,
    target: command || call.target,
    verdict: v.decision,
    ...(reason ? { reason } : {}),
    ...(rule ? { rule } : {}),
    ...(hook ? { hook } : {}),
    ...(setting ? { setting } : {}),
    ...(plugin ? { plugin } : {}),
    ...(check.approver ? { approver: check.approver } : {}),
    ...(records.mode ? { mode: records.mode } : {}),
  }
  const at = records.decisions.findIndex(one => one.id === check.id)
  if (at >= 0) records.decisions.splice(at, 1)
  records.decisions.push(made)
  if (records.decisions.length > INSPECT_CAPS.decisions) records.decisions.splice(0, records.decisions.length - INSPECT_CAPS.decisions)
  return made
}

/**
 * A permission dialog for call `id` (classic.PermissionRequest): it showed,
 * so the person answers it; or a PermissionRequest settings hook answered in
 * its place (`answer`: allow, or deny with its message; a block is a deny).
 * Whether a decision changed.
 */
export function noteDialog(data: DeckData, id: string | undefined, answer?: { behavior?: unknown; message?: unknown } | null, block?: unknown): boolean {
  const found = id ? decisionOf(data, id) : undefined
  if (!found) return false
  const behavior = answer && (answer.behavior === 'allow' || answer.behavior === 'deny') ? answer.behavior : typeof block === 'string' && block !== '' ? 'deny' : null
  if (behavior) {
    const message = said(answer?.message, INSPECT_CAPS.reason) || said(block, INSPECT_CAPS.reason)
    found.hookAnswer = { behavior, ...(message ? { message } : {}) }
  } else {
    found.isDialog = true
  }
  return true
}

/** Auto mode's classifier refused call `id` (classic.PermissionDenied), for `reason`. Whether a decision changed. */
export function noteDenied(data: DeckData, id: string, reason: string): boolean {
  const found = decisionOf(data, id)
  if (!found) return false
  found.denied = said(reason, INSPECT_CAPS.reason) || 'No reason given'
  return true
}

/** A call's end as `tool.call`'s `next(e)` resolved it: a hook's refusal (`deny`), or the tool's error (`isError`, its words `text`). */
export type CallEnd = { deny?: string | undefined; isError?: boolean | undefined; text?: string | undefined }

/**
 * Whether a call that ended as `end` says was refused, and with what words;
 * undefined when it ran. Claude Code hands a refusal made before the tool
 * ran (your rule, your hook, you or the host declining its dialog, auto
 * mode, its turn stopped while it asked) back as an error, `isError` with
 * the refusal's words, not as a `deny`; what tells it from a tool that ran
 * and failed is that neither PostToolUse nor PostToolUseFailure fired for
 * it (`hasRun` false). A hook's `deny` is a refusal however it came.
 */
export function refusalOfEnd(end: CallEnd, hasRun: boolean): string | undefined {
  if (typeof end.deny === 'string') return end.deny
  if (end.isError === true && !hasRun) return typeof end.text === 'string' ? end.text : ''
  return undefined
}

/** Call `id` ended: it ran (`ran`), or it was refused with `refusal`, the words the model read. Whether a decision changed. */
export function noteEnd(data: DeckData, id: string, ran: boolean, refusal = ''): boolean {
  const found = decisionOf(data, id)
  if (!found) return false
  found.ran = ran
  if (!ran && refusal.trim() !== '') found.refusal = said(refusal, INSPECT_CAPS.refusal)
  return true
}

/**
 * What a call's run says of Inspect: a skill the Skill tool ran (by its
 * name), an MCP server's tool called. Whether it was either.
 */
export function noteCall(data: DeckData, tool: string, input: unknown, at: number): boolean {
  const args = isRecord(input) ? input : {}
  if (tool === 'Skill' && typeof args.skill === 'string' && args.skill.trim() !== '') {
    const name = said(args.skill, 120)
    const records = own(data)
    const was = records.skillsUsed[name]
    records.skillsUsed[name] = { count: (was?.count ?? 0) + 1, at }
    return true
  }
  if (tool.startsWith('mcp__')) {
    const records = own(data)
    records.mcpCalls[tool] = (records.mcpCalls[tool] ?? 0) + 1
    return true
  }
  return false
}

/** Who settled a decision, as Inspect words it. */
export type DecisionWords = {
  /** How it came out: run, refused (`denied`), refused by a hook (`blocked`), its dialog open on you (`waiting`), or put to the mode's decider and not settled yet (`deciding`). */
  outcome: 'allowed' | 'denied' | 'blocked' | 'waiting' | 'deciding'
  /** Who decided: you (its dialog), auto mode, your rule, your hook, the host program, Claude Code's own check; '' where nothing says. */
  by: 'you' | 'auto' | 'rule' | 'hook' | 'host' | 'engine' | ''
  /** "Denied by auto mode", "Allowed by your rule", "You allowed it". */
  text: string
  /** Why, verbatim as the engine said it (the rule as written, the hook's event and reason, the classifier's reason, the refusal); '' for nothing said. */
  why: string
}

/** A hook's event and its words: "PreToolUse: “.env files are off limits”". */
function hookWhy(hook: string, words: string | undefined): string {
  return words ? `${hook}: “${words}”` : hook
}

/**
 * How a decision reads: its outcome, who decided and why, from what the
 * engine said alone. An allow or a deny names its rule or its hook; an ask
 * is settled by auto mode's refusal, a PermissionRequest hook's answer, or
 * the person's answer to its dialog (it ran: allowed; it was refused:
 * declined). An ask that ran with no dialog and no refusal, in auto mode,
 * reads "Allowed by auto mode", its why the facts it rests on.
 */
export function decisionWords(d: DeckDecision): DecisionWords {
  const reason = d.reason ?? ''
  if (d.verdict === 'deny') {
    if (d.hook) return { outcome: 'blocked', by: 'hook', text: 'Blocked by your hook', why: hookWhy(d.hook, d.reason) }
    if (d.rule) return { outcome: 'denied', by: 'rule', text: 'Denied by your rule', why: d.rule }
    return { outcome: 'denied', by: 'engine', text: 'Denied', why: reason }
  }
  if (d.verdict === 'allow') {
    if (d.hook) return { outcome: 'allowed', by: 'hook', text: 'Allowed by your hook', why: hookWhy(d.hook, d.reason) }
    if (d.rule) return { outcome: 'allowed', by: 'rule', text: 'Allowed by your rule', why: d.rule }
    return { outcome: 'allowed', by: 'engine', text: 'Allowed', why: reason }
  }
  // an ask: who put it, then how it was settled
  const asker = d.hook ? `your ${d.hook} hook asked` : d.plugin ? `${d.plugin}’s hook asked` : d.setting ? `${d.setting} asked` : ''
  if (d.denied !== undefined) return { outcome: 'denied', by: 'auto', text: 'Denied by auto mode', why: d.denied }
  if (d.hookAnswer) {
    const why = hookWhy('PermissionRequest', d.hookAnswer.message)
    return d.hookAnswer.behavior === 'allow' ? { outcome: 'allowed', by: 'hook', text: 'Allowed by your hook', why } : { outcome: 'blocked', by: 'hook', text: 'Blocked by your hook', why }
  }
  if (d.isDialog) {
    if (d.ran === undefined) return { outcome: 'waiting', by: 'you', text: 'Waiting on you', why: 'its dialog is open in Claude Code' }
    if (d.ran) return { outcome: 'allowed', by: 'you', text: 'You allowed it', why: 'answered in Claude Code' }
    return { outcome: 'denied', by: 'you', text: 'You declined it', why: d.refusal ?? 'answered in Claude Code' }
  }
  const isAuto = d.mode === 'auto'
  if (d.ran === undefined) return { outcome: 'deciding', by: '', text: isAuto ? 'Auto mode is deciding' : 'Asked', why: asker || reason }
  if (d.ran) {
    if (isAuto) return { outcome: 'allowed', by: 'auto', text: 'Allowed by auto mode', why: 'ran with no dialog, auto mode on' }
    if (d.approver === 'host') return { outcome: 'allowed', by: 'host', text: 'Allowed by the host', why: 'ran with no dialog' }
    return { outcome: 'allowed', by: '', text: 'Allowed', why: asker ? `${asker}; ran with no dialog` : 'ran with no dialog' }
  }
  return { outcome: 'denied', by: '', text: 'Refused', why: d.refusal ?? reason }
}

/** How call `id` was refused, for Recent activity's mark: by a hook (`blocked`), or anyone else (`denied`); undefined for a call that ran, is open, or that the deck saw no decision of. */
export function refusalOf(data: DeckData, id: string): 'denied' | 'blocked' | undefined {
  const found = decisionOf(data, id)
  if (!found || found.ran === true) return undefined
  const words = decisionWords(found)
  if (words.outcome === 'blocked') return 'blocked'
  if (words.outcome === 'denied') return 'denied'
  return undefined
}

// Compactions.

/** One `session.compact` as the hooks module hands it over: whose context, the trigger, the counts, the summary (its first message's words), or why it was refused. */
export type CompactionIn = { agent: string; trigger: string; before?: number; after?: number; summary: string; skipped?: string; at: number }

/**
 * Records a compaction. One that stands is a chat row of its own (kind
 * `compaction`, from the loop whose context it was, to nobody), its words
 * the summary the loop goes on from (whole in its file when long), its facts
 * beside them; the main loop's carries the window its percentages are of.
 * One refused (`skipped`) is kept in Inspect alone. The newest 20 are kept.
 */
export function noteCompaction(data: DeckData, c: CompactionIn): DeckCompaction {
  const records = own(data)
  const agent = c.agent || M.MAIN
  const window = agent === M.MAIN ? records.context?.window : undefined
  const facts: DeckCompactionFacts = {
    trigger: c.trigger,
    ...(typeof c.before === 'number' && Number.isFinite(c.before) ? { before: c.before } : {}),
    ...(typeof c.after === 'number' && Number.isFinite(c.after) ? { after: c.after } : {}),
    ...(window ? { window } : {}),
  }
  let messageId = ''
  if (c.skipped === undefined) {
    const message = M.addMessage(data, { from: agent, to: '', kind: 'compaction', text: c.summary.trim(), at: c.at, compaction: facts })
    messageId = message.id
  }
  const made: DeckCompaction = { ...facts, messageId, at: c.at, agent, summary: said(c.summary, INSPECT_CAPS.summary), ...(c.skipped !== undefined ? { skipped: said(c.skipped, INSPECT_CAPS.reason) || 'No reason given' } : {}) }
  records.compactions.push(made)
  if (records.compactions.length > INSPECT_CAPS.compactions) records.compactions.splice(0, records.compactions.length - INSPECT_CAPS.compactions)
  return made
}

/** A share of `window` as a whole percentage; null where either is not known. */
function percentOf(tokens: number | undefined, window: number | undefined): number | null {
  if (tokens === undefined || !window || window <= 0) return null
  return Math.round((tokens / window) * 100)
}

/** A compaction's figures, worded: "92% → 18% · 184k → 36k tokens · auto"; each part only as the engine gave it (the percentages only of a known window). */
export function compactionFiguresOf(facts: DeckCompactionFacts): string {
  const from = percentOf(facts.before, facts.window)
  const to = percentOf(facts.after, facts.window)
  const percent = from !== null && to !== null ? `${from}% → ${to}%` : from !== null ? `from ${from}%` : ''
  const tokens = facts.before !== undefined && facts.after !== undefined ? `${num(facts.before)} → ${num(facts.after)} tokens` : facts.before !== undefined ? `${num(facts.before)} tokens before` : ''
  return [percent, tokens, facts.trigger].filter(part => part !== '').join(' · ')
}

/** A compaction's title, by whose context it was: "Context compacted" (the Orchestrator's), "researcher’s context compacted". */
export function compactionTitleOf(agent: string, name: string): string {
  return agent === M.MAIN ? 'Context compacted' : `${name}’s context compacted`
}

// The context and what is loaded.

/** /context's breakdown, as much of `$.session.usage({ breakdown })`'s `context.breakdown` as Inspect reads. */
export type BreakdownIn = {
  categories: readonly { name: string; tokens: number; kind: string; color: string }[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  model: string
  memoryFiles: readonly { path: string; type: string; tokens: number }[]
  mcpTools: readonly { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
  skills?: { totalSkills: number; skillFrontmatter: readonly { name: string }[] }
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
}

const ROW_KINDS: readonly DeckContextRow['kind'][] = ['used', 'free', 'buffer', 'deferred']

/** The loaded record to write to, made on first use. */
function loadedOf(data: DeckData, at: number): DeckLoaded {
  const records = own(data)
  if (!records.loaded) records.loaded = { at, instructions: [], skills: null, mcp: [], hooks: [] }
  records.loaded.at = at
  return records.loaded
}

/** The instruction file at `path` (compared as paths are: slashes and, under a drive letter, case), added when new; at most 60 kept. */
function instructionAt(loaded: DeckLoaded, path: string, kind: string): DeckInstruction | undefined {
  const found = loaded.instructions.find(one => M.samePath(one.path, path))
  if (found) return found
  if (loaded.instructions.length >= INSPECT_CAPS.instructions) return undefined
  const made: DeckInstruction = { path, kind }
  loaded.instructions.push(made)
  return made
}

/**
 * The context as /context breaks it down, read at `at`: its rows (each as
 * /context lists it: name, tokens, kind, theme colour), total, window and
 * share, where auto-compaction runs, and `window`, the model's window the
 * header's percentage is of. What it lists of what is loaded comes with it:
 * each memory file's tokens, the skills, the MCP servers and their tools.
 */
export function noteBreakdown(data: DeckData, b: BreakdownIn, window: number | undefined, at: number): void {
  const records = own(data)
  const rows: DeckContextRow[] = b.categories
    .filter(row => typeof row.name === 'string' && typeof row.tokens === 'number')
    .map(row => ({ name: said(row.name, 60), tokens: Math.max(0, row.tokens), kind: ROW_KINDS.includes(row.kind as DeckContextRow['kind']) ? (row.kind as DeckContextRow['kind']) : 'used', color: said(row.color, 40) }))
  records.context = {
    at,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    percent: b.percentage,
    model: said(b.model, 80),
    rows,
    ...(b.isAutoCompactEnabled && typeof b.autoCompactThreshold === 'number' ? { autoCompactAt: b.autoCompactThreshold } : {}),
    ...(window ? { window } : {}),
  }
  const loaded = loadedOf(data, at)
  for (const file of b.memoryFiles) {
    if (typeof file.path !== 'string' || file.path === '') continue
    const one = instructionAt(loaded, file.path, said(file.type, 30))
    if (one) one.tokens = file.tokens
  }
  loaded.skills = b.skills ? { total: b.skills.totalSkills, names: b.skills.skillFrontmatter.map(skill => said(skill.name, 120)).filter(Boolean).slice(0, INSPECT_CAPS.skills) } : { total: 0, names: [] }
  const servers = new Map<string, { server: string; tools: number; deferred: number; names: string[] }>()
  for (const tool of b.mcpTools) {
    const name = said(tool.serverName, 80)
    if (name === '') continue
    const server = servers.get(name) ?? { server: name, tools: 0, deferred: 0, names: [] }
    server.tools += 1
    if (!tool.isLoaded) server.deferred += 1
    server.names.push(tool.name)
    servers.set(name, server)
  }
  loaded.mcp = [...servers.values()].slice(0, INSPECT_CAPS.mcp)
}

/** The instruction files `prompt.context` says the conversation carries (its `instructionFiles`): each one's path, tier, lines and the file that imported it. */
export function noteInstructions(data: DeckData, files: readonly { path: string; kind: string; content?: string; parent?: string }[], at: number): void {
  const loaded = loadedOf(data, at)
  for (const file of files) {
    if (typeof file.path !== 'string' || file.path === '') continue
    const one = instructionAt(loaded, file.path, file.kind)
    if (!one) continue
    one.kind = file.kind
    if (typeof file.content === 'string') one.lines = file.content === '' ? 0 : file.content.replace(/\n+$/, '').split('\n').length
    if (file.parent) one.parent = file.parent
  }
}

/** One file classic.InstructionsLoaded says loaded: its path, its tier (`memory_type`), why (`load_reason`) and the file that brought it. */
export function noteInstructionLoaded(data: DeckData, file: { path: string; memoryType: string; reason: string; trigger?: string; parent?: string }, at: number): void {
  if (file.path === '') return
  const loaded = loadedOf(data, at)
  const one = instructionAt(loaded, file.path, file.memoryType)
  if (!one) return
  if (!one.kind) one.kind = file.memoryType
  one.reason = file.reason
  if (file.trigger) one.trigger = file.trigger
  if (file.parent) one.parent = file.parent
}

/** The model, the output style and the settings' hooks as the engine reads them now; each left as it was when not given. */
export function noteLoaded(data: DeckData, facts: { model?: string; outputStyle?: string; hooks?: DeckHook[] }, at: number): void {
  const loaded = loadedOf(data, at)
  if (facts.model) loaded.model = facts.model
  if (facts.outputStyle) loaded.outputStyle = facts.outputStyle
  if (facts.hooks) loaded.hooks = facts.hooks.slice(0, INSPECT_CAPS.hooks)
}

/**
 * The hooks one settings source configures (its `hooks` key, as a
 * settings.json holds it: each event's matchers and their hooks), in the
 * order written: each one's event, matcher, what it runs (a command, a URL,
 * a prompt) and the source. None for anything else.
 */
export function hooksOf(settings: unknown, source: string): DeckHook[] {
  const hooks = isRecord(settings) ? settings.hooks : undefined
  if (!isRecord(hooks)) return []
  const out: DeckHook[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue
      const matcher = typeof group.matcher === 'string' ? group.matcher : ''
      for (const hook of group.hooks) {
        if (!isRecord(hook)) continue
        const runs = [hook.command, hook.url, hook.prompt, hook.type].find(one => typeof one === 'string' && one.trim() !== '')
        out.push({ event: said(event, 40), matcher: said(matcher, 80), command: said(runs, INSPECT_CAPS.command), source })
      }
    }
  }
  return out
}

// The v2 state's `inspect`.

/** One permission decision as every surface draws it. */
export type V2Decision = {
  /** The call's tool_use_id, web-safe. */
  id: string
  at: number
  /** `main`, or the agent whose call it was; `agentName` its row's title. */
  agent: string
  agentName: string
  tool: string
  /** What the call was aimed at, verbatim: a shell's command, a file, a URL. */
  target: string
} & DecisionWords

/** One row of the context's breakdown, as /context lists it, with the hue every surface draws it in. */
export type V2ContextRow = { name: string; tokens: number; kind: DeckContextRow['kind']; hue: string }

/** The context as /context last counted it. */
export type V2Context = {
  /** "82.2k of 200k". */
  text: string
  total: number
  max: number
  percent: number
  /** The share auto-compaction runs at, of the same window; null when it is off. */
  autoCompactPercent: number | null
  model: string
  rows: V2ContextRow[]
  at: number
}

/** One compaction as Inspect lists it. */
export type V2Compaction = {
  /** Its chat row's id, web-safe ('' for one refused): the whole summary at /message/<id> when the row is cut. */
  id: string
  at: number
  agent: string
  agentName: string
  /** Who asked for it (`manual`, `auto`, `plugin`), and how full before and after: "92% → 18%" of a known window, else "176k → 44k tokens"; '' where the engine gave no counts. */
  trigger: string
  figures: string
  /** "Orchestrator · auto · 92% → 18%". */
  text: string
  /** The summary's first words; '' for none. */
  summary: string
  /** Refused: why, as its notice read. */
  skipped?: string
}

/** A chat row's compaction (kind `compaction`): its facts, and its line as every surface words it. */
export type V2ChatCompaction = {
  trigger: string
  before: number | null
  after: number | null
  percentBefore: number | null
  percentAfter: number | null
  /** "Context compacted", "researcher’s context compacted". */
  title: string
  /** "92% → 18% · 184k → 36k tokens · auto". */
  figures: string
}

/** One instruction or memory file as Loaded lists it. */
export type V2LoadedFile = {
  path: string
  /** "~/.claude/CLAUDE.md", "agent-deck/CLAUDE.md"; a memory file its name. */
  name: string
  /** Its tier as the engine said it (`user`, `project`, `local`, `managed`, `memory`, `AutoMem`). */
  kind: string
  /** "yours, for every project", "this project", "memory". */
  kindText: string
  lines: number | null
  tokens: number | null
  /** Why it loaded, worded: "loaded at start", "loaded on reading app.ts"; '' where nothing said. */
  how: string
}

/** What shapes the session, as Loaded lists it. */
export type V2Loaded = {
  /** The model, short (`opus-5.5`), and as the engine named it. */
  model: string
  modelId: string
  /** The effort, the output style and the permission mode's words; '' where the engine has not said. */
  effort: string
  outputStyle: string
  mode: string
  instructions: V2LoadedFile[]
  memory: V2LoadedFile[]
  /** The skills the context lists (null: not read yet), and those the Skill tool ran, most used first. */
  skills: { total: number | null; names: string[]; used: { name: string; count: number }[] }
  /** The MCP servers whose tools the context carries: their tools, those loaded on demand, the calls made to them. */
  mcp: { server: string; tools: number; deferred: number; calls: number }[]
  /** The settings' hooks, and what the hooks of each event decided (from the permission decisions their event named). */
  hooks: { event: string; matcher: string; command: string; source: string; sourceText: string }[]
  hookEvents: { event: string; decided: number; blocked: number }[]
}

/** Inspect's part of the v2 state beyond the spend: the mode, each section's one line, the context, the compactions, the permission decisions and what is loaded. */
export type V2InspectMore = {
  /** The main loop's permission mode as the engine names it (`auto`), and in words ("auto mode"); '' until a hook named it. */
  mode: string
  modeText: string
  /** Each section's one line while it is folded: "41% · compacted once", "23 decisions · 2 denied", "2 instruction files · 23 skills", "$4.12 · 2.3M tokens"; '' for a section with nothing. */
  summary: { context: string; permissions: string; loaded: string; spend: string }
  context: V2Context | null
  /** Oldest first. */
  compactions: V2Compaction[]
  /** The decisions, newest first (at most 100), and how many came out each way. */
  permissions: { decisions: V2Decision[]; total: number; denied: number; blocked: number; waiting: number }
  loaded: V2Loaded | null
}

/** What the builder needs of web.ts: a party's name, a model's short name, an id made web-safe. */
export type InspectNames = { nameOf: (id: string) => string; short: (model: string) => string; idOf: (id: string) => string }

/** A theme colour of /context's (its key in Claude Code's theme) as the deck draws it, close to Claude Code's dark theme. */
const THEME_HUE: Readonly<Record<string, string>> = {
  text: '#e5e5e5',
  inactive: '#8a8a8a',
  subtle: '#5a5a5a',
  suggestion: '#b1b9f9',
  remember: '#b1b9f9',
  success: '#4eba65',
  error: '#ff6b80',
  warning: '#ffc107',
  merged: '#af87ff',
  claude: '#d77757',
  permission: '#b1b9f9',
  planMode: '#48968c',
  autoAccept: '#af87ff',
  promptBorder: '#9ca3af',
  bashBorder: '#fd5db1',
  ide: '#47a8d8',
  professionalBlue: '#6a9bcc',
  fastMode: '#ff7814',
  purple_FOR_SUBAGENTS_ONLY: '#a78bfa',
  cyan_FOR_SUBAGENTS_ONLY: '#22d3ee',
  green_FOR_SUBAGENTS_ONLY: '#4ade80',
  blue_FOR_SUBAGENTS_ONLY: '#60a5fa',
  red_FOR_SUBAGENTS_ONLY: '#f87171',
  orange_FOR_SUBAGENTS_ONLY: '#fb923c',
  pink_FOR_SUBAGENTS_ONLY: '#f472b6',
  yellow_FOR_SUBAGENTS_ONLY: '#facc15',
}

/** The hue a context row draws in: its theme colour's, a dark track for the free space, a dim one for the buffer; a colour written as one (`#abc`) as it is. */
export function contextHueOf(row: Pick<DeckContextRow, 'color' | 'kind'>): string {
  if (row.kind === 'free') return '#2a2a2a'
  if (row.kind === 'buffer') return '#3f3f46'
  if (/^#[0-9a-f]{3,8}$/i.test(row.color)) return row.color
  return THEME_HUE[row.color] ?? '#8a8a8a'
}

function isMemory(kind: string): boolean {
  const k = kind.toLowerCase()
  return k === 'memory' || k === 'automem'
}

/** A tier in words: the person's own, the project's, the organization's, memory. */
function kindTextOf(kind: string): string {
  const k = kind.toLowerCase()
  if (k === 'user') return 'yours, for every project'
  if (k === 'project') return 'this project'
  if (k === 'local') return 'this project, yours alone'
  if (k === 'managed' || k === 'policy') return 'your organization’s'
  if (isMemory(kind)) return 'memory'
  return kind
}

/** A path as Loaded names it: under a home folder's `.claude` with `~`, else its last two parts. */
function fileNameOf(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const home = /^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(\/.*)$/i.exec(slashed)
  if (home && /^\/\.claude\//.test(home[1] ?? '')) return `~${home[1]}`
  const parts = slashed.split('/').filter(Boolean)
  return parts.length > 2 ? parts.slice(-2).join('/') : slashed
}

/** Why a file loaded, worded: InstructionsLoaded's `load_reason` and the file behind it; '' for none said. */
function howOf(file: DeckInstruction): string {
  const base = (path: string | undefined) => (path ? F.baseName(path.replace(/\\/g, '/')) : '')
  switch (file.reason) {
    case undefined:
      return file.parent ? `imported by ${base(file.parent)}` : ''
    case 'session_start':
      return 'loaded at start'
    case 'nested_traversal':
      return file.trigger ? `loaded on reading ${base(file.trigger)}` : 'loaded on reading a file under it'
    case 'path_glob_match':
      return file.trigger ? `loaded: ${base(file.trigger)} matched it` : 'loaded: a file matched it'
    case 'include':
      return file.parent ? `imported by ${base(file.parent)}` : 'imported'
    case 'compact':
      return 'loaded again after a compaction'
    default:
      return file.reason
  }
}

/** A settings source in words: yours, the project's, the project's private one, your organization's, the command line's. */
function sourceTextOf(source: string): string {
  return ({ user: 'yours', project: 'project', local: 'project, yours alone', policy: 'your organization’s', flag: 'command line' } as Readonly<Record<string, string>>)[source] ?? source
}

/** The context's one line: its share (the header's, else /context's) and the compactions; '' with neither. */
function contextSummaryOf(percent: number | null, records: DeckInspect): string {
  const stood = records.compactions.filter(one => one.skipped === undefined).length
  const parts = [percent !== null ? `${Math.round(percent)}%` : '', stood === 1 ? 'compacted once' : stood > 1 ? `compacted ${stood} times` : '']
  return parts.filter(Boolean).join(' · ')
}

/**
 * Inspect's part of the v2 state beyond the spend, from the records: the
 * mode, the context, the compactions, the decisions (newest first), what is
 * loaded, and each section's one line. `percent` is the header's context
 * share; `spend` the session's cost and every agent's tokens.
 */
export function inspectMoreOf(data: DeckData, percent: number | null, spend: { costUsd: number | null; tokens: number }, names: InspectNames): V2InspectMore {
  const records = inspectOf(data)
  const ctx = records.context
  const context: V2Context | null = ctx
    ? {
        text: `${num(ctx.total)} of ${num(ctx.max)}`,
        total: ctx.total,
        max: ctx.max,
        percent: ctx.percent,
        autoCompactPercent: ctx.autoCompactAt !== undefined ? percentOf(ctx.autoCompactAt, ctx.max) : null,
        model: names.short(ctx.model) || ctx.model,
        rows: ctx.rows.map(row => ({ name: row.name, tokens: row.tokens, kind: row.kind, hue: contextHueOf(row) })),
        at: ctx.at,
      }
    : null
  const compactions: V2Compaction[] = records.compactions.map(one => {
    const agentName = names.nameOf(one.agent)
    const from = percentOf(one.before, one.window)
    const to = percentOf(one.after, one.window)
    const figures = from !== null && to !== null ? `${from}% → ${to}%` : one.before !== undefined && one.after !== undefined ? `${num(one.before)} → ${num(one.after)} tokens` : ''
    const text = one.skipped !== undefined ? [agentName, one.trigger, 'not compacted'].join(' · ') : [agentName, one.trigger, figures].filter(Boolean).join(' · ')
    return { id: one.messageId ? names.idOf(one.messageId) : '', at: one.at, agent: one.agent, agentName, trigger: one.trigger, figures, text, summary: one.summary, ...(one.skipped !== undefined ? { skipped: one.skipped } : {}) }
  })
  const decisions: V2Decision[] = [...records.decisions].reverse().map(d => ({ id: names.idOf(d.id), at: d.at, agent: d.agent, agentName: names.nameOf(d.agent), tool: d.tool, target: d.target, ...decisionWords(d) }))
  const count = (outcome: DecisionWords['outcome']) => decisions.filter(one => one.outcome === outcome).length
  const permissions = { decisions, total: decisions.length, denied: count('denied'), blocked: count('blocked'), waiting: count('waiting') }
  const loaded = loadedStateOf(records, decisions, names)
  const loadedParts = loaded
    ? [
        loaded.instructions.length > 0 ? plural(loaded.instructions.length, 'instruction file') : '',
        loaded.memory.length > 0 ? plural(loaded.memory.length, 'memory file') : '',
        loaded.skills.total !== null && loaded.skills.total > 0 ? plural(loaded.skills.total, 'skill') : '',
        loaded.mcp.length > 0 ? plural(loaded.mcp.length, 'MCP server') : '',
        loaded.hooks.length > 0 ? plural(loaded.hooks.length, 'hook') : '',
      ]
    : []
  const permissionParts = [
    permissions.total > 0 ? plural(permissions.total, 'decision') : '',
    permissions.waiting > 0 ? `${permissions.waiting} waiting on you` : '',
    permissions.denied > 0 ? `${permissions.denied} denied` : '',
    permissions.blocked > 0 ? `${permissions.blocked} blocked` : '',
  ]
  const shown = percent ?? (ctx ? ctx.percent : null)
  return {
    mode: records.mode,
    modeText: records.mode ? modeText(records.mode) : '',
    summary: {
      context: contextSummaryOf(shown, records),
      permissions: permissionParts.filter(Boolean).join(' · '),
      loaded: loadedParts.filter(Boolean).join(' · ') || (loaded ? [loaded.model, loaded.mode].filter(Boolean).join(' · ') : ''),
      spend: [spend.costUsd !== null ? usd(spend.costUsd) : '', spend.tokens > 0 ? `${num(spend.tokens)} tokens` : ''].filter(Boolean).join(' · '),
    },
    context,
    compactions,
    permissions,
    loaded,
  }
}

/** Loaded as the state lists it: null while nothing of it is known. */
function loadedStateOf(records: DeckInspect, decisions: readonly V2Decision[], names: InspectNames): V2Loaded | null {
  const loaded = records.loaded
  const used = Object.entries(records.skillsUsed)
    .map(([name, one]) => ({ name, count: one.count, at: one.at }))
    .sort((a, b) => b.count - a.count || b.at - a.at)
    .map(({ name, count }) => ({ name, count }))
  if (!loaded && used.length === 0 && records.mode === '' && records.effort === '') return null
  const files = (loaded?.instructions ?? []).map(file => ({
    path: file.path,
    name: isMemory(file.kind) ? F.baseName(file.path.replace(/\\/g, '/')) : fileNameOf(file.path),
    kind: file.kind,
    kindText: kindTextOf(file.kind),
    lines: file.lines ?? null,
    tokens: file.tokens ?? null,
    how: howOf(file),
  }))
  const calls = (server: { names: string[] }) => {
    const tools = new Set(server.names)
    return Object.entries(records.mcpCalls).reduce((sum, [tool, n]) => sum + (tools.has(tool) ? n : 0), 0)
  }
  const hookEvents = new Map<string, { event: string; decided: number; blocked: number }>()
  for (const d of decisions) {
    const event = d.by === 'hook' ? (d.why.split(':')[0] ?? '').trim() : ''
    if (event === '') continue
    const one = hookEvents.get(event) ?? { event, decided: 0, blocked: 0 }
    one.decided += 1
    if (d.outcome === 'blocked') one.blocked += 1
    hookEvents.set(event, one)
  }
  return {
    model: names.short(loaded?.model ?? ''),
    modelId: loaded?.model ?? '',
    effort: records.effort,
    outputStyle: loaded?.outputStyle ?? '',
    mode: records.mode ? modeText(records.mode) : '',
    instructions: files.filter(file => !isMemory(file.kind)),
    memory: files.filter(file => isMemory(file.kind)),
    skills: { total: loaded?.skills ? loaded.skills.total : null, names: loaded?.skills?.names ?? [], used },
    mcp: (loaded?.mcp ?? []).map(server => ({ server: server.server, tools: server.tools, deferred: server.deferred, calls: calls(server) })),
    hooks: (loaded?.hooks ?? []).map(hook => ({ ...hook, sourceText: sourceTextOf(hook.source) })),
    hookEvents: [...hookEvents.values()],
  }
}

/** A chat row's compaction, from its message's facts: the percentages only of a known window; `name` whose context it was. */
export function chatCompactionOf(facts: DeckCompactionFacts, agent: string, name: string): V2ChatCompaction {
  return {
    trigger: facts.trigger,
    before: facts.before ?? null,
    after: facts.after ?? null,
    percentBefore: percentOf(facts.before, facts.window),
    percentAfter: percentOf(facts.after, facts.window),
    title: compactionTitleOf(agent, name),
    figures: compactionFiguresOf(facts),
  }
}
