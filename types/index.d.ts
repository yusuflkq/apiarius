export type DeckStatus =
  /** A placeholder row: its Agent call started and the engine has not spawned the agent yet. */
  | 'starting'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'

/**
 * The five statuses the deck draws (an agent's status square), folded from
 * DeckStatus and a needs-you note by `statusOf`.
 */
export type DeckShownStatus = 'running' | 'waiting' | 'done' | 'failed' | 'idle'

export type DeckKind = 'you' | 'main' | 'agent' | 'teammate' | 'peer'

/**
 * Where a loop came from: an Agent call (`agent`), a teammate's spawn
 * (`teammate`), a workflow script's `agent()` (`workflow`), or the engine's
 * own housekeeping (`engine`: a prompt suggestion, a compaction, memory, any
 * loop seen with no spawn that neither the list nor SubagentStart names).
 * A workflow's agents fold into one dim row; the engine's own show nowhere.
 */
export type DeckOrigin = 'agent' | 'teammate' | 'workflow' | 'engine'

/** A plan step's or a checklist item's state, as the outline draws it (✓ done, ■ active, □ pending, ✗ failed). */
export type DeckStepStatus = 'done' | 'active' | 'pending' | 'failed'

/**
 * How an agent was tied to a plan step, strongest first: the board task names
 * it its owner; it claimed the task itself; its Agent call mentions the step;
 * its caller had exactly that one item in progress when the call fired; or
 * the words of its task and the step's overlap (a guess).
 */
export type DeckStepHow = 'owner' | 'self' | 'mention' | 'during' | 'words'

export type DeckActivity = {
  id: string
  tool: string
  target: string
  /** The call's own words for what it does: a Bash or PowerShell `description`. */
  description?: string
  /** A shell call's command on one line, for "allow Bash "npm test"". */
  command?: string
  at: number
  ms?: number
  ok?: boolean
}

/**
 * What one model step of a loop (the main loop's, a subagent's, a
 * teammate's) gave besides its tool calls, as Claude Code gave it: its
 * visible text (`said`), or its thinking as Claude Code shows it live
 * (`thought`: a summary, or nothing when thinking is off). Never put in
 * Chat: these words are said to nobody.
 */
export type DeckWord = {
  kind: 'said' | 'thought'
  /** When the step's response ended. */
  at: number
  /** The step: its turn's id and its index in that turn. */
  turnId: string
  step: number
  /** The words, at most 4000 characters (`isCut` when they were longer). */
  text: string
  isCut?: true
  /** The id of the loop's latest call begun before the words came, '' for none: in its log they follow that call. */
  after: string
  /** Chat has them already: the turn's last step's text (the Orchestrator's answer to you, an agent's result), or an agent's first words after your message. */
  isChat?: true
}

/** What an agent said it is working on: the in-progress item of its todo list or task list. */
export type DeckTodo = {
  /** The item's `activeForm` ("Running the tests"), else its content or subject. */
  text: string
  /** The task's id when a TaskUpdate started it, so that task's end takes it down. */
  task?: string
}

/** One item of an agent's checklist (its whole TodoWrite list), with when it started and ended. */
export type DeckTodoItem = {
  /** Stable across rewrites of the list: the item is matched by its normalised content. */
  key: string
  /** The item's content, imperative ("Run the tests"). */
  text: string
  /** Its activeForm ("Running the tests"), when it differs. */
  doing?: string
  status: 'done' | 'active' | 'pending'
  startedAt?: number
  doneAt?: number
}

/** The item the caller had in progress when an Agent call fired: the agent's 'during' link to the plan. */
export type DeckDuring = {
  /** From the caller's todo list or the task board. */
  kind: 'todo' | 'task'
  /** The todo item's key, or the task's id. */
  key: string
  text: string
}

/**
 * The engine told the person it needs them (a permission prompt, an MCP
 * server's question, Claude waiting for input). Each is kept in
 * `DeckData.needs`, the newest also on the Orchestrator (`needs`); the next
 * tool call of the loop it waits on, or the main loop's next turn, takes it down.
 */
