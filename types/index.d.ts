export type DeckStatus =
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

export type DeckActivity = {
  id: string
  tool: string
  target: string
  /** The call's own words for what it does: a Bash or PowerShell `description`. */
  description?: string
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
  answer?: string
  /** The in-progress item of its todo list (TodoWrite) or task list (TaskUpdate). */
  todo?: DeckTodo
  /** On the Orchestrator alone: the engine waits on the person. */
  needs?: DeckNeeds
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
}

export type DeckMinute = { m: number; tools: number; edits: number; tokens: number }

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
}

/** The pane's tabs. Older builds' names (overview, diffs, commits, graph, flow) are read as these by `tabNamed`. */
export type DeckTab = 'agents' | 'changes' | 'stats'

/** What the selected agent's detail shows: its exact diffs, its conversation, or its recent tool calls. */
export type DeckAgentPane = 'activity' | 'edits' | 'chat'

/** How the Agents tab draws the delegation: a tidy tree, or one lane per participant. */
export type DeckMapView = 'tree' | 'wire'

export type DeckView = {
  tab: DeckTab
  /** The agent whose detail is open on the Agents tab; '' when none is (the Orchestrator's shows). */
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
