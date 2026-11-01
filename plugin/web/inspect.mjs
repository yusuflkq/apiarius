/* Apiarius's web page: Inspect (#/inspect, tab 5), the session's depth. */
import { clamp, h, icon, num, plural, total, usd } from './basics.mjs';
import { ageOf, isOpen, S, shut, toggle } from './state.mjs';
import { Empty, NameLink, Section } from './parts.mjs';
import { timeTitle } from './chat.mjs';

// ==================================================================== inspect
// The session's depth (#/inspect, tab 5), as the state's `inspect` holds it:
// what fills the context and each compaction, every permission decision and
// who made it, what is loaded, and the spend. Each section folds by its head
// to one line, as the pane's do, and shows only while it has something; `i`
// opens Inspect (again: back to the tab you came from).

export function InspectPage() {
  const ins = S.inspect;
  const hasSpend = ins.agents.length > 0 || ins.costUsd != null || ins.contextPercent != null;
  const parts = [
    (ins.context || ins.compactions.length > 0) && ContextSection(),
    ins.permissions.total > 0 && PermissionsSection(),
    ins.loaded && LoadedSection(),
    hasSpend && InspectSection(),
  ];
  return h('div', { key: 'inspect', class: 'page page-inspect' },
    parts.some(Boolean) ? parts : h('div', { class: 'card' }, Empty('gauge', 'Nothing to inspect yet', 'What fills the context, every permission decision, what is loaded and the spend show here as Claude Code reports them.')));
}

/** A section of Inspect: folded, its head and its one line (`summary`); open, `right` at its head's right. */
function InsSection(id, title, count, summary, right, body) {
  const isShut = shut.has(id);
  return Section(id, title, count, isShut ? (summary ? h('span', { class: 'sec-summary', title: summary }, summary) : null) : right, body);
}

/** Context: its size of the window and its share, its rows as /context counts them (a bar, then each row), then the compactions. */
function ContextSection() {
  const ins = S.inspect, c = ins.context;
  return InsSection('ins-context', 'Context', null, ins.summary.context, c && h('span', { class: 'sec-note' }, 'as /context counts it'), () => h('div', { class: 'ins' },
    c ? h('div', { key: 'ctx', class: 'card ctx-card' },
      h('p', { class: 'ctx-figs' },
        h('strong', { class: 'ctx-size' }, c.text),
        h('span', { class: 'ctx-more' }, [`${Math.round(c.percent)}%`, c.autoCompactPercent != null ? `auto-compacts at ${c.autoCompactPercent}%` : 'auto-compact off', c.model].filter(Boolean).join(' · '))),
      ContextBar(c),
      h('div', { class: 'ctx-legend' }, c.rows.map(r => h('div', { key: r.name, class: `ctx-row is-${r.kind}` },
        h('span', { class: 'ctx-sw', style: { background: r.kind === 'free' ? 'transparent' : r.hue } }),
        h('span', { class: 'ctx-name' }, r.kind === 'deferred' && !/deferred|on demand/i.test(r.name) ? `${r.name} (on demand)` : r.name),
        h('span', { class: 'ctx-n' }, num(r.tokens))))))
    : h('div', { key: 'ctx', class: 'card' }, Empty('gauge', 'Not measured yet', 'What fills the context shows once Claude Code has measured it.')),
    ins.compactions.length > 0 && h('div', { key: 'cmp', class: 'ins-by' },
      h('p', { class: 'ins-caption' }, 'Compactions'),
      h('div', { class: 'card list cmps' }, ins.compactions.map(CompactionRow)))));
}

/** The context's bar: each row its share of the window, in its hue (the free space a dark track, the buffer dim); schemas loaded on demand are outside it. */
function ContextBar(c) {
  const rows = c.rows.filter(r => r.kind !== 'deferred' && r.tokens > 0);
  return h('div', { class: 'ctx-bar', role: 'img', 'aria-label': `Context: ${c.text}` },
    rows.map(r => h('span', { key: r.name, class: `ctx-seg is-${r.kind}`, title: `${r.name}: ${num(r.tokens)}`, style: { flex: `${r.tokens} 1 0px`, background: r.kind === 'free' ? '' : r.hue } })));
}

