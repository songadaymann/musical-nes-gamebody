import fs from 'node:fs';
import { NES, Controller } from 'jsnes';

const rom = fs.readFileSync(new URL('../build/gamebody.nes', import.meta.url));
const labels = Object.fromEntries(fs.readFileSync(new URL('../build/gamebody.lbl', import.meta.url), 'utf8')
  .split('\n').map(line => /^al ([0-9A-F]+) \.(\w+)$/.exec(line))
  .filter(Boolean).map(([, address, name]) => [name, parseInt(address, 16)]));

export function instrument() {
  let audio = [], frame;
  const writes = [];
  const nes = new NES({ sampleRate: 48000,
    onFrame(buffer) { frame = Int32Array.from(buffer); },
    onAudioSample(l, r) { audio.push((l+r)/2); },
  });
  nes.loadROM(rom);
  const write = nes.cpu.write.bind(nes.cpu);
  nes.cpu.write = (address, value) => {
    if (address >= 0x4000 && address <= 0x4017) writes.push({ address, value });
    write(address, value);
  };
  const api = {
    nes, writes, rom,
    frames(count) { for (let i = 0; i < count; i++) nes.frame(); },
    down(...names) { for (const n of names) nes.buttonDown(1, Controller[`BUTTON_${n}`]); },
    up(...names) { for (const n of names) nes.buttonUp(1, Controller[`BUTTON_${n}`]); },
    tap(name) { api.down(name); api.frames(2); api.up(name); api.frames(2); },
    release() { for (let i = 0; i < 8; i++) nes.buttonUp(1, i); },
    value(name) {
      if (!(name in labels)) throw new Error(`Unknown RAM symbol: ${name}`);
      return nes.cpu.mem[labels[name]];
    },
    word(name) { return api.value(name) | (nes.cpu.mem[labels[name]+1] << 8); },
    memory(name, length) { return [...nes.cpu.mem.slice(labels[name], labels[name]+length)]; },
    voice(index, name) {
      return nes.cpu.mem[labels.voice_states + index*(labels.voice_end-labels.voice_begin) + labels[name]-labels.voice_begin];
    },
    clearLoops() { api.release(); api.down('START'); api.frames(62); api.release(); api.frames(2); },
    cycleSound() { api.release(); api.frames(2); api.down('A','B'); api.frames(2); api.release(); api.frames(2); },
    takeAudio() { const result = audio; audio = []; return result; },
    frame() { return frame; },
    pitch(voice = 1) { return 1789773 / (16*(nes.papu[`square${voice}`].progTimerMax+1)); },
  };
  api.frames(60);
  api.takeAudio();
  writes.length = 0;
  return api;
}

export const rms = values => Math.sqrt(values.reduce((s, n) => s+n*n, 0)/values.length);
// A halted NES triangle holds its DAC value. Measure changing signal, not DC,
// when checking audibility; JSNES can also retain a constant filter residual.
export const acRms = values => {
  const mean = values.reduce((s,n)=>s+n,0)/values.length;
  return Math.sqrt(values.reduce((s,n)=>s+(n-mean)**2,0)/values.length);
};
