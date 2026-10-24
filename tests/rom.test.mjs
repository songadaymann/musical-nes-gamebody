import test from 'node:test';
import assert from 'node:assert/strict';
import { instrument, rms } from './harness.mjs';

const directions = ['LEFT', 'DOWN', 'UP', 'RIGHT'];
const semitones = [0, 2, 4, 7, 9, 12, 14, 16];

test('boots a standalone 24 KiB NROM cartridge silently, at octave 4', () => {
  const app = instrument();
  assert.equal(app.rom.length, 16+16384+8192);
  assert.deepEqual([...app.rom.subarray(0, 8)], [78,69,83,26,1,1,0,0]);
  app.frames(30);
  assert.equal(app.value('base_octave'), 2);
  assert.equal(app.value('gate'), 0);
  assert.ok(rms(app.takeAudio()) < 0.0001);
});

test('all 32 notes are audible and tuned within 12 cents across four octaves', () => {
  const app = instrument();
  app.tap('SELECT'); app.tap('SELECT');
  let worst = 0;
  for (let octave = 2; octave <= 5; octave++) {
    for (let slot = 0; slot < 8; slot++) {
      app.release(); app.frames(40);
      if (slot >= 4) app.down('A');
      app.down(directions[slot % 4]);
      app.frames(12);
      app.takeAudio();
      app.frames(12);
      const expected = 440 * 2**((12*(octave+1)+semitones[slot]-69)/12);
      const cents = Math.abs(1200*Math.log2(app.pitch()/expected));
      worst = Math.max(cents, worst);
      assert.ok(cents < 12, `octave ${octave}, slot ${slot}: ${cents} cents`);
      assert.ok(rms(app.takeAudio()) > 0.005, `inaudible octave ${octave}, slot ${slot}`);
    }
    app.release(); app.frames(2); app.tap('START');
  }
  console.log(`Maximum pitch rounding error: ${worst.toFixed(2)} cents`);
});

test('A changes a held note immediately and releasing A restores it', () => {
  const app = instrument();
  app.down('LEFT'); app.frames(2);
  assert.equal(app.value('note_slot'), 0);
  app.down('A'); app.frames(2);
  assert.equal(app.value('note_slot'), 4);
  app.up('A'); app.frames(2);
  assert.equal(app.value('note_slot'), 0);
});

test('new direction wins on diagonal rolls; releasing it falls back to the held note', () => {
  const app = instrument();
  app.down('RIGHT'); app.frames(2);
  app.down('UP'); app.frames(2);
  assert.equal(app.value('note_slot'), 2);
  app.up('UP'); app.frames(2);
  assert.equal(app.value('note_slot'), 3);
  app.down('LEFT'); app.frames(2);
  assert.equal(app.value('note_slot'), 0);
  app.release(); app.frames(2);
  assert.equal(app.value('gate'), 0);
});

test('octave shifts happen once per press, stay bounded, and cancel when pressed together', () => {
  const app = instrument();
  app.down('SELECT'); app.frames(120);
  assert.equal(app.value('base_octave'), 1);
  app.up('SELECT'); app.frames(2);
  for (let i = 0; i < 8; i++) app.tap('SELECT');
  assert.equal(app.value('base_octave'), 0);
  for (let i = 0; i < 8; i++) app.tap('START');
  assert.equal(app.value('base_octave'), 3);
  app.down('SELECT', 'START'); app.frames(2);
  assert.equal(app.value('base_octave'), 3);
});

test('B alternates plucked notes with an octave answer and audible gaps', () => {
  const app = instrument();
  app.down('UP'); app.frames(24);
  const pitch = app.pitch();
  const echo = app.pitch(2);
  app.down('B'); app.frames(2);
  const leadVolumes = [], octaveVolumes = [];
  for (let i = 0; i < 32; i++) {
    app.frames(1);
    leadVolumes.push(app.value('lead_volume'));
    octaveVolumes.push(app.value('echo_volume'));
  }
  assert.equal(app.pitch(), pitch);
  assert.ok(Math.abs(app.pitch(2)/echo - 2) < 0.015);
  assert.ok(leadVolumes.includes(12) && leadVolumes.includes(0));
  assert.ok(octaveVolumes.includes(8) && octaveVolumes.includes(0));
  assert.ok(leadVolumes.every((v, i) => v === 0 || octaveVolumes[i] === 0));
  app.up('B'); app.frames(20);
  assert.equal(app.pitch(2), echo);
});

test('letting go fades both voices to silence, including with A and B held', () => {
  const app = instrument();
  app.down('LEFT', 'A', 'B'); app.frames(20);
  app.up('LEFT'); app.frames(70);
  app.takeAudio(); app.frames(20);
  assert.equal(app.value('lead_volume'), 0);
  assert.equal(app.value('echo_volume'), 0);
  assert.ok(rms(app.takeAudio()) < 0.0001);
});

test('A and B alone never trigger a note or a phantom startup echo', () => {
  const app = instrument();
  app.down('A', 'B'); app.frames(90);
  assert.equal(app.value('gate'), 0);
  assert.ok(rms(app.takeAudio()) < 0.0001);
});

test('held notes do not repeatedly reset the pulse phase; retapping does retrigger', () => {
  const app = instrument();
  app.down('LEFT'); app.frames(2);
  app.writes.length = 0;
  app.frames(120);
  assert.equal(app.writes.filter(w => w.address === 0x4003).length, 0);
  app.up('LEFT'); app.frames(2);
  app.down('LEFT'); app.frames(2);
  assert.equal(app.writes.filter(w => w.address === 0x4003).length, 1);
});

test('all runtime PPU updates stay in vertical blank', () => {
  const app = instrument();
  const observed = [];
  const write = app.nes.cpu.write.bind(app.nes.cpu);
  app.nes.cpu.write = (address, value) => {
    // JSNES numbers scanline 0 as hardware scanline 241 (start of blanking).
    if (address === 0x2007) observed.push((app.nes.ppu.scanline + 241) % 262);
    write(address, value);
  };
  app.down('A', 'B', 'RIGHT'); app.frames(30);
  assert.ok(observed.length > 100);
  assert.ok(observed.every(line => line >= 241 && line <= 260), `PPU write scanlines: ${[...new Set(observed)]}`);
});
