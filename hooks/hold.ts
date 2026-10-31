/**
 * The web page's words in your voice, held for your Send. The page the deck
 * opens in the Desktop's Browser pane (its link's grade, `pane`: hooks/web.ts
 * `WebGrade`) is one Claude's own tools can drive: they read its link and
 * press its buttons, and nothing on a page tells your click from theirs. So
 * what that page sends as you (a message to the Orchestrator or an agent,
 * Review, an answer to a question, any of these for another session's deck)
 * waits in the band above the prompt, a row each, until you press its Send
 * there, which runs it as a page in your own browser would have at once;
 * Discard drops it, and one left there ten minutes goes by itself. A press in
 * Claude Code's own band is yours: Claude has no tool that reaches it.
 *
 * What the page does in this session that speaks for nobody (Stop, Stop
 * turn, Cancel, Clear finished, a pick of Changes, the avatar style)
 * runs at once from either link, as presses on the native deck do. For
 * another session's deck, everything the Browser pane's page sends but
 * viewing it waits too (`isHeld`): a Stop there stops work you may not be
 * watching, in a session you did not drive from here, so it is yours to send.
 *
 * Pure: the hooks module keeps the one queue, acks it and draws it.
 */
import * as F from './format'

/** How long a held command waits for your Send before it goes unsent. */
export const HOLD_MS = 10 * 60_000

/** The most that wait at once: past it the page's next one is refused, so the band never grows past a few rows. */
export const MOST_HELD = 5

/** Past this many characters, or with a line break, a row shows its start and a More that opens the whole text. */
export const ROW_CHARS = 80

/** The commands that speak as you: held when a `pane` page sends them. */
const VOICE: ReadonlySet<string> = new Set(['chat', 'review', 'answer'])

/** What the page's ack says while one waits, and the page shows under it. */
export const HELD_TEXT = 'Press Send above your prompt in Claude Code to send it'

/** One command held: its key in the queue, its ack's id, the command as the page sent it (no `session`), the session it is for ('' this one), when it came, whom it goes to in words, and what it says. */
export type Held = {
  key: string
  ackId: string
  cmd: Record<string, unknown>
  session: string
  at: number
  /** In your voice (`chat`, `review`, `answer`), or a press for another session's deck that speaks for nobody (`control`: a Stop, Stop turn, Clear finished, a pick of its Changes). */
  kind: 'chat' | 'review' | 'answer' | 'control'
  /** Whom it goes to: "Orchestrator", an agent's name, or another session's name (and its agent's, when it names one). */
  to: string
  /** What it says, as sent: a message's or Review's words, an answer's answers. */
  text: string
}

/** One row of the band: what it is ("→ builder", "asks for a review", "answers Orchestrator"), its words on one line and whole, whether they are longer than a row, and whether the row is opened to them. */
export type HeldRow = { key: string; what: string; text: string; whole: string; isLong: boolean; isOpen: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a page's command speaks as you (a message, Review, an answer): one a `pane` page sends is held. */
export function isVoice(cmd: unknown): boolean {
  return isRecord(cmd) && typeof cmd.cmd === 'string' && VOICE.has(cmd.cmd)
}

/** Whether a command from the Browser pane's page waits for your Send: one in your voice, and every one for another session's deck (`session` names one other than `me`) but viewing it. */
export function isHeld(cmd: unknown, me: string): boolean {
  if (isVoice(cmd)) return true
  return isRecord(cmd) && typeof cmd.session === 'string' && cmd.session !== '' && cmd.session !== me && cmd.cmd !== 'view'
}

/** What a voice command says, as sent: a message's or Review's words; an answer's answers, each after its question when it answers several. */
export function wordsOf(cmd: Record<string, unknown>): string {
  if (cmd.cmd !== 'answer') return typeof cmd.text === 'string' ? cmd.text.trim() : ''
  const answers = isRecord(cmd.answers) ? Object.entries(cmd.answers).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : []
  return answers.length === 1 ? (answers[0]?.[1] ?? '').trim() : answers.map(([question, answer]) => `${question.trim()} ${answer.trim()}`).join('; ')
}

/** A held command, from the page's: its key, when it came, the session it is for ('' this one) and whom it goes to in words. */
export function heldOf(cmd: Record<string, unknown>, key: string, at: number, session: string, to: string): Held {
  const kind = cmd.cmd === 'answer' ? 'answer' : cmd.cmd === 'review' ? 'review' : cmd.cmd === 'chat' ? 'chat' : 'control'
  return { key, ackId: typeof cmd.id === 'string' ? cmd.id : '', cmd, session, at, kind, to, text: kind === 'control' ? '' : wordsOf(cmd) }
}

/** The last part of a folder's path, for a pick of another session's Changes. */
const baseOf = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

/** What a press for another session's deck does, in words: "stops builder in acme-api", "stops the turn in acme-api". */
function controlOf(item: Held): string {
  const cmd = item.cmd.cmd
  if (cmd === 'stopAgent') return `stops ${item.to}`
  if (cmd === 'abortTurn') return `stops the turn in ${item.to}`
  if (cmd === 'stopBackground') return `stops a background task in ${item.to}`
  if (cmd === 'clearFinished') return `clears what finished in ${item.to}`
  if (cmd === 'showCleared') return `shows what was cleared in ${item.to}`
  if (cmd === 'selectRepo') {
    const root = typeof item.cmd.root === 'string' ? item.cmd.root : ''
    return root.trim() === '' ? `has ${item.to}'s Changes follow the work` : `shows ${F.trunc(baseOf(root), 40)} in ${item.to}'s Changes`
  }
  return `sends ${typeof cmd === 'string' ? cmd : 'a command'} to ${item.to}`
}

/** What a row says it is: "→ builder" for a message, "asks for a review", "answers Orchestrator", "stops the turn in acme-api". */
function whatOf(item: Held): string {
  if (item.kind === 'review') return item.to === '' ? 'asks for a review' : `asks ${item.to} for a review`
  if (item.kind === 'answer') return `answers ${item.to}`
  if (item.kind === 'control') return controlOf(item)
  return `→ ${item.to}`
}

/** The band's rows for what waits, oldest first, each its words cleaned for a drawing (control and bidirectional characters out), on one line and whole; those in `open` opened to their whole text. */
export function heldRowsOf(items: readonly Held[], open: ReadonlySet<string>): HeldRow[] {
  return items.map(item => {
    const line = F.oneLine(item.text)
    const isLong = Array.from(item.text).length > ROW_CHARS || /\n/.test(item.text.trim())
    return { key: item.key, what: F.oneLine(whatOf(item)), text: line, whole: F.clean(item.text.trim()), isLong, isOpen: isLong && open.has(item.key) }
  })
}

/** The held commands whose ten minutes are up at `now`. */
export function expiredOf(items: readonly Held[], now: number): Held[] {
  return items.filter(item => now - item.at >= HOLD_MS)
}

/** What a held command's ack says once it went unsent: discarded by you, or left past its ten minutes. */
export function unsentText(why: 'discarded' | 'expired'): string {
  return why === 'discarded' ? 'Not sent: you discarded it above your prompt' : `Not sent: it waited ${HOLD_MS / 60_000} minutes for your Send above the prompt`
}

/** Why the page's next voice command is refused while `MOST_HELD` wait. */
export const FULL_TEXT = `Not sent: ${MOST_HELD} messages from the web page wait above your prompt already. Send or discard those first`
