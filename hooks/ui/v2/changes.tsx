/**
 * Changes: git's uncommitted files (the v2 state's `changes`), each a plain
 * Button keyed `file:<path>` (W.fileKeyOf) that opens git's own diff of it
 * (`selectFile`, the hooks module reading it), with each agent's own edit
 * patches of that file beside it, from 140 cells side by side. Git's hunks
 * are never tagged by agent: that would be invented. Then the edits agents
 * made outside the repository, the commits (a press opens one, `selectCommit`),
 * and Review, which puts a prompt for Claude in the prompt box (`review`).
 *
 * Pure: Kit, the state, its lazy files, the deck model (the diff and the
 * commit read) and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { filePatchesOf, hunksOf } from '../../diff'
import { clean } from '../../format'
import { fileKeyOf, type V2Changes, type V2Files, type WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit } from '../types'
import { delta, diffBlocks, editBlock, editorsOf, titleOf, type Budget } from './diffs'
import { advanceOf, quiet, sectionHead } from './look'
import { P } from './palette'
import { ago, cutCells, plural } from './text'

/** The diff characters one drawing of Changes spends at most, every open file and commit together. */
const DIFF_CHARS = 36_000
/** The files the list draws at most, so the pane's drawing keeps inside its bounds. */
const MOST_FILES = 60
/** The width from which git's diff and the agents' edits stand side by side. */
const BESIDE = 140
/** The edits outside the repository opened, by id, while the module lives. */
const outsideOpen = new Set<string>()

type File = V2Changes['files'][number]

/** Changes: the repository's line and Review, its files, the edits outside it, its commits. */
export function changesTab(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box } = kit
  const budget: Budget = { chars: DIFF_CHARS }
  const changes = state.changes
  const outside = changes.edits.filter(edit => edit.isOutside === true)
  return (
    <Box key="changes" flexDirection="column" gap={1}>
      {repoLine(kit, state, actions, isDemo)}
      {changes.repo ? filesList(kit, state, files, model, actions, isDemo, budget) : editsOnly(kit, state, files, budget, actions)}
      {changes.repo && outside.length > 0 ? outsideList(kit, state, files, outside, budget, actions) : null}
      {changes.repo ? commitsList(kit, state, model, actions, isDemo, budget) : null}
    </Box>
  )
}

function reviewText(root: string): string {
  return `Review my uncommitted changes in ${root} (git -C "${root}" status, then git -C "${root}" diff HEAD and any new files) and point out bugs or risky edits before I commit.`
}

/** The repository on one line ("acme-api ⎇ feat/rate-limit ↑1 · 5 files +16 −2"), and Review at its right. */
function repoLine(kit: Kit, state: WebStateV2, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box, Text, Button } = kit
  const { repo, files } = state.changes
  if (!repo) {
    return <Text color={P.muted2}>{state.changes.edits.length > 0 ? 'No git repository here: the edits agents made are below, exact.' : 'No git repository here.'}</Text>
  }
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  const branch = repo.branch === '' || repo.branch === 'HEAD' ? 'detached' : repo.branch
  const counts = delta(kit, added, removed)
  const canReview = !isDemo && files.length > 0
  return (
    <Box key="changes:repo" flexDirection="row" columnGap={2}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold color={P.text}>
            {repo.name}
          </Text>
          <Text color={P.muted}>{` ⎇ ${branch}`}</Text>
          {repo.ahead > 0 || repo.behind > 0 ? <Text color={P.muted2}>{` ↑${repo.ahead} ↓${repo.behind}`}</Text> : null}
          <Text color={P.muted2}>{files.length > 0 ? ` · ${plural(files.length, 'file')} ` : ` · clean at ${repo.head.slice(0, 7)}`}</Text>
          {files.length > 0 ? counts : null}
        </Text>
      </Box>
      {canReview ? (
        <Box flexShrink={0}>
          <Button key="changes:review" label="Review" plain onPress={() => actions.review(reviewText(repo.root))} />
        </Box>
      ) : null}
    </Box>
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

/** A file's row: git's code, its path (the Button), `+a −r`, and the agents whose own edits touched it. */
function fileRow(kit: Kit, state: WebStateV2, file: File, isOpen: boolean, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const by = editorsOf(state, file.edits)
  const path = cutCells(file.path, Math.max(16, kit.columns - 24 - (by ? Math.min(24, by.length + 2) : 0)), advanceOf(kit))
  return (
    <Box key={`filerow:${file.path}`} flexDirection="row" columnGap={1}>
      <Box flexShrink={0} width={1}>
        <Text color={P.muted2}>{file.code}</Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Button key={fileKeyOf(file.path)} label={path} plain dimColor={!isOpen} onPress={() => actions.selectFile(file.path)} />
      </Box>
      <Box flexShrink={0}>{delta(kit, file.added, file.removed) ?? <Text> </Text>}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {by}
        </Text>
      </Box>
    </Box>
  )
}

/** An open file: git's diff (read by the hooks module), and beside it (under it, below 140 cells) each agent's own edits of it. */
function fileDetail(kit: Kit, state: WebStateV2, files: V2Files, model: DeckModel, file: File, isDemo: boolean, budget: Budget): RenderElement {
  const { Box, Text } = kit
  const diff = !isDemo && model.fileDiff !== null && model.fileDiff.path === file.path ? model.fileDiff : null
  let git: RenderElement | RenderElement[]
  if (isDemo) git = quiet(kit, 'The sample holds no git diff of its own: its agents’ edits are beside it.')
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

/** Outside a repository: the files agents edited, each a row that opens its edits. */
function editsOnly(kit: Kit, state: WebStateV2, files: V2Files, budget: Budget, actions: DashActions): RenderElement {
  if (state.changes.edits.length === 0) return quiet(kit, 'No edits by agents yet: the files they change show here.')
  return outsideList(kit, state, files, state.changes.edits, budget, actions, 'Edited')
}

/** Edits outside the repository (or with none), newest first: a row each, open to its patch. */
function outsideList(kit: Kit, state: WebStateV2, files: V2Files, edits: V2Changes['edits'], budget: Budget, actions: DashActions, title = 'Outside the repository'): RenderElement {
  const { Box, Text, Button } = kit
  const list = [...edits].reverse().slice(0, 20)
  return (
    <Box key="changes:outside" flexDirection="column">
      {sectionHead(kit, title, edits.length)}
      {list.map(edit => {
        const isOpen = outsideOpen.has(edit.id)
        const toggle = () => {
          if (isOpen) outsideOpen.delete(edit.id)
          else outsideOpen.add(edit.id)
          actions.redraw()
        }
        const path = cutCells(edit.path, Math.max(16, kit.columns - 30), advanceOf(kit))
        return (
          <Box key={`outside:${edit.id}`} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Box flexShrink={1} minWidth={0}>
                <Button key={`edits:${edit.id}`} label={path} plain dimColor={!isOpen} onPress={toggle} />
              </Box>
              <Box flexShrink={0}>{delta(kit, edit.added, edit.removed) ?? <Text> </Text>}</Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text color={P.muted2} wrap="truncate-end">{`${titleOf(state, edit.agent)} · ${ago(edit.at, state.now)}`}</Text>
              </Box>
            </Box>
            {isOpen ? (
              <Box paddingLeft={2} marginBottom={1}>
                {editBlock(kit, state, files, edit, budget)}
              </Box>
            ) : null}
          </Box>
        )
      })}
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
