/**
 * Opens the web deck's link in the person's own browser, with the system's
 * opener. The deck's "Open in browser" runs it with node.
 *
 *   node web/open.js   (the link on stdin)
 *
 * The link comes on stdin, never argv, so node's own command line never
 * holds it; it must be the deck's own, `http://127.0.0.1:<port>/?t=<ticket>`,
 * and nothing else is opened. The ticket opens one page (web/server.js): the
 * person's browser trades it for a handle the moment the page loads.
 *
 * Any program of the person's can read every process's arguments (`ps`), and
 * a link read there could be traded before the browser trades it. So on
 * macOS the link never goes in an argument: `osascript -` reads
 * `open location "<link>"` on its stdin, and Launch Services hands the link to
 * the browser in an Apple event, a browser it starts included. Windows
 * (`start`, through cmd, no other shell) and Linux (`xdg-open`) have no such
 * way: there the opener's arguments hold the link while it runs, so the deck
 * makes this link work for 30 seconds only (its ticket says until when).
 *
 * It prints one line, `{"ok":true}` or `{"ok":false,"why":...}`, and exits 0
 * either way.
 */
'use strict'
const { spawn } = require('child_process')

/** The deck's link, and only it: the server's own address, a port, and a ticket of web/server.js's shape (a deadline in it or none). */
const LINK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/\?t=[pf]-[0-9a-f]{16}(?:-[0-9a-f]{8})?-[0-9a-f]{32}$/
/** How long osascript may take to hand the link over (a browser it starts included) before this says it could not. */
const OSASCRIPT_MS = 8000

/** Whether `text` is a link this opens. */
const isLink = text => typeof text === 'string' && LINK.test(text)

/** An AppleScript string of `text`: quoted, a quote or backslash in it escaped (the deck's link holds neither). */
const appleString = text => `"${text.replace(/[\\"]/g, '\\$&')}"`

/** The opener's command line for `url` on `platform` (`process.platform`), how node passes it on, and what goes on its stdin (macOS: the script, so no argument holds the link). */
function openerOf(platform, url) {
  if (platform === 'darwin') return { file: 'osascript', args: ['-'], verbatim: false, stdin: `open location ${appleString(url)}\n` }
  // `start` is cmd's own: its first quoted word is the window's title, so an empty one goes first; the whole line quoted once more, which /s takes off (as node's own shell option does); the link holds nothing cmd reads as an operator
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"start "" "${url}""`], verbatim: true }
  return { file: 'xdg-open', args: [url], verbatim: false }
}

let isDone = false

/** Prints what came of it, once. */
function done(value) {
  if (isDone) return
  isDone = true
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function main() {
  let text = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    text += chunk
    if (text.length > 2000) text = text.slice(0, 2001)
  })
  process.stdin.on('end', () => {
    const url = text.trim()
    if (!isLink(url)) return done({ ok: false, why: 'not the deck’s link' })
    const opener = openerOf(process.platform, url)
    if (opener.stdin !== undefined) return runScript(opener)
    const { file, args, verbatim } = opener
    let child
    try {
      child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: verbatim })
    } catch (err) {
      return done({ ok: false, why: String(err && err.message ? err.message : err) })
    }
    child.once('error', err => done({ ok: false, why: err.code === 'ENOENT' ? `${file} was not found` : err.message }))
    child.once('spawn', () => {
      child.unref()
      done({ ok: true })
    })
  })
}

/** macOS: osascript with its script on stdin, waited for, since it ends once the link is handed over; what it said on stderr is why it could not. */
function runScript({ file, args, stdin }) {
  let child
  try {
    child = spawn(file, args, { stdio: ['pipe', 'ignore', 'pipe'] })
  } catch (err) {
    return done({ ok: false, why: String(err && err.message ? err.message : err) })
  }
  let errors = ''
  const timer = setTimeout(() => {
    child.kill()
    done({ ok: false, why: `${file} did not answer` })
  }, OSASCRIPT_MS)
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { if (errors.length < 2000) errors += chunk })
  child.once('error', err => {
    clearTimeout(timer)
    done({ ok: false, why: err.code === 'ENOENT' ? `${file} was not found` : err.message })
  })
  child.once('close', code => {
    clearTimeout(timer)
    done(code === 0 ? { ok: true } : { ok: false, why: errors.split('\n').find(line => line.trim() !== '')?.trim() || `${file} ended with ${code}` })
  })
  child.stdin.on('error', () => {}) // a child that ended first: its close says why
  child.stdin.end(stdin)
}

if (require.main === module) main()

module.exports = { isLink, openerOf, appleString }
