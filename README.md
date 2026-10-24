# Gamebody

A pick-up-and-play NES instrument with square, triangle, and drum sounds.
Play a phrase, loop it, and add a second part with one button.

The sound, controls, and recorder run inside a real `.nes` ROM. The browser
preview runs that cartridge in [JSNES](https://github.com/bfirsh/jsnes).

**Play locally:** [localhost:4173](http://localhost:4173), after the setup below.
There is no public web deployment yet.

**Download:** [prototype releases](https://github.com/songadaymann/musical-nes-gamebody/releases).

## Controls

| NES controller | Keyboard preview | What it does |
| --- | --- | --- |
| Left / Down / Up / Right | Arrow keys | C / D / E / G |
| Hold A + a direction | Hold X + an arrow | A / C / D / E, higher in the scale |
| Hold B + a direction | Hold Z + an arrow | Rhythmic bursts; repeating hits for drums |
| Tap A+B with directions released | Tap X+Z with arrows released | Square → triangle → drums → square |
| Select | Shift | Cycle root octave: C4 → C5 → C2 → C3 → C4 |
| Tap Start | Tap Enter | Record → loop → add a part |
| Hold Start for one second | Hold Enter for one second | Clear both parts |

The eight pitched notes belong to C-major pentatonic: C, D, E, G, A, C, D, E.
A and B can be held together while playing, and do not start a note alone.
Release both before selecting another sound. The most recently pressed direction
wins; releasing it returns to a direction still held. Ties within one frame use
Right, Up, Down, Left priority. Octaves change once per Select press.

In drums, the lower bank is kick / snare / closed hat / tom. Hold A for
clap / open hat / click / zap. Select leaves drum pitches unchanged.

Touch buttons support simultaneous notes and modifiers. Browser-standard
gamepads use D-pad or left stick, bottom/right face buttons for A/B, and
Select/Start. Nonstandard USB adapters may need a desktop emulator's mapping.
The browser pauses on focus loss so notes cannot get stuck.

## Make a loop

1. Tap Start. The screen says **READY**; recording begins on your first note.
2. Play a phrase. Tap Start again to repeat it. The first take closes
   automatically at about 8½ seconds if you keep recording.
3. Play along. Change sound or octave freely; the recorded part keeps its own
   notes and sound changes.
4. Tap Start to record a second part while the first keeps playing. Recording
   lasts exactly one repetition, starting at the loop's current position.
   It then plays both parts. Tap Start sooner to finish the second part early.
5. Tap Start again to **REDO** the second part. The first stays intact.
   Hold Start for one second to clear both and begin again.

Start taps act when released. A second tap while READY cancels an empty take.
When a take closes, release any held direction before playing along, so the
same held note is not doubled.

There are two recorded parts, each up to 512 video frames (about 8.52 seconds
on NTSC). They fit in the NES's own 2 KiB of working memory. No battery or
extra cartridge RAM is required to use the looper. Resetting or turning off
the console loses the recording. This version has no save or export feature.

The NES has two pulse channels, one triangle channel, and one noise channel.
Live notes take priority, followed by the second recorded part. Two square
parts can sound together. Overlapping triangle notes share one channel, as do
noise-based drums; kick, tom, and zap also use the triangle channel. A part
returns when the higher-priority note releases. Three simultaneous square
parts share two channels. This is a limit of the original sound hardware.

## Run locally

Use Node.js 20 or newer, Python 3.9 or newer, and the cc65 assembler.
No credentials or environment variables are needed.

1. Install cc65. On macOS:

   ```sh
   brew install cc65
   ```

   On Debian or Ubuntu:

   ```sh
   sudo apt install cc65
   ```

2. Install dependencies:

   ```sh
   npm ci
   ```

3. Build the cartridge and preview:

   ```sh
   npm run build
   ```

4. Start the local preview:

   ```sh
   npm start
   ```

5. Open [localhost:4173](http://localhost:4173) and click **Make some noise**.
   Or open `build/gamebody.nes` in a desktop NES emulator set to NTSC.

The build produces a 24,592-byte iNES ROM: 16 KiB program, 8 KiB graphics, and
a 16-byte header. It uses NROM, with no battery, mapper switching, expansion
audio, samples, or external files.

## Sound

Square has a quick 25% pulse pluck and a quiet sustained tail. A spare pulse
channel supplies a soft echo about 266 ms later. B alternates low and high
plucks every eight video frames, with short gaps. The burst uses one channel
so another part can play beside it.

Triangle uses the NES's native triangle wave. B alternates the note and its
octave with short gaps. Drums combine noise envelopes with descending triangle
tones; B repeats a hit every eight frames. There is no sine preset because the
NES has no native sine oscillator.

All sound comes from the NES's built-in audio hardware. The preview plays
emulator output without adding synthesis, effects, samples, or a backing track.

### Browser response time

The audio clock requests one emulated frame at a time; drawing the screen does
not schedule the sound. A 14 ms refill allowance keeps the queue below about
31 ms while leaving time to emulate the next frame. Pausing freezes the ROM
and discards pending sound; resuming continues the same recording or loop.

If playing feels late through AirPods or other wireless headphones, compare
with the computer's speakers or wired headphones. The output device can add
delay beyond the preview's queue.

For timing checks, open [localhost:4173/?timing=1](http://localhost:4173/?timing=1).
The optional readout shows the queue, missing audio time, emulation work, and
the browser's [base latency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency)
and [output latency estimate](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency).
These are separate parts of the path, not a physical measurement from key press
to audible sound. Measurements reset on resume; intentional startup silence
does not count as missing audio. There is no timing readout in the normal view.

## Check and render

```sh
npm test
npm run demo
```

The ROM tests cover startup silence, tuning, note and modifier gestures,
all three sounds, recording, playing along, adding and replacing a second
part, loop boundaries, capacity, clearing, reset, channel priority, and display
writes during vertical blanking.

Audio transport tests check sample order at 44.1, 48, and 96 kHz, delayed
responses, bounded buffering, stale packets, and pause/resume. They also run
the real ROM without screen refresh callbacks to check recording and tempo.

The demo command writes `output/gamebody-demo.wav` and
`output/cartridge-screen.png`. The audio records a square melody, adds a lower
triangle part, then plays drums over both loops. It is rendered from the ROM.

## Limits

This prototype has been checked in JSNES. Original NES hardware, flash
cartridges, physical USB controllers, and touch on a real phone have not been
tested. It targets NTSC; PAL needs separate tuning and rhythm timing.
Cartridge manufacturing, Game Boy support, saved recordings, and MIDI are
separate follow-ups.

The ROM polls once per video frame, about 16.6 ms. A browser or emulator adds
its own latency, so feel and sound still need a playtest with a real controller.

## Source and license

`src/main.s`, `src/controls.inc`, `src/voices.inc`, and `src/mixer.inc` contain
the instrument. `scripts/assets.py` draws the original pixel art and calculates
pitch tables. `web/` contains the emulator preview; `tests/` checks the ROM.

Code: [MIT](LICENSE), copyright Jonathan Mann. Original art and demo audio:
[CC BY 4.0](ASSETS.md). JSNES keeps its Apache-2.0 license. No private or paid
assets are required.

Hardware references: [NES audio](https://www.nesdev.org/wiki/APU_basics),
[working memory](https://www.nesdev.org/wiki/CPU_memory_map),
[controller input](https://www.nesdev.org/wiki/Standard_controller), and
[NROM cartridges](https://www.nesdev.org/wiki/NROM).
