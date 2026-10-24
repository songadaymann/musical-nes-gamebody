import test from 'node:test';
import assert from 'node:assert/strict';
import { instrument, acRms as rms } from './harness.mjs';

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
    app.release(); app.frames(2); app.tap('SELECT');
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

test('Select advances once per press and four taps return to the starting octave', () => {
  const app = instrument();
  app.down('SELECT'); app.frames(120);
  assert.equal(app.value('base_octave'), 3);
  app.up('SELECT'); app.frames(2);
  const sequence=[];
  for (let i=0;i<4;i++) { app.tap('SELECT'); sequence.push(app.value('base_octave')); }
  assert.deepEqual(sequence,[0,1,2,3]);
  app.tap('START');
  assert.equal(app.value('base_octave'), 3, 'Start no longer changes the octave');
});

test('B alternates low/high plucks on one channel so another part can play', () => {
  const app = instrument();
  app.down('UP'); app.frames(24);
  const base = app.pitch();
  app.down('B');
  const pitches = [], volumes = [];
  for (let i = 0; i < 32; i++) {
    app.frames(1); pitches.push(app.pitch()); volumes.push(app.value('lead_volume'));
  }
  assert.ok(pitches.some(p=>Math.abs(p/base-1)<0.01));
  assert.ok(pitches.some(p=>Math.abs(p/base-2)<0.015));
  assert.ok(volumes.includes(12) && volumes.includes(8) && volumes.includes(0));
  app.up('B'); app.frames(2);
  assert.equal(app.pitch(),base);
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

test('A+B cycles sounds once, requires full release, and wraps after three sounds', () => {
  const app=instrument();
  app.down('A','B'); app.frames(90);
  assert.equal(app.value('sound'),1);
  app.up('A'); app.frames(2); app.down('A'); app.frames(2);
  assert.equal(app.value('sound'),1,'partial release must not cycle twice');
  app.cycleSound(); assert.equal(app.value('sound'),2);
  app.cycleSound(); assert.equal(app.value('sound'),0);
});

test('A+B keeps upper-note bursts while playing and does not switch after releasing a note', () => {
  const app=instrument();
  app.down('LEFT','A','B'); app.frames(4);
  assert.equal(app.value('sound'),0);
  assert.equal(app.value('note_slot'),4);
  app.up('LEFT'); app.frames(4);
  assert.equal(app.value('sound'),0);
  app.cycleSound(); assert.equal(app.value('sound'),1);
});

test('all three patches make sound on a note and remain quiet when selected at rest', () => {
  const app=instrument();
  for(let patch=0;patch<3;patch++) {
    app.frames(60);app.takeAudio();app.frames(12);
    assert.ok(rms(app.takeAudio())<0.0001,`patch ${patch} made a phantom note`);
    app.down('LEFT');app.frames(8);
    assert.ok(rms(app.takeAudio())>0.003,`patch ${patch} is silent`);
    app.release();app.frames(70);app.takeAudio();app.frames(20);
    assert.ok(rms(app.takeAudio())<0.0001,`patch ${patch} did not stop`);
    app.cycleSound();
  }
});

test('triangle sustains on the native channel at the selected pitch; B bursts', () => {
  const app=instrument();
  app.cycleSound();app.down('LEFT');app.frames(30);
  const frequency=1789773/(32*(app.nes.papu.triangle.progTimerMax+1));
  assert.ok(Math.abs(frequency-261.626)<2);
  assert.ok(app.nes.papu.triangle.linearCounter>0);
  assert.equal(app.nes.papu.square1.masterVolume,0);
  app.down('B');
  const gates=[];
  for(let i=0;i<32;i++) { app.frames(1);gates.push(app.value('triangle_on')); }
  assert.ok(gates.includes(0) && gates.includes(1));
});

test('all eight drum hits speak, decay, and B repeats the selected hit', () => {
  const app=instrument();
  app.cycleSound();app.cycleSound();
  const signatures=[];
  for(let slot=0;slot<8;slot++) {
    app.release();app.frames(60);app.takeAudio();
    app.down(directions[slot%4]);if(slot>=4)app.down('A');
    app.frames(8);
    const signal=app.takeAudio();
    assert.ok(rms(signal)>0.002,`drum ${slot} was silent`);
    // Skip the frame before the CPU has polled the new controller state.
    signatures.push(signal.slice(1600,1660).map(n=>n.toFixed(4)).join(','));
    app.frames(60);app.takeAudio();app.frames(10);
    assert.ok(rms(app.takeAudio())<0.0001,`drum ${slot} did not decay`);
  }
  assert.equal(new Set(signatures).size,8);
  app.down('B');app.frames(40);
  assert.ok(rms(app.takeAudio())>0.002);
});

test('Start arms recording, waits for the first note, and a second empty tap cancels', () => {
  const app=instrument();
  app.tap('START');app.frames(120);
  assert.equal(app.value('loop_state'),1);
  assert.equal(app.word('loop_length'),0);
  app.tap('START');assert.equal(app.value('loop_state'),0);
  app.tap('START');app.down('LEFT');app.frames(6);
  assert.equal(app.value('loop_state'),2);
  assert.equal(app.word('loop_length'),6);
});

test('packed playback preserves notes, rests, octaves, patches, bursts, and diagonal rolls', () => {
  const app=instrument();
  app.tap('START');app.down('LEFT');app.frames(12);
  app.down('UP');app.frames(4);app.up('UP');app.frames(4);
  app.release();app.frames(4);app.tap('SELECT');
  app.down('UP','A','B');app.frames(19);
  app.release();app.frames(4);app.cycleSound();
  app.down('RIGHT');app.frames(11);app.release();app.frames(8);
  app.tap('START');
  const length=app.word('loop_length');
  const notes=app.memory('loop_first',length);
  assert.ok(notes.includes(255) && notes.some(n=>n!==255 && (n&128)));
  for(let i=0;i<length*3;i++) {
    const position=app.word('loop_position');
    app.frames(1);
    const expected=notes[position];
    assert.equal(app.value('loop_state'),3);
    assert.equal(app.voice(1,'gate'),expected===255?0:1,`gate at ${position}`);
    if(expected!==255) {
      assert.equal(app.voice(1,'note_id'),expected&31,`note at ${position}`);
      assert.equal(app.voice(1,'sound'),(expected>>5)&3,`patch at ${position}`);
      assert.equal(Boolean(app.voice(1,'buttons')&64),Boolean(expected&128));
    }
    assert.equal(app.value('gate'),0,'live input stays independent of playback');
  }
  assert.equal(app.word('loop_length'),length);
});

test('playing a new square note leaves the recorded square sounding on another channel', () => {
  const app=instrument();
  app.tap('START');app.down('LEFT');app.frames(40);app.tap('START');
  app.release();app.frames(2);
  const length=app.word('loop_length'), before=app.word('loop_position');
  app.down('UP');app.frames(8);
  assert.equal(app.word('loop_position'),(before+8)%length);
  assert.equal(app.voice(1,'note_slot'),0);
  assert.equal(app.value('note_slot'),2);
  assert.ok(app.nes.papu.square1.masterVolume>0 && app.nes.papu.square2.masterVolume>0);
  assert.ok(Math.abs(app.pitch()-329.628)<2);
  assert.ok(Math.abs(app.pitch(2)-261.626)<2);
});

test('a second part records for exactly one loop at its current position, then repeats', () => {
  const app=instrument();
  app.tap('START');app.down('LEFT');app.frames(90);app.tap('START');
  app.release();app.frames(2);app.cycleSound();
  const length=app.word('loop_length');
  const first=app.memory('loop_first',512);
  app.down('UP');app.tap('START');
  assert.equal(app.value('loop_state'),4);
  const remaining=app.word('dub_remaining');
  assert.equal(remaining,length-2);
  app.frames(remaining-1);assert.equal(app.value('loop_state'),4);
  app.frames(1);assert.equal(app.value('loop_state'),3);
  assert.equal(app.value('layer_present'),1);
  assert.deepEqual(app.memory('loop_first',512),first);
  assert.ok(app.memory('loop_second',length).every(n=>n===50)); // triangle E4
  app.release();app.frames(length+5);
  assert.equal(app.voice(1,'sound'),0);
  assert.equal(app.voice(2,'sound'),1);
  assert.ok(app.nes.papu.square1.masterVolume>0);
  assert.ok(app.nes.papu.triangle.linearCounter>0);
  assert.equal(app.value('gate'),0);
});

test('a redo replaces only the second part and can finish early with rests elsewhere', () => {
  const app=instrument();
  app.tap('START');app.down('LEFT');app.frames(80);app.tap('START');
  app.release();app.frames(2);app.cycleSound();
  const first=app.memory('loop_first',512), length=app.word('loop_length');
  app.down('UP');app.tap('START');app.frames(length);app.release();app.frames(2);
  app.cycleSound();app.down('DOWN');app.tap('START');app.frames(8);app.tap('START');
  assert.equal(app.value('loop_state'),3);
  assert.equal(app.value('layer_present'),1);
  assert.deepEqual(app.memory('loop_first',512),first);
  const layer=app.memory('loop_second',length);
  assert.ok(layer.includes(255));
  assert.ok(layer.some(n=>n!==255));
  assert.ok(layer.every(n=>n===255 || ((n>>5)&3)===2),'old triangle part was removed');
});

test('holding Start clears both parts and never restarts recording on release', () => {
  const app=instrument();
  app.tap('START');app.down('LEFT');app.frames(40);app.tap('START');app.release();app.frames(2);
  app.down('UP');app.tap('START');app.frames(50);app.release();
  app.clearLoops();app.frames(70);app.takeAudio();app.frames(20);
  assert.equal(app.value('loop_state'),0);
  assert.equal(app.word('loop_length'),0);
  assert.equal(app.value('layer_present'),0);
  assert.ok(rms(app.takeAudio())<0.0001);
  app.down('START');app.frames(30);
  assert.equal(app.value('loop_state'),0,'a tap acts on release');
  app.up('START');app.frames(1);assert.equal(app.value('loop_state'),1);
});

test('a one-frame phrase can repeat, add a part, and clear without a stuck note', () => {
  const app=instrument();
  app.tap('START');app.down('START','LEFT');app.frames(1);
  app.release();app.frames(1);
  assert.equal(app.word('loop_length'),1);
  assert.equal(app.word('loop_position'),0);
  assert.equal(app.value('loop_state'),3);
  app.cycleSound();app.down('RIGHT');app.tap('START');app.frames(30);
  assert.equal(app.value('layer_present'),1);
  app.clearLoops();app.frames(60);app.takeAudio();app.frames(20);
  assert.ok(rms(app.takeAudio())<0.0001);
});

test('both 512-frame buffers stay within internal RAM, including an overdub crossing zero', () => {
  const app=instrument();
  const badWrites=[];
  const write=app.nes.cpu.write.bind(app.nes.cpu);
  app.nes.cpu.write=(address,value)=>{
    if(address>=0x800&&address<0x2000)badWrites.push(address);
    write(address,value);
  };
  app.tap('START');app.down('RIGHT');app.frames(530);
  assert.equal(app.value('loop_state'),3);
  assert.equal(app.word('loop_length'),512);
  assert.equal(app.word('loop_position'),18);
  const first=app.memory('loop_first',512);
  app.release();app.frames(2);app.cycleSound();app.down('UP');app.tap('START');
  app.frames(512);
  assert.equal(app.value('loop_state'),3);
  assert.equal(app.value('layer_present'),1);
  assert.deepEqual(app.memory('loop_first',512),first);
  assert.ok(app.memory('loop_second',512).every(n=>n===50));
  assert.deepEqual(badWrites,[]);
});

test('live triangle wins a shared channel and the recorded triangle returns afterward', () => {
  const app=instrument();app.cycleSound();
  app.tap('START');app.down('LEFT');app.frames(80);app.tap('START');
  app.release();app.frames(2);app.down('RIGHT');app.frames(4);
  assert.equal(app.value('triangle_owner'),0);
  app.release();app.frames(4);
  assert.equal(app.value('triangle_owner'),1);
  const pitch=1789773/(32*(app.nes.papu.triangle.progTimerMax+1));
  assert.ok(Math.abs(pitch-261.626)<2);
});

test('reset loses both parts, restores square, and starts at octave 4', () => {
  const app=instrument();
  app.cycleSound();app.tap('START');app.down('LEFT');app.frames(20);app.tap('START');
  assert.equal(app.value('loop_state'),3);
  app.nes.reloadROM();app.frames(60);
  assert.equal(app.value('loop_state'),0);
  assert.equal(app.word('loop_length'),0);
  assert.equal(app.value('layer_present'),0);
  assert.equal(app.value('sound'),0);
  assert.equal(app.value('base_octave'),2);
});

test('two square parts return as soon as a third live square fades', () => {
  const app=instrument();
  app.tap('START');app.down('LEFT');app.frames(90);app.tap('START');
  app.release();app.frames(2);app.down('UP');app.tap('START');app.frames(100);
  app.release();app.frames(2);app.down('RIGHT');app.frames(5);
  assert.equal(app.value('pulse_one'),0);
  assert.equal(app.value('pulse_two'),2);
  app.release();app.frames(30);
  assert.equal(app.value('pulse_one'),2);
  assert.equal(app.value('pulse_two'),1);
  assert.ok(app.nes.papu.square1.masterVolume>0 && app.nes.papu.square2.masterVolume>0);
});