export type DeckNeeds = {
  /** The notification's message ("Claude needs your permission to use Bash"). */
  text: string
  /** The notification's type: `permission_prompt`, `idle_prompt`, `elicitation_dialog`. */
  kind: string
  at: number
  /** The agent whose tool call waits on the person, when it could be told. */
  agent?: string
  /** That tool call's id: its end takes the note down. */
  call?: string
  /** The notification's own title, when it carried one. */
  title?: string
}

export type DeckAgent = {
  id: string
  kind: DeckKind
  name: string
  type: string
  description: string
  prompt: string
  parentId?: string
  status: DeckStatus
  model?: string
  startedAt: number
  endedAt?: number
  /**
   * When it was last resumed, finished or idle (a SendMessage woke it, or
   * Claude Code brought it back): the same agent, no new spawn, its run since
   * then that wake's. Absent for an agent never resumed.
   */
  resumedAt?: number
  lastAt: number
  tools: number
  errors: number
  toolCounts: Record<string, number>
  files: string[]
  added: number
  removed: number
  tokensIn: number
  tokensOut: number
  cacheRead: number
  requests: number
  current?: DeckActivity
  recent: DeckActivity[]
  /** Its steps' words and thinking (`DeckWord`), oldest first, the newest 60; absent before its first. */
  words?: DeckWord[]
  /** Its result: the SubagentHandback report, else the turn's answer, else the last message at SubagentStop. */
  answer?: string
  /**
   * Where `answer` came from in this run: its SubagentHandback `message`, its
   * turn's answer, its foreground Agent call's text, or SubagentStop's last
   * message. A weaker source never replaces a stronger one.
   */
  resultVia?: 'handback' | 'answer' | 'call' | 'stop'
  /** The in-progress item of its todo list (TodoWrite) or task list (TaskUpdate). */
  todo?: DeckTodo
  /** On the Orchestrator alone: the engine waits on the person. */
  needs?: DeckNeeds
  /** Its label, at most 18 characters, fixed when it spawned (`labelOf`). */
  label?: string
  /** What the description says after its leading marker ("data, banner" of "Phase A: data, banner"). */
  scope?: string
  /** Where its loop came from (`originOf`); absent on rows from before this field, read as `agent`. */
  origin?: DeckOrigin
  /** The Agent call that started it: its placeholder row was keyed by this until the spawn bound it. */
  toolUseId?: string
  /** The goal it was spawned under. */
  goal?: string
  /** What its caller had in progress when the Agent call fired. */
  during?: DeckDuring
  /** Its whole checklist: every item of its latest TodoWrite (at most 50). */
  todos?: DeckTodoItem[]
  /** When that list was last written. */
  todosAt?: number
  /** The workflow run (its Workflow call's id) a workflow agent belongs to. */
  workflow?: string
  /**
   * Its spawn ran it in the background (`agent.spawn`'s `background`: a
   * background or remote agent, and every teammate); absent before its spawn
   * says. Only such an agent can be stopped (TaskStop); a foreground one ends
   * with its caller's turn.
   */
  background?: boolean
  /** What the timeline keeps of its loop beyond the fields above (hooks/lane.ts); absent before its first call, run or wait. */
  lane?: DeckLane
}

/**
 * What Org's Timeline keeps of one loop that the model's own fields let go
 * of (hooks/lane.ts), every time one Claude Code reported: its tool calls
 * past the newest 14, the runs it ended before it ran again (the
 * Orchestrator's: its turns), and its waits on you.
 */
