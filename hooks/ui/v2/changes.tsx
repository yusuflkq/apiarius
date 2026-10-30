/**
 * Changes: git's uncommitted files (the v2 state's `changes`), each a row
 * that opens, its chevron and its path a plain Button keyed `file:<path>`
 * (W.fileKeyOf) that opens git's own diff of it (`selectFile`, the hooks
 * module reading it), with each agent's own edit patches of that file beside
 * it, from 140 cells side by side, and the faces of the agents who made
 * them. Git's hunks are never tagged by agent: that would be invented. Then
 * the edits agents made outside the repository, a row a file as the web
 * page's, the commits (a press opens one, `selectCommit`), and Review, which
 * puts a prompt for Claude in the prompt box (`review`).
 *
 * With no repository to show it says where the chat runs and that Changes
 * follows the repository an agent edits in, offers the repositories directly
 * inside the chat's directory (`selectRepo` pins one), and lists every edit
 * the agents made, the newest file open. Pinned, a quiet Follow the work
 * lets it follow the work again. On another session's deck its picks,
 * Follow the work and Review go to that session's own deck, what came of
 * each said beside it; where its deck takes nothing from here, why instead.
 *
 * Pure: Kit, the state, its lazy files, the deck model (the diff and the
 * commit read) and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { filePatchesOf, hunksOf } from '../../diff'
import { baseName, clean } from '../../format'
import { fileKeyOf, type V2Changes, type V2Files, type WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit } from '../types'
import { rowOf } from './dashModel'
import { delta, diffBlocks, editBlock, editorIdsOf, editorsOf, titleOf, type Budget } from './diffs'
import { advanceOf, icon, quiet, sectionHead, svgOf } from './look'
import { P } from './palette'
import { cellsForPx, chevronOf, faces, facesCells, plainSlack, pressed, pressNote, pressOf, pressSending } from './parts'
import { ago, cellsOf, cutCells, plural } from './text'

/** The diff characters one drawing of Changes spends at most, every open file and commit together. */
const DIFF_CHARS = 36_000
/** The files the list draws at most, so the pane's drawing keeps inside its bounds. */
const MOST_FILES = 60
/** The files the agents' edits list draws at most. */
const MOST_EDITED = 20
/** The width from which git's diff and the agents' edits stand side by side. */
const BESIDE = 140
/** The faces a row shows at most, each one's size in px, and a chevron's. */
const MOST_FACES = 3
const FACE = 16
const CHEVRON = 14
const FILE_ICON = 14

/**
 * The agents' edits of each file opened or shut, by path, while the module
 * lives: as last pressed (or opened from the Dashboard's Files); one never
 * pressed is shut, but for the newest of the Agent edits list the first
 * time it is drawn, as the web page fixes a fold the first time it is seen.
 */
const editsOpen = new Map<string, boolean>()

type File = V2Changes['files'][number]
type Edit = V2Changes['edits'][number]

/** One file the agents edited: its edits (oldest first, as the state lists them), who made them in the order of their first, their lines and the last. */
export type EditGroup = { path: string; edits: Edit[]; agents: string[]; added: number; removed: number; lastAt: number }

/** Changes: the repository's line and Review (or where the chat runs, and the repositories to pick from), its files, the edits outside it, its commits. */
export function changesTab(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box } = kit
  const budget: Budget = { chars: DIFF_CHARS }
  const changes = state.changes
  const outside = changes.edits.filter(edit => edit.isOutside === true)
  return (
    <Box key="changes" flexDirection="column" gap={1}>
      {repoLine(kit, state, actions, isDemo)}
      {changes.repo ? null : picksList(kit, state, actions)}
      {changes.repo ? filesList(kit, state, files, model, actions, isDemo, budget) : editsOnly(kit, state, files, budget, actions)}
      {changes.repo && outside.length > 0 ? editsList(kit, state, files, outside, budget, actions, 'Outside the repository', false) : null}
      {changes.repo ? commitsList(kit, state, model, actions, isDemo, budget) : null}
    </Box>
  )
}

function reviewText(root: string): string {
  return `Review my uncommitted changes in ${root} (git -C "${root}" status, then git -C "${root}" diff HEAD and any new files) and point out bugs or risky edits before I commit.`
}

/**
 * What Changes says with no repository to show: where the chat runs and that
 * it is in none, and what Changes follows; a pin git cannot read; or, from an
 * earlier build's state (no `where`), as it said it then.
 */
