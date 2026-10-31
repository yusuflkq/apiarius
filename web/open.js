/**
 * Opens the web deck's link in the person's own browser, with the system's
 * opener: `open` on macOS, `start` on Windows (through cmd, no other shell),
 * `xdg-open` elsewhere. The deck's "Open in browser" runs it with node.
 *
 *   node web/open.js   (the link on stdin)
 *
 * The link comes on stdin, never argv, so node's own command line never
 * holds it; it must be the deck's own, `http://127.0.0.1:<port>/?t=<ticket>`,
 * and nothing else is opened. The ticket opens one page (web/server.js): the
 * person's browser trades it for a handle the moment the page loads.
 *
 * It prints one line, `{"ok":true}` or `{"ok":false,"why":...}`, and exits 0
 * either way.
 */
'use strict'
const { spawn } = require('child_process')

/** The deck's link, and only it: the server's own address, a port, and a ticket of web/server.js's shape. */
const LINK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/\?t=[pf]-[0-9a-f]{16}-[0-9a-f]{32}$/

/** Whether `text` is a link this opens. */
const isLink = text => typeof text === 'string' && LINK.test(text)

/** The opener's command line for `url` on `platform` (`process.platform`), and how node passes it on. */
function openerOf(platform, url) {
  if (platform === 'darwin') return { file: 'open', args: [url], verbatim: false }
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
    const { file, args, verbatim } = openerOf(process.platform, url)
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

if (require.main === module) main()

module.exports = { isLink, openerOf }