export type DeckLane = {
  /** When its first recorded call started, ms since the epoch: `calls` count from it. */
  t0: number
  /** The tools its calls used, each once, in the order first used: a call names its tool by place. */
  tools: string[]
  /**
   * Its tool calls, oldest first, the newest 400: each `[start, length,
   * tool, how]`, its start in ms after `t0`, its length in ms (-1 until its
   * end came), its tool's place in `tools`, and how it went (1 ok, 0 failed,
   * -1 not known yet).
   */
  calls: [number, number, number, number][]
  /** Its runs that ended before it ran again (a message woke it, a teammate's next turn), or the Orchestrator's turns that ended: `[from, to]`, ms since the epoch, oldest first, the newest 100. */
  runs: [number, number][]
  /** When it last ran again after an end: its run now started then. Absent before. */
  woke?: number
  /**
   * Its waits on you, oldest first, the newest 100: a call held on you
   * (`held`: a question, a permission prompt, until the call ended) or
   * Claude Code's notification (`note`: until its loop moved on, as
   * `M.clearNeeds` takes it down). `to` absent while it waits, or when its
   * end never came.
   */
  waits: { kind: 'held' | 'note'; from: number; to?: number; call?: string }[]
  /**
   * The background tasks its calls started that ended (their rows left the
   * Dashboard's Background), oldest first, the newest 50: each as its row
   * said it (`id`, `title` and `what`, as v2's `background.rows`), from its
   * call to the moment Claude Code said it ended (its task notification, the
   * TaskStop that stopped it, the first snapshot that no longer listed it).
   * Absent before any did.
   */
  background?: { id: string; title: string; what: string; from: number; to: number }[]
}

/**
 * Who said what to whom: `prompt` your prompt to the Orchestrator (typed
 * mid-turn too), `spawn` a task handed down, `result` a report handed back,
 * `message` a SendMessage between agents, `chat` yours from the deck (or an
 * agent's words after it), `answer` the Orchestrator's reply to you,
 * `question` an agent's question to you (AskUserQuestion), `choice` how it
 * was answered, `notification` Claude Code's notification to you
 * (classic Notification, from `engine`), `task` a background task's
 * notification to the main loop (`<task-notification>`, from `engine`),
 * `command` a slash command you ran alone ("/login", from `you` to nobody
 * in particular): no words of yours, so no bubble, a line of its own;
 * `stop` what you stopped from the deck, through Claude Code's own channels
 * ("You stopped builder", "You stopped the turn"): a line of its own too;
 * `compaction` a loop's context compacted (`session.compact`), from that
 * loop to nobody, its words the summary it goes on from: a divider line.
 */
export type DeckMessageKind = 'prompt' | 'spawn' | 'result' | 'message' | 'chat' | 'answer' | 'question' | 'choice' | 'notification' | 'task' | 'command' | 'stop' | 'compaction'

export type DeckMessage = {
  /** `[A-Za-z0-9_]` and `-` only: the web deck serves it as a file name. */
  id: string
  /** An agent's id, `you`, `engine` (Claude Code itself), or the name a sender went by that no agent of the session carries. */
  from: string
  /**
   * An agent's id, `you`, or the name SendMessage was given that no agent of
   * the session carries; '' when the words went to nobody in particular (an
   * agent's words after your message: never taken to be to you).
   */
  to: string
  kind: DeckMessageKind
  /** At most 700 characters (`LIMITS.messageChars`). */
  text: string
  at: number
  isDelivered?: boolean
  /** The whole text (at most 20,000 characters) of one cut at 700, until the web deck wrote it to its file; kept on the newest 20. */
  full?: string
  /** The web deck wrote its whole text to `messages/<id>.md`: never again. */
  isSaved?: true
  /** The id of the web deck's command that sent it: that command's outcome is its ack. */
  ackId?: string
  /** A question's or a choice's call (the AskUserQuestion tool_use_id). */
  callId?: string
  /** Its own title: a SendMessage's `summary`; a notification's title, else its type; a task notification's status. */
  title?: string
  /** The agent a notification is about: the loop it fired in, or the agent whose task it reports. */
  agent?: string
  /** A `compaction` row's facts, as `session.compact` gave them (hooks/inspect.ts). */
  compaction?: DeckCompactionFacts
}

/** What one compaction did, as the engine said it: who asked for it, and the conversation's size before and after; absent where it did not say. */
export type DeckCompactionFacts = {
  /** `manual` (your /compact), `auto` (the engine at its threshold), `plugin`. */
  trigger: string
  before?: number
  after?: number
  /** The context window the percentages are of: the main loop's, as `session.usage` gave it when the compaction ran; absent for an agent's. */
  window?: number
}