export function noRepoText(changes: Pick<V2Changes, 'where' | 'edits'>): string {
  const where = changes.where
  const hasEdits = changes.edits.length > 0
  if (where && where.pinned !== '') return `Changes is pinned to ${baseName(where.pinned.replace(/[\\/]+$/, ''))}, which git can’t read now.`
  if (where && where.isRepo === null) return 'Looking for a git repository…'
  if (where && where.isRepo === false) {
    const tail = hasEdits ? '; the edits agents made outside one are below, exact.' : '.'
    return `This chat runs in ${where.name || where.cwd}, which isn’t a git repository. Changes follows the repository an agent edits in${tail}`
  }
  return hasEdits ? 'No git repository here: the edits agents made are below, exact.' : 'No git repository here.'
}

/** Where another session's deck takes nothing from here: why ('' on this deck's own, and while it does). Its picks, Follow the work and Review are not offered then. */
function deafOf(state: Pick<WebStateV2, 'peer'>): string {
  return state.peer && !state.peer.canSteer ? state.peer.why : ''
}

/**
 * Follow the work: a quiet plain Button that lets go of the pin, so Changes
 * follows the repository an agent edits in again; on another session's
 * deck, what came of a pick or of it beside it ("Asking its deck…" in its
 * place while that deck has not answered), and, where it takes nothing
 * from here, why in its place.
 */
function followPart(kit: Kit, state: WebStateV2, actions: DashActions, isPinned: boolean): RenderElement | null {
  const { Box, Button, Text } = kit
  const deaf = deafOf(state)
  if (deaf !== '' && isPinned) {
    return (
      <Box flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {deaf}
        </Text>
      </Box>
    )
  }
  // a pick or Follow the work done: Changes shows what its deck now shows, and what came of it at its right
  const parts = isPinned ? pressed(kit, state, 'repo', <Button key="changes:follow" label="Follow the work" plain dimColor onPress={() => actions.selectRepo('')} />) : [pressNote(kit, pressOf(state, 'repo'), 'repo')]
  if (parts.every(part => part === null)) return null
  return (
    <Box flexShrink={0} flexDirection="row" columnGap={2}>
      {parts}
    </Box>
  )
}

