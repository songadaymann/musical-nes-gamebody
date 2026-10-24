# Gamebody prototype

## Browser latency

- [x] Measure the preview's audio queue and reported output delay.
- [x] Drive emulation from audio demand, independently of screen refresh.
- [x] Bound buffering and preserve loop timing through pause/resume.
- [x] Test the audio transport and verify keyboard play in the browser.

The preview now requests one NES frame when the audio queue needs it. Painting
and accessible status updates run separately. Generation IDs reject pending
audio from before a pause. The ROM and its controls are unchanged.

On October 24, 2026, the old queue averaged 31.6 ms and peaked at 45 ms.
The final queue averaged 24.9 ms and peaked at 34.6 ms, with no missing samples
in a 59-second run before pausing.
Checks included keyboard recording, adding a second part, and resuming both
parts after a pause. Browser errors: none.

The output path changed during the check: the old run used 48 kHz and reported
168 ms of output delay; the new run used 44.1 kHz and reported 32 ms. The output
delay change is not attributed to the code. Only the preview queue is being
compared; physical key-to-ear latency has not been measured.

A 6 ms refill allowance produced gaps under browser load. Both 12 ms and 14 ms
left sub-millisecond gaps in longer runs after resuming, with emulation work
peaking at 12.5 ms. The final refill allowance is 18 ms to cover that work and
the message round trip. All 34 checks pass:
26 ROM checks and eight audio checks, including
three sample rates, delayed replies, stale packets, pause/resume, and ten
seconds of real-ROM playback without any screen refresh callbacks. The ROM
still matches the published v0.2.0 SHA-256:
`508ffc4e0593158a3ddb22d9e8b9dfbb0e60b81f1c61f269b9a112d9cb302525`.

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
