/**
 * The web deck on the sample state: `node web/dev.js` runs the server against
 * web/fixtures with a fixed dev token and prints the URL to open. Commands the
 * page sends are printed here too. Edit web/fixtures/state.json to see a live
 * update; Ctrl+C stops both processes.
 */
'use strict'
const { spawn } = require('child_process')
const path = require('path')

const TOKEN = 'agent-deck-dev-token'
const args = [path.join(__dirname, 'server.js'), '--dir', path.join(__dirname, 'fixtures'), '--parent', String(process.pid)]
// stdin stays a pipe: the server leaves when it closes, so it goes when this process does
const server = spawn(process.execPath, args, { env: { ...process.env, AGENT_DECK_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] })

let buffer = ''
server.stdout.setEncoding('utf8').on('data', chunk => {
  buffer += chunk
  let at
  while ((at = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    const ready = /^\{"ready":(\d+)\}$/.exec(line)
    console.log(ready ? `Agent Deck (dev): http://127.0.0.1:${ready[1]}/?t=${TOKEN}` : `command: ${line}`)
  }
})
server.on('exit', code => process.exit(code ?? 0))
