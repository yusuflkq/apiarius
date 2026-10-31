/* Apiarius: the web page.
 *
 * What Claude Code is doing, who is working on what, and whether anything
 * needs you, live over SSE. It draws the mod's v2 view model (hooks/web.ts,
 * `WebStateV2`), the one the Desktop pane and the
 * terminal draw too, with the same names, order and keys: six routes (#/now,
 * the Dashboard; #/chat, the group chat; #/org, the org chart; #/changes;
 * #/inspect: the context, permissions, what is loaded and the spend;
 * #/settings: the avatar style and Help) and an agent drawer. No
 * dependencies and no build step.
 *
 * The page renders through a tiny keyed virtual DOM (h/patch, basics.mjs). Every
 * state update builds the view again and patches the live DOM in place, so
 * the route, an open drawer, the folds, scroll positions, the chart's pan and
 * zoom, the focus and a half-typed message all survive it. Elements keep
 * their identity by key (lists) or by position (fixed structure).
 *
 * This file is the page itself: what shows around and in place of a tab
 * (the banners, the welcome, the toast), the keys, the render loop, and the
 * boot. The rest is in modules it imports, as the browser loads them:
 * - basics.mjs: the helpers, the virtual DOM and the icons (it imports nothing)
 * - state.mjs: the state and its index, the connection, acks, lazy files, the
 *   router, the UI state, and All sessions (another session's deck too)
 * - parts.mjs: what every tab shows or uses: avatars, components, Markdown,
 *   diffs, what needs you, the header and the agent drawer
 * - now.mjs, chat.mjs, org.mjs, changes.mjs, inspect.mjs, settings.mjs: a tab each
 * - avatars.mjs, the deck's avatar library, and timeline.mjs, how Org's
 *   Timeline is laid out, which the mod draws the pane's avatars and
 *   Timeline from too
 * They import each other freely, cycles and all, so that any order loads
 * them none reads another's constants or variables while it loads but
 * basics.mjs's (which imports nothing, so it loads first); this file loads
 * last and boots the page. web/server.js serves each by name (its PAGE
 * map): a new module goes there too.
 */
import { clamp, create, h, icon, patch } from './basics.mjs';
import {
  access, closeDrawer, conn, connect, isWide, IX, navigate, parseRoute, PeerWait, retryNow, route, S, saveScroll, scrollSoon,
  SessionsPage, setRoute, setShut, switchView, TABS, toast, toggleSessions, ui
} from './state.mjs';
import { Avatar, Dot, Drawer, drawerStyle, Empty, Header } from './parts.mjs';
import { NowPage } from './now.mjs';
import { ChatPage, composerId, setDraft } from './chat.mjs';
import { fitOrg, lastLayout, org, OrgPage, tl } from './org.mjs';
import { ChangesPage } from './changes.mjs';
import { InspectPage } from './inspect.mjs';
import { SettingsPage } from './settings.mjs';

// ===================================================================== notes

function Toast() {
  const t = ui.toast;
  return t && Date.now() < t.until ? h('div', { key: 'toast', class: 'toast', role: 'status' }, t.text) : null;
}

function ConnBanner() {
  const st = conn.status;
  if (st === 'reconnecting' && S) {
    const secs = conn.retryAt ? Math.max(0, Math.ceil((conn.retryAt - Date.now()) / 1000)) : 0;
    return h('div', { class: 'connbar connbar-wait', role: 'status' }, icon('wifiOff'),
      h('span', null, h('strong', null, 'Disconnected.'), ` Showing the last state; retrying${secs ? ` in ${secs}s` : ''}…`),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: retryNow }, 'Retry now'));
  }
  if (st === 'ended') {
    const at = S && S.now ? new Date(S.now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return h('div', { class: 'connbar connbar-idle', role: 'status' }, icon('power'),
      h('span', null, h('strong', null, 'The session ended.'), ` This is its last state${at ? ` (${at})` : ''}. Run /apiarius web in a new session to follow it live.`),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: retryNow }, 'Try again'));
  }
  if (st === 'denied' && S) {
    return h('div', { class: 'connbar connbar-idle', role: 'status' }, icon('octagon'),
      h('span', null, h('strong', null, 'This page lost access.'), ` ${deniedText().why} ${OPEN_AGAIN}`));
  }
  return null;
}

/** Where a page is opened again: the deck's own links, each for one page. */
const OPEN_AGAIN = 'Open it again from Claude Code: /apiarius web for the Browser pane, or Open in browser in the deck\'s Settings for your own browser.';

