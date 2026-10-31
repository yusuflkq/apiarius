/* Apiarius's web page: Settings (#/settings, tab 6), the avatar style and Help. */
import * as AV from './avatars.mjs';
import { h, icon } from './basics.mjs';
import { hrefOf, TABS } from './state.mjs';
import { Avatar, pickStyle, Section, styleNow } from './parts.mjs';
import { WELCOME } from './app.js';

// =================================================================== settings
// The deck's own: the avatar style, and Help (what each tab is for, and the
// keys). Each section folds by its head, as the Dashboard's do; `h` brings
// Help into view.

export function SettingsPage() {
  return h('div', { key: 'settings', class: 'page page-settings' },
    AvatarSection(),
    HelpSection());
}

/** The avatar style: every style the library draws, each a preview of three agents (done, at work, waiting on you) and its name; the one drawn checked. */
function AvatarSection() {
  const now = styleNow();
  return Section('avatars', 'Avatar style', null, null, () => h('div', { class: 'avatars' },
    h('p', { class: 'sec-text' }, 'How the agents look here, in the Desktop pane and in /apiarius demo, in every session. /apiarius avatars <style> picks one too.'),
    h('div', { class: 'styles', role: 'radiogroup', 'aria-label': 'Avatar style' },
      AV.STYLES.map(s => h('button', {
        key: s.id, type: 'button', role: 'radio', class: `style-pick${s.id === now ? ' on' : ''}`, 'aria-checked': s.id === now ? 'true' : 'false',
        title: `Draw the agents as ${s.name}`, onClick: () => pickStyle(s.id),
      },
      h('span', { class: 'style-faces', 'aria-hidden': 'true' }, WELCOME.map(a => h('span', { key: a.id }, Avatar(a, 30, { dot: true, style: s.id })))),
      h('span', { class: 'style-name' }, s.name),
      s.id === now && icon('check', 'style-check'))))));
}

/** What each tab is for, in its order. */
const TAB_HELP = [
  ['now', 'What needs you, a card per agent, the session\'s figures, the plan Claude made, the newest tool calls and the files the agents touched.'],
  ['chat', 'The session as a group chat. Pick Everyone or one agent at the top: your words go to the one picked (Everyone: the Orchestrator), or @name another.'],
  ['org', 'Every agent under the one that started it, as a chart (drag to pan, pinch or + and − to zoom) or as a list; or the Timeline, a row an agent beside its lane over the run: its calls, waits on you and idle time, the stretches where nobody worked folded (hover to read one, press a lane to open it).'],
  ['changes', 'Git\'s uncommitted files, each with git\'s own diff and the agents\' own edits of it; their other edits; the commits; and Review.'],
  ['inspect', 'What fills the context and each compaction, every permission decision and who made it, what is loaded (model, CLAUDE.md, memory, skills, MCP servers, hooks), and the spend per agent.'],
  ['settings', 'This page: how the agents look, and these notes.'],
];

const KEYS = [
  ['1 2 3 4 5 6', 'Dashboard · Chat · Org · Changes · Inspect · Settings'],
  ['j  k', 'Move the focus down, up'],
  ['Enter', 'Open the focused row: an agent, a fold, a need, a file'],
  ['b', 'Back: close the agent'],
  ['s', 'All sessions: every session on this machine, ↑ ↓ to pick one, Enter to show its deck; s again goes back'],
  ['n', 'The next thing that needs you'],
  ['m', 'Message: the composer (in an agent\'s drawer, that agent)'],
  ['i', 'Inspect (again: back)'],
  ['h  ?', 'Help, here in Settings'],
  ['/', 'The composer'],
  ['@', 'The composer, with @ typed'],
  ['Esc', 'Close the drawer'],
];

function HelpSection() {
  return Section('help', 'Help', null, null, () => h('div', { class: 'help' },
    h('dl', { key: 'tabs', class: 'card list help-tabs' }, TAB_HELP.map(([id, what]) => h('div', { key: id, class: 'help-tab' },
      h('dt', null, h('a', { class: 'help-tab-name', href: hrefOf(id, null) }, TABS.find(t => t[0] === id)[1])),
      h('dd', null, what)))),
    h('div', { key: 'keys', class: 'card help-keys' },
      h('p', { class: 'ins-caption' }, 'Keys'),
      h('p', { class: 'sec-text' }, '1 to 6, Enter and b work in the Desktop pane and the terminal too; the rest are this page\'s own. None fires while you type.'),
      h('dl', { class: 'keys' }, KEYS.map(([k, what]) => [h('dt', { key: `k:${k}` }, k.split(/\s+/).map((one, i) => h('kbd', { key: i }, one))), h('dd', { key: `d:${k}` }, what)])))));
}