/**
 * One permission decision the deck saw (hooks/inspect.ts): a call's
 * `tool.check` verdict as the engine gave it, then how an ask was settled
 * (its dialog shown, auto mode's refusal, a PermissionRequest hook's
 * answer) and how the call ended.
 */
export type DeckDecision = {
  /** The call's tool_use_id. */
  id: string
  at: number
  /** `main`, or the agent whose call it is. */
  agent: string
  tool: string
  /** What the call was aimed at, verbatim as the deck keeps it: a shell's command, a file, a pattern, a URL. */
  target: string
  /** `tool.check`'s verdict. */
  verdict: 'allow' | 'ask' | 'deny'
  /** The verdict's reason, the settings rule that decided (as written), the classic hook event that decided, the option that asked, the plugin whose hook asked: each as the engine gave it. */
  reason?: string
  rule?: string
  hook?: string
  setting?: string
  plugin?: string
  /** Who the engine said answers this call's asks: `host` (a program), `person`. */
  approver?: string
  /** The permission mode the loop ran in, as the engine last named it (`auto`, `default`, ...); absent while it had not. */
  mode?: string
  /** The permission dialog showed (classic.PermissionRequest), so the person answered. */
  isDialog?: true
  /** A PermissionRequest settings hook answered in the dialog's place. */
  hookAnswer?: { behavior: 'allow' | 'deny'; message?: string }
  /** Auto mode's classifier refused it (classic.PermissionDenied): its reason. */
  denied?: string
  /** How the call ended: it ran (true) or was refused (false); absent while it is open. */
  ran?: boolean
  /** A refused call's words, as the model read them (at most 300 characters). */
  refusal?: string
}

/** One compaction of a loop's context (`session.compact`): the chat row that marks it, and its facts. */
export type DeckCompaction = DeckCompactionFacts & {
  /** Its chat row's id (`DeckMessage.id`); '' for a compaction refused (`skipped`). */
  messageId: string
  at: number
  /** `main`, or the agent whose context it was. */
  agent: string
  /** The summary's first words (at most 300 characters); the whole is its chat row's. */
  summary: string
  /** Refused (SessionCompactSkipped): why, as its notice read. */
  skipped?: string
}

/** One row of the context as /context breaks it down (`$.session.usage({ breakdown })`). */
export type DeckContextRow = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred'; color: string }

/** The context window as /context last counted it, and the window the header's percentage is of. */
export type DeckContext = {
  at: number
  /** The breakdown's total, its window (`rawMaxTokens`), and the share as /context prints it. */
  total: number
  max: number
  percent: number
  model: string
  rows: DeckContextRow[]
  /** The token count auto-compaction runs at; absent when it is off. */
  autoCompactAt?: number
  /** The model's window (`session.usage().context.window`): what the header's percentage, and a compaction's, are of. */
  window?: number
}

/** One instruction or memory file the session loaded, from whichever source told the deck (prompt.context, classic.InstructionsLoaded, the breakdown). */
export type DeckInstruction = {
  path: string
  /** Its tier: `user`, `project`, `local`, `managed`, `memory` (prompt.context's), else the engine's own word for it (`User`, `AutoMem`). */
  kind: string
  lines?: number
  tokens?: number
  /** Why it loaded (InstructionsLoaded's `load_reason`), and the file that brought it. */
  reason?: string
  trigger?: string
  parent?: string
}

/** One hook the settings configure (`$.settings.read({ source })`'s `hooks`). */
export type DeckHook = { event: string; matcher: string; command: string; source: string }

/** What shapes the session, as the engine gave it: read at the start, at a settings change, and as the breakdown is read. */
export type DeckLoaded = {
  at: number
  /** The session's model, as `$.session.model()` gave it. */
  model?: string
  /** The output style: the settings' `outputStyle`, or `/config`'s row for it. */
  outputStyle?: string
  instructions: DeckInstruction[]
  /** The skills the context lists (the breakdown's `skills`); null until read. */
  skills: { total: number; names: string[] } | null
  /** The MCP servers whose tools the context carries, with their tool counts (the breakdown's `mcpTools`). */
  mcp: { server: string; tools: number; deferred: number; names: string[] }[]
  hooks: DeckHook[]
}

