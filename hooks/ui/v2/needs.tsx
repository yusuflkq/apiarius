/**
 * Needs you: what Claude Code itself holds on you (the v2 state's `needs`,
 * oldest first), at the top of Now and on the asking agent's page; nothing
 * at all when nothing does. Each is an amber card with its age.
 *
 * - A question (AskUserQuestion): its header chip and words, then a Button
 *   an option (its description dim under it) and Other… for words of your
 *   own. One question with one answer sends at the press; several, or a
 *   multi-select one (whose options toggle), send with Submit. It goes
 *   through the resolver the web deck's `answer` command takes
 *   (`actions.answer`), and the card collapses to "Answered: …". One the
 *   deck cannot answer (it reloaded since) shows its options read-only.
 * - A permission prompt: its tool, its exact command (or path), what the
 *   call says it does, and "Answer it in Claude Code".
 * - Claude Code's notification: its title and its words, verbatim.
 *
 * Each card's title is a plain Button keyed `need:<id>` (W.needKeyOf, the
 * row `j`, `k` and `n` move the focus to) that opens the asking agent's page.
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * picks are ./answers'.
 */
import type { RenderElement } from 'claude-code'

import { clean } from '../../format'
import { needKeyOf, type V2Need, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import * as A from './answers'
import { icon, sectionHead } from './look'
import { P, mix } from './palette'
import { cut, flat } from './text'

/** The cards drawn whole at most; past them, a line each. */
const MOST_CARDS = 4

/** The needs drawn as cards at most; past them, a line each. */
export const MOST_NEED_CARDS = MOST_CARDS
/** The amber card's edge, its notes and its time, flattened from the web's translucent amber. */
const EDGE = mix(P.wait, P.card, 0.45)
const NOTE = mix(P.waitNote, P.card, 0.25)
const TIME = mix(P.waitNote, P.card, 0.45)

/** Where the cards stand: Now, or an agent's page (that agent's alone). */
export type NeedsWhere = 'now' | 'page'

/**
 * The section for `list` (the state's needs, or one agent's); null when it
 * is empty. The first `cards` (four at most) a card each, the rest a line
 * each, `lines` of them at most and "and n more" past them: fewer where the
 * terminal is short of rows.
 */
export function needsSection(kit: Kit, state: WebStateV2, list: readonly V2Need[], actions: DashActions, where: NeedsWhere, cards = MOST_CARDS, lines = Infinity): RenderElement | null {
  const { Box } = kit
  A.prune(new Set(state.needs.map(need => need.id)), state.now)
  if (list.length === 0) return null
  const most = Math.max(0, Math.min(MOST_CARDS, cards))
  const rest = list.slice(most)
  const shown = rest.slice(0, Math.max(0, lines))
  return (
    <Box key={`needs:${where}`} flexDirection="column" gap={1}>
      {sectionHead(kit, 'Needs you', list.length)}
      {list.slice(0, most).map(need => card(kit, state, need, actions))}
      {rest.length > 0 ? moreLines(kit, shown, actions, rest.length - shown.length) : null}
    </Box>
  )
}

/** What a need's title says: who asks, who needs your OK and for which tool, or the notification's own title, else its type in words ("Permission prompt"; one the deck does not know as sent). */
export function needTitle(need: V2Need): string {
  if (need.kind === 'question') {
    const n = need.questions?.length ?? 0
    return n > 1 ? `${need.agentName} asks ${n} questions` : `${need.agentName} asks you`
  }
  if (need.kind === 'permission') return `${need.agentName} needs your OK${need.tool ? ` · ${need.tool}` : ''}`
  return need.title || need.typeText || need.type || 'Claude Code'
}

function markOf(kit: Kit, need: V2Need): RenderElement {
  if (need.kind === 'question') return icon(kit, 'help', P.waitText, '?')
  if (need.kind === 'permission') return icon(kit, 'shield', P.waitText, '!')
  return icon(kit, 'bell', P.waitText, '•')
}

function card(kit: Kit, state: WebStateV2, need: V2Need, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const answered = A.sentOf(need.id, state.now)
  const title = needTitle(need)
  return (
    <Box key={`needs:${need.id}`} flexDirection="column" borderStyle="round" borderColor={EDGE} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{markOf(kit, need)}</Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Box flexDirection="row">
            <Box flexShrink={1} minWidth={0}>
              <Button key={needKeyOf(need.id)} label={title} plain onPress={() => actions.openAgent(need.agent)}>
                <Text bold color={P.waitTitle}>
                  {title}
                </Text>
              </Button>
            </Box>
          </Box>
        </Box>
        <Box flexShrink={0}>
          <Text color={TIME}>{need.age}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {answered ? answeredLine(kit, answered.words) : need.kind === 'question' ? questionBody(kit, need, actions, state.now) : need.kind === 'permission' ? permissionBody(kit, need) : notificationBody(kit, need)}
      </Box>
    </Box>
  )
}

function answeredLine(kit: Kit, words: string): RenderElement {
  const { Text } = kit
  return (
    <Text wrap="wrap">
      <Text color={P.doneText}>✓ </Text>
      <Text color={P.fg2}>{`Answered: ${clean(words)}`}</Text>
    </Text>
  )
}

/** How a question's card answers: from here (at a press, or with Submit), or not at all (read-only). */
type Mode = { canAnswer: boolean; isInstant: boolean }

function questionBody(kit: Kit, need: V2Need, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const qs = need.questions ?? []
  const mode: Mode = { canAnswer: need.isAnswerable, isInstant: need.isAnswerable && A.isInstant(need) }
  return (
    <Box flexDirection="column" gap={1}>
      {qs.map((q, qi) => questionBlock(kit, need, qi, mode, actions, now))}
      {questionFoot(kit, need, mode, actions, now)}
    </Box>
  )
}

/** Sends `answers` for `need` and notes them, so its card says "Answered: …" until it goes. */
function send(need: V2Need, answers: Record<string, string>, actions: DashActions, now: number) {
  A.noteSent(need.id, answers, now)
  actions.answer(need.id, answers)
  actions.redraw()
}

/** One question: its header chip and words, its options, and the Other… field. */
function questionBlock(kit: Kit, need: V2Need, qi: number, mode: Mode, actions: DashActions, now: number): RenderElement {
  const { Box, Text } = kit
  const q = (need.questions ?? [])[qi]
  if (!q) return <Box flexDirection="column" />
  return (
    <Box key={`q:${need.id}:${qi}`} flexDirection="column">
      <Text wrap="wrap">
        {q.header ? (
          <Text color={P.fg2} backgroundColor={P.chip}>
            {` ${clean(q.header).toUpperCase()} `}
          </Text>
        ) : null}
        {q.header ? <Text> </Text> : null}
        <Text bold color={P.text}>
          {clean(q.question)}
        </Text>
        {q.multiSelect ? <Text color={P.muted}>{mode.canAnswer ? '  pick any' : '  several allowed'}</Text> : null}
      </Text>
      {q.options.map((option, oi) => (mode.canAnswer ? optionButton(kit, need, qi, oi, mode, actions, now) : optionLine(kit, need, qi, oi)))}
      {mode.canAnswer ? otherField(kit, need, qi, mode, actions, now) : null}
    </Box>
  )
}

/** An option you can pick: a Button (its mark first in a form: ○ ● for one answer, ☐ ☑ for several), its description dim under it. */
function optionButton(kit: Kit, need: V2Need, qi: number, oi: number, mode: Mode, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const q = (need.questions ?? [])[qi]
  const option = q?.options[oi]
  if (!q || !option) return <Box flexDirection="column" />
  const pick = A.pickOf(need)
  const isOn = q.multiSelect ? (pick.checked[qi] ?? []).includes(option.label) : pick.chosen[qi] === option.label
  const mark = mode.isInstant ? '' : q.multiSelect ? (isOn ? '☑ ' : '☐ ') : isOn ? '● ' : '○ '
  const words = cut(clean(option.label), Math.max(12, kit.columns - 14))
  const press = () => {
    if (mode.isInstant) return send(need, { [q.question]: option.label }, actions, now)
    if (q.multiSelect) A.toggle(need, qi, option.label)
    else A.choose(need, qi, option.label)
    actions.redraw()
  }
  return (
    <Box key={`opt:${need.id}:${qi}:${oi}`} flexDirection="column">
      <Box flexDirection="row">
        <Button key={`answer:${need.id}:${qi}:${oi}`} label={`${mark}${words}`} variant="secondary" onPress={press}>
          {mark ? <Text color={isOn ? P.text : P.muted}>{mark}</Text> : null}
          <Text bold={isOn} color={P.text}>
            {words}
          </Text>
        </Button>
      </Box>
      {option.description ? (
        <Box paddingLeft={2}>
          <Text color={P.muted} wrap="wrap">
            {clean(option.description)}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** An option as words only, for a question the deck cannot answer. */
function optionLine(kit: Kit, need: V2Need, qi: number, oi: number): RenderElement {
  const { Box, Text } = kit
  const q = (need.questions ?? [])[qi]
  const option = q?.options[oi]
  if (!q || !option) return <Box flexDirection="column" />
  return (
    <Box key={`opt:${need.id}:${qi}:${oi}`} flexDirection="column">
      <Text wrap="wrap">
        <Text color={P.muted3}>{q.multiSelect ? '☐ ' : '○ '}</Text>
        <Text color={P.fg2}>{clean(option.label)}</Text>
      </Text>
      {option.description ? (
        <Box paddingLeft={2}>
          <Text color={P.muted} wrap="wrap">
            {clean(option.description)}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * Other…: words of your own. Enter answers at once where a press would; in
 * a form it keeps them until Submit. Each edit is kept as it is typed, so a
 * redraw keeps the words.
 */
function otherField(kit: Kit, need: V2Need, qi: number, mode: Mode, actions: DashActions, now: number): RenderElement | null {
  const { Input } = kit
  const q = (need.questions ?? [])[qi]
  if (!Input || !q) return null
  return (
    <Input
      key={`other:${need.id}:${qi}`}
      label="Other…"
      placeholder={q.options.length > 0 ? 'your own answer' : 'your answer'}
      value={A.pickOf(need).other[qi] ?? ''}
      submitLabel={mode.isInstant ? 'answer' : 'keep'}
      onInput={text => A.setOther(need, qi, text)}
      onSubmit={text => {
        const said = text.trim().slice(0, 2000)
        if (mode.isInstant) {
          if (said !== '') send(need, { [q.question]: said }, actions, now)
          return
        }
        A.setOther(need, qi, said)
        actions.redraw()
      }}
    />
  )
}

/** Under the questions: Submit and where else to answer; for a read-only question, where to answer it. */
function questionFoot(kit: Kit, need: V2Need, mode: Mode, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  if (!mode.canAnswer) return <Text color={NOTE}>Answer it in Claude Code.</Text>
  if (mode.isInstant) return <Text color={NOTE}>Or answer it in Claude Code.</Text>
  const qs = need.questions ?? []
  const pick = A.pickOf(need)
  const submit = () => {
    const answers = A.answersOf(need)
    const missing = qs.find(q => !(q.question in answers))
    if (missing) {
      A.noteOn(need, `Pick an answer for ${missing.header || cut(missing.question, 40)} first.`)
      actions.redraw()
      return
    }
    send(need, answers, actions, now)
  }
  return (
    <Box flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>
        <Button key={`answer:${need.id}`} label={qs.length > 1 ? 'Submit answers' : 'Submit'} variant="primary" onPress={submit} />
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={pick.note ? P.waitText : NOTE} wrap="wrap">
          {pick.note || 'Or answer it in Claude Code.'}
        </Text>
      </Box>
    </Box>
  )
}

/** A permission prompt: its exact command (or path), what the call says it does, and where to answer. */
function permissionBody(kit: Kit, need: V2Need): RenderElement {
  const { Box, Text, Code } = kit
  const what = need.command ?? need.path ?? ''
  return (
    <Box flexDirection="column">
      {need.command ? <Code source={cut(clean(need.command), 2000)} language={need.tool === 'PowerShell' ? 'powershell' : 'bash'} /> : null}
      {!need.command && need.path ? (
        <Text color={P.fg2} wrap="wrap">
          {clean(need.path)}
        </Text>
      ) : null}
      {need.description && need.description !== what ? (
        <Text color={P.fg2} wrap="wrap">
          {clean(need.description)}
        </Text>
      ) : null}
      {!what && !need.description && need.text ? (
        <Text color={P.fg2} wrap="wrap">
          {clean(need.text)}
        </Text>
      ) : null}
      <Text color={NOTE}>Answer it in Claude Code.</Text>
    </Box>
  )
}

/** Claude Code's notification: its words as sent, and where to answer. */
function notificationBody(kit: Kit, need: V2Need): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column">
      <Text color={P.fg2} wrap="wrap">
        {clean(need.text)}
      </Text>
      <Text color={NOTE}>Answer it in Claude Code.</Text>
    </Box>
  )
}

/** Past the cards: a line a need, its title and words as one Button (keyed as its card's would be) and its age. */
function moreLines(kit: Kit, rest: readonly V2Need[], actions: DashActions, past = 0): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key="needs:more" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      {rest.map(need => {
        const words = cut(`${needTitle(need)}: ${flat(need.text)}`, 200)
        return (
          <Box key={`needs:line:${need.id}`} flexDirection="row" columnGap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Box flexDirection="row">
                <Box flexShrink={1} minWidth={0}>
                  <Button key={needKeyOf(need.id)} label={words} plain onPress={() => actions.openAgent(need.agent)}>
                    <Text color={P.fg2}>{words}</Text>
                  </Button>
                </Box>
              </Box>
            </Box>
            <Box flexShrink={0}>
              <Text color={P.muted2}>{need.age}</Text>
            </Box>
          </Box>
        )
      })}
      {past > 0 ? <Text color={P.muted2}>{rest.length > 0 ? `and ${past} more: answer ${past === 1 ? 'it' : 'them'} in Claude Code, or make the pane taller` : `Answer ${past === 1 ? 'it' : 'them'} in Claude Code, or make the pane taller`}</Text> : null}
    </Box>
  )
}
