/**
 * The page as one script, for a vm with no DOM (page.test.js,
 * sessions.test.js): app.js and every module of the page's own it imports,
 * in the order a browser runs them, their imports and exports left off. The
 * avatar library and the timeline's layout, which the mod imports too, are
 * not in it: the vm hands them in as `__avatars` and `__timeline`, the AV and
 * TL the modules import.
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const WEB = path.join(__dirname, '..')
/** A module's import of another of the page's files, `import * as AV from './avatars.mjs';` or `import { a, b } from './state.mjs';` (on lines of their own, CRLF too: a Windows checkout's). */
const IMPORT = /^import\s+(?:\*\s+as\s+\w+|\{[^}]*\})\s+from\s+'\.\/([\w.-]+)';\r?\n/gm
/** What the mod imports too: handed in, never read here. */
const LIBRARIES = new Set(['avatars.mjs', 'timeline.mjs'])

/** The page's own modules, app.js last, in the order a browser runs them: each after the ones it imports, a cycle cut where it closes. */
function modules(file = 'app.js', seen = new Set(), order = []) {
  seen.add(file)
  for (const [, dep] of fs.readFileSync(path.join(WEB, file), 'utf8').matchAll(IMPORT)) if (!LIBRARIES.has(dep) && !seen.has(dep)) modules(dep, seen, order)
  order.push(file)
  return order
}

/** The page as one script: every module in that order, its imports and its exports' `export` left off, AV and TL from the vm. */
function pageScript() {
  const parts = modules().map(file => fs.readFileSync(path.join(WEB, file), 'utf8').replace(IMPORT, '').replace(/^export (?=(?:async )?function |const |let |class )/gm, ''))
  const script = ['const AV = __avatars;', 'const TL = __timeline;', ...parts].join('\n')
  const left = /^(?:import|export)\b.*/m.exec(script)
  if (left) throw new Error(`page-script: a module's ${left[0]} is not one it can leave off`)
  return script
}

module.exports = { modules, pageScript }