/** Inspect's own records (hooks/inspect.ts): what Claude Code said of permissions, compactions, the context and what is loaded. */
export type DeckInspect = {
  /** The main loop's permission mode, as a classic hook's `permission_mode` last named it; '' until one did. */
  mode: string
  /** The main loop's effort, as a classic hook's `effort.level` last named it; '' until one did. */
  effort: string
  /** The permission decisions, newest last (at most 100). */
  decisions: DeckDecision[]
  /** The compactions, newest last (at most 20). */
  compactions: DeckCompaction[]
  context: DeckContext | null
  loaded: DeckLoaded | null
  /** The skills the Skill tool ran this session, by name: how many times, and when last. */
  skillsUsed: Record<string, { count: number; at: number }>
  /** MCP tool calls this session, by the tool's name (`mcp__server__tool`). */
  mcpCalls: Record<string, number>
}

/** One question of an AskUserQuestion call, as its dialog draws it. */
export type DeckQuestion = {
  question: string
  /** Its chip ("Library"); '' when the call gave none. */
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

/**
 * A call the engine holds on the person: a question (AskUserQuestion) or a
 * permission prompt (a `tool.check` ask the engine put to its dialog), until
 * the call ends.
 */
export type DeckPending = {
  /** The call's tool_use_id. */
  id: string
  /** The loop whose call it is: 'main' for the Orchestrator. */
  agentId: string
  kind: 'question' | 'permission'
  tool: string
  at: number
  /** A question's questions, as the call gave them. */
  questions?: DeckQuestion[]
  /** A permission's shell command. */
  command?: string
  /** A permission's file, relative to the repository shown when it lies in it. */
  path?: string
  /** What the call says it does (a shell call's description), else what it is aimed at. */
  description?: string
}

/** What came of a command from the web deck's page, by its `id`. */
export type DeckAck = {
  id: string
  ok: boolean
  status: 'queued' | 'delivered' | 'answered' | 'failed'
  /** In words: "It reads it at its next step", "Already answered in Claude Code", the reason it failed. */
  text: string
  at: number
}

export type DeckEdit = {
  id: string
  agent: string
  tool: string
  path: string
  abs: string
  at: number
  added: number
  removed: number
  patch: string
  isNew: boolean
  /** The person changed the proposed edit before accepting it (the tool's `userModified`). */
  userModified?: boolean
}

export type DeckMinute = { m: number; tools: number; edits: number; tokens: number }

/** What the person asked for: a prompt in their own words, and the follow-ups typed while it was under way. */
export type DeckGoal = {
  id: string
  /** The first line, at most 80 characters; a slash command's own name and arguments. */
  headline: string
  text: string
  at: number
  followUps: { text: string; at: number }[]
  /** Where the words came from: `composer`, `bridge`, `sdk` or `plugin`. */
  origin: string
  /** The plan approved under this goal (ExitPlanMode), split into steps. */
  plan?: { steps: string[]; at: number }
}

/** One task of the session's task board (TaskCreate, TaskUpdate, TaskList, TaskGet, TaskCreated, TaskCompleted). */
export type DeckTask = {
  id: string
  subject: string
  description?: string
  /** Its activeForm. */
  doing?: string
  status: 'done' | 'active' | 'pending'
  /** The owner TaskUpdate or TaskList names: a teammate's name. */
  owner?: string
  /** The agent whose call created it. */
  createdBy?: string
  /** The agent whose own TaskUpdate started or finished it. */
  claimedBy?: string
  /** The goal it was created or last updated under. */
  goal?: string
  at: number
  startedAt?: number
  doneAt?: number
}

/** A Workflow run: its script's meta, who called it, and how long it lived. */
export type DeckWorkflow = {
  /** The Workflow call's tool_use_id, which its agents' spawns carry. */
  id: string
  /** The loop that called it. */
  caller: string
  name: string
  /** `meta.phases`' titles, in order. */
  phases: string[]
  runId?: string
  taskId?: string
  goal?: string
  startedAt: number
  lastAt: number
  endedAt?: number
}

/**
 * What runs when no agent is talking: a background shell, a monitor, a
 * workflow or a background agent Claude Code holds as a task, and a cron or
 * a wakeup scheduled to wake the session. Seen the moment the call that
 * starts it ends (Bash with run_in_background, Monitor, Workflow, CronCreate,
 * ScheduleWakeup), or first in a snapshot (the `background_tasks` and
 * `session_crons` of Stop and SubagentStop); gone when a later snapshot no
 * longer lists it, or its stop is seen (TaskStop, CronDelete, a task
 * notification that it ended, a one-shot schedule firing).
 */
export type DeckBackground = {
  /**
   * Claude Code's id for it: the task's (a shell's `backgroundTaskId`,
   * Monitor's and Workflow's `taskId`) or the schedule's (CronCreate's `id`,
   * a snapshot's); a wakeup has none until a snapshot lists it, and keeps
   * its call's id until then (`isBound` false).
   */
  id: string
  /** Whether `id` is Claude Code's own (TaskStop and CronDelete take it), not the starting call's stand-in. */
  isBound: boolean
  kind: 'shell' | 'monitor' | 'workflow' | 'agent' | 'other' | 'cron' | 'wakeup'
  /** The snapshot's own type label verbatim (`shell`, `monitor`, …); '' until a snapshot lists it. */
  type: string
  /** The snapshot's own status verbatim (`running`, `pending`); '' until a snapshot lists it. */
  status: string
  /** A shell's command, a monitor's or an agent's description, a workflow's name, a schedule's prompt (a wakeup's reason), as given. */
  title: string
  /** What else Claude Code said of it: a shell's description, a monitor's server and tool, an agent's type, a cron's schedule in words. */
  note: string
  /** A schedule's prompt as given (what it submits when it fires); '' for a task. */
  prompt: string
  /** A cron's expression, as given; '' for a task. */
  schedule: string
  /** A cron that fires on every match; false for a one-shot cron and a wakeup. */
  recurring: boolean
  /** When it fires next, as CronCreate (`nextFireAt`) or ScheduleWakeup (`scheduledFor`) said; absent when not said. */
  nextAt?: number
  /** The loop whose call started it (`main` or an agent's id); '' when the deck first saw it in a snapshot. */
  by: string
  /** The call that started it (its tool_use_id); '' for one first seen in a snapshot. */
  call: string
  /** When its call started it, or a snapshot first listed it. */
  at: number
  /** When a snapshot last listed it; 0 for never. */
  seenAt: number
}

/** What Claude Code's permission check (`$.tool.check`, no classifier asked) said of the deck's stopping call `<tool>:<id>`, and when. */
export type DeckVerdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string; at: number }

