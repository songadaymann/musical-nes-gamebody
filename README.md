# Gamebody

A pick-up-and-play NES instrument. Press a direction to play a note, hold A for
more notes, or hold B for bouncy rhythmic bursts. It starts ready to play.

The sound and controls run inside a real `.nes` ROM. The browser preview runs
that cartridge in [JSNES](https://github.com/bfirsh/jsnes).

**Play locally:** [localhost:4173](http://localhost:4173), after the setup below.
There is no public web deployment yet.

**Download:** [prototype releases](https://github.com/songadaymann/musical-nes-gamebody/releases).

## Controls

| NES controller | Keyboard preview | What it does |
| --- | --- | --- |
| Left / Down / Up / Right | Arrow keys | C / D / E / G |
| Hold A + a direction | Hold X + an arrow | A / C / D / E, higher in the scale |
| Hold B + a direction | Hold Z + an arrow | Repeating pluck, then an octave answer |
| Select | Shift | Down one octave |
| Start | Enter | Up one octave |

The eight notes belong to C-major pentatonic: C, D, E, G, A, C, D, E.
The root starts at C4 and can move from C2 to C5. A and B can be held together.
They do not play notes on their own. The most recently pressed direction wins;
releasing it returns to a direction still held. Ties within one frame use
Right, Up, Down, Left priority. Select and Start together leave the octave unchanged.

Touch buttons support simultaneous notes and modifiers. Browser-standard
gamepads use D-pad or left stick, bottom/right face buttons for A/B, and
Select/Start. Nonstandard USB adapters may need a desktop emulator's mapping.
The browser pauses on focus loss so notes cannot get stuck.

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

2. Install the browser emulator and image utility:

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
a 16-byte header. It uses NROM, the simplest NES cartridge layout, with no
battery, mapper switching, expansion audio, or external files.

## Sound

The main voice is a 25% pulse wave with a quick pluck and a quiet sustained tail.
A second pulse voice adds a soft echo about 266 ms later. Holding B replaces
the echo with alternating plucks: the main note, then its octave, every eight
video frames. This creates about 7.5 attacks per second, with short gaps.
Changing notes restarts the burst. B is a live effect, not a latch.

All sound comes from the NES's built-in audio hardware. The preview only plays
the emulator's output; it adds no synthesizer, effects, samples, or backing track.

## Check and render

```sh
npm test
```

The emulator tests cover startup silence, all 32 note/octave combinations,
A switching, direction overlap, octave limits, B's rhythm, note release,
phase resets, and display writes during vertical blanking.

```sh
npm run demo
```

This writes a 13-second audio example to `output/gamebody-demo.wav` and a
cartridge screenshot to `output/cartridge-screen.png`. The melody plays once
without B and once with B. Both are rendered from the ROM.

## Limits

This is a first playable prototype, checked in JSNES. Original NES hardware,
flash cartridges, physical USB controllers, and touch on a real phone have not
been tested. It targets NTSC; PAL needs separate tuning and rhythm timing.
Cartridge manufacturing, Game Boy support, presets, recording, and MIDI are
not part of this version.

The ROM polls once per video frame, about 16.6 ms. A browser or emulator adds
its own latency, so feel and sound still need a playtest with a real controller.

## Source and license

`src/main.s` contains the instrument. `scripts/assets.py` draws the original
pixel art and calculates pitch tables. `web/` contains the emulator preview.
`tests/` checks the built ROM.

Code: [MIT](LICENSE), copyright Jonathan Mann. Original art and demo audio:
[CC BY 4.0](ASSETS.md). JSNES keeps its Apache-2.0 license. No private or paid
assets are required.

Hardware references: [NES audio](https://www.nesdev.org/wiki/APU_basics),
[controller input](https://www.nesdev.org/wiki/Standard_controller), and
[NROM cartridges](https://www.nesdev.org/wiki/NROM).
