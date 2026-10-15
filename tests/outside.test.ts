import { expect, test } from 'claude-code/testing'

import { emptyGit, type FileRow, type GitState } from '../hooks/git'
import * as M from '../hooks/model'
import * as W from '../hooks/web'
import type { DeckData } from '../types'

/**
 * Files outside the repository in the web deck's state: an agent's scratch
 * and temp files keep their absolute paths (the deck makes a path relative
 * to the repository's root as it records it), so `files[]` marks them
 * `isOutside`, lists the repository's own first, and `summary.filesInRepo`
 * counts the repository's; `summary.files` stays git's count.
 */

const NOW = 1_700_000_100_000
const ROOT = 'C:/Users/developer/Documents/agent-deck'
const SCRATCH = 'C:/Users/developer/AppData/Local/Temp/claude/C--Users-developer-Documents/0d3f5b7a-1c2e-4a6b-9d8f-2e4a6c8b0f13/scratchpad/talk'

function fileRow(path: string): FileRow {
  return { path, code: 'M', isStaged: false, isUnstaged: true, isUntracked: false, isBinary: false, added: 2, removed: 1 }
}

const GIT: GitState = { ...emptyGit(), isRepo: true, root: ROOT, branch: 'main', checkedAt: NOW, files: [fileRow('README.md'), fileRow('notes.txt')] }

/** One edit of `abs` by an agent `minutesAgo`, its path made relative to `root` as the hooks record it. */
function edited(data: DeckData, abs: string, minutesAgo: number, root: string = ROOT): void {
  M.noteFile(data, { agent: 'agent-n1', path: M.relOf(abs, root), abs, at: NOW - minutesAgo * 60_000, added: 3, removed: 1, isNew: false })
}

/** The session of the screenshots: repository files and scratch files edited in turn, the latest first. */
function session(root: string = ROOT): DeckData {
  const data = M.emptyData(NOW - 3_600_000)
  data.agents.push(M.newAgent('agent-n1', 'agent', 'Native deck N1', NOW - 3_600_000, { parentId: M.MAIN, status: 'completed', endedAt: NOW }))
  edited(data, `${SCRATCH}/detail4.spec`, 40, root)
  edited(data, `${ROOT}/hooks/ui/detail.tsx`, 30, root)
  edited(data, `${SCRATCH}/msg2.txt`, 20, root)
  edited(data, `${ROOT}/README.md`, 10, root)
  // a drive letter in another case, as a tool may spell it, is still the repository
  edited(data, `c:/users/developer/documents/agent-deck/web/app.js`, 50, root)
  return data
}

test('files outside the repository: marked isOutside, listed after the repository`s own (each the one edited last first), and left out of summary.filesInRepo; summary.files stays git`s', () => {
  const state = W.webStateOf(session(), M.defaultView(), GIT, null, NOW, 'session-1', ROOT)
  expect(state.files.map(file => [file.path, file.isOutside ?? false])).toEqual([
    ['README.md', false],
    ['hooks/ui/detail.tsx', false],
    ['web/app.js', false],
    [`${SCRATCH}/msg2.txt`, true],
    [`${SCRATCH}/detail4.spec`, true],
  ])
  // the flag is there only when it is true, as JSON writes it
  expect(Object.keys(state.files[0] ?? {})).not.toContain('isOutside')
  expect(state.files[3]).toEqual({ path: `${SCRATCH}/msg2.txt`, editors: ['agent-n1'], live: false, isShared: false, added: 3, removed: 1, lastAt: NOW - 20 * 60_000, isOutside: true })
  expect(state.summary).toMatchObject({ files: 2, filesInRepo: 3 })
})

test('outside a repository nothing is outside it: no file is marked, filesInRepo counts them all; on a POSIX root a /tmp file is outside', () => {
  const bare = W.webStateOf(session(''), M.defaultView(), { ...emptyGit(), isRepo: false, checkedAt: NOW }, null, NOW, 'session-1', '/work')
  expect(bare.files.every(file => file.isOutside === undefined)).toBe(true)
  expect(bare.files[0]?.path).toBe(`${ROOT}/README.md`)
  expect(bare.summary.filesInRepo).toBe(5)

  const data = M.emptyData(NOW - 600_000)
  for (const [abs, minutesAgo] of [['/tmp/claude/notes.txt', 1], ['/repo/src/a.ts', 2], ['/repo2/src/b.ts', 3]] as const) {
    M.noteFile(data, { agent: M.MAIN, path: M.relOf(abs, '/repo'), abs, at: NOW - minutesAgo * 60_000, added: 1, removed: 0, isNew: false })
  }
  const posix = W.webStateOf(data, M.defaultView(), { ...emptyGit(), isRepo: true, root: '/repo', checkedAt: NOW }, null, NOW, 'session-1', '/repo')
  expect(posix.files.map(file => [file.path, file.isOutside === true])).toEqual([
    ['src/a.ts', false],
    ['/tmp/claude/notes.txt', true],
    ['/repo2/src/b.ts', true],
  ])
  expect(posix.summary.filesInRepo).toBe(1)
})
