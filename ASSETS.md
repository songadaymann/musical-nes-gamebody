# Assets

Code is MIT; see [LICENSE](LICENSE). This document covers non-code material.

## 1. Ours: included and open

Original visual and audio material for this project is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Credit "Jonathan Mann (Song A Day)".

| Source | Material | License |
| --- | --- | --- |
| `scripts/assets.py` | Original pixel glyphs, instrument screen, and sprite patterns | CC BY 4.0 |
| `src/main.s`, `src/voices.inc` | Original synthesized instrument patches; no samples | CC BY 4.0 for rendered sound; MIT for code |
| `scripts/render-demo.mjs` | Original demonstration melody and layered performance | CC BY 4.0 |

The build generates CHR graphics, a nametable, ROM, screenshots, and demo audio.
Generated output stays outside Git in `build/` and `output/`.

## 2. Free third-party

There are no third-party media assets. The browser preview uses
[JSNES](https://github.com/bfirsh/jsnes), Apache-2.0, installed through npm.
Its license is retained with the package and copied into the browser build.
The cartridge contains no emulator code or Nintendo game assets.

## 3. Licensed (paid or restricted): not included

None.

## 4. Not ours and not licensed: never in the repo

None. No private assets are required to build or play.
