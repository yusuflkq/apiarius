/**
 * `/apiarius` and the words after it: `close`, `band`, `avatars`, `clear`,
 * `probe`, `web`, the sessions, the sample, and a tab of this session's deck
 * (the Dashboard alone). register.tsx registers the command and hands each
 * run here (`runApiarius`); what a run does to the pane, the view and the
 * sample it asks of that module, imported from there.
 */
import type { CommandRunInput, CommandRunResult, EngineInterface } from 'claude-code'

import * as AV from '../web/avatars.mjs'
import * as F from './format'
import * as M from './model'
import {
  changed,
  chatFollow,
  clearFinished,
  currentView,
  leaveDemo,
  loadDemo,
  openPane,
  orgDown,
  PANE,
  paneClosed,
  savePrefs,
  setAvatarStyle,
  showCleared,
  toggleProbe,
  toggleSessions,
} from './register'
import * as SR from './registry'
import { openWeb, stopWeb } from './webServer'

/** The style `/apiarius avatars <words>` names: by its id or its name, any case, spaces or not, or the start of one alone ("crit"); undefined for none. */
function avatarStyleNamed(words: string): AV.AvatarStyle | undefined {
  const said = words.toLowerCase().replace(/[\s_-]+/g, '')
  if (said === '') return undefined
  const exact = AV.STYLES.find(one => one.id === said || one.name.toLowerCase().replace(/\s+/g, '') === said)
  if (exact) return exact.id
  const starts = AV.STYLES.filter(one => one.id.startsWith(said) || one.name.toLowerCase().replace(/\s+/g, '').startsWith(said))
  return starts.length === 1 ? starts[0]?.id : undefined
}

/** `/apiarius avatars`: the styles, the one drawn marked; `/apiarius avatars <style>` draws that one from now on, in every session. */
function avatarsCommand($: EngineInterface, words: string): CommandRunResult {
  const list = AV.STYLES.map(one => `${one.id === currentView().avatarStyle ? '▸' : ' '} ${one.id.padEnd(8)} ${one.name}`).join('\n')
  if (words === '') return { text: `Avatar styles (now ${AV.styleName(currentView().avatarStyle)}):\n${list}\n/apiarius avatars <style> draws another, here and on the web page, in every session. The pane's Settings (6) picks one too.` }
  const style = avatarStyleNamed(words)
  if (style === undefined) return { text: `No avatar style called "${F.trunc(F.oneLine(words), 40)}". One of: ${AV.STYLE_IDS.join(', ')}.` }
  setAvatarStyle($, style)
  return { text: `Avatars: ${AV.styleName(style)}, in every session: the pane, the web page and /apiarius demo draw them (the terminal as one character each); /apiarius avatars lists the others.` }
}

/**
 * A run of `/apiarius`: what its words ask for done, and what the command
 * answers. The deck opens on the tab named (the Dashboard with no words),
 * leaving the sample; a pane with no room yet says so.
 */
export async function runApiarius($: EngineInterface, e: Pick<CommandRunInput, 'args'>): Promise<CommandRunResult> {
  const arg = e.args.trim().toLowerCase()
  if (arg === 'close' || arg === 'off' || arg === 'hide') {
    await $.ui.close({ id: PANE })
    paneClosed()
    chatFollow.isShown = false
    return { text: 'Apiarius closed.' }
  }
  if (arg === 'band') {
    currentView().isBandHidden = !currentView().isBandHidden
    savePrefs($)
    changed($)
    return { text: currentView().isBandHidden ? 'The agents band above the prompt is hidden. /apiarius band shows it again.' : 'The agents band shows above the prompt while subagents run.' }
  }
  if (arg === 'avatars' || arg.startsWith('avatars ')) return avatarsCommand($, arg.slice('avatars'.length).trim())
  // the deck's own tidying: finished agents hidden from the Dashboard, Chat and Org (nothing in Claude Code), or shown again
  if (arg === 'clear') return { text: await clearFinished($) }
  if (arg === 'clear show' || arg === 'clear undo') return { text: await showCleared($) }
  if (arg === 'probe') return toggleProbe($)
  // the live dashboard: started if need be, opened in your own browser; or, asked for, in Claude's Browser pane
  const words = arg.split(/\s+/)
  if (words[0] === 'web') {
    if (words[1] === 'stop' || words[1] === 'off' || words[1] === 'close') return { text: stopWeb($) ? 'Apiarius web stopped.' : 'Apiarius web was not running.' }
    return openWeb($, words[1] === 'pane' ? 'pane' : 'own')
  }
  // an Org chart Client that failed is tried again whenever /apiarius opens
  orgDown.clear()
  // every session on this machine, dropped over the tabs
  if (arg === 'sessions' || arg === 'all') {
    if (!SR.isListOpen()) toggleSessions($)
    const isShown = await openPane($)
    changed($)
    return isShown ? {} : { text: 'Apiarius is open and waiting for room: widen the window, or press ctrl+x then tab.' }
  }
  // the sample: the deck drawn from the v2 sample
  if (arg === 'demo' || arg === 'sample') {
    const why = await loadDemo($, true)
    const isShown = await openPane($)
    changed($)
    if (why) return { text: why }
    return isShown ? {} : { text: 'Apiarius is open and waiting for room: widen the window, or press ctrl+x then tab.' }
  }
  // anything else is this session's deck: /apiarius alone the Dashboard; dashboard (or now), chat, org, changes or settings (inspect and help too)
  leaveDemo()
  currentView().page = ''
  // /apiarius chat takes the pane to Chat's newest message, though Chat showed already
  chatFollow.isShown = false
  const tab = arg === '' ? 'now' : M.v2TabFor(words[0] ?? '')
  if (tab) currentView().v2 = M.view2With(currentView().v2, { tab })
  const isPlaced = await openPane($)
  changed($)
  return isPlaced ? {} : { text: 'Apiarius is open and waiting for room: widen the window, or press ctrl+x then tab.' }
}
