/**
 * The types of web/timeline.mjs, how every surface lays Org's Timeline out:
 * the web page imports the module as it is, the mod through these
 * declarations.
 */

/** A stretch of a lane, as V2Timeline's lanes hold them: `to` null runs to now. */
export type Stretch = { kind: 'work' | 'wait' | 'idle'; from: number; to: number | null }

/** A fold: a stretch where nobody worked, and where its break sits on the axis. */
export type Fold = { from: number; to: number; x0: number; x1: number }

export type Axis = {
  span: number
  room: number
  /** How wide each fold's break is. */
  gap: number
  /** How much room a ms of open time takes. */
  per: number
  folds: Fold[]
  x: (ms: number) => number
}

export type AxisWord = { x: number; text: string; align: 'start' | 'middle' | 'end'; kind: 'now' | 'fold' | 'start' | 'edge' | 'tick' }

/** A call as segmentsOf takes it: `ms` -1 for an end not seen; `how` 1 ok, 0 failed, -1 not known. */
export type Call = { at: number; ms: number; tool: string; how: number }

export type Segment = { from: number; to: number; x0: number; x1: number; tool: string; count: number; tools: Record<string, number>; failed: boolean; running: boolean }

export type Crossing = { at: number; n: number; role: 'from' | 'to' | 'pass'; down: boolean }

export type Row<L, B> = { kind: 'lane'; lane: L } | { kind: 'bg'; bg: B }

export const FOLD_MS: number
export const GROUP_MS: number

export function busyOf(lanes: readonly { spans: readonly Stretch[] }[], span: number): [number, number][]
export function foldsOf(lanes: readonly { spans: readonly Stretch[] }[], span: number, min?: number): { from: number; to: number }[]
export function axisOf(span: number, folds: readonly { from: number; to: number }[], room: number, gap: number): Axis
export function isFolded(axis: Axis, ms: number): boolean
export function clockOf(at: number): string
export function lengthOf(ms: number): string
export function axisWordsOf(axis: Axis, startedAt: number, widthOf: (text: string) => number, gap: number, fold?: string | null): AxisWord[]
export function rowsOf<L extends { id: string }, B extends { by: string | null; start: number }>(lanes: readonly L[], background: readonly B[]): Row<L, B>[]
export function newestOf<L extends { id: string; start: number }>(lanes: readonly L[], most: number): { lanes: L[]; more: number }
export function segmentsOf(calls: readonly Call[], axis: Axis, opts?: { liveTo?: number | null; min?: number; join?: number }): Segment[]
export function segmentLabel(segment: Segment, w: number, widthOf: (text: string) => number, rich?: boolean, pad?: number): string
export function toolsText(segment: Segment): string
export function crossingsOf(ids: readonly string[], messages: readonly { at: number; from: string; to: string }[]): Crossing[][]
export function numberedOf<M extends { from: string; to: string }>(ids: readonly string[], messages: readonly M[]): (M & { n: number })[]