/** Why the page has no access, in words, by what the server said (state.mjs `access.why`). */
function deniedText() {
  if (access.why === 'used') return { title: 'This link was used already', why: 'Each link opens one page.' };
  if (access.why === 'expired') return { title: 'This link has expired', why: 'A link Open in browser makes works for 30 seconds.' };
  if (access.why === 'restarted') return { title: 'This page needs opening again', why: 'The deck\'s server started again, so the access this page had ended.' };
  if (access.why === 'none') return { title: 'This page was opened without its link', why: 'The deck opens it with a link of its own.' };
  return { title: 'This link no longer works', why: 'It is from before the deck\'s server started again, or not one of its own.' };
}

function Loading() {
  return h('div', { key: 'loading', class: 'page page-loading', 'aria-busy': 'true' },
    h('div', { class: 'sk sk-head' }),
    h('div', { class: 'sk sk-list' }),
    h('div', { class: 'sk sk-list short' }));
}

function Unreachable() {
  const denied = conn.status === 'denied';
  const said = denied ? deniedText() : null;
  return h('div', { key: 'unreachable', class: 'page' },
    h('div', { class: 'card' }, Empty(denied ? 'octagon' : 'wifiOff',
      denied ? said.title : 'Can\'t reach the deck',
      denied ? `${said.why} ${OPEN_AGAIN}` : 'The deck server is not answering. If the Claude Code session ended, run /apiarius web in a new one.',
      denied ? null : h('button', { class: 'btn btn-sm', type: 'button', onClick: retryNow }, icon('refresh'), 'Try again'))));
}

/** The welcome's three agents: one done, one at work, one waiting on you. */
export const WELCOME = [
  { id: 'bob', title: 'bob', kind: 'agent', status: 'done', todos: [] },
  { id: 'helper', title: 'helper', kind: 'agent', status: 'running', todos: [] },
  { id: 'deck-1', title: 'deck', kind: 'agent', status: 'waiting', todos: [] },
];

export function Welcome() {
  const old = S && S.empty === 'old';
  return h('div', { key: 'welcome', class: 'page' },
    h('div', { class: 'card welcome' },
      h('div', { class: 'welcome-art', 'aria-hidden': 'true' },
        WELCOME.map((a, n) => h('span', { key: n, class: `welcome-av w${n}` }, Avatar(a, n === 1 ? 44 : 34, { live: true })))),
      h('p', { class: 'welcome-title' }, old ? 'Waiting for the deck\'s state' : 'Nothing yet'),
      h('p', { class: 'welcome-text' }, old
        ? 'The mod writing this session\'s state is older than this page. Start a new session (or reload the mod) and run /apiarius web again.'
        : 'Prompt Claude Code and this page fills in live: what Claude is doing, every agent it starts, what needs you, and the files they change.'),
      h('p', { class: 'welcome-live' }, Dot(conn.status === 'live' ? 'run' : 'idle', conn.status === 'live'), conn.status === 'live' ? 'Connected and listening' : 'Waiting for the session')));
}

function Page() {
  // every session on this machine, and another session's deck while it is read
  if (route.tab === 'sessions') return SessionsPage();
  if (route.session && !S) return PeerWait();
  if (!S) return conn.status === 'denied' || conn.fails >= 2 ? Unreachable() : Loading();
  // Settings holds with nothing yet too: the avatar style and the help are the deck's own
  if (route.tab === 'settings') return SettingsPage();
  if (S.empty) return Welcome();
  if (route.tab === 'inspect') return InspectPage();
  return route.tab === 'chat' ? ChatPage() : route.tab === 'org' ? OrgPage() : route.tab === 'changes' ? ChangesPage() : NowPage();
}

function App() {
  const drawer = !!route.drawer && !!S && !S.empty;
  return h('div', { id: 'app', class: `app deck-${conn.status}${S ? '' : ' no-state'}${drawer ? ' has-drawer' : ''} on-${route.tab}`, style: drawerStyle() },
    Header(),
    ConnBanner(),
    h('main', { class: 'scroll', ref: el => { scroller = el; } }, Page()),
    drawer ? h('div', { key: 'scrim', class: 'scrim', onClick: closeDrawer }) : null,
    Drawer(),
    Toast());
}

// ======================================================================= keys
// The same keys as the Desktop pane and the terminal, plus the page's own
// /, @, ? and Esc. None fires while you type,
// and no badge in the header says them: Settings' Help lists them.

const isTyping = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);

/** `i`: Inspect (an agent's drawer stays where the page is wide enough to keep it); pressed again there, back to the tab you came from. */
function openInspect() {
  if (route.tab === 'inspect') { navigate(ui.prevTab && ui.prevTab !== 'inspect' ? ui.prevTab : 'now'); return; }
  navigate('inspect', isWide() ? route.drawer : null);
}

