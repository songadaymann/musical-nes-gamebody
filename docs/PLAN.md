# First playable prototype

- [x] Choose an immediate eight-note layout and a momentary B effect.
- [x] Build a standalone NTSC NES ROM using the console's own sound channels.
- [x] Add a local browser emulator with keyboard, touch, and controller input.
- [x] Verify pitches, note changes, release, octave limits, effects, and startup.
- [x] Inspect the screen and browser experience; render an audio demonstration.
- [ ] Run the public-source check, commit, and publish the repository and ROM.

## Scope

Working title: Gamebody. One expressive sound, immediate startup, no tracker,
sequencer, configuration screens, or menus. The screen shows the note being
played and the controls. All sound and instrument behavior must live in the ROM.

Left/down/up/right play C/D/E/G. Holding A changes these to A/C/D/E higher
in the C-major pentatonic scale. B repeats plucks with an octave answer. Select/Start
move the base octave down/up, bounded at C2 and C5, starting at C4.
Most-recently-pressed direction wins when directions overlap. Letting go of
that direction falls back to any direction still held. Holding A or B alone
does not start a note. Octave changes happen once per press.

## Later decisions

Play with a real controller before choosing additional sounds or changing the
layout. Confirm original-hardware timing and audio, then choose a compatible
NROM cartridge board/flash cartridge. PAL tuning, Game Boy, MIDI, recording,
presets, and standalone cartridge manufacturing are separate follow-ups.
