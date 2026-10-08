/**
 * The Changes tab: the clean git checker.
 *
 * The repository the deck follows on one line (with a picker when agents
 * work in more than one), its uncommitted files with who touched each and a
 * file's hunks under it on a press, then the last commits, marking the ones
 * this session made and the agent that made each. Outside a repository it
 * lists the edits agents made, by file, from their own exact patches.
 *
 * Pure: the hooks module hands in the Kit, the DeckModel and the Actions.
 */
import type { RenderElement } from 'claude-code'

import type { DeckEdit } from '../../types'
import { codeSourcesOf, filePatchesOf, hunksOf, type Hunk } from '../diff'
import * as F from '../format'
import type { Commit, CommitDetail, FileCode, FileRow, GitRepo } from '../git'
import { agentOf, editorsOf, labelOf } from '../model'
import { N, NATIVE_TEXT } from './theme'
import type { Actions, DeckModel, Kit } from './types'

/** How much one drawing shows: diff characters (the open file's and the open commit's together) and rows of each list. */
type Limits = { diffChars: number; files: number; commits: number; commitFiles: number; edits: number }

/** The first drawing; diff.ts keeps each Code source under the element's 10 000 characters. */
const FULL: Limits = { diffChars: 40_000, files: 30, commits: 20, commitFiles: 30, edits: 8 }
/** The drawing for a repository so busy that its rows alone fill the tree. */
const LEAN: Limits = { diffChars: 12_000, files: 12, commits: 10, commitFiles: 10, edits: 3 }
/** What the tab's tree may serialize to: the router's frame keeps its room under the host's 100 000. */
const TREE_CHARS = 72_000
/** A diff starts only with this much of the budget left. */
const MIN_DIFF_CHARS = 400
const BODY_CHARS = 1200
/** Cells a desktop's native button takes beyond its label's characters. */
const BUTTON_SLACK = 4
/** The least room the dim note after a file's counts keeps. */
const NOTE_ROOM = 14

/** What every piece of one drawing reads: the surface, the state, the presses, the diff characters left, the rows allowed. */
type Ctx = { kit: Kit; model: DeckModel; actions: Actions; budget: { chars: number }; limits: Limits }

/** One row of the files list: a file git reports, or one agents edited outside a repository. */
type Row = { path: string; code: FileCode; added: number; removed: number; note: string }

/** The files list's columns in cells: the path's label and its box, the `+a` and `−r` columns (0 when no row has one). */
type Cols = { label: number; box: number; add: number; del: number }

/**
 * The tab: the repository line, then its files and commits; outside a
 * repository, the edits agents made. A drawing over the tab's share of the
 * tree is drawn again with the diffs cut by the excess, then leaner still.
 */
export function changesTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const full = drawChanges(kit, model, actions, FULL)
  const size = JSON.stringify(full).length
  if (size <= TREE_CHARS) return full

  const cut = drawChanges(kit, model, actions, { ...FULL, diffChars: Math.max(0, FULL.diffChars - (size - TREE_CHARS) - 4000) })
  if (JSON.stringify(cut).length <= TREE_CHARS) return cut

  return drawChanges(kit, model, actions, LEAN)
}