/**
 * `h`: Settings' Help opened and brought into view (an agent's drawer stays
 * where the page is wide enough to keep it); pressed again there, back to
 * the tab you came from.
 */
function openSettings(section) {
  if (route.tab === 'settings' && ui.settingsAt === section) { navigate(ui.prevTab && ui.prevTab !== 'settings' ? ui.prevTab : 'now'); return; }
  setShut(section, false);
  navigate('settings', isWide() ? route.drawer : null);
  ui.settingsAt = section;
  scrollSoon(`sec-${section}`, 'settings');
}

/** Back: closes what is open over the page, the topmost first. */
function back() {
  if (route.drawer) { closeDrawer(); return true; }
  if (ui.goalOpen) { ui.goalOpen = false; renderNow(); return true; }
  return false;
}

/** Takes the Dashboard to need `n`'s card, open, and the focus with it. */
export function goToNeed(n) {
  ui.needOpen.set(n.id, true);
  setShut('needs', false);
  navigate('now', isWide() ? route.drawer : null);
  scrollSoon(`need-${n.id}`, 'now', true);
}

function nextNeed() {
  if (!S.needs.length) { toast('Nothing needs you'); return; }
  ui.needAt = (ui.needAt + 1) % S.needs.length;
  goToNeed(S.needs[ui.needAt]);
}


/** The chat's composer, focused (`/`), with `@` typed when it is empty (`@`). */
function composeInChat(withAt) {
  if (withAt && !(ui.drafts.get('chat') || '').trim()) setDraft('chat', '@', false);
  ui.focusTo = composerId('chat');
  navigate('chat', isWide() ? route.drawer : null);
}

/** m: the composer of an open agent's drawer (its words go to that agent), else the chat's. */
function message() {
  const d = route.drawer;
  if (d && d.kind === 'agent' && IX.byId.has(d.id)) { ui.focusTo = composerId(`agent:${d.id}`); renderNow(); return; }
  composeInChat(false);
}

/** j/k: the focus to the next or the previous row of the layer in front (an open drawer, else the page). */
function moveFocus(dir) {
  if (typeof document.querySelectorAll !== 'function') return;
  const active = document.activeElement;
  const drawer = document.querySelector('.drawer');
  const layer = drawer && ((active && drawer.contains(active)) || !isWide()) ? drawer : document.querySelector('.scroll');
  if (!layer) return;
  const items = [...layer.querySelectorAll('[data-nav]')].filter(el => el.getClientRects().length > 0);
  if (!items.length) return;
  const cur = active && active.closest ? active.closest('[data-nav]') : null;
  const i = items.indexOf(cur);
  const next = items[i < 0 ? (dir > 0 ? 0 : items.length - 1) : clamp(i + dir, 0, items.length - 1)];
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest' });
}

/** What a key does (false: nothing, and it goes on to the browser). */
function keyAction(key) {
  // s: All sessions, or back to the deck it was opened from; ↑ ↓ there: the row after or before the one focused
  if (key === 's') return toggleSessions();
  if (route.tab === 'sessions' && (key === 'ArrowDown' || key === 'ArrowUp')) { moveFocus(key === 'ArrowDown' ? 1 : -1); return true; }
  if (!S) return false;
  // nothing yet: the tabs and Settings' keys, the rest have nothing to act on
  if (S.empty && !/^[1-6ih?]$/.test(key)) return false;
  switch (key) {
    case '1': case '2': case '3': case '4': case '5': case '6': navigate(TABS[Number(key) - 1][0]); return true;
    case 'j': moveFocus(1); return true;
    case 'k': moveFocus(-1); return true;
    case 'b': return back();
    case 'n': nextNeed(); return true;
    case 'm': message(); return true;
    case 'i': openInspect(); return true;
    case 'h': case '?': openSettings('help'); return true;
    case '/': composeInChat(false); return true;
    case '@': composeInChat(true); return true;
    default: return false;
  }
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (isTyping(e.target)) { e.target.blur(); e.preventDefault(); return; }
    if (back()) e.preventDefault();
    return;
  }
  if (isTyping(e.target)) return;
  if (keyAction(e.key)) e.preventDefault();
}

// ===================================================================== render

export let vroot = null, scroller = null, frame = 0, frameTimer = 0, shownKey = route.key;
/** Render counts and timings, for checking the page stays cheap (read it from the console). */
const stats = (window.__deckStats = { renders: 0, lastMs: 0, maxMs: 0 });

