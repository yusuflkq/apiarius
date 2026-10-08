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
 * server's question, Claude waiting for input). Kept on the Orchestrator;
 * the next tool call or turn takes it down.
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
}

export type DeckMessageKind = 'prompt' | 'spawn' | 'result' | 'message' | 'chat'

export type DeckMessage = {
  id: string
  from: string
  to: string
  kind: DeckMessageKind
  text: string
  at: number
  isDelivered?: boolean
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
}

/** The pane's tabs. Older builds' names (overview, diffs, commits, graph, flow) are read as these by `tabNamed`. */
export type DeckTab = 'agents' | 'changes' | 'stats'

/** What the selected agent's detail shows: its exact diffs, its conversation, or its recent tool calls. */
export type DeckAgentPane = 'activity' | 'edits' | 'chat'

/** How the Agents tab draws the delegation: a tidy tree, or one lane per participant. */
export type DeckMapView = 'tree' | 'wire'

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
}

export type DeckSnapshot = {
  v: number
  data: DeckData
  view: DeckView
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': {
      snapshot: DeckSnapshot
      /** The repository root the person pinned the deck to; '' while it follows the work. */
      repo: string
    }
  }
}
