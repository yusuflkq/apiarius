/**
 * The answers being picked in the pane's question cards, by the need's id
 * (the question call's): per question the option chosen (single select) or
 * the options checked (multi-select), and words of your own (Other); and
 * the answers sent from here, so a card collapses to "Answered: …" at once.
 * The pane's own state, kept while the module lives: a reload starts it
 * over, as it does the questions' races. A need no longer held is forgotten.
 *
 * Pure: no `$`; a press that changes a pick asks the hooks module to draw again.
 */
import type { V2Need } from '../../web'

/** What a pick reads of a need: its id and its questions. */
type Asked = Pick<V2Need, 'id' | 'questions'>

export type Picked = {
  /** A single-select question's option, by question; null for none. */
  chosen: (string | null)[]
  /** A multi-select question's options checked, by question, in the order checked. */
  checked: string[][]
  /** Words of your own, by question. */
  other: string[]
  /** Why a Submit did not send: '' for none. */
  note: string
}

const picks = new Map<string, Picked>()

/** The answers sent from here, by need id: their words and when (the state's time it was drawn at). */
const sent = new Map<string, { words: string; at: number }>()

function questionsOf(p: Asked): NonNullable<V2Need['questions']> {
  return p.questions ?? []
}

/** The picks for a need, made empty on first sight (or when its questions changed). */
export function pickOf(p: Asked): Picked {
  const qs = questionsOf(p)
  let pick = picks.get(p.id)
  if (!pick || pick.chosen.length !== qs.length) {
    pick = { chosen: qs.map(() => null), checked: qs.map(() => []), other: qs.map(() => ''), note: '' }
    picks.set(p.id, pick)
  }
  return pick
}

/** A single-select option chosen: it replaces the option or words chosen before. */
export function choose(p: Asked, qi: number, label: string): void {
  const pick = pickOf(p)
  pick.chosen[qi] = label
  pick.other[qi] = ''
  pick.note = ''
}

/** A multi-select option checked, or unchecked when it was. */
export function toggle(p: Asked, qi: number, label: string): void {
  const pick = pickOf(p)
  const list = pick.checked[qi] ?? []
  pick.checked[qi] = list.includes(label) ? list.filter(one => one !== label) : [...list, label]
  pick.note = ''
}

/** Words of your own: for a single-select question they take the place of the option chosen. */
export function setOther(p: Asked, qi: number, text: string): void {
  const pick = pickOf(p)
  pick.other[qi] = text
  if (text.trim() !== '' && questionsOf(p)[qi]?.multiSelect !== true) pick.chosen[qi] = null
  pick.note = ''
}

/** Says under Submit why it did not send. */
export function noteOn(p: Asked, note: string): void {
  pickOf(p).note = note
}

/**
 * The answers picked so far, by question text, as the page sends them: the
 * option chosen; the options checked in the options' own order, words of
 * your own last, joined with ", "; or the words alone. A question with none
 * is left out. Each answer at most 2000 characters.
 */
export function answersOf(p: Asked): Record<string, string> {
  const pick = pickOf(p)
  const out: Record<string, string> = {}
  questionsOf(p).forEach((q, qi) => {
    const other = (pick.other[qi] ?? '').trim()
    let said = ''
    if (q.multiSelect) {
      const checked = pick.checked[qi] ?? []
      const labels = q.options.map(option => option.label).filter(label => checked.includes(label))
      if (other) labels.push(other)
      said = labels.join(', ')
    } else {
      said = pick.chosen[qi] ?? other
    }
    if (said !== '') out[q.question] = said.slice(0, 2000)
  })
  return out
}

/** Whether a press answers the need at once: one question, one answer (no checkboxes, no Submit). */
export function isInstant(p: Asked): boolean {
  const qs = questionsOf(p)
  return qs.length === 1 && qs[0]?.multiSelect !== true
}

/** Notes an answer sent from here: its card shows "Answered: …" from now on. */
export function noteSent(id: string, answers: Readonly<Record<string, string>>, at: number): void {
  sent.set(id, { words: Object.values(answers).join('; '), at })
  picks.delete(id)
}

/** The answer sent from here for need `id`, while it is new (at most 90 s before `now`); undefined for none. */
export function sentOf(id: string, now: number): { words: string; at: number } | undefined {
  const one = sent.get(id)
  return one && now - one.at <= 90_000 ? one : undefined
}


/** Forgets the picks of every need not in `live`, and the answers sent long ago. */
export function prune(live: ReadonlySet<string>, now: number): void {
  for (const id of picks.keys()) if (!live.has(id)) picks.delete(id)
  for (const [id, one] of sent) if (now - one.at > 90_000) sent.delete(id)
}