/** One agent's share of a file's edits. */
export type DeckFileEditor = { agent: string; count: number; added: number; removed: number; firstAt: number; lastAt: number }

/** Every file agents edited this session, by its normalised path: who, how much, when. */
export type DeckFile = {
  /** As the deck shows it: relative to the repository followed, else absolute. */
  path: string
  abs: string
  editors: DeckFileEditor[]
  added: number
  removed: number
  lastAt: number
  isNew?: boolean
  userModified?: boolean
}

export type DeckData = {
  startedAt: number
  agents: DeckAgent[]
  messages: DeckMessage[]
  edits: DeckEdit[]
  minutes: DeckMinute[]
  commitsBy: Record<string, string>
  /** What each task of the session's task list says while in progress, by task id (TaskCreate, TaskUpdate). */
  tasks: Record<string, string>
  turns: number
  turnMs: number
  /** The person's goals, newest last (at most 20). */
  goals: DeckGoal[]
  /** The task board, by task id (at most 200). */
  board: Record<string, DeckTask>
  /** The files edited, by normalised path (at most 500). */
  files: Record<string, DeckFile>
  /** The Workflow runs, newest last (at most 10). */
  workflows: DeckWorkflow[]
  /** The next prompt in the person's words starts a new goal, whatever is still live. */
  isNewGoalNext?: boolean
  /** The calls the engine holds on the person now (questions, permission prompts), oldest first (at most 20). */
  pending: DeckPending[]
  /** What came of the web deck's commands, newest last (at most 50). */
  acks: DeckAck[]
  /** Claude Code's notifications that wait on the person, oldest first (at most 20); each goes once what it waits on moves (`clearNeeds`). */
  needs: DeckNeeds[]
  /** The plan approved last (ExitPlanMode), as Claude wrote it (at most 20,000 characters), and the loop that made it. */
  approved?: { text: string; at: number; by: string }
  /**
   * The main loop's running turn, as its `turn.start` gave it (never a
   * subagent's or teammate's, whose runs raise `turn.start` too); absent
   * between turns. Stop turn ends it (`$.turn.abort`).
   */
  mainTurnId?: string
  /** When that turn started (its `turn.start`); absent with it, and in a snapshot of a build that did not keep it. */
  mainTurnAt?: number
  /** What runs in the background or is scheduled (hooks/background.ts), oldest first (at most 50); absent in a snapshot of a build that kept none. */
  background?: DeckBackground[]
  /**
   * Claude Code's permission verdicts on the deck's stopping calls (TaskStop
   * of an agent or a task, CronDelete of a schedule), by `<tool>:<id>`: a
   * Stop or Cancel shows only where the newest says `allow`, and a press
   * asks again first. Absent in a snapshot of a build that kept none.
   */
  verdicts?: Record<string, DeckVerdict>
  /** Inspect's records (hooks/inspect.ts): permission decisions, compactions, the context and what is loaded; absent until the first. */
  inspect?: DeckInspect
  /**
   * The session began as a fork of another (Claude Code's SessionStart said
   * `fork`): its /cost total starts at that one's. The engine does not say
   * which session it was. Absent for any other start.
   */
  isFork?: true
}