/** The repository on one line ("acme-api ⎇ feat/rate-limit ↑1 · pinned · 5 files +16 −2"), and at its right Follow the work while it is pinned, and Review. */
function repoLine(kit: Kit, state: WebStateV2, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box, Text, Button } = kit
  const { repo, files, where } = state.changes
  const isPinned = where !== undefined && where.pinned !== ''
  if (!repo) {
    return (
      <Box key="changes:repo" flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={P.muted2} wrap="wrap">
            {noRepoText(state.changes)}
          </Text>
        </Box>
        {followPart(kit, state, actions, isPinned)}
      </Box>
    )
  }
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  const branch = repo.branch === '' || repo.branch === 'HEAD' ? 'detached' : repo.branch
  const counts = delta(kit, added, removed)
  const canReview = !isDemo && files.length > 0 && deafOf(state) === ''
  return (
    <Box key="changes:repo" flexDirection="row" columnGap={2}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold color={P.text}>
            {repo.name}
          </Text>
          <Text color={P.muted}>{` ⎇ ${branch}`}</Text>
          {repo.ahead > 0 || repo.behind > 0 ? <Text color={P.muted2}>{` ↑${repo.ahead} ↓${repo.behind}`}</Text> : null}
          {isPinned ? <Text color={P.muted2}>{' · pinned'}</Text> : null}
          <Text color={P.muted2}>{files.length > 0 ? ` · ${plural(files.length, 'file')} ` : ` · clean at ${repo.head.slice(0, 7)}`}</Text>
          {files.length > 0 ? counts : null}
        </Text>
      </Box>
      {followPart(kit, state, actions, isPinned)}
      {canReview ? (
        <Box flexShrink={0} flexDirection="row" columnGap={2}>
          {pressed(kit, state, 'review', <Button key="changes:review" label="Review" plain onPress={() => actions.review(reviewText(repo.root))} />)}
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * While the chat's directory is in no repository and none is pinned: the
 * repositories directly inside it, the one changed last first, each its
 * branch mark and its name, a plain Button keyed `changes:pick:<root>` that
 * pins Changes to it. Nothing where there are none.
 */
function picksList(kit: Kit, state: WebStateV2, actions: DashActions): RenderElement | null {
  const { Box, Text, Button } = kit
  const where = state.changes.where
  if (!where || where.isRepo !== false || where.pinned !== '' || where.picks.length === 0) return null
  const room = Math.max(8, kit.columns - 4)
  // another session's: its picks pin its own deck's Changes ("Asking its deck…" under them meanwhile); where its deck takes nothing from here, names alone, and why
  const deaf = deafOf(state)
  const press = pressOf(state, 'repo')
  return (
    <Box key="changes:picks" flexDirection="column">
      {sectionHead(kit, `Repositories in ${where.name || where.cwd}`, where.picks.length)}
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {where.picks.map(pick => (
          <Box key={`pick:${pick.root}`} flexDirection="row" columnGap={1} flexShrink={0}>
            <Text color={P.muted2}>⎇</Text>
            {deaf !== '' ? <Text color={P.fg2}>{cutCells(pick.name, room, advanceOf(kit))}</Text> : <Button key={`changes:pick:${pick.root}`} label={cutCells(pick.name, room, advanceOf(kit))} plain onPress={() => actions.selectRepo(pick.root)} />}
          </Box>
        ))}
      </Box>
      {deaf !== '' ? (
        <Text key="changes:deaf" color={P.muted2} wrap="wrap">
          {deaf}
        </Text>
      ) : press?.status === 'sending' ? (
        pressSending(kit, press, 'repo')
      ) : null}
    </Box>
  )
}

/** A row's chevron: an icon where Svg draws, else ▸ shut and ▾ open, dim. */
export function chevron(kit: Kit, isOpen: boolean): RenderElement {
  const { Text } = kit
  return svgOf(kit) ? icon(kit, isOpen ? 'chevronDown' : 'chevronRight', P.muted2, '', CHEVRON) : <Text color={P.muted2}>{chevronOf(isOpen)}</Text>
}

/** The cells `chevron` takes. */
export function chevronCells(kit: Kit): number {
  return svgOf(kit) ? cellsForPx(CHEVRON) : 1
}

/** The faces of the agents `ids` names, as the Dashboard's Files draws them; one the state does not hold is grey. */
function facesOf(kit: Kit, state: WebStateV2, ids: readonly string[]): RenderElement {
  return faces(
    kit,
    ids.map(id => rowOf(state, id) ?? null),
    FACE,
    ids.map(id => titleOf(state, id)),
    MOST_FACES,
  )
}

/** Git's files: a row each, the open one's diff and its agents' edits under it. */
function filesList(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean, budget: Budget): RenderElement {
  const { Box } = kit
  const list = state.changes.files
  if (list.length === 0) return quiet(kit, 'Working tree clean: nothing to commit.')
  return (
    <Box key="changes:files" flexDirection="column">
      {sectionHead(kit, 'Uncommitted', list.length)}
      {list.slice(0, MOST_FILES).map(file => {
        const isOpen = model.view.file === file.path
        return (
          <Box key={`fileblock:${file.path}`} flexDirection="column">
            {fileRow(kit, state, file, isOpen, actions)}
            {isOpen ? fileDetail(kit, state, files, model, file, isDemo, budget) : null}
          </Box>
        )
      })}
      {list.length > MOST_FILES ? quiet(kit, `${plural(list.length - MOST_FILES, 'more file')}: more than the pane holds; /deck web lists them all.`) : null}
    </Box>
  )
}

/** A file's row, as the web page's: its chevron, git's code, its path (the Button), the faces of the agents whose own edits touched it, `+a −r`, and their names. */
function fileRow(kit: Kit, state: WebStateV2, file: File, isOpen: boolean, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const by = editorsOf(state, file.edits)
  const ids = editorIdsOf(state, file.edits)
  const shown = ids.length > 0 ? facesCells(kit, ids.length, FACE, MOST_FACES) + 1 : 0
  const path = cutCells(file.path, Math.max(16, kit.columns - 26 - chevronCells(kit) - shown - (by ? Math.min(24, by.length + 2) : 0)), advanceOf(kit))
  return (
    <Box key={`filerow:${file.path}`} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{chevron(kit, isOpen)}</Box>
      <Box flexShrink={0} width={1}>
        <Text color={P.muted2}>{file.code}</Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Button key={fileKeyOf(file.path)} label={path} plain onPress={() => actions.selectFile(file.path)} />
      </Box>
      {ids.length > 0 ? <Box flexShrink={0}>{facesOf(kit, state, ids)}</Box> : null}
      <Box flexShrink={0}>{delta(kit, file.added, file.removed) ?? <Text> </Text>}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {by}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * An open file: git's own diff of it (the state's, `diffId` through
 * `files.gitDiff`, as the web page reads it; else the one the hooks module
 * read), and beside it (under it, below 140 cells) each agent's own edits of it.
 */
function fileDetail(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, file: File, isDemo: boolean, budget: Budget): RenderElement {
  const { Box, Text } = kit
  const own = file.diffId !== null ? files.gitDiff(file.diffId) : null
  const diff = !isDemo && model.fileDiff !== null && model.fileDiff.path === file.path ? model.fileDiff : null
  let git: RenderElement | RenderElement[]
  if (own !== null) git = own.trim() === '' ? quiet(kit, 'Git shows no line changes in it.') : diffBlocks(kit, hunksOf(own), file.path, budget)
  else if (isDemo) git = quiet(kit, 'The sample holds no git diff of its own: its agents’ edits are beside it.')
  else if (diff === null) git = <Text color={P.muted2}>Reading the diff…</Text>
  else if (diff.isBinary) git = quiet(kit, 'Binary file: no line diff.')
  else if (diff.note) git = quiet(kit, clean(diff.note))
  else git = diffBlocks(kit, diff.hunks, file.path, budget)
  const edits = file.edits.map(id => state.changes.edits.find(edit => edit.id === id)).filter(edit => edit !== undefined)
  const ours = (
    <Box flexDirection="column" gap={1}>
      <Text color={P.muted}>{edits.length > 0 ? 'The agents’ own edits' : 'No agent edited it: git’s diff is the whole of it.'}</Text>
      {edits.map(edit => editBlock(kit, state, files, edit, budget))}
    </Box>
  )
  const theirs = (
    <Box flexDirection="column">
      <Text color={P.muted}>Git’s diff</Text>
      {git}
    </Box>
  )
  if (kit.columns >= BESIDE && edits.length > 0) {
    return (
      <Box key={`filediff:${file.path}`} flexDirection="row" columnGap={2} paddingLeft={2} marginBottom={1}>
        <Box width="50%" flexDirection="column">
          {theirs}
        </Box>
        <Box width="50%" flexDirection="column">
          {ours}
        </Box>
      </Box>
    )
  }
  return (
    <Box key={`filediff:${file.path}`} flexDirection="column" gap={1} paddingLeft={2} marginBottom={1}>
      {theirs}
      {ours}
    </Box>
  )
}

/** Outside a repository: the files agents edited, each a row that opens its edits, the newest open the first time. */
function editsOnly(kit: Kit, state: WebStateV2, files: V2Files, budget: Budget, actions: DashActions): RenderElement {
  if (state.changes.edits.length === 0) return quiet(kit, 'No edits by agents yet: the files they change show here.')
  return editsList(kit, state, files, state.changes.edits, budget, actions, 'Agent edits', true)
}

/** The agents' edits by file, the file edited last first; each file's edits as the state lists them, oldest first. */
export function editGroupsOf(edits: readonly Edit[]): EditGroup[] {
  const groups = new Map<string, EditGroup>()
  for (const edit of edits) {
    const group = groups.get(edit.path) ?? { path: edit.path, edits: [], agents: [], added: 0, removed: 0, lastAt: 0 }
    group.edits.push(edit)
    if (!group.agents.includes(edit.agent)) group.agents.push(edit.agent)
    group.added += edit.added
    group.removed += edit.removed
    group.lastAt = Math.max(group.lastAt, edit.at)
    groups.set(edit.path, group)
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/** The Button key of a file's row of the agents' edits: `edits:` and its path. */
export function editsKeyOf(path: string): string {
  return `edits:${path}`
}

/** Opens the agents' edits of file `path` in Changes, as a press on its row does (the Dashboard's Files, for a file git does not list). */
export function openEditsOf(path: string): void {
  editsOpen.set(path, true)
}

/**
 * The agents' edits outside the repository (or, with none, every one), a
 * row a file as the web page's: its chevron, its folder dim and its file's
 * name (a plain Button keyed `edits:<path>` that opens or shuts it), the
 * faces of who edited it, "2 edits", `+a −r` and when, then, open, each
 * edit's tool, agent and time and its exact patch. With `opensNewest`, the
 * newest file is open the first time the list is drawn.
 */
function editsList(kit: Kit, state: WebStateV2, files: V2Files, edits: readonly Edit[], budget: Budget, actions: DashActions, title: string, opensNewest: boolean): RenderElement {
  const { Box } = kit
  const groups = editGroupsOf(edits)
  const list = groups.slice(0, MOST_EDITED)
  // a fold's default is fixed the first time it is drawn, so live updates never flip it
  const isFirst = opensNewest && list.every(group => !editsOpen.has(group.path))
  list.forEach((group, i) => {
    if (!editsOpen.has(group.path)) editsOpen.set(group.path, isFirst && i === 0)
  })
  return (
    <Box key="changes:outside" flexDirection="column">
      {sectionHead(kit, title, groups.length)}
      {list.map(group => {
        const isOpen = editsOpen.get(group.path) === true
        const toggle = () => {
          editsOpen.set(group.path, !isOpen)
          actions.redraw()
        }
        return (
          <Box key={`edited:${group.path}`} flexDirection="column">
            {editsRow(kit, state, group, isOpen, toggle)}
            {isOpen ? (
              <Box flexDirection="column" gap={1} paddingLeft={2} marginBottom={1}>
                {group.edits.map(edit => editBlock(kit, state, files, edit, budget))}
              </Box>
            ) : null}
          </Box>
        )
      })}
      {groups.length > MOST_EDITED ? quiet(kit, `${plural(groups.length - MOST_EDITED, 'more file')}: more than the pane holds; /deck web lists them all.`) : null}
    </Box>
  )
}

/** The cells the file icon before a row's path takes: an icon where Svg draws, none on the terminal. */
function fileIconCells(kit: Kit): number {
  return svgOf(kit) ? cellsForPx(FILE_ICON) : 0
}

/** A path as its folder and its file's name: "src/" and "rateLimit.ts"; '' and the whole of one with no folder. */
export function pathParts(path: string): { dir: string; base: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at < 0 ? { dir: '', base: path } : { dir: path.slice(0, at + 1), base: path.slice(at + 1) }
}

/**
 * How a file's row of the agents' edits reads: Changes' (the faces of who
 * edited it, and when it was edited last), or an agent page's (`isOwn`:
 * neither, the agent being the page's own), its Button keyed `key`.
 */
export type EditsRowLook = { key?: string; isOwn?: boolean }

/**
 * One file of the agents' edits, as the web page's row: chevron, the file
 * icon where Svg draws, its folder dim and cut at its end, its file's name
 * (the Button), faces, "n edits", `+a −r`, and when it was edited last.
 */
export function editsRow(kit: Kit, state: WebStateV2, group: EditGroup, isOpen: boolean, toggle: () => void, look: EditsRowLook = {}): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const isOwn = look.isOwn === true
  const count = plural(group.edits.length, 'edit')
  const when = isOwn ? '' : ago(group.lastAt, state.now)
  const lines = `${group.added > 0 ? `+${group.added}` : ''}${group.added > 0 && group.removed > 0 ? ' ' : ''}${group.removed > 0 ? `−${group.removed}` : ''}`
  const faceCells = isOwn ? 0 : facesCells(kit, group.agents.length, FACE, MOST_FACES) + 1
  // the path's room: the row less the chevron, the icon, the Button's chrome, the faces, the count, the lines, the age and the gaps
  const taken = chevronCells(kit) + fileIconCells(kit) + plainSlack(kit) + faceCells + cellsOf(count, adv) + cellsOf(lines, adv) + cellsOf(when, adv) + 6
  const room = Math.max(16, kit.columns - taken)
  const { dir, base } = pathParts(group.path)
  const name = cutCells(base, room, adv)
  // the folder takes what the name leaves, cut at its end as the web's ("C:/Users/sam…"); too little left, it goes
  const left = room - cellsOf(name, adv)
  const folder = dir !== '' && left >= 6 ? cutCells(dir, left, adv) : ''
  return (
    <Box key={isOwn ? `page:editrow:${group.path}` : `editrow:${group.path}`} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{chevron(kit, isOpen)}</Box>
      {svgOf(kit) ? <Box flexShrink={0}>{icon(kit, 'file', P.muted2, '', FILE_ICON)}</Box> : null}
      <Box flexShrink={1} minWidth={0} flexDirection="row" alignItems="center">
        {folder ? (
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {folder}
            </Text>
          </Box>
        ) : null}
        <Box flexShrink={0}>
          <Button key={look.key ?? editsKeyOf(group.path)} label={name} plain onPress={toggle} />
        </Box>
      </Box>
      {isOwn ? null : <Box flexShrink={0}>{facesOf(kit, state, group.agents)}</Box>}
      <Box flexShrink={0}>
        <Text color={P.muted2}>{count}</Text>
      </Box>
      <Box flexShrink={0}>{delta(kit, group.added, group.removed) ?? <Text> </Text>}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {when}
        </Text>
      </Box>
    </Box>
  )
}

/** The newest commits: short hash, subject (the Button), the agent whose shell call made it, when, `+a −r`; the open one's detail under it. */
function commitsList(kit: Kit, state: WebStateV2, model: DeckModel, actions: DashActions, isDemo: boolean, budget: Budget): RenderElement {
  const { Box, Text, Button } = kit
  const list = state.changes.commits
  return (
    <Box key="changes:commits" flexDirection="column">
      {sectionHead(kit, 'Commits', list.length)}
      {list.length === 0 ? quiet(kit, 'No commits yet on this branch.') : null}
      {list.map(commit => {
        const isOpen = model.view.commit === commit.hash
        const by = commit.agent ? titleOf(state, commit.agent) : ''
        const subject = cutCells(clean(commit.subject) || '(no subject)', Math.max(16, Math.min(60, kit.columns - 30)), advanceOf(kit))
        return (
          <Box key={`commit:${commit.hash}:row`} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Box flexShrink={0}>
                <Text color={P.muted2}>{commit.short}</Text>
              </Box>
              <Box flexShrink={1} minWidth={0}>
                <Button key={`commit:${commit.hash}`} label={subject} plain dimColor={!isOpen} onPress={() => actions.selectCommit(commit.hash)} />
              </Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text color={P.muted2} wrap="truncate-end">
                  {`${by ? `${by} · ` : ''}${commit.author} · ${ago(commit.at, state.now)} `}
                  {delta(kit, commit.added, commit.removed)}
                </Text>
              </Box>
            </Box>
            {isOpen ? commitDetail(kit, model, commit.hash, isDemo, budget) : null}
          </Box>
        )
      })}
    </Box>
  )
}

/** An open commit: its message past the subject, then each file's hunks while the budget lasts. */
function commitDetail(kit: Kit, model: DeckModel, hash: string, isDemo: boolean, budget: Budget): RenderElement {
  const { Box, Text } = kit
  const detail = !isDemo && model.commit !== null && model.commit.hash === hash ? model.commit : null
  if (isDemo) return <Box paddingLeft={2}>{quiet(kit, 'The sample holds no commit of its own to read.')}</Box>
  if (detail === null) {
    return (
      <Box paddingLeft={2}>
        <Text color={P.muted2}>Reading the commit…</Text>
      </Box>
    )
  }
  const patches = new Map(filePatchesOf(detail.patch).map(patch => [patch.path, patch]))
  const body = clean(detail.body).split('\n').slice(1).join('\n').trim()
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1} gap={1}>
      {body ? (
        <Text color={P.fg2} wrap="wrap">
          {body.slice(0, 1200)}
        </Text>
      ) : null}
      {detail.files.slice(0, 20).map(file => {
        const patch = patches.get(file.path)
        return (
          <Box key={`commitfile:${hash}:${file.path}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={P.fg2}>{`${file.path}  `}</Text>
              {delta(kit, file.added, file.removed)}
            </Text>
            {file.isBinary || patch?.isBinary ? quiet(kit, 'Binary file: no line diff.') : patch ? diffBlocks(kit, hunksOf(patch.text), file.path, budget) : quiet(kit, detail.isPatchCut ? 'Cut to fit: past what the deck reads.' : 'No line changes to show.')}
          </Box>
        )
      })}
      {detail.files.length > 20 ? quiet(kit, `${plural(detail.files.length - 20, 'more file')} not shown.`) : null}
    </Box>
  )
}
