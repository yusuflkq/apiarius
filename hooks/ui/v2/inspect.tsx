/**
 * Inspect (key 5): the session's depth, as the v2 state's `inspect` holds it
 * (hooks/inspect.ts), in four sections, top to bottom:
 *
 * - Context: "82.2k of 200k · 41% · auto-compacts at 83%", what fills it as
 *   /context counts it (a bar, an image where Svg draws and block
 *   characters on the terminal, and its rows in two columns), then each
 *   compaction: whose context, the trigger, how full before and after, and
 *   the first words of the summary the loop went on from;
 * - Permissions: every decision the deck saw, newest first (the newest 20
 *   here): its mark, the agent's face and name, the tool and what it was
 *   aimed at; who decided ("Denied by auto mode", "Allowed by your rule",
 *   "You allowed it") and why, verbatim; when. The mode at the head's right;
 * - Loaded: the model with its effort, output style and permission mode;
 *   the instruction files and memory; the skills (and those the Skill tool
 *   ran); the MCP servers whose tools the context carries; the settings'
 *   hooks, and what the hooks of each event decided;
 * - Spend: the context used, the spend, the tokens and the requests, each
 *   in a tile; then a row an agent (its face and name, its model, its tokens
 *   in, out and read from the cache, its requests, tool calls and errors), a
 *   table where the pane is wide enough and two lines an agent where it is
 *   not.
 *
 * Each section folds to its head and one line (./parts `foldHead`), folded
 * until you open it (`DeckView2.openFolds`: `inspect:context`,
 * `inspect:permissions`, `inspect:loaded`, `inspect:spend`), and shows only
 * while it has something. Also here: a chat row's compaction line, the
 * divider Chat draws where a loop's context was compacted.
 *
 * Pure: Kit, the state, the view and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import type { V2Context, V2Decision, V2InspectMore, V2Loaded } from '../../inspect'
import { MAIN } from '../../model'
import type { V2AgentRow, V2ChatRow, V2Inspect, WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { isAiry, listBox, listRow } from './dash'
import { AVATAR, avatar, quiet, svgOf, type Face } from './look'
import { P } from './palette'
import { foldHead, openFoldsWith, rule, widthFor, type Fold } from './parts'
import { ago, num, plural, usd } from './text'

/** Inspect's sections' fold ids, in `DeckView2.openFolds`. */
export const INSPECT_FOLDS = { context: 'inspect:context', permissions: 'inspect:permissions', loaded: 'inspect:loaded', spend: 'inspect:spend' } as const

/** The decisions the pane lists at most, so it keeps inside the elements a desktop draws; /deck web lists the newest 100. */
export const MOST_DECISIONS = 20

/** Inspect's part of a state, its newer fields filled where a state of an earlier build lacks them. */
function moreOf(ins: V2Inspect): V2InspectMore {
  const more = ins as Partial<V2InspectMore>
  return {
    mode: more.mode ?? '',
    modeText: more.modeText ?? '',
    summary: more.summary ?? { context: '', permissions: '', loaded: '', spend: '' },
    context: more.context ?? null,
    compactions: more.compactions ?? [],
    permissions: more.permissions ?? { decisions: [], total: 0, denied: 0, blocked: 0, waiting: 0 },
    loaded: more.loaded ?? null,
  }
}