function drawChanges(kit: Kit, model: DeckModel, actions: Actions, limits: Limits): RenderElement {
  const { Box } = kit
  const ctx: Ctx = { kit, model, actions, budget: { chars: limits.diffChars }, limits }
  const { git } = model

  const head = (
    <Box flexDirection="column">
      {repoLine(ctx)}
      {repoPicker(ctx)}
    </Box>
  )

  if (git.isRepo === null) return head

  if (!git.isRepo) {
    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {editsList(ctx)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {head}
      {gitFiles(ctx)}
      {commitList(ctx)}
    </Box>
  )
}

// The repository: one line saying where the deck looks, and the picker.

function repoLine({ kit, model }: Ctx): RenderElement {
  const { Text } = kit
  const { git } = model

  if (git.isRepo === null) return <Text dimColor>Reading git…</Text>

  if (!git.isRepo) {
    const hasEdits = model.data.edits.length > 0
    if (git.root !== '') {
      const why = F.oneLine(git.error ?? '') || 'git status failed'
      return (
        <Text wrap="truncate-end">
          <Text color={N.err}>■</Text>
          {` git failed in ${F.baseName(git.root)}: ${why}`}
          {hasEdits ? <Text dimColor>. The edits agents made are below, exact.</Text> : null}
        </Text>
      )
    }
    const where = model.cwd || 'this folder'
    return (
      <Text dimColor wrap="truncate-end">
        {hasEdits ? `No git repository at ${where}; the edits agents made are below.` : `No git repository at ${where}.`}
      </Text>
    )
  }

  const head = git.head.slice(0, 7)
  const branch = git.branch === '' || git.branch === 'HEAD' ? 'detached' : git.branch
  const count = git.files.length
  const counts = signed(kit, git.added, git.removed)
  const tail = count === 0 ? (head ? ` · clean at ${head}` : ' · no commits yet') : `${counts ? ' in ' : ''}${F.plural(count, 'file')} vs ${head || 'the empty tree'}`

  return (
    <Text wrap="truncate-end">
      <Text bold>{F.baseName(git.root) || git.root}</Text>
      {` ⎇ ${branch}`}
      {git.upstream ? <Text dimColor>{` · ${git.upstream} ↑${git.ahead} ↓${git.behind}`}</Text> : null}
      {count > 0 ? <Text dimColor> · </Text> : null}
      {count > 0 ? counts : null}
      <Text dimColor>{tail}</Text>
    </Text>
  )
}

/**
 * Which repository the deck shows, when agents work in more than one: a
 * Select where the surface draws one (the mobile app draws none), else a
 * row of Buttons. "Follow the work" is the empty value.
 */
function repoPicker({ kit, model, actions }: Ctx): RenderElement | null {
  const { Box, Button } = kit
  const Select = kit.surface === 'mobile' ? undefined : kit.Select
  const { repos, pinned, root } = model.git
  if (repos.length < 2) return null

  const seen = new Map<string, number>()
  for (const repo of repos) seen.set(repo.name, (seen.get(repo.name) ?? 0) + 1)
  const nameOf = (repo: GitRepo) => {
    const name = (seen.get(repo.name) ?? 0) > 1 ? F.truncStart(repo.root, 40) : repo.name
    return repo.isCwd ? `${name} (session folder)` : name
  }

  const options = [
    { value: '', label: pinned === '' && root !== '' ? `Follow the work (${F.baseName(root)})` : 'Follow the work' },
    ...repos.map(repo => ({ value: repo.root, label: nameOf(repo) })),
  ]
  const value = options.some(option => option.value === pinned) ? pinned : ''

  if (Select) {
    return <Select key="repo" label="Repository" options={options} value={value} onSelect={picked => actions.selectRepo(picked)} />
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {options.map(option => (
        <Button
          key={`repo:${option.value || 'follow'}`}
          label={option.label}
          plain
          dimColor={option.value !== value}
          onPress={() => actions.selectRepo(option.value)}
        />
      ))}
    </Box>
  )
}

// Files: git's uncommitted ones, or outside a repository the ones agents edited.

function gitFiles(ctx: Ctx): RenderElement {
  const { kit, model, actions, limits } = ctx
  const { Box, Text, Button } = kit
  const { git, data, view } = model

  if (git.files.length === 0) return quiet(kit, 'Working tree clean: nothing to commit.')

  const items = git.files.slice(0, limits.files).map(file => ({
    file,
    row: {
      path: file.path,
      code: file.code,
      added: file.added,
      removed: file.removed,
      note: noteOf(file, editorsOf(data, file.path).map(labelOf)),
    },
  }))
  const cols = colsOf(kit, items.map(item => item.row))

  return (
    <Box flexDirection="column">
      {items.map(({ file, row }) => {
        const isOpen = view.file === file.path
        const line = fileRow(kit, cols, row, isOpen, () => actions.selectFile(file.path))
        return isOpen ? (
          <Box flexDirection="column">
            {line}
            {fileDetail(ctx, file)}
          </Box>
        ) : (
          line
        )
      })}
      {git.files.length > limits.files ? <Text dimColor>{F.plural(git.files.length - limits.files, 'more file')}</Text> : null}
      <Box flexDirection="row" columnGap={2} marginTop={1}>
        <Button key="review" label="Ask Claude to review" plain dimColor onPress={() => actions.review(reviewAllText(git.root))} />
        {view.file === '' ? quiet(kit, 'Press a file to open its diff.') : null}
      </Box>
    </Box>
  )
}

/** An open file's hunks as diff Code, or why there are none, then the review request. */
function fileDetail(ctx: Ctx, file: FileRow): RenderElement {
  const { kit, model, actions, budget } = ctx
  const { Box, Text, Button } = kit
  const diff = model.fileDiff !== null && model.fileDiff.path === file.path ? model.fileDiff : null

  let body: RenderElement | RenderElement[]
  if (diff === null) body = <Text dimColor>Reading the diff…</Text>
  else if (diff.isBinary) body = quiet(kit, 'Binary file: no line diff.')
  else if (diff.note) body = <Text dimColor wrap="truncate-end">{F.oneLine(diff.note)}</Text>
  else body = codeBlocks(kit, diff.hunks, file.path, budget)

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {body}
      <Button key={`review:${file.path}`} label="Ask Claude to review this file" plain dimColor onPress={() => actions.review(reviewFileText(model.git.root, file))} />
    </Box>
  )
}

