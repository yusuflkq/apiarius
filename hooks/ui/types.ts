/**
 * The types every drawing shares: the surface's elements (Kit), the state to
 * draw (DeckModel) and the closures a press runs (Actions). The hooks module
 * supplies all three; the screens only read them.
 */
import type { Elements, RenderSurface } from 'claude-code'

import type { DeckData, DeckTab, DeckView, DeckView2 } from '../../types'
import type { CommitDetail, FileDiff, GitState } from '../git'
import type { V2Band, V2Files, WebStateV2 } from '../web'

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
  /** Where the surface runs a plugin's surface module (the terminal and the desktop): Org's chart. */
  Client?: Elements['desktop']['Client']
  columns: number
  /** The style the screens draw agents' avatars in (web/avatars.mjs `STYLE_IDS`): the deck's setting; absent, robots. */
  avatarStyle?: string
}

export type UsageInfo = {
  startedAt: number
  contextPercent?: number
  costUsd?: number
  limits: { kind: string; percentUsed: number }[]
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
  usage: UsageInfo | null
  /**
   * The time the drawing shows. Screens draw only what the screen signature
   * covers from it (a time of day, an agent's coarse elapsed time), so a
   * redraw that changes nothing else draws the same tree.
   */
  now: number
  cwd: string
  /** The web deck; absent reads as off. */
  web?: WebPane
  /** What the band above the prompt says, from this session's v2 state (`W.bandOf`): null (or absent) when it says nothing. */
  band?: V2Band | null
}

export type Actions = {
  /** Opens the diff of Changes' file `path` (git's, read again), or closes it when it is the one open. */
  selectFile: (path: string) => void
  /** Opens commit `hash`'s files, or closes them when it is the one open. */
  selectCommit: (hash: string) => void
  /** Hides the band above the prompt, or shows it again, as `/deck band` does; the choice stays. */
  toggleBand: () => void
  /**
   * Sends `text` to agent `agentId` (to the Orchestrator: your next prompt).
   * With `ackId` (`[A-Za-z0-9_-]`, at most 40) what came of it is noted in the
   * state's `acks` under that id, and the message carries it, as for the web
   * page's `chat` command.
   */
  sendChat: (agentId: string, text: string, ackId?: string) => void
  review: (text: string) => void
  /** The band's Open: this session's deck (out of the sample, off an agent's page and Inspect) on that tab, the pane opened; a v1 tab lands on the v2 tab it folded into (`M.v2TabOf`). */
  open: (tab: DeckTab | DeckView2['tab']) => void
  /** Pins the deck to the repository at `root`; '' follows the work again. */
  selectRepo: (root: string) => void
  /** What `/deck web` does: starts the dashboard's server if it is not running, then opens the page in the Browser pane (the pane shows the link when that fails). */
  openWeb: () => void
}

/** What the native dashboard's presses run, beside the deck's own (Actions). */
export type DashActions = Actions & {
  /** Opens agent `id`'s page over the tab in view; `b` (Back) returns to that tab. */
  openAgent: (id: string) => void
  /** Leaves the agent page for the tab it was opened from. */
  back: () => void
  /**
   * Folds one of Now's sections to its head and one line, or opens it again,
   * by its `DeckView.collapsed` id (./v2/dashModel's FOLD): it stays so
   * through redraws, live updates and reloads.
   */
  toggleSection: (id: string) => void
  /**
   * Answers the question held on call `callId`, by question text: through
   * the resolver the web deck's `answer` command takes; in the sample, in
   * the sample alone.
   */
  answer: (callId: string, answers: Record<string, string>) => void
  /** Draws again after a change of the pane's own state (a pick in a question). */
  redraw: () => void
  /**
   * Reads the whole text of message `id` that the state cut (`isCut`), as the
   * web page's `/message/<id>` serves it: `onRead` gets it (null when it cannot
   * be read), then the pane draws again.
   */
  loadMessage: (id: string, onRead: (text: string | null) => void) => void
  /**
   * Brings the element keyed `key` into the pane's view once it is drawn:
   * `start` puts its top at the window's top (the default), `nearest` moves the
   * least that shows it.
   */
  reveal: (key: string, block?: 'start' | 'nearest') => void
  /** Leaves the sample (`/deck demo`) for this session's own deck. */
  exitDemo: () => void
  /**
   * Sets the v2 screens' own state (`DeckView.v2`: the tab, the open folds,
   * Chat's filter, Inspect), each field checked, what `patch` leaves out
   * kept; the pane draws again and the choice stays through reloads. An
   * agent page is `openAgent` and `back`, as before.
   */
  setV2View: (patch: Partial<DeckView2>) => void
  /**
   * `j` (1) and `k` (-1): moves the pane's focus ring one row down or up
   * (`$.ui.focus`) among `keys`, the rows' Button keys in the order drawn;
   * left out, the v2 screen's own (`W.focusKeysOf`: Now's needs and tree
   * rows, Changes' files). It holds at either end; from no row, `j` takes
   * the first and `k` the last. The deck follows the ring (`ui.focus`).
   */
  focusNext: (dir: 1 | -1, keys?: readonly string[]) => void
  /** `n`: Now, the focus on the next thing that needs you (`W.nextNeedKeyOf`: after the need focused, round to the first). */
  focusNeed: () => void
  /**
   * Draws the agents' avatars in `style` (web/avatars.mjs `STYLE_IDS`) from
   * now on, as `/deck avatars <style>` does: kept in the person's prefs, for
   * every session; the pane draws again and the web page follows.
   */
  setAvatarStyle: (style: string) => void
  /**
   * "Clear finished" (as `/deck clear`): every agent shown that is finished
   * (done, failed, stopped or idle) hidden from the Dashboard, Chat's members
   * and Everyone, and Org, kept in the view through reloads. The deck's own
   * tidying: nothing in Claude Code changes.
   */
  clearFinished: () => void
  /** "Show N cleared" (as `/deck clear show`): the agents "Clear finished" hid shown again. */
  showCleared: () => void
}

/** What the pane draws from, beside the deck's model. */
export type DashModel = {
  /**
   * The v2 view model (`deckStateOf`, web/CONTRACT.md v2) of the live deck,
   * the very one state.json's `v2` holds (built once per screen); the
   * sample's (web/fixtures/state.v2.json, its times moved to now) while the
   * sample shows; null while that is read or could not be.
   */
  v2: WebStateV2 | null
  /** The v2 state's lazy files (an agent's file, a patch, a cut message's whole text): the live deck's, or the sample's (web/fixtures/v2/). */
  v2Files: V2Files
  /** The sample (`/deck demo`) is shown, not this session. */
  isDemo: boolean
  /** Why the sample could not be read; '' otherwise. */
  demoNote: string
  /** Org's chart Client failed on this surface: Org lists the agents as a tree instead, until Org is left (or /deck opens). */
  isOrgDown: boolean
  /** The agent Org's chart marks: the one whose page was opened last; null for none. */
  selected: string | null
}