/** Inspect: its four sections, each folded to its head and one line until opened, each only while it has something. */
export function inspectTab(kit: Kit, state: WebStateV2, view2: Pick<DeckView2, 'openFolds'>, actions: DashActions): RenderElement {
  const { Box } = kit
  const ins = state.inspect
  const more = moreOf(ins)
  const open = new Set(view2.openFolds)
  const fold = (id: string, summary: string): Fold => ({ id, isOpen: open.has(id), summary, press: () => actions.setV2View({ openFolds: openFoldsWith(view2.openFolds, id) }) })
  const hasSpend = ins.agents.length > 0 || ins.costUsd !== null || ins.contextPercent !== null
  const sections = [
    more.context || more.compactions.length > 0 ? contextSection(kit, state, more, fold(INSPECT_FOLDS.context, more.summary.context), actions) : null,
    more.permissions.total > 0 ? permissionsSection(kit, state, more, fold(INSPECT_FOLDS.permissions, more.summary.permissions), actions) : null,
    more.loaded ? loadedSection(kit, state, more.loaded, fold(INSPECT_FOLDS.loaded, more.summary.loaded), actions) : null,
    hasSpend ? spendSection(kit, state, fold(INSPECT_FOLDS.spend, more.summary.spend), actions) : null,
  ].filter((one): one is RenderElement => one !== null)
  const isAnyOpen = Object.values(INSPECT_FOLDS).some(id => open.has(id))
  return (
    <Box key="inspect" flexDirection="column" gap={isAiry(kit) ? 1 : isAnyOpen ? 1 : 0}>
      {sections.length === 0 ? quiet(kit, 'Nothing to inspect yet: what fills the context, every permission decision, what is loaded and the spend show here as Claude Code reports them.') : sections}
    </Box>
  )
}

/** A section as Inspect stacks it: its head (it folds), then while open what it holds, half a line apart where the surface lays gaps out in half lines. */
function section(kit: Kit, key: string, head: RenderElement, body: readonly (RenderElement | null)[] | null): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      {head}
      {body}
    </Box>
  )
}

// The marks Inspect draws: Lucide-style 24 px strokes, as ./palette's icons.

const MARKS = {
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  hook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  shrink: '<path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"/><path d="M9 19.8V15m0 0H4.2M9 15l-6 6"/><path d="M15 4.2V9m0 0h4.8M15 9l6-6"/><path d="M9 4.2V9m0 0H4.2M9 9 3 3"/>',
} as const

type Mark = keyof typeof MARKS

/** A mark where the surface draws Svg (`alt` its words); else `text` in `color`, the terminal drawing text alone. */
function mark(kit: Kit, name: Mark, color: string, text: string, alt: string, px = 16): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (!Svg) return <Text color={color}>{text}</Text>
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MARKS[name]}</svg>`
  return <Svg source={source} alt={alt} width={px} height={px} />
}

/** A row's two lines beside its mark: the first bold, the second dim, each cut to the row. */
function twoLines(kit: Kit, top: RenderElement, bottom: RenderElement | null): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
      {top}
      {bottom}
    </Box>
  )
}

/** Words on one line, cut to its room. */
function line(kit: Kit, text: string, color: string, bold = false): RenderElement {
  const { Text } = kit
  return (
    <Text bold={bold} color={color} wrap="truncate-end">
      {text}
    </Text>
  )
}

/** Who an agent of Inspect's is, for its face: its row in `agents`, else the Orchestrator or an agent at rest. */
function faceOf(state: WebStateV2, id: string, title: string): Face {
  const row = state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === id)
  return row ?? { id, title, kind: id === MAIN ? 'orchestrator' : 'agent', status: 'idle', isStopped: false }
}

// Context.

/** The rows the bar draws: those in the window (not tool schemas loaded on demand). */
function barRows(context: V2Context): V2Context['rows'] {
  return context.rows.filter(row => row.kind !== 'deferred' && row.tokens > 0)
}

/** The bar's widths, `across` units in all, each row's share of the window (a row with tokens never vanishes), the last taking what rounding left. */
function shares(rows: V2Context['rows'], across: number): number[] {
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  if (total <= 0) return rows.map(() => 0)
  const widths = rows.map(row => Math.max(1, Math.round((row.tokens / total) * across)))
  let over = widths.reduce((sum, w) => sum + w, 0) - across
  for (let i = widths.length - 1; i >= 0 && over !== 0; i--) {
    const w = widths[i] as number
    const step = over > 0 ? Math.min(over, w - 1) : over
    widths[i] = w - step
    over -= step
  }
  return widths
}

/** The context's bar: an image of rounded runs where Svg draws, else runs of block characters (█ used, ░ free, ▒ the buffer) in their hues. */
function contextBar(kit: Kit, context: V2Context): RenderElement {
  const { Box, Text } = kit
  const Svg = svgOf(kit)
  const rows = barRows(context)
  if (Svg) {
    const px = Math.max(120, Math.min(640, Math.floor(kit.columns * 7.85) - 8))
    const widths = shares(rows, px)
    let x = 0
    const rects = rows.map((row, i) => {
      const w = widths[i] ?? 0
      const made = `<rect x="${x}" y="0" width="${Math.max(1, w - 2)}" height="12" rx="3" fill="${row.hue}"/>`
      x += w
      return made
    })
    return <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="12">${rects.join('')}</svg>`} alt={`Context: ${context.text}`} width={px} height={12} />
  }
  const cells = Math.max(10, Math.min(60, kit.columns - 2))
  const widths = shares(rows, cells)
  return (
    <Box flexDirection="row">
      <Text>
        {rows.map((row, i) => (
          <Text color={row.kind === 'free' ? P.muted3 : row.hue}>{(row.kind === 'free' ? '░' : row.kind === 'buffer' ? '▒' : '█').repeat(widths[i] ?? 0)}</Text>
        ))}
      </Text>
    </Box>
  )
}

