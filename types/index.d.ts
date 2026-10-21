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
 * own housekeeping (`engine`: compaction, memory, any loop seen with no spawn).
 * The last two fold into one dim row instead of showing as the Orchestrator's children.
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
 * in particular): no words of yours, so no bubble, a line of its own.
 */
export type DeckMessageKind = 'prompt' | 'spawn' | 'result' | 'message' | 'chat' | 'answer' | 'question' | 'choice' | 'notification' | 'task' | 'command'

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
 * the tab open (Dashboard, Chat, Org, Changes, Settings; keys 1 to 5), the
 * fold rows opened and Chat's filter. The agent page open is `page`.
 */
export type DeckView2 = {
  /** The tab open: `now` is the Dashboard (its id from before it was renamed, so `/deck now` and saved views still land). */
  tab: 'now' | 'chat' | 'org' | 'changes' | 'settings'
  /** The fold rows opened, by their id (`fold:` and the parent's id); oldest first, at most 50. Every other stays folded. */
  openFolds: string[]
  /** Chat's filter: '' for all, `you` (yours and what came to you), `between` (agent to agent), or an agent's id. */
  chatFilter: string
  /**
   * Inspect over the tab, as earlier builds had it: always false now, as
   * Inspect is a section of Settings. A view saved with `true`, or a patch
   * that sets it, opens Settings (`M.view2With`).
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