type EditedFile = { path: string; abs: string; added: number; removed: number; isNew: boolean }

/** The files agents edited, by path, biggest change first. */
function editedFiles(edits: readonly DeckEdit[]): EditedFile[] {
  const byPath = new Map<string, EditedFile>()
  for (const edit of edits) {
    const known = byPath.get(edit.path)
    if (known) {
      known.added += edit.added
      known.removed += edit.removed
    } else {
      byPath.set(edit.path, { path: edit.path, abs: edit.abs, added: edit.added, removed: edit.removed, isNew: edit.isNew })
    }
  }
  return [...byPath.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path))
}

function editsList(ctx: Ctx): RenderElement {
  const { kit, model, actions, limits } = ctx
  const { Box, Text } = kit
  const { data, view } = model
  const files = editedFiles(data.edits)

  if (files.length === 0) return quiet(kit, 'No edits by agents yet; the files they change show here.')

  const items = files.slice(0, limits.files).map(file => ({
    file,
    row: {
      path: file.path,
      code: (file.isNew ? 'N' : 'M') as FileCode,
      added: file.added,
      removed: file.removed,
      note: noteOf(null, editorsOf(data, file.path).map(labelOf)),
    },
  }))
  const cols = colsOf(kit, items.map(item => item.row))

  return (
    <Box flexDirection="column">
      {items.map(({ file, row }) => {
        const isOpen = view.file === file.path
        const line = fileRow(kit, cols, row, isOpen, () => actions.selectFile(file.path))
        return isOpen ? (
          <Box flexDirection="column">
            {line}
            {editDetail(ctx, file)}
          </Box>
        ) : (
          line
        )
      })}
      {files.length > limits.files ? <Text dimColor>{F.plural(files.length - limits.files, 'more file')}</Text> : null}
    </Box>
  )
}

/** The edits agents made to one file, newest first, each from its own patch. */
function editDetail(ctx: Ctx, file: EditedFile): RenderElement {
  const { kit, model, actions, budget, limits } = ctx
  const { Box, Text, Button } = kit
  const edits = model.data.edits.filter(edit => edit.path === file.path).reverse()
  const shown = edits.slice(0, limits.edits)

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {shown.map(edit => (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {`${edit.isNew ? 'Created' : edit.tool} by ${nameOf(model, edit.agent)} · ${F.ago(model.now - edit.at)}`}
          </Text>
          {codeBlocks(kit, hunksOf(edit.patch), edit.path, budget)}
        </Box>
      ))}
      {edits.length > shown.length ? <Text dimColor>{F.plural(edits.length - shown.length, 'earlier edit')}</Text> : null}
      <Button
        key={`review:${file.path}`}
        label="Ask Claude to review this file"
        plain
        dimColor
        onPress={() => actions.review(`Review the edits agents made this session to ${file.abs || file.path} and point out bugs or risky changes.`)}
      />
    </Box>
  )
}

