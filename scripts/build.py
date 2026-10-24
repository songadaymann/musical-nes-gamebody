#!/usr/bin/env python3
"""Build the ROM and a portable static emulator preview."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
from assets import generate

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
BUILD.mkdir(exist_ok=True)
for executable in ('ca65', 'ld65'):
    if not shutil.which(executable):
        sys.exit('Install cc65 first: brew install cc65 (macOS), apt install cc65 (Debian/Ubuntu).')
generate(BUILD)
subprocess.run(['ca65', '-g', '-I', str(BUILD), '-I', str(ROOT/'src'), '--bin-include-dir', str(BUILD), '-o', str(BUILD/'main.o'),
                str(ROOT/'src/main.s')], check=True)
subprocess.run(['ld65', '-C', str(ROOT/'src/nes.cfg'), '-m', str(BUILD/'gamebody.map'),
                '-Ln', str(BUILD/'gamebody.lbl'), '--dbgfile', str(BUILD/'gamebody.dbg'),
                '-o', str(BUILD/'gamebody.nes'), str(BUILD/'main.o')], check=True)
web = BUILD / 'web'
web.mkdir(exist_ok=True)
labels = dict((name, int(address, 16)) for address, name in
              re.findall(r'^al ([0-9A-F]+) \.(\w+)$', (BUILD/'gamebody.lbl').read_text(), re.M))
(web/'rom-state.json').write_text(json.dumps({name: labels[name] for name in
    ('loop_state', 'loop_position', 'loop_length', 'layer_present', 'sound', 'base_octave')}))
for source in (ROOT/'web').glob('*'):
    if source.is_file():
        shutil.copy2(source, web/source.name)
shutil.copy2(BUILD/'gamebody.nes', web/'gamebody.nes')
shutil.copy2(ROOT/'LICENSE', web/'LICENSE.txt')
shutil.copy2(ROOT/'ASSETS.md', web/'ASSETS.md')
jsnes = ROOT / 'node_modules/jsnes'
if (jsnes/'dist/jsnes.min.js').exists():
    shutil.copy2(jsnes/'dist/jsnes.min.js', web/'jsnes.min.js')
    shutil.copy2(jsnes/'LICENSE', web/'JSNES-LICENSE.txt')
else:
    print('ROM built. Run npm install, then rebuild to enable the browser preview.')
print(f'Built {BUILD.relative_to(ROOT)}/gamebody.nes ({(BUILD/"gamebody.nes").stat().st_size:,} bytes)')
