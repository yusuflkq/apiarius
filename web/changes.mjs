/* Apiarius's web page: Changes (#/changes, tab 4), git's uncommitted files and the agents' edits. */
import { h, icon, plural, total } from './basics.mjs';
import { ageOf, command, deafWhy, isOpen, IX, newCmdId, S, sendState, StatusNote, toggle, ui } from './state.mjs';
import {
  AvatarStack, DiffStat, EditBlock, Empty, FileGroup, NameLink, OutsideRows, PatchView, PathText, Section, stop
} from './parts.mjs';
import { isPressing, PressNote, sendPress } from './now.mjs';
import { invalidate, renderNow } from './app.js';

// ==================================================================== changes
// Git's uncommitted files, each opening on git's own diff of it and, beside
// it, the agents' own edits of it (git's hunks are never tagged by agent:
// nothing maps them); the agents' other edits; the commits; and Review, which
// asks Claude after a confirm.

const CODE = { M: ['M', 'wait', 'Modified'], A: ['A', 'done', 'Added'], N: ['N', 'done', 'New'], D: ['D', 'fail', 'Deleted'], R: ['R', 'run', 'Renamed'], C: ['C', 'run', 'Copied'], U: ['U', 'fail', 'Conflict'], '?': ['?', 'idle', 'Untracked'], '??': ['?', 'idle', 'Untracked'] };

function CodeBadge(code) {
  const [ch, hue, label] = CODE[(code || '').trim()] || CODE[(code || '').trim()[0]] || [String(code || '?').slice(0, 1), 'idle', code || 'Changed'];
  return h('span', { class: `code-badge hue-${hue}`, title: label }, ch);
}

/**
 * Asks Claude for a review, after a confirm: in the Desktop app the mod
 * queues the prompt for when Claude is free; where a prompt box exists it
 * fills it. The ack says which, under the button, for a few seconds.
 */
function ReviewButton(scope, text, label = 'Ask for review') {
  const st = ui.review.get(scope);
  const confirming = st && st.status === 'confirm';
  const close = () => { ui.review.delete(scope); renderNow(); };
  const go = async () => {
    const id = newCmdId('r');
    const sent = { status: 'sent', state: 'sending', id, at: Date.now() };
    ui.review.set(scope, sent);
    renderNow();
    try { await command({ cmd: 'review', id, text }); sent.state = 'sent'; }
    catch (e) { Object.assign(sent, { state: 'error', error: e.message }); }
    renderNow();
    // the note stays until a while after its ack (or the wait for one) ends
    const tidy = () => {
      if (ui.review.get(scope) !== sent) return;
      const now = sendState(sent, 'review');
      if (now.busy) { setTimeout(tidy, 1000); return; }
      if (!sent.settled) { sent.settled = Date.now(); invalidate(); }
      if (Date.now() - sent.settled >= 8000) { ui.review.delete(scope); invalidate(); } else setTimeout(tidy, 1000);
    };
    setTimeout(tidy, 1000);
  };
  const note = st && st.status === 'sent' ? sendState(st, 'review') : null;
  // the confirm, then in its place what came of it: a box under the button, so nothing around it moves
  return h('span', { class: 'review' },
    h('button', {
      class: 'btn btn-sm', type: 'button', 'aria-expanded': confirming ? 'true' : 'false', 'aria-haspopup': 'dialog',
      disabled: !!(note && note.busy), onClick: () => (confirming ? close() : (ui.review.set(scope, { status: 'confirm' }), renderNow())),
    }, icon('eye'), label),
    confirming
      ? h('div', { key: 'ask', class: 'confirm', role: 'dialog', 'aria-label': 'Ask Claude for a review', onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); stop(e); close(); } } },
        h('p', { class: 'confirm-text' }, 'Ask Claude to review these changes? It runs when Claude is free.'),
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn btn-xs', type: 'button', onClick: close }, 'Cancel'),
          h('button', { class: 'btn btn-xs btn-primary', type: 'button', ref: el => requestAnimationFrame(() => el.focus()), onClick: go }, 'Ask Claude')))
      : note ? h('div', { key: 'note', class: 'confirm confirm-note' }, StatusNote(note, 'review-note')) : null);
}