/**
 * The list's columns: the path box as wide as the longest path the room
 * allows (a desktop's native button wider than its label), then the `+a`
 * and `−r` columns right-aligned, then the note in what is left.
 */
function colsOf(kit: Kit, rows: readonly Row[]): Cols {
  const add = Math.max(0, ...rows.map(row => (row.added > 0 ? F.num(row.added).length + 1 : 0)))
  const del = Math.max(0, ...rows.map(row => (row.removed > 0 ? F.num(row.removed).length + 1 : 0)))
  const longest = Math.max(8, ...rows.map(row => Array.from(row.path).length))
  const gaps = 1 + (add > 0 ? 1 : 0) + (del > 0 ? 1 : 0) + 1
  const slack = kit.surface === 'terminal' ? 0 : BUTTON_SLACK
  const noteRoom = rows.some(row => row.note !== '') ? NOTE_ROOM : 0
  const room = kit.columns - 1 - gaps - add - del - noteRoom - slack
  const label = Math.max(12, Math.min(longest, room))
  return { label, box: label + slack, add, del }
}

function fileRow(kit: Kit, cols: Cols, row: Row, isOpen: boolean, onPress: () => void): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box width={1} flexShrink={0}>
        <Text color={codeColor(row.code)}>{row.code}</Text>
      </Box>
      <Box width={cols.box} flexShrink={0}>
        <Button key={`file:${row.path}`} label={F.truncStart(row.path, cols.label)} plain dimColor={!isOpen} onPress={onPress} />
      </Box>
      {cols.add > 0 ? (
        <Box width={cols.add} flexShrink={0} justifyContent="flex-end">
          {row.added > 0 ? <Text color={N.add}>{`+${F.num(row.added)}`}</Text> : null}
        </Box>
      ) : null}
      {cols.del > 0 ? (
        <Box width={cols.del} flexShrink={0} justifyContent="flex-end">
          {row.removed > 0 ? <Text color={N.del}>{`−${F.num(row.removed)}`}</Text> : null}
        </Box>
      ) : null}
      {row.note ? (
        <Text dimColor wrap="truncate-end">
          {row.note}
        </Text>
      ) : null}
    </Box>
  )
}

/** The dim words after a file's counts: where a rename came from, binary, staged, and the agents that edited it. */
function noteOf(file: FileRow | null, editors: readonly string[]): string {
  const parts: string[] = []
  if (file?.oldPath) parts.push(`from ${F.truncStart(file.oldPath, 32)}`)
  if (file?.isBinary) parts.push('binary')
  if (file?.isStaged) parts.push(file.isUnstaged ? 'partly staged' : 'staged')
  if (editors.length > 0) parts.push(`by ${editors.join(', ')}`)
  return parts.join(' · ')
}

/** The status code's colour: added and new green, deleted red, a conflict red, renamed blue, modified yellow. */
function codeColor(code: FileCode): string {
  switch (code) {
    case 'A':
    case 'N':
      return N.add
    case 'D':
      return N.del
    case '!':
      return N.err
    case 'R':
      return N.info
    default:
      return N.warn
  }
}

// Commits: the last ones on the branch, this session's and each agent's marked.

function commitList(ctx: Ctx): RenderElement {
  const { kit, model, limits } = ctx
  const { Box, Text } = kit
  const { git } = model
  const list = git.commits.slice(0, limits.commits)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>Commits</Text>
        <Text dimColor>{`  ${git.today.commits} today · ${git.sessionCommits} this session`}</Text>
      </Text>
      {list.length === 0 ? quiet(kit, git.head ? 'No commits to show.' : 'No commits yet on this branch.') : null}
      {list.map(commit => commitRow(ctx, commit))}
    </Box>
  )
}

