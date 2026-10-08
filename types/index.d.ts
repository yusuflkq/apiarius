export type DeckStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'

export type DeckKind = 'you' | 'main' | 'agent' | 'teammate' | 'peer'

export type DeckActivity = {
  id: string
  tool: string
  target: string
  at: number
  ms?: number
  ok?: boolean
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
  turns: number
  turnMs: number
}

export type DeckTab = 'overview' | 'agents' | 'diffs' | 'commits' | 'graph'

export type DeckAgentPane = 'activity' | 'edits' | 'chat'

export type DeckView = {
  tab: DeckTab
  /** The agent whose card is open on the Flow tab; '' when none is. */
  agent: string
  agentPane: DeckAgentPane
  file: string
  commit: string
  filter: string
  showFiles: boolean
  isBandHidden: boolean
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
