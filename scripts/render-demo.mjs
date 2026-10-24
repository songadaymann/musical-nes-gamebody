import fs from 'node:fs';
import { PNG } from 'pngjs';
import { instrument, rms } from '../tests/harness.mjs';

const output = new URL('../output/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const app = instrument();
const notes = ['LEFT','DOWN','UP','RIGHT'];
const melody = [0,2,3,2,1,0,3,4];

// First pass: record a square melody. All timing and sound come from the ROM.
app.tap('START');
for (const slot of melody) {
  if (slot >= 4) app.down('A');
  app.down(notes[slot%4]);app.frames(24);
  app.release();app.frames(8);
}
app.tap('START');
const length=app.word('loop_length');

// Second pass: record a lower triangle part over the uninterrupted melody.
app.cycleSound();
app.tap('SELECT');app.tap('SELECT');app.tap('SELECT');
app.tap('START');
for (const slot of [0,3,4,3]) {
  if(slot>=4)app.down('A');
  app.down(notes[slot%4]);app.frames(56);
  app.release();app.frames(8);
}

// Play the drum kit live over both repeating parts for two more passes.
app.cycleSound();
for(let pass=0;pass<2;pass++) for(let hit=0;hit<8;hit++) {
  const slot=[0,2,1,2,0,5,1,2][hit];
  const duration=Math.floor((hit+1)*length/8)-Math.floor(hit*length/8);
  if(slot>=4)app.down('A');
  app.down(notes[slot%4]);app.frames(1);
  app.release();app.frames(duration-1);
}
app.clearLoops();app.frames(40);
const audio = app.takeAudio();
const wav = Buffer.alloc(44+audio.length*2);
wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(48000,24); wav.writeUInt32LE(96000,28); wav.writeUInt16LE(2,32);
wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(audio.length*2,40);
for (let i=0; i<audio.length; i++) wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,audio[i]*0.8))*32767),44+i*2);
fs.writeFileSync(new URL('gamebody-demo.wav',output),wav);

// A separate two-part performance provides the cartridge screenshot.
app.cycleSound();app.tap('START');app.down('LEFT');app.frames(60);app.tap('START');
app.release();app.frames(2);app.cycleSound();app.down('UP');app.tap('START');app.frames(65);
app.release();app.frames(2);app.down('RIGHT');app.frames(4);
const framebuffer=app.frame();
const scale=3;
const png=new PNG({width:256*scale,height:240*scale});
for(let y=0;y<png.height;y++) for(let x=0;x<png.width;x++) {
  const color=framebuffer[Math.floor(y/scale)*256+Math.floor(x/scale)];
  const at=(y*png.width+x)*4;
  png.data[at]=color & 255; png.data[at+1]=(color>>8)&255;
  png.data[at+2]=(color>>16)&255; png.data[at+3]=255;
}
fs.writeFileSync(new URL('cartridge-screen.png',output),PNG.sync.write(png));
console.log(`Rendered ${(audio.length/48000).toFixed(1)} seconds of actual ROM audio; RMS ${rms(audio).toFixed(4)}.`);