function commitRow(ctx: Ctx, commit: Commit): RenderElement {
  const { kit, model, actions } = ctx
  const { Box, Text, Button } = kit
  const { data, view, now } = model
  const isOpen = view.commit === commit.hash
  const by = data.commitsBy[commit.hash]
  const agent = by ? agentOf(data, by) : undefined
  const isSession = commit.at >= data.startedAt - 60_000
  const marks = [isSession ? 'this session' : '', agent ? `by ${labelOf(agent)}` : ''].filter(mark => mark !== '').join(' · ')
  const subjectRoom = Math.max(16, Math.min(60, kit.columns - 9 - (marks ? marks.length + 1 : 0) - 18))
  const counts = signed(kit, commit.added, commit.removed)

  const line = (
    <Box flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text dimColor>{commit.short}</Text>
      </Box>
      <Box flexShrink={0}>
        <Button
          key={`commit:${commit.hash}`}
          label={F.trunc(F.oneLine(commit.subject) || '(no subject)', subjectRoom)}
          plain
          dimColor={!isOpen}
          onPress={() => actions.selectCommit(commit.hash)}
        />
      </Box>
      {marks ? (
        <Box flexShrink={0}>
          <Text>{marks}</Text>
        </Box>
      ) : null}
      <Text dimColor wrap="truncate-end">
        {`${commit.author} · ${F.ago(now - commit.at)}`}
        {counts ? ' · ' : null}
        {counts}
        {` · ${F.plural(commit.files, 'file')}`}
      </Text>
    </Box>
  )

  return isOpen ? (
    <Box flexDirection="column">
      {line}
      {commitDetail(ctx, commit)}
    </Box>
  ) : (
    line
  )
}

/**
 * An open commit: its message and who made it, then each file's header and
 * hunks while the diff budget lasts, the files past it as headers under one
 * note, and the review request.
 */
function commitDetail(ctx: Ctx, commit: Commit): RenderElement {
  const { kit, model, actions, budget, limits } = ctx
  const { Box, Text, Button } = kit
  const detail: CommitDetail | null = model.commit !== null && model.commit.hash === commit.hash ? model.commit : null

  if (detail === null) {
    return (
      <Box paddingLeft={2} marginBottom={1}>
        <Text dimColor>Reading the commit…</Text>
      </Box>
    )
  }

  const body = bodyOf(detail.body, commit.subject)
  const patches = new Map(filePatchesOf(detail.patch).map(patch => [patch.path, patch]))
  const files = detail.files.slice(0, limits.commitFiles)
  const shown: RenderElement[] = []
  const cut: RenderElement[] = []
  const short = detail.hash.slice(0, 10)

  for (const file of files) {
    const header = fileHeader(kit, file.path, file.added, file.removed, file.oldPath ? `from ${file.oldPath}` : '')
    if (budget.chars < MIN_DIFF_CHARS) {
      cut.push(header)
      continue
    }
    const patch = patches.get(file.path)
    let hunks: RenderElement[]
    if (file.isBinary || patch?.isBinary) hunks = [quiet(kit, 'Binary file: no line diff.')]
    else if (patch) hunks = codeBlocks(kit, hunksOf(patch.text), file.path, budget)
    else if (detail.isPatchCut) hunks = [quiet(kit, "Cut to fit: this file's patch is past what the deck reads.")]
    else hunks = [quiet(kit, 'No line changes to show.')]
    shown.push(
      <Box flexDirection="column">
        {header}
        {hunks}
      </Box>,
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {body ? <Text wrap="wrap">{body}</Text> : null}
      <Text dimColor wrap="truncate-end">
        {`${detail.hash} · ${detail.author}${detail.email ? ` <${detail.email}>` : ''}`}
      </Text>
      {shown.length > 0 ? (
        <Box flexDirection="column" gap={1} marginTop={1}>
          {shown}
        </Box>
      ) : null}
      {cut.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {quiet(kit, `The diffs of ${F.plural(cut.length, 'more file')} are cut to fit the pane:`)}
          {cut}
        </Box>
      ) : null}
      {detail.files.length > files.length ? <Text dimColor>{F.plural(detail.files.length - files.length, 'more file')}</Text> : null}
      <Button
        key={`review-commit:${detail.hash}`}
        label="Ask Claude to review this commit"
        plain
        dimColor
        onPress={() =>
          actions.review(
            `Review commit ${short} ("${F.trunc(F.oneLine(commit.subject), 80)}") in ${model.git.root} (git -C "${model.git.root}" show ${short}) and point out bugs or risky changes.`,
          )
        }
      />
    </Box>
  )
}