/** The context's rows as /context lists them, in two columns where the pane is wide enough: its square in its hue, its name, its tokens. */
function legend(kit: Kit, context: V2Context): RenderElement {
  const { Box, Text } = kit
  const cols = kit.columns >= 60 ? 2 : 1
  const width = widthFor(Math.min(kit.columns, 84), cols)
  const lines = context.rows.map(row => (
    <Box key={`ctx:row:${row.name}`} flexDirection="row" columnGap={1} width={width}>
      <Box flexShrink={0}>
        <Text color={row.kind === 'free' ? P.muted3 : row.hue}>■</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {line(kit, row.kind === 'deferred' && !/deferred|on demand/i.test(row.name) ? `${row.name} (on demand)` : row.name, row.kind === 'deferred' ? P.muted2 : P.fg2)}
      </Box>
      <Box flexShrink={0}>
        <Text color={P.muted2}>{num(row.tokens)}</Text>
      </Box>
    </Box>
  ))
  const half = Math.ceil(lines.length / cols)
  return (
    <Box key="ctx:legend" flexDirection="row" columnGap={2}>
      {Array.from({ length: cols }, (_, i) => (
        <Box key={`ctx:col:${i}`} flexDirection="column">
          {lines.slice(i * half, (i + 1) * half)}
        </Box>
      ))}
    </Box>
  )
}

/** Context: its figures, the bar and its rows, then the compactions. */
function contextSection(kit: Kit, state: WebStateV2, more: V2InspectMore, fold: Fold, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const context = more.context
  const head = foldHead(kit, fold, 'Context', null, actions, fold.isOpen && context ? <Text color={P.muted2}>as /context counts it</Text> : null)
  if (!fold.isOpen) return section(kit, 'inspect:context', head, null)
  const figures = context
    ? [`${Math.round(context.percent)}%`, context.autoCompactPercent !== null ? `auto-compacts at ${context.autoCompactPercent}%` : 'auto-compact off', context.model].filter(Boolean).join(' · ')
    : ''
  return section(kit, 'inspect:context', head, [
    context ? (
      <Box key="ctx:figures" flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>
          <Text bold color={P.text}>
            {context.text}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {line(kit, `· ${figures}`, P.muted2)}
        </Box>
      </Box>
    ) : (
      quiet(kit, 'What fills the context shows once Claude Code has measured it.')
    ),
    context ? <Box key="ctx:bar">{contextBar(kit, context)}</Box> : null,
    context ? legend(kit, context) : null,
    more.compactions.length > 0 ? compactionsList(kit, state, more) : null,
  ])
}