/** One compaction: when, whose (a press opens it), the trigger and how full before and after; the summary's first words, or why it was refused. */
function CompactionRow(x) {
  return h('div', { key: x.id || `${x.at}|${x.agent}`, class: 'cmp-row' },
    h('span', { class: 'cmp-when', title: timeTitle(x.at) }, ageOf(x.at)),
    h('span', { class: 'cmp-who' }, NameLink(x.agent, 16)),
    h('span', { class: 'cmp-how' }, [x.trigger, x.skipped != null ? 'not compacted' : x.figures].filter(Boolean).join(' · ')),
    h('span', { class: 'cmp-said', title: x.skipped != null ? x.skipped : x.summary }, x.skipped != null ? x.skipped : x.summary ? `“${x.summary}”` : ''));
}

/** The decisions Permissions lists until you ask for all of them (the state keeps the newest 100). */
const PERMS_SHOWN = 25;
/** A decision's hue: refused red, yours or waiting on you amber, being decided blue, allowed green. */
const permHue = d => (d.outcome === 'denied' || d.outcome === 'blocked' ? 'fail' : d.outcome === 'waiting' || d.by === 'you' ? 'wait' : d.outcome === 'deciding' ? 'run' : 'done');
/** A decision's mark: ⊘ refused, a clock while open, a hand where you allowed it, else a tick. */
const permIcon = d => (d.outcome === 'denied' || d.outcome === 'blocked' ? 'ban' : d.outcome === 'waiting' || d.outcome === 'deciding' ? 'clock' : d.by === 'you' ? 'hand' : 'check');

/** Permissions: every decision the deck saw, newest first: who, the tool and what it was aimed at; who decided and why, verbatim; when. The mode at the head's right. */
function PermissionsSection() {
  const ins = S.inspect, p = ins.permissions;
  const all = isOpen('perms|all', false);
  const list = all ? p.decisions : p.decisions.slice(0, PERMS_SHOWN);
  const mode = ins.modeText && h('span', { class: `mode-chip${ins.mode === 'bypassPermissions' ? ' is-fail' : ''}`, title: 'The permission mode, as Claude Code names it' }, ins.modeText);
  return InsSection('ins-permissions', 'Permissions', p.total, ins.summary.permissions, mode, () => h('div', { class: 'ins-by' },
    h('div', { class: 'card list perms' }, list.map(PermRow)),
    p.total > PERMS_SHOWN && h('button', { type: 'button', class: 'more more-start', 'aria-expanded': all ? 'true' : 'false', onClick: () => toggle('perms|all') }, all ? `Show the newest ${PERMS_SHOWN}` : `Show all ${p.total}`, icon('chevronDown', all ? 'flip' : ''))));
}

function PermRow(d) {
  const hue = permHue(d);
  return h('div', { key: d.id, class: `perm-row is-${d.outcome}`, 'data-nav': 'perm', tabindex: '-1' },
    h('span', { class: `perm-mark tx-${hue}` }, icon(permIcon(d))),
    h('span', { class: 'perm-main' },
      h('span', { class: 'perm-top' },
        NameLink(d.agent, 16),
        h('span', { class: 'perm-tool' }, d.tool),
        d.target && h('code', { class: 'code perm-target', title: d.target }, d.target)),
      h('span', { class: 'perm-say' },
        h('span', { class: `perm-verdict tx-${hue}` }, d.text),
        d.why && h('span', { class: 'perm-why', title: d.why }, d.why))),
    h('span', { class: 'perm-time', title: timeTitle(d.at) }, ageOf(d.at)));
}