/** The commit message less the subject its row already shows; '' when that is all there is. */
function bodyOf(message: string, subject: string): string {
  const lines = F.clean(message).split('\n')
  if (lines.length > 0 && (lines[0] ?? '').trim() === subject.trim()) lines.shift()
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
  return F.trunc(lines.join('\n').trimEnd(), BODY_CHARS)
}

// Pieces the lists share.

/** A diff file header: the directory dim and cut from its start, the file name bold, then `+a −r` and a dim note. */
function fileHeader(kit: Kit, path: string, added: number, removed: number, note: string): RenderElement {
  const { Text } = kit
  const name = F.baseName(path)
  const dir = path.slice(0, Math.max(0, path.length - name.length))
  const counts = signed(kit, added, removed)
  const room = Math.max(8, kit.columns - 6 - Array.from(name).length - 14)
  return (
    <Text wrap="truncate-end">
      {dir ? <Text dimColor>{F.truncStart(dir, room)}</Text> : null}
      <Text bold>{name}</Text>
      {counts ? '  ' : null}
      {counts}
      {note ? <Text dimColor>{`  ${note}`}</Text> : null}
    </Text>
  )
}

/** `+a −r` in the add and remove colours, a zero side left out; null when both are zero. */
function signed(kit: Kit, added: number, removed: number): RenderElement | null {
  const { Text } = kit
  if (added <= 0 && removed <= 0) return null
  return (
    <Text>
      {added > 0 ? <Text color={N.add}>{`+${F.num(added)}`}</Text> : null}
      {added > 0 && removed > 0 ? ' ' : null}
      {removed > 0 ? <Text color={N.del}>{`−${F.num(removed)}`}</Text> : null}
    </Text>
  )
}

/** Hunks as diff Code blocks, spending from `budget`; a note when some or all were cut to fit. */
function codeBlocks(kit: Kit, hunks: readonly Hunk[], path: string, budget: { chars: number }): RenderElement[] {
  const { Code } = kit
  if (hunks.length === 0) return [quiet(kit, 'No line changes to show.')]
  if (budget.chars < MIN_DIFF_CHARS) return [quiet(kit, 'Cut to fit the pane: close the other open diff to read this one.')]

  const { sources, isCut, used } = codeSourcesOf(hunks, budget.chars)
  budget.chars -= used
  const blocks: RenderElement[] = sources.map(source => <Code source={source} format="diff" path={path.slice(-200)} />)
  if (isCut) blocks.push(quiet(kit, 'The rest is cut to fit the pane.'))
  return blocks
}

/** One quiet line (the fourth text level) where content will be, or saying why there is none. */
function quiet(kit: Kit, text: string): RenderElement {
  const { Text } = kit
  return (
    <Text {...NATIVE_TEXT.text4} wrap="truncate-end">
      {text}
    </Text>
  )
}

function nameOf(model: DeckModel, id: string): string {
  const agent = agentOf(model.data, id)
  return agent ? labelOf(agent) : id
}

function reviewAllText(root: string): string {
  return `Review my uncommitted changes in ${root} (git -C "${root}" status, then git -C "${root}" diff HEAD and any new files) and point out bugs or risky edits before I commit.`
}

function reviewFileText(root: string, file: FileRow): string {
  if (file.isUntracked) return `Review the new file ${root}/${file.path} and point out bugs or risky code.`
  return `Review my uncommitted changes to ${file.path} in ${root} (git -C "${root}" diff HEAD -- "${file.path}") and point out bugs or risky edits.`
}
