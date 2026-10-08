/**
 * The types every drawing shares: the surface's elements (Kit), the state to
 * draw (DeckModel) and the closures a press runs (Actions). The hooks module
 * supplies all three; the screens and the map only read them.
 */
import type { Elements, RenderSurface } from 'claude-code'

import type { DeckAgentPane, DeckData, DeckMapView, DeckTab, DeckView } from '../../types'
import type { CommitDetail, FileDiff, GitState } from '../git'

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
}

export type Actions = {
  setTab: (tab: DeckTab) => void
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
  /** Picks a row of the messages log: marks it, and opens the agent it went to (its sender, for one sent to you). */
  selectMessage: (id: string) => void
  /** Draws the delegation map as the tidy tree or the wire. */
  setMapView: (map: DeckMapView) => void
  /** Pins the deck to the repository at `root`; '' follows the work again. */
  selectRepo: (root: string) => void
}
