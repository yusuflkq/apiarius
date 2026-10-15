/**
 * The answers being picked in the pane's needs-you cards, by the question
 * call's id: per question the option chosen (single select) or the options
 * checked (multi-select), and words of your own (Other). The pane's own
 * state, kept while the module lives, as the detail's opened texts are: a
 * reload starts it over, as it does the questions' races. A call that is no
 * longer pending is forgotten.
 *
 * Pure: no `$`; a press that changes a pick asks the hooks module to draw again.
 */
import type { WebPending } from '../../web'
import { questionsOf } from './dashModel'

export type Pick = {
  /** A single-select question's option, by question; null for none. */
  chosen: (string | null)[]
  /** A multi-select question's options checked, by question, in the order checked. */
  checked: string[][]
  /** Words of your own, by question. */
  other: string[]
  /** Why a Submit did not send: '' for none. */
  note: string
}

const picks = new Map<string, Pick>()

/** The picks for a call, made empty on first sight (or when its questions changed). */
export function pickOf(p: WebPending): Pick {
  const qs = questionsOf(p)
  let pick = picks.get(p.id)
  if (!pick || pick.chosen.length !== qs.length) {
    pick = { chosen: qs.map(() => null), checked: qs.map(() => []), other: qs.map(() => ''), note: '' }
    picks.set(p.id, pick)
  }
  return pick
}

/** A single-select option chosen: it replaces the option or words chosen before. */
export function choose(p: WebPending, qi: number, label: string): void {
  const pick = pickOf(p)
  pick.chosen[qi] = label
  pick.other[qi] = ''
  pick.note = ''
}

/** A multi-select option checked, or unchecked when it was. */
export function toggle(p: WebPending, qi: number, label: string): void {
  const pick = pickOf(p)
  const list = pick.checked[qi] ?? []
  pick.checked[qi] = list.includes(label) ? list.filter(one => one !== label) : [...list, label]
  pick.note = ''
}

/** Words of your own: for a single-select question they take the place of the option chosen. */
export function setOther(p: WebPending, qi: number, text: string): void {
  const pick = pickOf(p)
  pick.other[qi] = text
  if (text.trim() !== '' && questionsOf(p)[qi]?.multiSelect !== true) pick.chosen[qi] = null
  pick.note = ''
}

/** Says under Submit why it did not send. */
export function noteOn(p: WebPending, note: string): void {
  pickOf(p).note = note
}

/**
 * The answers picked so far, by question text, as the page sends them: the
 * option chosen; the options checked in the options' own order, words of
 * your own last, joined with ", "; or the words alone. A question with none
 * is left out. Each answer at most 2000 characters.
 */
export function answersOf(p: WebPending): Record<string, string> {
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

/** Whether every question has an answer picked. */
export function isComplete(p: WebPending): boolean {
  return Object.keys(answersOf(p)).length === questionsOf(p).length
}

/** Whether a press answers the call at once: one question, one answer (no checkboxes, no Submit). */
export function isInstant(p: WebPending): boolean {
  const qs = questionsOf(p)
  return qs.length === 1 && qs[0]?.multiSelect !== true
}

/** Forgets the picks of every call not in `live`. */
export function prune(live: ReadonlySet<string>): void {
  for (const id of picks.keys()) if (!live.has(id)) picks.delete(id)
}

/** Forgets one call's picks: it was answered. */
export function forget(id: string): void {
  picks.delete(id)
}
