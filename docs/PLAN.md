# Gamebody prototype

## Version 0.2.0: sounds and two-part loops

- [x] Make Select cycle C4 → C5 → C2 → C3 → C4.
- [x] Make A+B at rest cycle square, triangle, and drums.
- [x] Record up to 512 frames in the NES's internal RAM.
- [x] Keep the first part playing while recording a second part.
- [x] Keep live playing available during playback.
- [x] Make Start tap record/loop/add/redo; hold one second to clear both parts.
- [x] Update the cartridge display and accessible browser controls.
- [x] Test tuning, sound changes, exact playback, boundaries, capacity,
      channel priority, clearing, reset, and display timing.
- [x] Render the audio example, inspect the browser display, and package the ROM.

All 26 ROM checks pass. The browser was checked through recording, adding a
second part, pause/resume, and clearing, with no reported browser errors.

Two parts fit in ordinary NES working memory by storing the resolved note,
patch, and burst flag in one byte per frame. Both last up to 8.52 seconds.
No battery is needed during play. Recordings are lost on reset or power-off.
The ROM keeps the original NROM layout without extra cartridge RAM.

Live notes have first claim on the original audio channels. The second loop
has priority over the first when they need the same triangle or noise channel.
Two square leads fit at once; a quiet echo uses a spare pulse channel.

The user chose three native sounds and the ability to record another part
while the loop plays. No substitute sine preset or single-phrase-only mode.

## Version 0.1.0

- [x] Build a standalone NTSC NES ROM with immediate eight-note controls.
- [x] Add momentary B bursts and a local browser emulator.
- [x] Test pitches, note changes, release, octave limits, effects, and startup.
- [x] Check the browser; render audio and a cartridge screenshot.
- [x] Publish public source and the ROM.

The original 10 checks passed locally and in
[GitHub Actions](https://github.com/songadaymann/musical-nes-gamebody/actions/runs/40046287455).
The [v0.1.0 release](https://github.com/songadaymann/musical-nes-gamebody/releases/tag/v0.1.0)
ROM matched the tested local build byte for byte.

## Remaining hardware work

Play with a physical controller, then test original NTSC hardware and a
compatible NROM cartridge board or flash cartridge. Physical USB controllers
and real phone touch remain untested. PAL, Game Boy, MIDI, persistent storage,
and cartridge manufacturing are separate follow-ups.
