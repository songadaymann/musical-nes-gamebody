import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { NES, Controller } from 'jsnes';

const workletSource = fs.readFileSync(new URL('../web/audio-worklet.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const rom = fs.readFileSync(new URL('../build/gamebody.nes', import.meta.url));
const addresses = JSON.parse(fs.readFileSync(new URL('../build/web/rom-state.json', import.meta.url)));

function audioClock(sampleRate = 48000, diagnostics = true) {
  let Processor;
  const messages = [];
  vm.runInNewContext(workletSource, {
    sampleRate, Float32Array,
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: message => messages.push(message) }; }
    },
    registerProcessor(name, constructor) { Processor = constructor; },
  });
  const processor = new Processor({ processorOptions: { diagnostics } });
  return {
    processor, messages,
    receive(data) { processor.port.onmessage({ data }); },
    render(size = 128) {
      const output = new Float32Array(size);
      assert.equal(processor.process([], [[output]]), true);
      return output;
    },
    reply(request, samples) {
      processor.port.onmessage({ data: { ...request, type: 'samples', samples } });
    },
  };
}

for (const sampleRate of [44100, 48000, 96000]) {
  test(`audio clock preserves every sample and stays below 31 ms at ${sampleRate} Hz`, () => {
    const clock = audioClock(sampleRate);
    const frameLength = Math.round(sampleRate / 60.0988);
    let produced = 0, consumed = 0;
    clock.receive({ type: 'start', epoch: 1 });
    // Exercise ring wraparound and block lengths other than the current 128.
    for (let block = 0; block < 2500; block++) {
      for (const message of clock.messages.splice(0)) {
        if (message.type !== 'frame') continue;
        clock.reply(message, Float32Array.from({ length: frameLength }, () => ++produced));
      }
      for (const value of clock.render([64, 128, 256][block % 3])) {
        assert.equal(value, ++consumed, 'no dropped, repeated, or silent samples');
      }
      assert.ok((produced - consumed) / sampleRate < 0.031, 'queue stays bounded');
    }
    assert.equal(clock.processor.underrun, 0);
  });
}

test('a stalled producer has one pending request and recovers without catch-up frames', () => {
  const clock = audioClock();
  clock.receive({ type: 'start', epoch: 1 });
  const first = clock.messages.shift();
  for (let i = 0; i < 100; i++) clock.render();
  assert.equal(clock.messages.length, 0, 'startup cannot flood the main thread');
  assert.equal(clock.processor.underrun, 0, 'intentional startup silence is excluded');
  clock.reply(first, new Float32Array(799).fill(0.5));
  for (let i = 0; i < 100; i++) clock.render();
  const requests = clock.messages.splice(0).filter(message => message.type === 'frame');
  assert.equal(requests.length, 1);
  assert.ok(clock.processor.underrun > 0);
  clock.reply(requests[0], new Float32Array(799).fill(0.75));
  assert.deepEqual([...clock.render()], Array(128).fill(0.75));
  assert.equal(clock.processor.frames, 2);
});

test('normal message and emulation delays do not leave gaps', () => {
  const clock = audioClock();
  let produced = 0, consumed = 0, packet;
  clock.receive({ type: 'start', epoch: 1 });
  clock.reply(clock.messages.shift(), Float32Array.from({ length: 799 }, () => ++produced));
  for (let block = 0; block < 3000; block++) {
    for (const message of clock.messages.splice(0)) {
      if (message.type === 'frame') packet = { message, due: block + block % 4 };
    }
    // Up to eight milliseconds between a request and its response.
    if (packet && packet.due <= block) {
      clock.reply(packet.message, Float32Array.from({ length: 799 }, () => ++produced));
      packet = null;
    }
    for (const value of clock.render()) assert.equal(value, ++consumed);
  }
  assert.equal(clock.processor.underrun, 0);
});

test('pause and resume discard queued audio, stale responses, and duplicate packets', () => {
  const clock = audioClock();
  clock.receive({ type: 'start', epoch: 1 });
  const oldRequest = clock.messages.shift();
  clock.reply(oldRequest, new Float32Array(799).fill(0.5));
  clock.receive({ type: 'stop', epoch: 2 });
  clock.reply(oldRequest, new Float32Array(799).fill(0.5));
  assert.deepEqual([...clock.render()], Array(128).fill(0));
  clock.receive({ type: 'start', epoch: 3 });
  const newRequest = clock.messages.shift();
  clock.reply({ ...oldRequest, request: newRequest.request }, new Float32Array(799).fill(0.5));
  assert.deepEqual([...clock.render()], Array(128).fill(0), 'old generation is silent');
  clock.reply(newRequest, new Float32Array(799).fill(0.75));
  clock.reply(newRequest, new Float32Array(799).fill(0.25));
  assert.deepEqual([...clock.render()], Array(128).fill(0.75));
  assert.equal(clock.processor.frames, 1);
});

