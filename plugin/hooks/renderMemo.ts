/**
 * The tree each of the deck's sites drew last, handed back while what it was
 * drawn from is the same.
 *
 * The engine draws a site again whenever its props change, the ones the deck
 * never reads too: the click that gives the pane the keyboard flips its
 * `isFocused`. Every `<Button>` built gets a new press handle, and the engine
 * lets the old handles go as soon as the new drawing is in. The Desktop holds
 * that drawing back until the pointer is up, so the click it then sends names
 * a handle no longer held: nothing runs, and the person clicks again. Handing
 * back the same tree keeps every handle, and the click lands.
 *
 * The deck clears it whenever it asks for a redraw itself, so what it
 * invalidates is drawn afresh.
 */
export type RenderMemo = {
  /**
   * The tree drawn last under `site`, when it was drawn from the same
   * `inputs` (compared as JSON); else what `draw` returns, kept for next time.
   */
  of: <T>(site: string, inputs: readonly unknown[], draw: () => T) => T
  /** Forgets every tree: the next draw of each site builds anew. */
  clear: () => void
}

export function newRenderMemo(): RenderMemo {
  const trees = new Map<string, { key: string; tree: unknown }>()
  return {
    of<T>(site: string, inputs: readonly unknown[], draw: () => T): T {
      let key: string | undefined
      try {
        key = JSON.stringify(inputs)
      } catch {
        key = undefined
      }
      const last = trees.get(site)
      if (key !== undefined && last !== undefined && last.key === key) return last.tree as T
      const tree = draw()
      if (key === undefined) trees.delete(site)
      else trees.set(site, { key, tree })
      return tree
    },
    clear: () => trees.clear(),
  }
}