/** Loaded: the model and its settings, the instruction files, memory, the skills, the MCP servers and the hooks, each group only while it has something. */
function LoadedSection() {
  const ins = S.inspect, l = ins.loaded;
  const model = l.model || S.header.model || l.modelId;
  const settings = [l.effort && `effort ${l.effort}`, l.outputStyle && `output style ${l.outputStyle}`].filter(Boolean).join(' · ');
  const memTokens = total(l.memory, f => f.tokens);
  const groups = [
    (model || settings || l.mode) && LoadedGroup('model', 'Model', [LoadedRow('model', 'cpu', model || 'Model not reported yet', settings, l.mode && h('span', { class: 'mode-chip' }, l.mode), l.modelId)]),
    l.instructions.length > 0 && LoadedGroup('instructions', 'Instructions', l.instructions.map((f, i) => LoadedRow(`file:${i}`, 'file', f.name, [f.kindText, f.lines != null && plural(f.lines, 'line'), f.tokens != null && `${num(f.tokens)} tokens`].filter(Boolean).join(' · '), f.how, f.path))),
    l.memory.length > 0 && LoadedGroup('memory', 'Memory', [LoadedRow('memory', 'bookmark', `Memory · ${plural(l.memory.length, 'file')}`, l.memory.map(f => f.name).join(' · '), memTokens ? `${num(memTokens)} tokens` : '', l.memory.map(f => f.path).join('\n'))]),
    (l.skills.total != null || l.skills.used.length > 0) && LoadedGroup('skills', 'Skills', [SkillsRow(l.skills)]),
    l.mcp.length > 0 && LoadedGroup('mcp', 'MCP servers', l.mcp.map(s => LoadedRow(`mcp:${s.server}`, 'plug', s.server, [plural(s.tools, 'tool'), s.deferred > 0 && `${s.deferred} loaded on demand`, s.calls > 0 && `used ${plural(s.calls, 'time')}`].filter(Boolean).join(' · '), ''))),
    l.hooks.length > 0 && LoadedGroup('hooks', 'Hooks', l.hooks.map((k, i) => LoadedRow(`hook:${i}`, 'hook', [k.event, k.matcher].filter(Boolean).join(' · '), k.command, k.sourceText)),
      l.hookEvents.map(e => h('p', { key: e.event, class: 'ld-note' }, `${e.event} hooks decided ${plural(e.decided, 'call')}${e.blocked ? `, blocked ${e.blocked}` : ''}`))),
  ];
  return InsSection('ins-loaded', 'Loaded', null, ins.summary.loaded, null, () => h('div', { class: 'ld' }, groups));
}

function LoadedGroup(key, title, rows, foot) {
  return h('div', { key, class: 'ld-group' }, h('p', { class: 'ins-caption' }, title), h('div', { class: 'card list' }, rows), foot && foot.length ? foot : null);
}

/** One thing loaded: its icon, its name and what it is, and a word at its right (`hover` the whole of it on hover). */
function LoadedRow(key, ic, title, sub, right, hover) {
  return h('div', { key, class: 'ld-row' },
    h('span', { class: 'ld-ic' }, icon(ic)),
    h('span', { class: 'ld-main' },
      h('span', { class: 'ld-title', title: hover || title }, title),
      sub && h('span', { class: 'ld-sub', title: sub }, sub)),
    right ? h('span', { class: 'ld-right' }, right) : null);
}

/** The skills: how many the context lists, those the Skill tool ran (most used first), and every name on demand. */
function SkillsRow(sk) {
  const open = isOpen('skills|names', false);
  return h('div', { key: 'skills', class: 'ld-row ld-skills' },
    h('span', { class: 'ld-ic' }, icon('sparkles')),
    h('span', { class: 'ld-main' },
      h('span', { class: 'ld-title' }, sk.total != null ? plural(sk.total, 'skill') : 'Skills'),
      h('span', { class: 'ld-sub' }, sk.used.length ? `used this session: ${sk.used.map(u => (u.count > 1 ? `${u.name} ×${u.count}` : u.name)).join(', ')}` : 'none used this session'),
      open && h('span', { class: 'ld-names' }, sk.names.join(' · '))),
    sk.names.length > 0 && h('button', { type: 'button', class: 'btn btn-xs', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle('skills|names') }, open ? 'Hide names' : 'Every name'));
}

