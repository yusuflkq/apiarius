/**
 * The types of web/avatars.mjs, the deck's one avatar library: the web page
 * imports the module as it is, the mod through these declarations.
 */

/** The styles the deck draws an agent in. */
export type AvatarStyle = 'robot' | 'mood' | 'critter' | 'pixel' | 'mono' | 'orbit' | 'bauhaus' | 'ring' | 'glyph' | 'blob'

/** A status as an avatar shows it: starting reads as running, stopped as idle. */
export type AvatarLook = 'running' | 'waiting' | 'done' | 'failed' | 'idle'

/** Who an avatar draws: seeded by `id` (else `name`); `role` 'main' is the Orchestrator; `status` the deck's; `progress` 0 to 1 for a progress ring. */
export type AvatarAgent = { id?: string; name?: string; role?: string; status?: string; progress?: number | null }

export type AvatarOptions = {
  /** Its status's motion (a robot's), still under prefers-reduced-motion; off by default. */
  animated?: boolean
  /** CSS px square; 40 by default. */
  size?: number
  /** false leaves the status dot off. */
  dot?: boolean
  /** The document's id prefix; by default one made from all it draws. */
  id?: string
  /** The colour the status dot is ringed in. */
  ground?: string
}

export const STYLES: readonly { readonly id: AvatarStyle; readonly name: string }[]
export const STYLE_IDS: readonly AvatarStyle[]
export const DEFAULT_STYLE: 'robot'
export const PALETTE: readonly (readonly [string, string])[]
export const LOOK_HUE: Readonly<Record<AvatarLook, string>>
export const LOOK_MARK: Readonly<Record<AvatarLook, string>>
export const GLYPHS: readonly string[]

export function lookOf(status: string | undefined): AvatarLook
export function isStyle(value: unknown): value is AvatarStyle
export function styleOf(value: unknown): AvatarStyle
export function styleName(style: string): string
export function hash(text: string): number
export function pickOf(text: string): number
export function paletteIndexOf(agent: AvatarAgent): number
export function colorsOf(agent: AvatarAgent): readonly [string, string]
export function progressOf(todos: readonly { status: string }[] | undefined): number | undefined
export function avatarSvg(style: string, agent: AvatarAgent, opts?: AvatarOptions): string
export function stackWidth(n: number, size: number, overlap?: number): number
export function avatarStackSvg(style: string, agents: readonly (AvatarAgent | null)[], opts?: { size?: number; overlap?: number; ground?: string; id?: string }): string
export function terminalFace(agent: AvatarAgent): { glyph: string; color: string; mark: string; markColor: string }
export function dataUrl(svg: string): string