// Run the actual browser adapter and actual ROM with a controllable audio
// clock. Animation callbacks deliberately never run: display refresh must not
// control notes, recording, or playback speed.
async function browserInstrument() {
  const clock = audioClock();
  const toAudio = [];
  let node, nes, frames = 0;
  const element = () => ({
    listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute() {}, blur() {}, append() {},
  });
  const elements = Object.fromEntries(['#screen', '#play', '#pause', '#launch', '#status', '#loop-action', 'main']
    .map(name => [name, element()]));
  elements['#loop-action'].parentElement = element();
  elements['#screen'].getContext = () => ({
    createImageData: () => ({ data: new Uint8ClampedArray(256 * 240 * 4) }), putImageData() {},
  });
  const document = Object.assign(element(), {
    querySelector: selector => elements[selector], querySelectorAll: () => [],
    hasFocus: () => true, hidden: false,
  });
  const window = element();
  vm.runInNewContext(appSource, {
    document, window, location: { search: '' }, navigator: {},
    URLSearchParams, Uint8Array, Uint32Array, Float32Array, performance, console,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fetch: async url => ({ ok: true, arrayBuffer: async () => rom, json: async () => addresses }),
    jsnes: { Controller, NES: class {
      constructor(options) {
        nes = new NES(options);
        const frame = nes.frame.bind(nes);
        nes.frame = () => { frames++; frame(); };
        return nes;
      }
    } },
    AudioContext: class {
      sampleRate = 48000;
      audioWorklet = { addModule: async () => {} };
      resume() { return Promise.resolve(); }
      suspend() { return Promise.resolve(); }
    },
    AudioWorkletNode: class {
      constructor() { node = this; this.port = { postMessage: data => toAudio.push(data) }; }
      connect() {}
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  function exchange() {
    while (toAudio.length || clock.messages.length) {
      for (const data of toAudio.splice(0)) clock.receive(data);
      for (const data of clock.messages.splice(0)) node.port.onmessage({ data });
    }
  }
  const api = {
    clock,
    async click(id) { await elements[id].listeners.click(); exchange(); },
    key(code, down) {
      document.listeners[down ? 'keydown' : 'keyup']({ code, preventDefault() {} });
    },
    blocks(count) { for (let i = 0; i < count; i++) { clock.render(); exchange(); } },
    frameCount: () => frames,
    value: name => nes.cpu.mem[addresses[name]],
    word: name => nes.cpu.mem[addresses[name]] | (nes.cpu.mem[addresses[name] + 1] << 8),
    blur() { window.listeners.blur(); exchange(); },
  };
  await api.click('#play');
  return api;
}

test('real ROM records and plays in time without any display callbacks', async () => {
  const app = await browserInstrument();
  app.key('Enter', true); app.blocks(12);
  app.key('Enter', false); app.blocks(12);
  assert.equal(app.value('loop_state'), 1);
  app.key('ArrowLeft', true); app.blocks(96);
  assert.equal(app.value('loop_state'), 2);
  app.key('ArrowLeft', false); app.blocks(30);
  app.key('Enter', true); app.blocks(12);
  app.key('Enter', false); app.blocks(12);
  assert.equal(app.value('loop_state'), 3);
  const frames = app.frameCount(), position = app.word('loop_position'), length = app.word('loop_length');
  app.blocks(3750); // Exactly 10 seconds at 48 kHz / 128 samples.
  const elapsed = app.frameCount() - frames;
  assert.ok(Math.abs(elapsed - 600.988) <= 1, `${elapsed} frames in ten seconds`);
  assert.equal(app.word('loop_position'), (position + elapsed) % length);
  assert.equal(app.clock.processor.underrun, 0);
});

test('pause and focus loss freeze the actual ROM, and resume never skips loop frames', async () => {
  const app = await browserInstrument();
  app.key('Enter', true); app.blocks(12);
  app.key('Enter', false); app.blocks(12);
  app.key('ArrowRight', true); app.blocks(60);
  assert.equal(app.value('loop_state'), 2);
  await app.click('#pause');
  const paused = app.frameCount(), length = app.word('loop_length');
  app.blocks(1000);
  assert.equal(app.frameCount(), paused);
  await app.click('#pause');
  assert.equal(app.frameCount(), paused + 1, 'only the first requested audible frame advances');
  assert.equal(app.word('loop_length'), length + 1);
  app.blur();
  const blurred = app.frameCount();
  app.blocks(1000);
  assert.equal(app.frameCount(), blurred);
});
