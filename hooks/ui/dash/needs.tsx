/**
 * What waits on you, at the top of the Dashboard and on the asking agent's
 * page: an amber card for each call the engine holds on you (`pending`,
 * questions first, oldest first), as the web deck's Needs you draws them.
 *
 * - A question: its header chip and its words, then one Button an option
 *   with the option's description dim under it, and an Other… field for
 *   words of your own. One question with one answer sends at the press (or
 *   at Enter in Other); several questions, or a multi-select one (whose
 *   options toggle), send with Submit. The answer goes through the resolver
 *   the web deck's `answer` command takes (`actions.answer`). A question the
 *   deck cannot answer (it reloaded since it was asked) shows its options
 *   read-only: answer it in Claude Code.
 * - A permission: "<agent> needs your OK to run `<command>`" (the whole
 *   command under it when it is long), what the call says it does, and
 *   "Allow or deny it in Claude Code".
 *
 * With nothing held, the needs-you line the mod words (`needs`) shows as a
 * banner when it is loud: a failure, a wait the engine raised another way,
 * or everything done.
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * picks are this module's own (./answers).
 */
import type { RenderElement } from 'claude-code'

import { clean } from '../../format'
import type { WebPending, WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import * as A from './answers'
import { agentOf, ago, cut, firstLine, isAnswerable, nameOf, pendingOf, pendingText, permitOf, plural, questionsOf, wrapTicks } from './dashModel'
import { P, mix } from './palette'
import { CARD_CHROME, buttonSlack, icon, openAgentPage, openButton, openWidth, pressLine, tickParts, tickTexts } from './parts'

/** The cards drawn whole at most; past them, a row each. */
const MOST_CARDS = 3
/** The longest command or path the title holds; past it, it shows whole under the title. */
const TITLE_CODE = 60
/** The amber card's edge, its notes and its time, flattened from the web's translucent amber. */
const EDGE = mix(P.wait, P.card, 0.45)
const NOTE = mix(P.waitNote, P.card, 0.25)
const TIME = mix(P.waitNote, P.card, 0.45)

/** Where the cards stand: the Dashboard (each with Open, to its agent's page) or that agent's page. */
export type NeedsWhere = 'dash' | 'agent'

/** The cards for what waits on you (on an agent's page, only that agent's); null when nothing does. */
export function needsCards(kit: Kit, state: WebState, actions: DashActions, now: number, where: NeedsWhere, agentId = ''): RenderElement | null {
  const { Box } = kit
  A.prune(new Set(state.pending.map(p => p.id)))
  const list = pendingOf(state).filter(p => agentId === '' || p.agentId === agentId)
  if (list.length === 0) return null
  const rest = list.slice(MOST_CARDS)
  return (
    <Box flexDirection="column" gap={1}>
      {list.slice(0, MOST_CARDS).map(p => card(kit, state, p, actions, now, where))}
      {rest.length > 0 ? moreRows(kit, state, rest, actions, now) : null}
    </Box>
  )
}

/** A card's title: who asks, or who needs your OK for what (the command or path as code). */
function titleOf(kit: Kit, p: WebPending, name: string): RenderElement {
  const { Text } = kit
  if (p.kind === 'question') {
    const n = questionsOf(p).length
    return (
      <Text bold color={P.waitTitle} wrap="wrap">
        {n > 1 ? `${name} asks ${n} questions` : `${name} asks you`}
      </Text>
    )
  }
  const { verb, what } = permitOf(p)
  const line = firstLine(what)
  return (
    <Text bold color={P.waitTitle} wrap="wrap">
      {`${name} needs your OK to ${verb}`}
      {line ? <Text> </Text> : null}
      {line ? (
        <Text color={P.text} backgroundColor={P.chip}>
          {cut(line, TITLE_CODE)}
        </Text>
      ) : null}
    </Text>
  )
}

/**
 * A card's title as one press that opens its agent's page, where it fits on
 * one line beside the time and "Open →"; null where it does not (it wraps,
 * as Text, and "Open →" opens the page).
 */
function titleLine(kit: Kit, p: WebPending, name: string, room: number, onPress: () => void): RenderElement | null {
  const { Text } = kit
  const key = `needs:title:${p.id}`
  if (p.kind === 'question') {
    const n = questionsOf(p).length
    const words = n > 1 ? `${name} asks ${n} questions` : `${name} asks you`
    if (Array.from(words).length > room) return null
    return pressLine(
      kit,
      key,
      [
        <Text bold color={P.waitTitle}>
          {words}
        </Text>,
      ],
      onPress,
    )
  }
  const { verb, what } = permitOf(p)
  const line = firstLine(what)
  const lead = `${name} needs your OK to ${verb}`
  const code = cut(line, TITLE_CODE)
  if (Array.from(lead).length + (line ? 1 + Array.from(code).length : 0) > room) return null
  return pressLine(
    kit,
    key,
    [
      <Text bold color={P.waitTitle}>
        {line ? `${lead} ` : lead}
      </Text>,
      ...(line
        ? [
            <Text bold color={P.text} backgroundColor={P.chip}>
              {code}
            </Text>,
          ]
        : []),
    ],
    onPress,
  )
}

function card(kit: Kit, state: WebState, p: WebPending, actions: DashActions, now: number, where: NeedsWhere): RenderElement {
  const { Box, Text } = kit
  const isQuestion = p.kind === 'question'
  const mark = icon(kit, isQuestion ? 'help' : 'shield', P.waitText) ?? <Text bold color={P.waitText}>{isQuestion ? '?' : '!'}</Text>
  const canOpen = where === 'dash' && agentOf(state, p.agentId) !== undefined
  const name = nameOf(state, p.agentId)
  const open = () => openAgentPage(actions, state, p.agentId)
  // the title's room on its row: less the card's rule and padding, the mark, the time, "Open →", the gaps and its button's chrome
  const titleRoom = kit.columns - CARD_CHROME - 2 - 1 - 4 - 1 - openWidth(kit) - 1 - buttonSlack(kit)
  const title = canOpen ? titleLine(kit, p, name, titleRoom, open) : null
  return (
    <Box key={`needs:${p.id}`} flexDirection="column" borderStyle="round" borderColor={EDGE} {...(canOpen ? { hover: { borderColor: P.wait } } : {})} paddingX={1} gap={1}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{mark}</Box>
        <Box flexGrow={1} flexShrink={1}>
          {title ?? titleOf(kit, p, name)}
        </Box>
        <Box flexShrink={0}>
          <Text color={TIME}>{ago(p.at, now)}</Text>
        </Box>
        {canOpen ? <Box flexShrink={0}>{openButton(kit, `needs:open:${p.id}`, P.waitText, open)}</Box> : null}
      </Box>
      {isQuestion ? questionBody(kit, p, actions) : permissionBody(kit, p)}
    </Box>
  )
}

/** How a question's card answers: from here (at a press, or with Submit), or not at all (read-only). */
type Mode = { canAnswer: boolean; isInstant: boolean }

function questionBody(kit: Kit, p: WebPending, actions: DashActions): RenderElement {
  const { Box } = kit
  const qs = questionsOf(p)
  const canAnswer = isAnswerable(p)
  const mode: Mode = { canAnswer, isInstant: canAnswer && A.isInstant(p) }
  return (
    <Box flexDirection="column" gap={1} paddingLeft={2}>
      {qs.map((q, qi) => questionBlock(kit, p, qi, mode, actions))}
      {questionFoot(kit, p, mode, actions)}
    </Box>
  )
}

/** One question: its header chip and words, its options, and the Other… field. */
function questionBlock(kit: Kit, p: WebPending, qi: number, mode: Mode, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const q = questionsOf(p)[qi]
  if (!q) return <Box flexDirection="column" />
  return (
    <Box key={`q:${p.id}:${qi}`} flexDirection="column">
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
      {q.options.map((option, oi) => (mode.canAnswer ? optionButton(kit, p, qi, oi, mode, actions) : optionLine(kit, p, qi, oi)))}
      {mode.canAnswer ? otherField(kit, p, qi, mode, actions) : null}
    </Box>
  )
}

/** An option you can pick: a Button (its mark first, in a form: ○ ● for one answer, ☐ ☑ for several), its description dim under it. */
function optionButton(kit: Kit, p: WebPending, qi: number, oi: number, mode: Mode, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const q = questionsOf(p)[qi]
  const option = q?.options[oi]
  if (!q || !option) return <Box flexDirection="column" />
  const pick = A.pickOf(p)
  const isOn = q.multiSelect ? (pick.checked[qi] ?? []).includes(option.label) : pick.chosen[qi] === option.label
  const mark = mode.isInstant ? '' : q.multiSelect ? (isOn ? '☑ ' : '☐ ') : isOn ? '● ' : '○ '
  const room = Math.max(12, kit.columns - 14)
  const press = () => {
    if (mode.isInstant) return actions.answer(p.id, { [q.question]: option.label })
    if (q.multiSelect) A.toggle(p, qi, option.label)
    else A.choose(p, qi, option.label)
    actions.redraw()
  }
  const label = [
    ...(mark ? [<Text color={isOn ? P.text : P.muted}>{mark}</Text>] : []),
    <Text bold={isOn} color={P.text}>
      {cut(clean(option.label), room)}
    </Text>,
  ]
  return (
    <Box key={`opt:${p.id}:${qi}:${oi}`} flexDirection="column">
      <Box flexDirection="row">
        <Button key={`answer:${p.id}:${qi}:${oi}`} variant="secondary" onPress={press}>
          {label}
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
function optionLine(kit: Kit, p: WebPending, qi: number, oi: number): RenderElement {
  const { Box, Text } = kit
  const q = questionsOf(p)[qi]
  const option = q?.options[oi]
  if (!q || !option) return <Box flexDirection="column" />
  return (
    <Box key={`opt:${p.id}:${qi}:${oi}`} flexDirection="column">
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
 * Other…: words of your own. Enter answers at once where a press would;
 * in a form it keeps them (for one answer, in place of the option chosen)
 * until Submit. Each edit is kept as it is typed, so a redraw keeps the words.
 */
function otherField(kit: Kit, p: WebPending, qi: number, mode: Mode, actions: DashActions): RenderElement | null {
  const { Input } = kit
  const q = questionsOf(p)[qi]
  if (!Input || !q) return null
  return (
    <Input
      key={`other:${p.id}:${qi}`}
      label="Other…"
      placeholder={q.options.length > 0 ? 'your own answer' : 'your answer'}
      value={A.pickOf(p).other[qi] ?? ''}
      submitLabel={mode.isInstant ? 'answer' : 'keep'}
      onInput={text => A.setOther(p, qi, text)}
      onSubmit={text => {
        const said = text.trim().slice(0, 2000)
        if (mode.isInstant) {
          if (said !== '') actions.answer(p.id, { [q.question]: said })
          return
        }
        A.setOther(p, qi, said)
        actions.redraw()
      }}
    />
  )
}

/** Under the questions: Submit and where else to answer; for a read-only question, where to answer it. */
function questionFoot(kit: Kit, p: WebPending, mode: Mode, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  if (!mode.canAnswer) return <Text color={NOTE}>Answer it in Claude Code.</Text>
  if (mode.isInstant) return <Text color={NOTE}>Or answer it in Claude Code.</Text>
  const qs = questionsOf(p)
  const pick = A.pickOf(p)
  const submit = () => {
    const answers = A.answersOf(p)
    const missing = qs.find(q => !(q.question in answers))
    if (missing) {
      A.noteOn(p, `Pick an answer for ${missing.header || cut(missing.question, 40)} first.`)
      actions.redraw()
      return
    }
    actions.answer(p.id, answers)
  }
  return (
    <Box flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>
        <Button key={`answer:${p.id}`} label={qs.length > 1 ? 'Submit answers' : 'Submit'} variant="primary" onPress={submit} />
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={pick.note ? P.waitText : NOTE} wrap="wrap">
          {pick.note || 'Or answer it in Claude Code.'}
        </Text>
      </Box>
    </Box>
  )
}

/** A permission: the whole command under the title when the title cut it, what the call says it does, and where to answer. */
function permissionBody(kit: Kit, p: WebPending): RenderElement {
  const { Box, Text, Code } = kit
  const { what } = permitOf(p)
  const line = firstLine(what)
  const isWhole = what.trim() === line && Array.from(line).length <= TITLE_CODE
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {what !== '' && !isWhole ? (
        p.command ? (
          <Code source={cut(clean(what), 2000)} language={p.tool === 'PowerShell' ? 'powershell' : 'bash'} />
        ) : (
          <Text color={P.fg2} wrap="wrap">
            {clean(what)}
          </Text>
        )
      ) : null}
      {p.description ? (
        <Text color={P.fg2} wrap="wrap">
          {clean(p.description)}
        </Text>
      ) : null}
      <Text color={NOTE}>Allow or deny it in Claude Code.</Text>
    </Box>
  )
}

/** Past the cards: one row a held call, its words, its time and "Open →"; a press on its words or on "Open →" opens its agent's page. */
function moreRows(kit: Kit, state: WebState, rest: readonly WebPending[], actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  // the words' room: less the card's rule and padding, the time, "Open →", the gaps and the button's chrome
  const room = Math.max(16, kit.columns - CARD_CHROME - 4 - 1 - openWidth(kit) - 1 - buttonSlack(kit))
  return (
    <Box key="needs:more" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Text color={P.muted}>{`Also waiting on you: ${plural(rest.length, 'more')}`}</Text>
      {rest.map(p => {
        const open = () => openAgentPage(actions, state, p.agentId)
        const words = wrapTicks(pendingText(p, nameOf(state, p.agentId)), room, 1)[0] ?? []
        return (
          <Box key={`needs:row:${p.id}`} flexDirection="row" columnGap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Button key={`needs:more:${p.id}`} plain onPress={open}>
                {tickParts(kit, words, P.fg2)}
              </Button>
            </Box>
            <Box flexShrink={0}>
              <Text color={P.muted2}>{ago(p.at, now)}</Text>
            </Box>
            <Box flexShrink={0}>{openButton(kit, `needs:more:open:${p.id}`, P.waitText, open)}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * The needs-you line the mod words, as a banner, when nothing it says is on
 * a card already: a failure (red, Open to the agent), a wait the engine
 * raised another way (amber), or everything done (green, Review changes to
 * Changes while files wait to be committed). Null while it is quiet.
 */
export function needsBanner(kit: Kit, state: WebState, actions: DashActions): RenderElement | null {
  const { Box, Text, Button } = kit
  const n = state.needs
  const isCovered = n.agentId !== undefined && state.pending.some(p => p.agentId === n.agentId)
  if (isCovered || !n.text) return null
  if (n.tone === 'done') {
    const changed = state.changes.length
    return (
      <Box key="needs:banner" flexDirection="row" columnGap={1} borderStyle="round" borderColor={mix(P.done, P.card, 0.45)} paddingX={1}>
        <Box flexShrink={0}>{icon(kit, 'circleCheck', P.doneText) ?? <Text color={P.doneText}>✓</Text>}</Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text bold color={P.text} wrap="wrap">
            {n.text}
          </Text>
          <Text color={P.muted} wrap="wrap">
            {changed > 0 ? `${plural(changed, 'file')} changed and not committed yet.` : 'Nothing left to commit.'}
          </Text>
        </Box>
        {changed > 0 ? (
          <Box flexShrink={0}>
            <Button key="needs:review" label="Review changes" plain onPress={() => actions.setTab('changes')} />
          </Box>
        ) : null}
      </Box>
    )
  }
  if (n.tone !== 'alert' && n.tone !== 'attention') return null
  const isAlert = n.tone === 'alert'
  const target = n.agentId !== undefined && agentOf(state, n.agentId) ? n.agentId : ''
  return (
    <Box key="needs:banner" flexDirection="row" columnGap={1} borderStyle="round" borderColor={isAlert ? mix(P.fail, P.card, 0.45) : EDGE} paddingX={1}>
      <Box flexShrink={0}>{icon(kit, isAlert ? 'octagon' : 'hand', isAlert ? P.failText : P.waitText) ?? <Text color={isAlert ? P.failText : P.waitText}>!</Text>}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold wrap="wrap">
          {tickTexts(kit, n.text, isAlert ? '#fee2e2' : P.waitTitle)}
        </Text>
        <Text color={isAlert ? mix(P.failText, P.card, 0.25) : NOTE} wrap="wrap">
          {isAlert ? 'Open the agent to see what went wrong, then tell Claude how to go on.' : 'Answer it in the Claude Code conversation; the agent carries on once you do.'}
        </Text>
      </Box>
      {target ? <Box flexShrink={0}>{openButton(kit, 'needs:banner:open', isAlert ? P.failText : P.waitText, () => openAgentPage(actions, state, target))}</Box> : null}
    </Box>
  )
}
