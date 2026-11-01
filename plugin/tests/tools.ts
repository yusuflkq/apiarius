/**
 * Bash calls, whatever tool table the engine laid. It writes
 * .claude-plugin/types/claude-code-tools on every load of the mod, from the
 * tools of the session that loaded it, and a session with PowerShell and no
 * Bash leaves Bash out of the tool names: there a literal `{ tool: 'Bash' }`
 * call and `e.tool === 'Bash'` stop compiling. So a test builds its Bash call
 * here, typed loosely, and a hook compares `(e.tool as string) === 'Bash'` and
 * reads the call's arguments as BashArgs. Either way the tests type-check.
 */
import type { Args } from 'claude-code'
import { test } from 'claude-code/testing'

/** Where one of the deck's git runs runs: the folder it hands git (`git -C <folder>`, from the session's own folder), else the run's own working folder. */
export function gitWhere(e: { argv: readonly string[]; init?: { cwd?: string } | undefined }): string {
  return e.argv[1] === '-C' ? (e.argv[2] ?? '') : (e.init?.cwd ?? '')
}

/** Whether a git run is the deck's read of where a repository's attribute files lie, before each run that reads the working tree (`ls-files` of its `.gitattributes`, `rev-parse --git-path info/attributes`). */
export function isAttrList(argv: readonly string[]): boolean {
  const line = argv.join(' ')
  return line.includes(' ls-files -z ') || line.includes(' rev-parse --git-path info/attributes')
}

/** Whether a git run is one of the deck's reads of a repository's settings, before each of its runs: where git's settings come from (`git config --list --show-scope`), or where its attribute files lie (`isAttrList`). A repository with no settings and no attribute files of its own answers each with nothing. */
export function isConfigList(argv: readonly string[]): boolean {
  return argv.join(' ').includes(' config --list --show-scope') || isAttrList(argv)
}

/** Bash's own arguments, as its input schema has them. */
export type BashArgs = { command: string; description?: string; timeout?: number; run_in_background?: boolean }

/** A Bash call as `$.tool.call` takes it and a `tool.call` hook sees it; `agentId` puts it in that subagent's loop. */
export function bash(args: BashArgs & { tool_use_id?: string; agentId?: string }): Args<'tool.call'> {
  return { tool: 'Bash', ...args } as unknown as Args<'tool.call'>
}

/**
 * Whether the tests run on Windows, read off this file's own address
 * (`file:///C:/…`, or `file://server/…` on a share); an address the kit does
 * not give counts as Windows. Claude Code resolves the path of a file call
 * the way the host does, so `C:\Users\…` is absolute on Windows alone: on
 * Linux and macOS it reads as a path inside the mod's folder.
 */
export const isWindows = !/^file:\/\/\/(?![a-z]:)/i.test(String((import.meta as { url?: unknown }).url ?? ''))

/** `test` on Windows, and no test elsewhere (the kit has no skip): for a file call's path with a drive letter or an 8.3 short name. */
export const windowsTest: typeof test = isWindows ? test : () => undefined

/** `test` on Linux and macOS, and no test on Windows: for the same rule as a `windowsTest`, spelled with their paths. */
export const posixTest: typeof test = isWindows ? () => undefined : test

/** Whether a run is web/files.js's (the deck reads an untracked file or an attribute file through it, never with `fs.read`), and its request. */
export function filesRequestOf(e: { argv: readonly string[]; init?: { stdin?: string } | undefined }): { root: string; paths: string[]; most: number; textMost: number } | null {
  if (!(e.argv[0] === 'node' && /[\\/]web[\\/]files\.js$/.test(e.argv[1] ?? ''))) return null
  try {
    return JSON.parse(e.init?.stdin ?? '') as { root: string; paths: string[]; most: number; textMost: number }
  } catch {
    return null
  }
}

/**
 * What web/files.js prints for `request`, in its place: each file's text by
 * `textOf` (its whole path, `/` between parts and no drive; undefined, none
 * there), counted and cut as the helper does.
 */
export function filesAnswerOf(request: { root: string; paths: string[]; most: number; textMost: number }, textOf: (abs: string) => string | undefined): string {
  const root = request.root.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '').replace(/\/+$/, '')
  const files = request.paths.map(place => {
    const text = textOf(`${root}/${place}`)
    if (text === undefined) return { path: place, kind: 'none' }
    const size = new TextEncoder().encode(text).length
    if (size > request.most) return { path: place, kind: 'big', size, mtimeMs: 0 }
    if (text.includes('\u0000')) return { path: place, kind: 'binary', size, mtimeMs: 0 }
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    return { path: place, kind: 'file', size, mtimeMs: 0, lines, ...(size <= request.textMost ? { text } : {}) }
  })
  return `${JSON.stringify({ ok: true, files })}\n`
}
