/**
 * Seals: what proves a file one session's deck reads of another's (its
 * registry file, the inbox file it writes into the other's state folder)
 * was written by one of the person's own decks, so that no other program,
 * no agent with a file tool and no other person on the machine can list a
 * session or send a deck a command.
 *
 * - **The key.** 32 random bytes every session of the person's shares,
 *   kept in the plugin's own store (`$.store`: a file of theirs under their
 *   Claude Code configuration folder, readable by them alone and in no
 *   workspace). The first deck that finds none makes it; two that start at
 *   once settle on the one the store keeps (`keyOf` on every read).
 * - **The seal.** HMAC-SHA256 (RFC 2104) of what a file says, its kind
 *   first (`ENTRY`, `INBOX`), as `seal` beside what it says, in hex. The
 *   hooks environment has no HMAC (its `crypto.subtle` digests alone, and
 *   only asynchronously), so SHA-256 (FIPS 180-4) and HMAC are here, in
 *   plain code that answers at once (tests/seal.test.ts checks both against
 *   their standards' own vectors); a seal is compared in constant time.
 *
 * What a file says is sealed as `JSON.stringify([kind, value])` of the
 * value as written, and checked on the value as read back: JSON's text of
 * a value parsed from JSON's text is that text again.
 */

/** Where the key is kept in the plugin's store. */
export const KEY_STORE = 'sealKey'

/** A registry file's seal, and an inbox file's: what each says sealed with its kind, so one is never taken for the other. */
export const ENTRY = 'apiarius/registry/1'
export const INBOX = 'apiarius/inbox/1'

/** The key, as its bytes and as the store keeps it (64 hex digits). */
export type SealKey = { bytes: Uint8Array; hex: string }

const HEX_KEY = /^[0-9a-f]{64}$/
const HEX_SEAL = /^[0-9a-f]{64}$/
const BLOCK = 64

/** The key a stored value holds; null for anything but 64 lower-case hex digits. */
export function keyOf(value: unknown): SealKey | null {
  if (typeof value !== 'string' || !HEX_KEY.test(value)) return null
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return { bytes, hex: value }
}

/** A new key: 32 bytes from the environment's own source of randomness. */
export function newKey(): SealKey {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return { bytes, hex: hexOf(bytes) }
}

function hexOf(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** SHA-256's round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256's first hash value: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19] as const

function ror(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** SHA-256 (FIPS 180-4) of `data`. */
export function sha256(data: Uint8Array): Uint8Array {
  // the message, a 1 bit, zeros, and its length in bits (64, big-endian), to a whole number of 64-byte blocks
  const padded = new Uint8Array(((data.length + 9 + 63) >>> 6) << 6)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000))
  view.setUint32(padded.length - 4, (data.length << 3) >>> 0)
  const h = new Uint32Array(H0)
  const w = new Uint32Array(64)
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0
      const b = w[i - 2] ?? 0
      w[i] = (w[i - 16] ?? 0) + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + (w[i - 7] ?? 0) + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))
    }
    let a = h[0] ?? 0
    let b = h[1] ?? 0
    let c = h[2] ?? 0
    let d = h[3] ?? 0
    let e = h[4] ?? 0
    let f = h[5] ?? 0
    let g = h[6] ?? 0
    let k = h[7] ?? 0
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) | 0
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      k = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] = (h[0] ?? 0) + a
    h[1] = (h[1] ?? 0) + b
    h[2] = (h[2] ?? 0) + c
    h[3] = (h[3] ?? 0) + d
    h[4] = (h[4] ?? 0) + e
    h[5] = (h[5] ?? 0) + f
    h[6] = (h[6] ?? 0) + g
    h[7] = (h[7] ?? 0) + k
  }
  const out = new Uint8Array(32)
  const put = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) put.setUint32(i * 4, h[i] ?? 0)
  return out
}

function joined(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** HMAC-SHA256 (RFC 2104) of `message` (a string as UTF-8) under `key`, in hex: SHA-256 of the key's outer pad and SHA-256 of its inner pad and the message. */
export function hmacHex(key: Uint8Array, message: string | Uint8Array): string {
  const block = new Uint8Array(BLOCK)
  block.set(key.length > BLOCK ? sha256(key) : key)
  const inner = new Uint8Array(BLOCK)
  const outer = new Uint8Array(BLOCK)
  for (let i = 0; i < BLOCK; i++) {
    inner[i] = (block[i] ?? 0) ^ 0x36
    outer[i] = (block[i] ?? 0) ^ 0x5c
  }
  const text = typeof message === 'string' ? new TextEncoder().encode(message) : message
  return hexOf(sha256(joined(outer, sha256(joined(inner, text)))))
}

/** Whether two seals are the same, in time that does not depend on where they differ. */
export function isSameSeal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The seal of `value` as a file of `kind` says it. */
export function sealOf(key: SealKey, kind: string, value: unknown): string {
  return hmacHex(key.bytes, JSON.stringify([kind, value]))
}

/** A file of `kind` saying `value`, sealed: its JSON with `seal` beside what it says, and a newline. */
export function sealedText(key: SealKey, kind: string, value: Record<string, unknown>): string {
  return `${JSON.stringify({ ...value, seal: sealOf(key, kind, value) })}\n`
}

/**
 * A file of `kind` read back: what it says (`seal` left out) when its seal
 * is that of what it says under `key`; null for one that is no JSON object,
 * has no seal, or whose seal is not its own (another key's, or forged).
 */
export function openedOf(key: SealKey, kind: string, text: string): Record<string, unknown> | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { seal, ...said } = value as Record<string, unknown>
  if (typeof seal !== 'string' || !HEX_SEAL.test(seal)) return null
  return isSameSeal(sealOf(key, kind, said), seal) ? said : null
}

/** Whether `text` is JSON at all: one that is not may be a file still being written, which is read again, never removed. */
export function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
