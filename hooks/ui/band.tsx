/**
 * The band above the prompt: one line, shown only while an agent is at
 * work or something needs you, "● 3 working · ? 1 question", then `/deck`,
 * which opens the deck on Now. Its words are the v2 state's (`W.bandOf`,
 * handed in as `DeckModel.band`); the glyphs carry the status hues (blue at
 * work, amber what needs you). No hotkeys: a bare digit in an empty prompt
 * would answer a band Button.
 *
 * Pure: Kit, the band and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { V2Band } from '../web'
import type { Actions, Kit } from './types'
import { P } from './v2/palette'

/** The band's line over what the engine drew there (`theirs`); null when it has nothing to say. */
export function bandView(kit: Kit, band: V2Band | null | undefined, actions: Pick<Actions, 'open'>, theirs: RenderElement | null): RenderElement | null {
  const { Box, Text, Button } = kit
  if (!band || band.parts.length === 0) return null
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            {band.parts.flatMap((part, i) => [
              i > 0 ? <Text color={P.muted2}> · </Text> : null,
              <Text color={part.kind === 'working' ? P.run : P.wait}>{part.glyph}</Text>,
              <Text color={P.fg2}>{` ${part.text}`}</Text>,
            ])}
            <Text color={P.muted2}> · </Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Button key="band:open" label="/deck" plain onPress={() => actions.open('now')} />
        </Box>
      </Box>
      {theirs}
    </Box>
  )
}