/** Render on the next frame. A hidden or occluded pane pauses frames, so a timer backs it up: the page is current the moment it shows. */
export function invalidate() {
  if (frame) return;
  frame = requestAnimationFrame(renderNow);
  frameTimer = setTimeout(renderNow, 200);
}

export function renderNow() {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (frameTimer) { clearTimeout(frameTimer); frameTimer = 0; }
  const t0 = performance.now();
  // Keep the chat at its newest row when the reader is already there (a send takes it there;
  // "Show more" leaves it where it is, so the reader goes on from the cut).
  const sc = scroller;
  const atEnd = !!sc && route.tab === 'chat' && shownKey === 'chat' && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 32;
  const pin = route.tab === 'chat' && (ui.pinChat || (!ui.holdChat && atEnd));
  ui.pinChat = false;
  ui.holdChat = false;
  const v = App();
  if (!vroot) document.getElementById('app').replaceWith(create(v, false));
  else patch(vroot, v, false);
  vroot = v;
  afterRender(pin);
  stats.renders++;
  stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
  stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
}

function afterRender(pin) {
  // Scroll memory per route: back where the reader was when they come back; the chat opens at its newest row
  // (and comes back to it, new rows and all, when the reader left it there).
  if (scroller && route.key !== shownKey) {
    const was = ui.scroll.get(route.key);
    scroller.scrollTop = was === 'end' || (was == null && route.key === 'chat') ? scroller.scrollHeight : was || 0;
    shownKey = route.key;
  } else if (scroller && pin) scroller.scrollTop = scroller.scrollHeight;
  if (ui.focusTo) {
    const el = document.getElementById(ui.focusTo);
    if (el) { el.focus(); if (el.setSelectionRange) { const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* not text */ } } }
    ui.focusTo = null;
  }
  // a call's "In Edits" and an edit's "In Activity" bring the other into view in the drawer, lit a moment
  if (ui.drawerTo) {
    const el = document.getElementById(ui.drawerTo.id);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (el.animate) el.animate([{ backgroundColor: 'rgba(59, 130, 246, 0.16)' }, { backgroundColor: 'transparent' }], { duration: 1400, easing: 'ease-out' });
      ui.drawerTo = null;
    } else if (Date.now() > ui.drawerTo.until) ui.drawerTo = null;
  }
  // n and "Answer on Dashboard" bring a need's card into view (and the focus to it), once it has rendered; i and h a section of Settings.
  if (ui.scrollTo) {
    const want = ui.scrollTo;
    const el = scroller && want.on === route.key ? document.getElementById(want.id) : null;
    if (el) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
      scroller.scrollTop = Math.max(0, top);
      if (want.focus && el.focus) el.focus({ preventScroll: true });
      ui.scrollTo = null;
    } else if (Date.now() > want.until) ui.scrollTo = null;
  }
  // The timeline is as wide as its card: measured once drawn, drawn again when that changed.
  if (route.tab === 'org' && ui.orgView === 'timeline' && tl.box && tl.box.isConnected) {
    const w = tl.box.clientWidth - 32;
    if (w > 0 && Math.abs(w - tl.width) > 2) { tl.width = w; invalidate(); }
  }
  // The org chart fits itself until the reader pans or zooms it.
  if (route.tab === 'org' && ui.orgView === 'chart' && org.view && org.view.isConnected && lastLayout) {
    const size = `${org.view.clientWidth}x${org.view.clientHeight}`;
    if (!org.touched && (org.sig !== lastLayout.sig || org.size !== size)) fitOrg(lastLayout);
    org.sig = lastLayout.sig; org.size = size;
  }
  document.title = S && !S.empty ? `${S.needs.length ? '● ' : ''}${S.header.stateText} · Apiarius` : 'Apiarius';
}

function boot() {
  window.addEventListener('hashchange', () => {
    saveScroll();
    setRoute(parseRoute());
    renderNow();
  });
  window.addEventListener('resize', () => invalidate());
  document.addEventListener('keydown', onKey);
  // Coarse times ("2m") move on their own; the retry countdown ticks every second while it shows.
  setInterval(invalidate, 15000);
  setInterval(() => { if (conn.status === 'reconnecting') invalidate(); }, 1000);

  renderNow();
  // a reload on another session's deck reads it again, once the page has traded its link for a handle
  connect().finally(() => { if (route.session) switchView(route.session); });
}

// web/test/page.test.js runs the page without a browser (web/test/page-script.js) and drives its views itself: it boots nothing then.
if (!globalThis.__deckTest) boot();
