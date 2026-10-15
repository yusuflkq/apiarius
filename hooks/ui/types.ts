/**
 * The types every drawing shares: the surface's elements (Kit), the state to
 * draw (DeckModel) and the closures a press runs (Actions). The hooks module
 * supplies all three; the screens only read them.
 */
import type { Elements, RenderSurface } from 'claude-code'

import type { DeckAgentPane, DeckData, DeckTab, DeckView } from '../../types'
import type { CommitDetail, FileDiff, GitState } from '../git'
import type { WebState } from '../web'

type TerminalTable = Elements['terminal']

export type Kit = {
  surface: RenderSurface
  Box: TerminalTable['Box']
  Text: TerminalTable['Text']
  Button: TerminalTable['Button']
  Code: TerminalTable['Code']
  Markdown: TerminalTable['Markdown']
  Input?: TerminalTable['Input']
  Select?: TerminalTable['Select']
  Svg?: Elements['desktop']['Svg']
  /** Where the surface runs a plugin's surface module (the terminal and the desktop): the org chart's. */
  Client?: Elements['desktop']['Client']
  columns: number
}

export type ChatLine = { role: 'parent' | 'agent' | 'tool' | 'note'; who: string; text: string }

export type UsageInfo = {
  startedAt: number
  contextPercent?: number
  costUsd?: number
  limits: { kind: string; percentUsed: number }[]
}

export type DayRow = {
  day: string
  added: number
  removed: number
  tools: number
  tokens: number
  sessions: number
  activeMs: number
}

/** The web deck (`/deck web`) as the pane shows it under its Open dashboard button. */
export type WebPane = {
  /** `off` until it is asked for, `starting` until the server says it is ready, `failed` when it could not start or stopped by itself. */
  status: 'off' | 'starting' | 'running' | 'failed'
  /** The page's address while the server runs; '' otherwise. */
  url: string
  /** How the last try to open it in the Browser pane went; '' before the first. */
  opened: '' | 'opened' | 'failed'
  /** Why it is not running, in a sentence; '' when it is. */
  note: string
}

export type DeckModel = {
  data: DeckData
  view: DeckView
  git: GitState
  fileDiff: FileDiff | null
  commit: CommitDetail | null
  /** The selected agent's conversation; null while it is read (or not asked for). */
  chat: ChatLine[] | null
  usage: UsageInfo | null
  days: DayRow[]
  /**
   * The time the drawing shows. Screens draw only what the screen signature
   * covers from it (a time of day, an agent's coarse elapsed time), so a
   * redraw that changes nothing else draws the same tree.
   */
  now: number
  cwd: string
  /** The web deck; absent reads as off. */
  web?: WebPane
}

export type Actions = {
  setTab: (tab: DeckTab) => void
  /**
   * Opens a row in the detail block: an agent's id (the Orchestrator's is
   * `main`), a plan step's key (as `planOf` gives it), or `file:` and a file's path.
   * The outline shows it: a zoom it lies outside ends, and the branches
   * folded above it open.
   */
  select: (id: string) => void
  /** Folds or opens an outline branch (an agent's id, a plan step's row id, a group's id); the choice stays. */
  toggleFold: (id: string) => void
  /** Re-roots the outline on a branch (an agent's id or a plan step's key); '' shows everything again, as does the branch already zoomed. */
  zoomTo: (id: string) => void
  selectAgent: (id: string) => void
  setAgentPane: (pane: DeckAgentPane) => void
  selectFile: (path: string) => void
  selectCommit: (hash: string) => void
  setFilter: (filter: string) => void
  toggleFiles: () => void
  toggleBand: () => void
  refresh: () => void
  sendChat: (agentId: string, text: string) => void
  review: (text: string) => void
  open: (tab: DeckTab) => void
  /** Pins the deck to the repository at `root`; '' follows the work again. */
  selectRepo: (root: string) => void
  /** What `/deck web` does: starts the dashboard's server if it is not running, then opens the page in the Browser pane (the pane shows the link when that fails). */
  openWeb: () => void
  /** Shows the Agents tab's full outline (Details), or its summary again. */
  toggleDetails: () => void
  /** Shows the full outline with row `id` selected (as `select`); '' only opens it. */
  showDetails: (id: string) => void
}

/** What the native dashboard's presses run, beside the deck's own (Actions). */
export type DashActions = Actions & {
  /**
   * Opens agent `id`'s page over the tab in view; Back returns to that tab.
   * With `pane`, the page opens on it, scrolled to it (Talk is `chat`).
   */
  openAgent: (id: string, pane?: DeckAgentPane) => void
  /**
   * Opens the Plan tab with step `key` (its `key` in the state's
   * `plan.steps`) open and scrolled into view, from any tab or agent page.
   */
  openStep: (key: string) => void
  /**
   * Opens or folds one of the Plan tab's disclosures, by its
   * `DeckView.planOpen` id (`step:<key>`, `goal`, `result:<agent id>`): it
   * stays so through redraws and reloads.
   */
  togglePlan: (id: string) => void
  /** Leaves the agent page for the tab it was opened from. */
  back: () => void
  /**
   * Answers the question held on call `callId`, by question text: through
   * the resolver the web deck's `answer` command takes; in the sample, in
   * the sample alone.
   */
  answer: (callId: string, answers: Record<string, string>) => void
  /** Draws again after a change of the pane's own state (a pick in a question). */
  redraw: () => void
  /** Leaves the sample (`/deck demo`) for this session's own deck. */
  exitDemo: () => void
}

/** What the native dashboard draws from, beside the deck's model. */
export type DashModel = {
  /** The web deck's state (`webStateOf` of the live deck), or the sample's; null while the sample is read. */
  state: WebState | null
  /** The sample (`/deck demo`) is shown, not this session. */
  isDemo: boolean
  /** Why the sample could not be read; '' otherwise. */
  demoNote: string
  /** The deck model the agent page's Diffs, Talk and Tool calls read: this session's, or the sample's. */
  paneData: DeckData
  /** The org chart's Client failed on this surface: the Org tab lists the agents as a tree instead. */
  isOrgDown: boolean
  /** The agent the org chart marks: the one whose page was opened last; null for none. */
  selected: string | null
}