/**
 * The pane's tabs: the Dashboard, the org chart, the Plan and Changes on the
 * tab row; Stats and Classic (`agents`: the summary and the full outline of
 * earlier builds) off it, opened by `/deck stats` and `/deck classic`.
 * Older builds' names (overview, diffs, commits, graph, flow) and `classic`
 * are read as these by `tabNamed`.
 */
export type DeckTab = 'dashboard' | 'org' | 'plan' | 'agents' | 'changes' | 'stats'

/** What the selected agent's detail shows: its exact diffs, its conversation, or its recent tool calls. */
export type DeckAgentPane = 'activity' | 'edits' | 'chat'

/** How the Agents tab draws the delegation: a tidy tree, or one lane per participant. */
export type DeckMapView = 'tree' | 'wire'

/**
 * What the v2 screens (web/CONTRACT.md v2) keep of their own in the pane:
 * the tab open (Dashboard, Chat, Org, Changes, Inspect, Settings; keys 1 to
 * 6), the fold rows opened and Chat's filter. The agent page open is `page`.
 */
export type DeckView2 = {
  /** The tab open: `now` is the Dashboard (its id from before it was renamed, so `/deck now` and saved views still land). */
  tab: 'now' | 'chat' | 'org' | 'changes' | 'inspect' | 'settings'
  /**
   * The fold rows opened, by their id: a tree's (`fold:` and the parent's
   * id), the "N finished" rows of the Dashboard (`finished:now`) and of
   * Chat's members (`finished:chat`), and Inspect's sections
   * (`inspect:context`, `inspect:permissions`, `inspect:loaded`,
   * `inspect:spend`); oldest first, at most 50. Every other stays folded.
   */
  openFolds: string[]
  /** Chat's filter: '' for Everyone, `between` (agent to agent), or the id of the agent picked in its member list. */
  chatFilter: string
  /**
   * The agents "Clear finished" hid from the Dashboard, Chat's members and
   * Everyone, and Org (the deck's own tidying: nothing in Claude Code), by
   * id, oldest first, at most 500; one that runs again after the press shows
   * again. "Show N cleared" empties it.
   */
  cleared: string[]
  /** When "Clear finished" was pressed last; 0 for never. */
  clearedAt: number
  /** What Org shows: its Timeline once picked (`timeline`); absent, the chart (a patch of `chart` goes back to it, and leaves the field out). */
  orgView?: 'chart' | 'timeline'
  /** What an agent page's Activity lists: its calls alone once "Calls only" is picked (`calls`); absent, its calls with their words between them (a patch of `words` goes back to that, and leaves the field out). */
  activityView?: 'calls' | 'words'
  /**
   * Inspect over the tab, as earlier builds had it: always false now, as
   * Inspect is a tab of its own. A view saved with `true`, or a patch that
   * sets it, opens Inspect (`M.view2With`).
   */
  isInspectOpen: boolean
}