function InspectStat(label, value, extra) {
  return h('div', { key: label, class: 'ins-stat' }, h('p', { class: 'ins-label' }, label), h('p', { class: 'ins-value' }, value), extra || null);
}

/** What the spend is, said once under the figures, as the pane says it: /cost's estimate at API list prices, the runs it drops, and a fork's parent counted in. */
function spendNote() {
  const fork = S.session.isFork ? ' As a fork, it includes its parent session’s.' : '';
  return `Claude Code’s /cost estimate at API list prices, not a bill on a subscription; it drops earlier runs that didn’t close normally (a crash, a kill or a shutdown).${fork}`;
}

/** Spend: the context, the spend and the tokens, then what the spend is, then each agent's tokens, requests, tool calls and failures. */
function InspectSection() {
  const ins = S.inspect;
  const sum = total(ins.agents, a => a.tokens.in + a.tokens.out + a.tokens.cacheRead);
  const pct = ins.contextPercent;
  const COLS = [['Agent', ''], ['Model', ''], ['In', 'Input tokens'], ['Out', 'Output tokens'], ['Cache', 'Cache reads'], ['Total', 'In, out and cache reads'], ['Req', 'Model requests'], ['Tools', 'Tool calls'], ['Err', 'Tool calls that failed']];
  return InsSection('ins-spend', 'Spend', null, ins.summary.spend, h('span', { class: 'sec-note' }, 'This session'), () => h('div', { class: 'ins' },
    h('div', { key: 'stats', class: 'ins-stats' },
      InspectStat('Context', pct == null ? '—' : `${Math.round(pct)}%`,
        pct != null && h('span', { class: 'bar' }, h('span', { class: `bar-fill${pct >= 80 ? ' hot' : ''}`, style: { width: `${clamp(pct, 0, 100)}%` } }))),
      InspectStat('At API prices', usd(ins.costUsd)),
      InspectStat('Tokens', num(sum)),
      InspectStat('Agents', String(ins.agents.length))),
    ins.costUsd != null && h('p', { key: 'note', class: 'ins-note' }, spendNote()),
    h('div', { key: 'by', class: 'ins-by' },
      h('p', { class: 'ins-caption' }, 'Tokens by agent'),
      ins.agents.length
        ? h('div', { class: 'ins-table', role: 'table', 'aria-label': 'Tokens by agent' },
          h('div', { class: 'ins-row ins-th', role: 'row' }, COLS.map(([t, title]) => h('span', { key: t, role: 'columnheader', title: title || null }, t))),
          ins.agents.map(r => h('div', { key: r.id, class: 'ins-row', role: 'row' },
            h('span', { class: 'ins-who' }, NameLink(r.id, 18)),
            h('span', { class: 'mono ins-model' }, r.model || '—'),
            h('span', { class: 'mono' }, num(r.tokens.in)),
            h('span', { class: 'mono' }, num(r.tokens.out)),
            h('span', { class: 'mono' }, num(r.tokens.cacheRead)),
            h('span', { class: 'mono ins-total' }, num(r.tokens.in + r.tokens.out + r.tokens.cacheRead)),
            h('span', { class: 'mono' }, String(r.requests)),
            h('span', { class: 'mono' }, String(r.tools)),
            h('span', { class: `mono${r.errors ? ' err' : ' muted'}` }, String(r.errors)))))
        : h('div', { class: 'card' }, Empty('gauge', 'No agent has spent tokens yet', 'Each agent\'s tokens, requests and tool calls show here as it works.')))));
}
