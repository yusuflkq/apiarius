/**
 * The band above the prompt: one line, shown only while an agent is at
 * work, something needs you, or something runs in the background or is
 * scheduled, "● 3 working · ? 1 question · ◐ 2 in the background · ◷ 1
 * scheduled", then `/apiarius`, which opens the deck on Now. Its words are the
 * v2 state's (`W.bandOf`, handed in as `DeckModel.band`); the glyphs carry
 * the status hues (blue at work and in the background, amber what needs
 * you, grey what is scheduled). No hotkeys: a bare digit in an empty prompt
 * would answer a band Button.
 *
 * Above that line, a row for each thing the Browser pane's web page sent in
 * your voice, or for another session's deck (../hold, `DeckModel.held`):
 * `Web page → Orchestrator: “fix the flaky test”  [Send] [Discard]`. A long
 * or many-line one shows its start and More, and its Send only once More
 * opened it, so its whole text is on screen when you press Send. Those rows
 * show whatever else does (the band hidden, nothing at work): your Send is
 * the only way they go. No row takes the focus itself (no `autoFocus`): you
 * move into the band (a click; ctrl+x tab on the terminal) and Tab to a
 * Send, so an Enter meant for the prompt never sends a row that appeared
 * just then.
 *
 * Pure: Kit, the band, the rows and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { HeldRow } from '../hold'
import type { V2Band } from '../web'
import type { Actions, Kit } from './types'
import { P } from './v2/palette'

/** The presses the band makes. */
type BandActions = Pick<Actions, 'open' | 'sendHeld' | 'discardHeld' | 'toggleHeld'>

/** The band over what the engine drew there (`theirs`): the rows waiting for your Send, then its line; null when it has nothing to say. */
export function bandView(kit: Kit, band: V2Band | null | undefined, actions: BandActions, theirs: RenderElement | null, held: readonly HeldRow[] = []): RenderElement | null {
  const { Box, Text } = kit
  const hasLine = !!band && band.parts.length > 0
  if (!hasLine && held.length === 0) return null
  return (
    <Box flexDirection="column">
      {held.map(row => heldRow(kit, row, actions))}
      {held.length > 0 && kit.surface === 'terminal' ? (
        <Box key="held:keys">
          <Text color={P.muted2} wrap="truncate-end">
            ctrl+x tab, then Tab to a Send and Enter · a long one's Send shows once More opens it
          </Text>
        </Box>
      ) : null}
      {band && hasLine ? statusLine(kit, band, actions) : null}
      {theirs}
    </Box>
  )
}

/** The band's own line: what is at work and what needs you, then `/apiarius`. */
function statusLine(kit: Kit, band: V2Band, actions: BandActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key="band:line" flexDirection="row">
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          {band.parts.flatMap((part, i) => [
            i > 0 ? <Text color={P.muted2}> · </Text> : null,
            <Text color={part.kind === 'working' ? P.run : part.kind === 'background' ? P.runText : part.kind === 'scheduled' ? P.muted : P.wait}>{part.glyph}</Text>,
            <Text color={P.fg2}>{` ${part.text}`}</Text>,
          ])}
          <Text color={P.muted2}> · </Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Button key="band:open" label="/apiarius" plain onPress={() => actions.open('now')} />
      </Box>
    </Box>
  )
}

/** One row waiting for your Send: who sent it and to whom, its words (cut to the row; More shows them whole), Send (a long one's once it is open) and Discard. */
function heldRow(kit: Kit, row: HeldRow, actions: BandActions): RenderElement {
  const { Box, Text, Button } = kit
  const isBare = row.isOpen || row.text === ''
  return (
    <Box key={`held:${row.key}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>
          <Text bold color={P.waitText}>
            Web page
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color={P.muted}>{isBare ? row.what : `${row.what}: `}</Text>
            {isBare ? null : <Text color={P.text}>{`“${row.text}”`}</Text>}
          </Text>
        </Box>
        {row.isLong ? (
          <Box flexShrink={0}>
            <Button key={`held:more:${row.key}`} label={row.isOpen ? 'Less' : 'More'} plain dimColor onPress={() => actions.toggleHeld(row.key)} />
          </Box>
        ) : null}
        {row.isLong && !row.isOpen ? null : (
          <Box flexShrink={0}>
            <Button key={`held:send:${row.key}`} label="Send" variant="primary" onPress={() => actions.sendHeld(row.key)} />
          </Box>
        )}
        <Box flexShrink={0}>
          <Button key={`held:discard:${row.key}`} label="Discard" onPress={() => actions.discardHeld(row.key)} />
        </Box>
      </Box>
      {row.isOpen ? (
        <Box paddingLeft={2}>
          <Text color={P.fg2} wrap="wrap">
            {row.whole}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