export type DeckView = {
  tab: DeckTab
  /**
   * What the Agents tab's detail block shows (`select`): an agent's id, a
   * plan step's key or a file's key; '' when none is (the Orchestrator's shows).
   */
  agent: string
  agentPane: DeckAgentPane
  file: string
  commit: string
  filter: string
  showFiles: boolean
  isBandHidden: boolean
  /**
   * The style the deck draws agents' avatars in (web/avatars.mjs
   * `STYLE_IDS`; robots by default): the person's own, kept in the store's
   * `prefs` beside `isBandHidden`, so it holds in every session. The pane
   * (its Kit), the web page (the v2 state's `avatarStyle`) and `/deck demo`
   * follow it.
   */
  avatarStyle: string
  /** The delegation map's view. */
  map: DeckMapView
  /** The id of the message picked in the messages log; '' when none is. */
  message: string
  /**
   * The person's own folds of outline branches (agent ids, plan step keys,
   * group ids), which win over the defaults (finished subtrees, background
   * and "+N done" rows folded): an id folds its branch, `+` and an id keeps
   * it open. Oldest first, at most 200.
   */
  folded: string[]
  /** The branch the outline is zoomed on (an agent id or a step key); '' for all. */
  zoom: string
  /** The Agents tab shows the full outline (Details) instead of its summary. */
  isDetailsOpen: boolean
  /** The agent whose page shows over the tab in view (Back returns to the tab); '' for none. */
  page: string
  /** The pane shows the sample (`/deck demo`, web/fixtures/state.json) in place of this session. */
  isDemo: boolean
  /**
   * What the Plan tab has open: `step:` and a step's key for its row, `goal`
   * for the goal's whole words, `result:` and an agent's id for its whole
   * result. Oldest first, at most 100; everything else stays folded.
   */
  planOpen: string[]
  /**
   * The sections folded to their heading and a one-line summary, by their id
   * (the dashboard's `FOLD`): the Dashboard's `dash:goal`, `dash:agents`,
   * `dash:figures`, `dash:activity` and `dash:files`; an agent page's
   * `page:task` and `page:checklist`; the Plan tab's `plan:goal`. Oldest
   * first, at most 50; everything else stays open.
   */
  collapsed: string[]
  /** The v2 screens' own (Phase 1): their tab, open folds, Chat's filter, Inspect. */
  v2: DeckView2
}

export type DeckSnapshot = {
  v: number
  data: DeckData
  view: DeckView
}

/** What `$.state` keeps of the web deck (`/deck web`). */
export type DeckWebSaved = {
  isOn: boolean
  /** The server's access token (the page's `t`). */
  token: string
  /** The port it listened on, taken again after a reload; 0 for none yet. */
  port: number
  /** The folder it serves, `<mod>/.web/<sessionId>`. */
  dir: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': {
      snapshot: DeckSnapshot
      /** The repository root the person pinned the deck to; '' while it follows the work. */
      repo: string
      /** The web deck: on for the session after /deck web, its server's token, port and folder, so a reload starts it again where it was. */
      web: DeckWebSaved
    }
  }
}
