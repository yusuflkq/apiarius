/**
 * web/open.js, which "Open in browser" runs with node: it opens the deck's own
 * link, and only that, with the system's opener; the link comes on stdin.
 */
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const OPEN = path.join(__dirname, '..', 'open.js')
const { isLink, openerOf } = require('../open.js')
const LINK = 'http://127.0.0.1:4321/?t=f-0011223344556677-a284df635f2f16617d5887d94954f3f8'

test('opens the deck`s link alone: its own address, a port and a ticket of the server`s shape; nothing else', () => {
  assert.equal(isLink(LINK), true)
  assert.equal(isLink(LINK.replace('/?t=f-', '/?t=p-')), true)
  for (const other of [
    'http://localhost:4321/?t=f-0011223344556677-a284df635f2f16617d5887d94954f3f8',
    'https://127.0.0.1:4321/?t=f-0011223344556677-a284df635f2f16617d5887d94954f3f8',
    'http://127.0.0.1:4321/?t=f-0011223344556677-a284df635f2f16617d5887d94954f3f8&x=1',
    'http://127.0.0.1:4321/?t=f-0011223344556677-a284df635f2f16617d5887d94954f3f8" & calc',
    'http://evil.example/?t=f-0011223344556677-a284df635f2f16617d5887d94954f3f8',
    'file:///etc/passwd',
    `${LINK}\nhttp://evil.example`,
    '',
  ]) assert.equal(isLink(other), false, other)
})

test('the opener by platform: open on macOS, start through cmd on Windows (the link quoted, an empty title first), xdg-open elsewhere', () => {
  assert.deepEqual(openerOf('darwin', LINK), { file: 'open', args: [LINK], verbatim: false })
  assert.deepEqual(openerOf('linux', LINK), { file: 'xdg-open', args: [LINK], verbatim: false })
  assert.deepEqual(openerOf('win32', LINK), { file: 'cmd.exe', args: ['/d', '/s', '/c', `"start "" "${LINK}""`], verbatim: true })
})

test('a link that is not the deck`s is refused, one line said, nothing opened', () => {
  const ran = spawnSync(process.execPath, [OPEN], { input: 'http://evil.example/\n', encoding: 'utf8', windowsHide: true })
  assert.equal(ran.status, 0)
  assert.deepEqual(JSON.parse(ran.stdout), { ok: false, why: 'not the deck’s link' })
})