/** The compactions, oldest first: when, whose and how, then the summary's first words. */
function compactionsList(kit: Kit, state: WebStateV2, more: V2InspectMore): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key="ctx:compactions" flexDirection="column">
      <Text bold color={P.muted}>
        Compactions
      </Text>
      {more.compactions.map((one, i) => (
        <Box key={`ctx:compaction:${i}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0} width={4}>
            <Text color={P.muted2}>{ago(one.at, state.now)}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={P.fg2}>{one.text}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {line(kit, one.skipped !== undefined ? `· ${one.skipped}` : one.summary ? `· summary: “${one.summary}”` : '', P.muted2)}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// Permissions.

/** How a decision came out, in its hue: allowed green (amber where you allowed it), refused red, waiting on you amber, deciding blue. */
function hueOf(d: V2Decision): string {
  if (d.outcome === 'denied' || d.outcome === 'blocked') return P.failText
  if (d.outcome === 'waiting' || d.by === 'you') return P.waitText
  if (d.outcome === 'deciding') return P.runText
  return P.doneText
}

/** A decision's mark: ⊘ refused, ✋ yours, ◷ open, ✓ allowed. */
function decisionMark(kit: Kit, d: V2Decision): RenderElement {
  const hue = hueOf(d)
  if (d.outcome === 'denied' || d.outcome === 'blocked') return mark(kit, 'ban', hue, '⊘', d.text)
  if (d.outcome === 'waiting' || d.outcome === 'deciding') return mark(kit, 'clock', hue, '◷', d.text)
  if (d.by === 'you') return mark(kit, 'hand', hue, '✓', d.text)
  return mark(kit, 'check', hue, '✓', d.text)
}

/** One decision: its mark; the agent's face and name, the tool, what it was aimed at; who decided and why; when. */
function decisionRow(kit: Kit, state: WebStateV2, d: V2Decision, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const isKnown = state.agents.some(one => one.row === 'agent' && one.id === d.agent)
  return listRow(kit, `perm:${d.id}`, [
    <Box flexShrink={0}>{decisionMark(kit, d)}</Box>,
    twoLines(
      kit,
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {svgOf(kit) ? <Box flexShrink={0}>{avatar(kit, faceOf(state, d.agent, d.agentName), 14)}</Box> : null}
        <Box flexShrink={0}>
          {isKnown ? (
            <Button key={`perm:open:${d.id}`} label={d.agentName} plain onPress={() => actions.openAgent(d.agent)}>
              <Text bold color={P.text}>
                {d.agentName}
              </Text>
            </Button>
          ) : (
            <Text bold color={P.text}>
              {d.agentName}
            </Text>
          )}
        </Box>
        <Box flexShrink={0}>
          <Text color={P.muted}>{d.tool}</Text>
        </Box>
        {d.target ? (
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.fg2} backgroundColor={P.chip} wrap="truncate-end">{` ${d.target} `}</Text>
          </Box>
        ) : null}
      </Box>,
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>
          <Text color={hueOf(d)}>{d.text}</Text>
        </Box>
        {d.why ? (
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {line(kit, `· ${d.why}`, P.muted2)}
          </Box>
        ) : null}
      </Box>,
    ),
    <Box flexShrink={0} width={4} justifyContent="flex-end">
      <Text color={P.muted2}>{ago(d.at, state.now)}</Text>
    </Box>,
  ])
}

/** Permissions: every decision the deck saw, newest first (the newest 20 here), the mode at the head's right. */
function permissionsSection(kit: Kit, state: WebStateV2, more: V2InspectMore, fold: Fold, actions: DashActions): RenderElement {
  const { Text } = kit
  const perms = more.permissions
  const right = more.modeText ? <Text color={P.waitText}>{more.modeText}</Text> : null
  const head = foldHead(kit, fold, 'Permissions', perms.total, actions, right)
  if (!fold.isOpen) return section(kit, 'inspect:permissions', head, null)
  const shown = perms.decisions.slice(0, MOST_DECISIONS)
  const left = perms.total - shown.length
  return section(kit, 'inspect:permissions', head, [
    listBox(
      kit,
      'perm:list',
      shown.flatMap((d, i) => [i > 0 ? rule(kit) : null, decisionRow(kit, state, d, actions)]),
    ),
    left > 0 ? quiet(kit, `${plural(left, 'older decision')}: /deck web lists the newest 100.`) : null,
  ])
}

// Loaded.

/** One thing loaded: its mark, its name and what it is, and a word at its right. */
function loadedRow(kit: Kit, key: string, icon: RenderElement, title: string, sub: string, right: string, rightHue: string = P.muted2): RenderElement {
  const { Box, Text } = kit
  return listRow(kit, key, [
    <Box flexShrink={0}>{icon}</Box>,
    twoLines(kit, line(kit, title, P.text, true), sub ? line(kit, sub, P.muted2) : null),
    right ? (
      <Box flexShrink={0}>
        <Text color={rightHue}>{right}</Text>
      </Box>
    ) : null,
  ])
}

/** A group of Loaded: its name, then its rows in a bordered list. */
function group(kit: Kit, key: string, title: string, rows: readonly RenderElement[], foot: readonly RenderElement[] = []): RenderElement | null {
  const { Box, Text } = kit
  if (rows.length === 0) return null
  return (
    <Box key={key} flexDirection="column" rowGap={0}>
      <Text bold color={P.muted}>
        {title}
      </Text>
      {listBox(
        kit,
        `${key}:list`,
        rows.flatMap((row, i) => [i > 0 ? rule(kit) : null, row]),
      )}
      {foot}
    </Box>
  )
}

/** Loaded: the model and its settings, the instruction files, memory, the skills, the MCP servers and the hooks, each group only while it has something. */
function loadedSection(kit: Kit, state: WebStateV2, loaded: V2Loaded, fold: Fold, actions: DashActions): RenderElement {
  const head = foldHead(kit, fold, 'Loaded', null, actions)
  if (!fold.isOpen) return section(kit, 'inspect:loaded', head, null)
  const dim = P.muted
  const model = loaded.model || state.header.model || loaded.modelId
  const settings = [loaded.effort ? `effort ${loaded.effort}` : '', loaded.outputStyle ? `output style ${loaded.outputStyle}` : ''].filter(Boolean).join(' · ')
  const modelRows = model || settings || loaded.mode ? [loadedRow(kit, 'loaded:model', mark(kit, 'cpu', dim, '◆', 'Model'), model || 'Model not reported yet', settings, loaded.mode, P.waitText)] : []
  const fileRows = loaded.instructions.map((file, i) =>
    loadedRow(kit, `loaded:file:${i}`, mark(kit, 'file', dim, '▤', 'Instruction file'), file.name, [file.kindText, file.lines !== null ? plural(file.lines, 'line') : '', file.tokens !== null ? `${num(file.tokens)} tokens` : ''].filter(Boolean).join(' · '), file.how),
  )
  const memoryTokens = loaded.memory.reduce((sum, one) => sum + (one.tokens ?? 0), 0)
  const memoryRows =
    loaded.memory.length > 0
      ? [loadedRow(kit, 'loaded:memory', mark(kit, 'bookmark', dim, '▤', 'Memory'), `Memory · ${plural(loaded.memory.length, 'file')}`, loaded.memory.map(one => one.name).join(' · '), memoryTokens > 0 ? `${num(memoryTokens)} tokens` : '')]
      : []
  const skills = loaded.skills
  const skillRows =
    skills.total !== null || skills.used.length > 0
      ? [
          loadedRow(
            kit,
            'loaded:skills',
            mark(kit, 'sparkles', dim, '✦', 'Skills'),
            skills.total !== null ? plural(skills.total, 'skill') : 'Skills',
            skills.used.length > 0 ? `used this session: ${skills.used.map(one => (one.count > 1 ? `${one.name} ×${one.count}` : one.name)).join(', ')}` : 'none used this session',
            skills.used.length > 0 ? `${skills.used.length} used` : '',
          ),
        ]
      : []
  const mcpRows = loaded.mcp.map(server =>
    loadedRow(
      kit,
      `loaded:mcp:${server.server}`,
      mark(kit, 'plug', dim, '⏚', 'MCP server'),
      server.server,
      [plural(server.tools, 'tool'), server.deferred > 0 ? `${server.deferred} loaded on demand` : '', server.calls > 0 ? `used ${plural(server.calls, 'time')}` : ''].filter(Boolean).join(' · '),
      '',
    ),
  )
  const hookRows = loaded.hooks.map((hook, i) => loadedRow(kit, `loaded:hook:${i}`, mark(kit, 'hook', dim, '↪', 'Hook'), [hook.event, hook.matcher].filter(Boolean).join(' · '), hook.command, hook.sourceText))
  const hookFoot = loaded.hookEvents.map(one => quiet(kit, `${one.event} hooks decided ${plural(one.decided, 'call')}${one.blocked > 0 ? `, blocked ${one.blocked}` : ''}`))
  return section(kit, 'inspect:loaded', head, [
    group(kit, 'loaded:g:model', 'Model', modelRows),
    group(kit, 'loaded:g:instructions', 'Instructions', fileRows),
    group(kit, 'loaded:g:memory', 'Memory', memoryRows),
    group(kit, 'loaded:g:skills', 'Skills', skillRows),
    group(kit, 'loaded:g:mcp', 'MCP servers', mcpRows),
    group(kit, 'loaded:g:hooks', 'Hooks', hookRows, hookFoot),
  ])
}

// Spend: the tokens and requests of each agent, as Settings' Inspect drew them before.

type InspectAgent = V2Inspect['agents'][number]

/** The agents Spend lists at most, so the pane keeps inside the elements a desktop draws; the rest counted under them. */
export const MOST_AGENTS = 20

/** The figures over the table: what each says, and its value as `inspect` gives it ("—" while Claude Code has not reported it). */
function figuresOf(inspect: V2Inspect): { key: string; value: string; label: string }[] {
  const sum = (of: (agent: InspectAgent) => number) => inspect.agents.reduce((total, agent) => total + of(agent), 0)
  return [
    { key: 'context', value: inspect.contextPercent !== null ? `${Math.round(inspect.contextPercent)}%` : '—', label: 'Context used' },
    { key: 'spend', value: usd(inspect.costUsd), label: 'Spent' },
    { key: 'tokens', value: num(sum(agent => agent.tokens.in + agent.tokens.out + agent.tokens.cacheRead)), label: 'Tokens' },
    { key: 'requests', value: num(sum(agent => agent.requests)), label: 'Requests' },
  ]
}

/** The table's number columns: each one's head, its cells across, and its value for an agent. */
type Column = { head: string; width: number; of: (agent: InspectAgent) => string }
const COLUMNS: readonly Column[] = [
  { head: 'In', width: 6, of: agent => num(agent.tokens.in) },
  { head: 'Out', width: 6, of: agent => num(agent.tokens.out) },
  { head: 'Cache', width: 6, of: agent => num(agent.tokens.cacheRead) },
  { head: 'Requests', width: 8, of: agent => num(agent.requests) },
  { head: 'Tools', width: 5, of: agent => num(agent.tools) },
]
const ERRORS: Column = { head: 'Errors', width: 6, of: agent => num(agent.errors) }
/** The model's column, and the least a name keeps beside the columns: under it the pane draws two lines an agent. */
const MODEL = 11
const NAME_LEAST = 14
/** The most cells Spend spans: wider, its numbers would stand far from the names they belong to. */
const SPEND_MOST = 110

/** Spend: the figures in tiles, then the agents (a table, or two lines an agent where the pane is narrow), SPEND_MOST cells across at most. */
function spendSection(kit: Kit, state: WebStateV2, fold: Fold, actions: DashActions): RenderElement {
  const { Box } = kit
  const head = foldHead(kit, fold, 'Spend', null, actions)
  if (!fold.isOpen) return section(kit, 'inspect:spend', head, null)
  const { inspect } = state
  const across = Math.min(kit.columns, SPEND_MOST)
  const agents = inspect.agents.slice(0, MOST_AGENTS)
  const columns = inspect.agents.some(agent => agent.errors > 0) ? [...COLUMNS, ERRORS] : COLUMNS
  const fixed = 2 + faceCells(kit) + 1 + MODEL + columns.reduce((sum, column) => sum + 1 + column.width, 0) + 1
  const isTable = across - fixed >= NAME_LEAST
  const rows = agents.map(agent => (isTable ? tableRow(kit, state, agent, columns, actions) : stackedRow(kit, state, agent, actions)))
  const more = inspect.agents.length - agents.length
  return section(kit, 'inspect:spend', head, [
    tiles(kit, figuresOf(inspect), across),
    inspect.contextPercent === null && inspect.costUsd === null ? quiet(kit, 'The context and the spend show once Claude Code reports them.') : null,
    agents.length === 0 ? (
      quiet(kit, 'No agent has made a request yet: each agent’s tokens, requests and tool calls show here.')
    ) : (
      <Box key="inspect:table" flexDirection="column" width={across}>
        {listBox(kit, 'inspect:agents', [isTable ? tableHead(kit, columns) : null, ...rows.flatMap((row, i) => [i > 0 || isTable ? rule(kit) : null, row])])}
      </Box>
    ),
    more > 0 ? quiet(kit, `${plural(more, 'more agent')}: more than Inspect lists. /deck web lists them all.`) : null,
  ])
}

/** The figures, each in a bordered tile, across `across` cells: all four in a row where that is wide enough, else two. */
function tiles(kit: Kit, figures: readonly { key: string; value: string; label: string }[], across: number): RenderElement {
  const { Box, Text } = kit
  const perRow = across >= 60 ? figures.length : 2
  const width = widthFor(across, perRow)
  return (
    <Box key="inspect:tiles" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      {figures.map(figure => (
        <Box key={`inspect:tile:${figure.key}`} flexDirection="column" width={width} borderStyle="round" borderColor={P.border} paddingX={1}>
          <Text bold color={P.text} wrap="truncate-end">
            {figure.value}
          </Text>
          <Text color={P.muted} wrap="truncate-end">
            {figure.label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** The cells an agent's face takes in a row: its image's where Svg draws, its glyph on the terminal. */
function faceCells(kit: Kit): number {
  return svgOf(kit) ? Math.ceil(AVATAR.list / 7.85) : 1
}

/** Its face and its name, a plain Button that opens its page when the state holds it. */
function who(kit: Kit, state: WebStateV2, agent: InspectAgent, actions: DashActions): RenderElement[] {
  const { Box, Button, Text } = kit
  const isKnown = state.agents.some(one => one.row === 'agent' && one.id === agent.id)
  return [
    <Box flexShrink={0}>{avatar(kit, faceOf(state, agent.id, agent.title), AVATAR.list)}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0}>
      {isKnown ? (
        <Button key={`inspect:open:${agent.id}`} label={agent.title} plain onPress={() => actions.openAgent(agent.id)}>
          <Text bold color={P.text}>
            {agent.title}
          </Text>
        </Button>
      ) : (
        <Text bold color={P.text} wrap="truncate-end">
          {agent.title}
        </Text>
      )}
    </Box>,
  ]
}

/** A cell of the table, right-aligned in its width. */
function cell(kit: Kit, text: string, width: number, color: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexShrink={0} width={width} justifyContent="flex-end">
      <Text color={color} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

/** The table's head row: the columns' names, dim. */
function tableHead(kit: Kit, columns: readonly Column[]): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key="inspect:head" flexDirection="row" columnGap={1} paddingX={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2}>Agent</Text>
      </Box>
      <Box flexShrink={0} width={MODEL}>
        <Text color={P.muted2}>Model</Text>
      </Box>
      {columns.map(column => cell(kit, column.head, column.width, P.muted2))}
    </Box>
  )
}

/** An agent as a row of the table. */
function tableRow(kit: Kit, state: WebStateV2, agent: InspectAgent, columns: readonly Column[], actions: DashActions): RenderElement {
  const { Box, Text } = kit
  return listRow(kit, `inspect:${agent.id}`, [
    ...who(kit, state, agent, actions),
    <Box flexShrink={0} width={MODEL}>
      <Text color={P.muted} wrap="truncate-end">
        {agent.model || '—'}
      </Text>
    </Box>,
    ...columns.map(column => cell(kit, column.of(agent), column.width, column === ERRORS && agent.errors > 0 ? P.failText : P.fg2)),
  ])
}

/** An agent in two lines, where the pane is too narrow for the table: its face, name and model, then its figures. */
function stackedRow(kit: Kit, state: WebStateV2, agent: InspectAgent, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const figures = [`${num(agent.tokens.in)} in`, `${num(agent.tokens.out)} out`, `${num(agent.tokens.cacheRead)} cache`, plural(agent.requests, 'request'), plural(agent.tools, 'tool')].join(' · ')
  return (
    <Box key={`inspect:${agent.id}`} flexDirection="column" paddingX={1} paddingY={isAiry(kit) ? 1 : 0}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {who(kit, state, agent, actions)}
        <Box flexShrink={0}>
          <Text color={P.muted}>{agent.model || '—'}</Text>
        </Box>
      </Box>
      <Text color={P.muted2} wrap="wrap">
        {figures}
        {agent.errors > 0 ? <Text color={P.failText}>{` · ${plural(agent.errors, 'error')}`}</Text> : null}
      </Text>
    </Box>
  )
}

// Chat's compaction line.

/**
 * A compaction in Chat: a divider across the conversation, "Context
 * compacted" (the Orchestrator's) or "researcher’s context compacted", its
 * figures and when; where Svg draws, between two rules with its mark,
 * on the terminal between dashes. After it the loop works from the summary.
 */
export function compactionLine(kit: Kit, state: WebStateV2, row: V2ChatRow, key: string): RenderElement {
  const { Box, Text } = kit
  const facts = row.compaction
  const title = facts?.title ?? 'Context compacted'
  const figures = [facts?.figures ?? '', ago(row.at, state.now)].filter(Boolean).join(' · ')
  if (!svgOf(kit)) {
    return (
      <Box key={key} flexDirection="row" justifyContent="center">
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color={P.muted3}>{'── '}</Text>
            <Text bold color={P.fg2}>
              {title}
            </Text>
            <Text color={P.muted2}>{figures ? ` · ${figures}` : ''}</Text>
            <Text color={P.muted3}>{' ──'}</Text>
          </Text>
        </Box>
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexGrow={1} flexShrink={1} minWidth={2}>
        {rule(kit)}
      </Box>
      <Box flexShrink={0}>{mark(kit, 'shrink', P.muted, '⇲', 'Compacted', 14)}</Box>
      <Box flexShrink={0}>
        <Text bold color={P.fg2}>
          {title}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        {line(kit, figures, P.muted2)}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={2}>
        {rule(kit)}
      </Box>
    </Box>
  )
}
