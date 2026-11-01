/**
 * Seals (hooks/seal.ts): SHA-256 and HMAC-SHA256 against their standards'
 * own vectors (FIPS 180-4's examples, RFC 4231's cases), the key as the
 * store keeps it, and a sealed file read back: what it says only where its
 * seal is its own, under the key and for its kind.
 */
import { expect, test } from 'claude-code/testing'

import * as SL from '../hooks/seal'

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const utf8 = (text: string) => new TextEncoder().encode(text)
const filled = (length: number, byte: number) => new Uint8Array(length).fill(byte)
const bytesOf = (hexText: string) => new Uint8Array(hexText.match(/../g)?.map(pair => parseInt(pair, 16)) ?? [])

test('SHA-256 as FIPS 180-4 has it: the empty message, "abc", the two-block message, a million a`s, and every length across a block`s padding', () => {
  expect(hex(SL.sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  expect(hex(SL.sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(hex(SL.sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  expect(hex(SL.sha256(utf8('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')))).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
  expect(hex(SL.sha256(filled(1_000_000, 0x61)))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  // 55, 56 and 64 bytes: the length's own block, or one more
  expect(hex(SL.sha256(filled(55, 0x61)))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318')
  expect(hex(SL.sha256(filled(56, 0x61)))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a')
  expect(hex(SL.sha256(filled(64, 0x61)))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb')
})

test('HMAC-SHA256 as RFC 4231 has it: each of its cases, a key longer than a block hashed first, a truncated one`s first 128 bits', () => {
  const cases: [Uint8Array, Uint8Array, string][] = [
    [filled(20, 0x0b), utf8('Hi There'), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
    [utf8('Jefe'), utf8('what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
    [filled(20, 0xaa), filled(50, 0xdd), '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe'],
    [bytesOf('0102030405060708090a0b0c0d0e0f10111213141516171819'), filled(50, 0xcd), '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b'],
    [filled(131, 0xaa), utf8('Test Using Larger Than Block-Size Key - Hash Key First'), '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'],
    [filled(131, 0xaa), utf8('This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.'), '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2'],
  ]
  for (const [key, message, want] of cases) expect(SL.hmacHex(key, message)).toBe(want)
  expect(SL.hmacHex(filled(20, 0x0c), utf8('Test With Truncation')).slice(0, 32)).toBe('a3b6167473100ee06e0c796c2955552b')
  // a string is its UTF-8
  expect(SL.hmacHex(utf8('k'), 'é…')).toBe(SL.hmacHex(utf8('k'), utf8('é…')))
})

test('the key: 64 lower-case hex digits as the store keeps them, anything else none; a new one random each time', () => {
  const key = SL.keyOf('0123456789abcdef'.repeat(4))
  expect(key?.bytes.length).toBe(32)
  expect(key?.bytes[1]).toBe(0x23)
  for (const bad of ['', 'ab', '0123456789ABCDEF'.repeat(4), `${'0'.repeat(63)}g`, '0'.repeat(65), 5, null, undefined, { hex: '0'.repeat(64) }]) expect(SL.keyOf(bad)).toBeNull()
  const one = SL.newKey()
  const two = SL.newKey()
  expect(one.hex).toMatch(/^[0-9a-f]{64}$/)
  expect(SL.keyOf(one.hex)?.hex).toBe(one.hex)
  expect(one.hex).not.toBe(two.hex)
})

test('a sealed file read back: what it says, its seal left out, only under its own key and kind; changed by one character, given another file`s seal, a seal of another length or none, it says nothing', () => {
  const key = SL.keyOf('5e'.repeat(32))!
  const said = { v: 1, id: 'other-1', cost: 0.1 + 0.2, text: 'é "quoted" \\   line', nested: { '1': 2, b: [1, null, true] } }
  const text = SL.sealedText(key, SL.ENTRY, said)
  expect(text.endsWith('}\n')).toBe(true)
  expect(SL.openedOf(key, SL.ENTRY, text)).toEqual(said)
  // another key's, or another kind's (an inbox file's seal on a registry file)
  expect(SL.openedOf(SL.newKey(), SL.ENTRY, text)).toBeNull()
  expect(SL.openedOf(key, SL.INBOX, text)).toBeNull()
  // what it says changed, its seal kept
  expect(SL.openedOf(key, SL.ENTRY, text.replace('other-1', 'other-2'))).toBeNull()
  expect(SL.openedOf(key, SL.ENTRY, text.replace('"v":1', '"v":1,"dir":"/tmp/x"'))).toBeNull()
  // another file's seal; a seal cut, upper-cased or missing; no JSON object at all
  const seal = (JSON.parse(text) as { seal: string }).seal
  const other = SL.sealedText(key, SL.ENTRY, { ...said, id: 'other-2' })
  expect(SL.openedOf(key, SL.ENTRY, other.replace(/"seal":"[0-9a-f]+"/, `"seal":"${seal}"`))).toBeNull()
  expect(SL.openedOf(key, SL.ENTRY, text.replace(seal, seal.slice(0, 63)))).toBeNull()
  expect(SL.openedOf(key, SL.ENTRY, text.replace(seal, seal.toUpperCase()))).toBeNull()
  expect(SL.openedOf(key, SL.ENTRY, JSON.stringify(said))).toBeNull()
  for (const junk of ['', '{', '[]', 'null', '"x"', `[${text}]`]) expect(SL.openedOf(key, SL.ENTRY, junk)).toBeNull()
  // read again with white space around it: the same
  expect(SL.openedOf(key, SL.ENTRY, `  ${text}   `)).toEqual(said)
  expect(SL.isJson('{')).toBe(false)
  expect(SL.isJson(text)).toBe(true)
})

test('seals compare in constant time: equal ones alike, any one character or the length apart not', () => {
  const seal = SL.hmacHex(utf8('k'), 'x')
  expect(SL.isSameSeal(seal, seal)).toBe(true)
  expect(SL.isSameSeal(seal, `${seal.slice(0, 63)}${seal.endsWith('0') ? '1' : '0'}`)).toBe(false)
  expect(SL.isSameSeal(seal, `${seal.endsWith('0') ? '1' : '0'}${seal.slice(1)}`)).toBe(false)
  expect(SL.isSameSeal(seal, seal.slice(1))).toBe(false)
  expect(SL.isSameSeal('', '')).toBe(true)
})
