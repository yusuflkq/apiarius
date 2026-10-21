// Builds the v2 sample through the mod's own builder: tests/v2session.ts (a
// session recorded through hooks/model.ts's recorders) into hooks/web.ts's
// deckStateOf, written as web/fixtures/state.v2.json, with its lazy files
// beside it as a session's folder holds them: web/fixtures/v2/agents/<id>.json,
// v2/patches/<id>.diff and v2/messages/<id>.md.
//
//   node web/fixtures/make-v2.mjs           writes them (the v2 folder afresh)
//   node web/fixtures/make-v2.mjs --check   exits 1 when what is written is not what the builder makes now
//
// Node 22.18 or newer runs the TypeScript as it is (type stripping); the hook
// below only adds the `.ts` the mod's imports leave off.
import fs from 'node:fs'
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOOKS = `
export async function resolve(spec, context, next) {
  const isLocal = spec.startsWith('./') || spec.startsWith('../')
  if (isLocal && !/[.](?:[cm]?[jt]sx?|json)$/.test(spec)) {
    for (const ext of ['.ts', '/index.ts']) {
      try { return await next(spec + ext, context) } catch {}
    }
  }
  return next(spec, context)
}`
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`)

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const { v2Session } = await import(pathToFileURL(path.join(repo, 'tests', 'v2session.ts')).href)
const W = await import(pathToFileURL(path.join(repo, 'hooks', 'web.ts')).href)

const { data, git, usage, now, sessionId, cwd, answerable } = v2Session()
const state = W.deckStateOf(data, git, usage, now, sessionId, cwd, answerable)

/** Every file the sample is, by its path under web/fixtures: the state, then its lazy files. */
const files = new Map()
files.set('state.v2.json', `${JSON.stringify(state, null, 2)}\n`)
for (const file of W.agentFilesOf(data)) files.set(`v2/agents/${file.id}.json`, `${JSON.stringify(JSON.parse(file.text), null, 2)}\n`)
for (const patch of W.newPatchesOf(data, new Set())) files.set(`v2/patches/${patch.id}.diff`, patch.text)
for (const file of W.newMessageFilesOf(data)) files.set(`v2/messages/${file.id}.md`, file.text)

/** What is on disk now under web/fixtures: state.v2.json and everything in v2/, line ends as LF. */
function onDisk() {
  const found = new Map()
  const read = rel => found.set(rel, fs.readFileSync(path.join(here, rel), 'utf8').replace(/\r\n/g, '\n'))
  if (fs.existsSync(path.join(here, 'state.v2.json'))) read('state.v2.json')
  const walk = rel => {
    const dir = path.join(here, rel)
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const one = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(one)
      else read(one)
    }
  }
  walk('v2')
  return found
}

if (process.argv.includes('--check')) {
  const disk = onDisk()
  const stale = [...new Set([...files.keys(), ...disk.keys()])].filter(rel => files.get(rel) !== disk.get(rel)).sort()
  if (stale.length > 0) {
    console.error(`web/fixtures: the v2 sample is not what the builder makes now (run node web/fixtures/make-v2.mjs):\n  ${stale.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`web/fixtures: the v2 sample is current (${files.size} files)`)
} else {
  fs.rmSync(path.join(here, 'v2'), { recursive: true, force: true })
  for (const [rel, text] of files) {
    fs.mkdirSync(path.dirname(path.join(here, rel)), { recursive: true })
    fs.writeFileSync(path.join(here, rel), text)
  }
  console.log(`web/fixtures: wrote state.v2.json and ${files.size - 1} lazy files under v2/`)
}