/** An untracked file: git status's '??', which the mod writes 'N'. */
const isUntracked = code => ['N', '?', '??'].includes(String(code || '').trim());

/** Git's own diff of one uncommitted file (/gitdiff/<diffId>), fetched again when its id moves; or why there is none. */
function GitDiff(f) {
  return h('div', { key: 'git', class: 'chg-part' },
    h('p', { class: 'chg-label' }, icon('branch'), h('span', null, 'Git\'s diff'), h('span', { class: 'chg-note' }, isUntracked(f.code) ? 'untracked: its whole text' : 'against HEAD')),
    f.diffId
      ? PatchView(f.diffId, 'git', 'gitdiff')
      : h('p', { class: 'chg-none' }, 'Git\'s diff of this file is not here: not read yet, a binary file, or too long to show.'));
}

function GitFileRow(f) {
  const key = `git|${f.path}`, open = isOpen(key, false);
  const edits = f.edits.map(id => IX.editById.get(id)).filter(Boolean);
  const editors = [...new Set(edits.map(e => e.agent))];
  return h('div', { key: f.path, id: `file-${f.path}`, class: `chg${open ? ' open' : ''}` },
    h('button', { class: 'chg-head', type: 'button', 'data-nav': 'file', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      CodeBadge(f.code),
      PathText(f.path, 'grow'),
      editors.length > 0 && AvatarStack(editors, 18),
      DiffStat(f.added, f.removed)),
    open && h('div', { class: 'chg-body' },
      GitDiff(f),
      h('div', { key: 'edits', class: 'chg-part' },
        edits.length
          ? [h('p', { key: 'label', class: 'chg-label' }, icon('pencil'), h('span', null, `${edits.length === 1 ? 'The agent edit' : `The ${edits.length} agent edits`} of this file`)), edits.map(e => EditBlock(e, 'git'))]
          : h('p', { class: 'chg-none' }, 'No agent edited this file in this session.'))));
}

function CommitRow(c) {
  return h('div', { key: c.hash, class: 'commit' },
    icon('commit', 'commit-ic'),
    h('span', { class: 'commit-hash' }, c.short),
    h('span', { class: 'commit-subject', title: c.subject }, c.subject),
    c.agent ? NameLink(c.agent) : h('span', { class: 'commit-author' }, c.author),
    h('span', { class: 'commit-files' }, plural(c.files, 'file')),
    DiffStat(c.added, c.removed),
    h('span', { class: 'commit-time' }, ageOf(c.at)));
}

/**
 * What Changes says with no repository to show, as the pane says it: where
 * the chat runs, that it is in none, and that Changes follows the repository
 * an agent edits in; a pin git cannot read; an older mod's state, as it said it.
 */
function noRepoText(ch) {
  const w = ch.where;
  if (w && w.pinned) return `Changes is pinned to ${w.pinned.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}, which git can’t read now.`;
  if (w && w.isRepo === null) return 'Looking for a git repository…';
  if (w && w.isRepo === false) return `This chat runs in ${w.name || w.cwd}, which isn’t a git repository. Changes follows the repository an agent edits in${ch.edits.length ? '; the edits agents made outside one are below, exact.' : '.'}`;
  return w ? (ch.edits.length ? 'No git repository here: the edits agents made are below, exact.' : 'No git repository here.') : 'The session is not in a git repository; the agents\' own edits are below.';
}

/** Changes shows the repository at `root`, pinned (a pick); '' follows the work again. The next state shows it, and what came of it shows beside Changes' head (`repo`). */
function selectRepo(root) {
  return sendPress('repo', { cmd: 'selectRepo', root }, 'rp');
}

/** While the chat's folder is in no repository and none is pinned: the repositories directly inside it, the one changed last first, each a press that pins Changes to it (on another session's deck that takes nothing from here, why instead). */
function PicksSection(w) {
  const busy = isPressing('repo');
  return Section('picks', `Repositories in ${w.name || w.cwd}`, w.picks.length, null, () => h('div', { class: 'chg-picks' },
    w.picks.map(p => h('button', { key: p.root, type: 'button', class: 'btn btn-sm chg-pick', title: p.root, disabled: busy || !!deafWhy(), onClick: () => selectRepo(p.root) }, icon('branch'), h('span', null, p.name))),
    deafWhy() && h('p', { key: 'deaf', class: 'peer-note' }, deafWhy())));
}

export function ChangesPage() {
  const ch = S.changes, repo = ch.repo, files = ch.files, where = ch.where;
  const add = total(files, f => f.added), rem = total(files, f => f.removed);
  const isPinned = !!(where && where.pinned);
  // the agents' edits git does not list (committed since, undone, or outside the repository); with no repository, all of them; the one edited last first
  const lastAt = p => Math.max(...IX.editsByPath.get(p).map(e => e.at));
  const other = [...IX.editsByPath.keys()].filter(p => !repo || !IX.gitPaths.has(p)).sort((a, b) => lastAt(b) - lastAt(a));
  const isOut = p => (IX.editsByPath.get(p) || []).some(e => e.isOutside);
  const own = other.filter(p => !isOut(p)), outside = other.filter(isOut);
  // with no repository the newest is open the first time the list is seen, as the pane's; a fold's default is fixed then
  const isFresh = !repo && !own.some(p => ui.open.has(`other|${p}`));
  const fileGroup = p => FileGroup(p, IX.editsByPath.get(p), { scope: 'other', open: isFresh && p === own[0], showAgent: true, editors: [...new Set(IX.editsByPath.get(p).map(e => e.agent))], outside: isOut(p) });
  // another session's: its Follow the work and Review go to its own deck; where it takes nothing from here, why in their place
  const deaf = deafWhy();
  const following = isPressing('repo');
  const follow = isPinned && !deaf && h('button', { key: 'follow', type: 'button', class: 'btn btn-xs chg-follow', disabled: following, title: 'Let go of the pin: Changes follows the repository an agent edits in', onClick: () => selectRepo('') }, following ? 'Asking…' : 'Follow the work');
  const note = PressNote('repo');
  return h('div', { key: 'changes', class: 'page page-changes' },
    h('div', { class: 'chg-top' },
      h('div', { class: 'chg-sum' },
        h('p', { class: 'chg-count' }, repo ? plural(files.length, 'uncommitted file') : 'No repository', repo && files.length ? DiffStat(add, rem) : null),
        repo
          ? h('p', { class: 'chg-repo' }, icon('branch'), h('span', null, repo.branch || 'detached'),
            repo.ahead ? h('span', null, `↑${repo.ahead}`) : null, repo.behind ? h('span', null, `↓${repo.behind}`) : null,
            h('span', { class: 'sep' }, '·'), h('span', null, repo.head.slice(0, 7)), h('span', { class: 'sep' }, '·'), h('span', null, repo.name),
            isPinned ? [h('span', { key: 'sep', class: 'sep' }, '·'), h('span', { key: 'pinned', class: 'chg-pinned' }, 'pinned')] : null)
          : h('p', { class: 'chg-where' }, noRepoText(ch))),
      (follow || note || files.length > 0 || (deaf && isPinned)) && h('div', { class: 'chg-acts' },
        note,
        follow,
        deaf && (isPinned || files.length > 0) && h('span', { key: 'deaf', class: 'peer-note' }, deaf),
        !deaf && files.length > 0 && ReviewButton('changes', `Review the uncommitted changes (${plural(files.length, 'file')}, +${add} −${rem}) and tell me what to fix before I commit.`))),
    !repo && where && where.isRepo === false && !isPinned && where.picks.length > 0 && PicksSection(where),
    repo && Section('uncommitted', 'Uncommitted', files.length || null, null, () => (files.length
      ? h('div', { class: 'card list chgs' }, files.map(GitFileRow))
      : h('div', { class: 'card' }, Empty('check', 'Working tree clean', 'Nothing to commit.')))),
    (other.length > 0 || !repo) && Section('other', repo ? 'Other agent edits' : 'Agent edits', own.length || null, null, () => (other.length
      ? h('div', { class: 'fgroups' }, own.map(fileGroup), OutsideRows(outside.length, 'changes', () => outside.map(fileGroup)))
      : h('div', { class: 'card' }, Empty('pencil', 'No agent edits yet', 'Each Edit and Write an agent makes shows here, grouped by file.')))),
    ch.commits.length > 0 && Section('commits', 'Commits', ch.commits.length, null, () => h('div', { class: 'card list commits' }, ch.commits.map(CommitRow))));
}
