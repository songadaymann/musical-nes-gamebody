/* The browser only emulates the cartridge and forwards physical controls. */
(() => {
  const canvas = document.querySelector('#screen');
  const context = canvas.getContext('2d', { alpha: false });
  const image = context.createImageData(256, 240);
  const pixels = new Uint32Array(image.data.buffer);
  const play = document.querySelector('#play');
  const pause = document.querySelector('#pause');
  const launch = document.querySelector('#launch');
  const status = document.querySelector('#status');
  const loopAction = document.querySelector('#loop-action');
  const buttons = [...document.querySelectorAll('[data-button]')];
  const keyMap = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', KeyX: 'A', KeyZ: 'B', ShiftLeft: 'SELECT', ShiftRight: 'SELECT', Enter: 'START' };
  const inputs = new Map();
  const applied = new Set();
  let rom, addresses, nes, audio, speaker, running = false, loading = false;
  let shownLoop = -1;
  let animation, samples = null, gamepadConnected = false;
  let latestFrame, frameReady = false, epoch = 0, lastRequest = 0;
  let frameWorkTotal = 0, frameWorkPeak = 0, framesProduced = 0;
  const timingEnabled = new URLSearchParams(location.search).has('timing');
  const timingOutput = timingEnabled ? document.createElement('pre') : null;
  if (timingOutput) {
    timingOutput.id = 'audio-timing';
    timingOutput.setAttribute('aria-label', 'Audio timing diagnostics');
    document.querySelector('main').append(timingOutput);
  }

  function reportTiming(data) {
    if (!timingOutput || data.type !== 'stats' || !running || data.epoch !== epoch) return;
    const ms = value => Math.round(value * 10) / 10;
    timingOutput.textContent = JSON.stringify({
      queueMeanMs: ms(data.queueMeanMs), queuePeakMs: ms(data.queuePeakMs),
      underrunMs: ms(data.underrunMs), elapsedSeconds: ms(data.elapsedSeconds),
      frameWorkMeanMs: ms(frameWorkTotal / framesProduced), frameWorkPeakMs: ms(frameWorkPeak),
      browserBaseMs: Math.round(audio.baseLatency * 1000),
      reportedOutputMs: Number.isFinite(audio.outputLatency) ? Math.round(audio.outputLatency * 1000) : null,
      sampleRate: audio.sampleRate,
    }, null, 2);
  }

  // Reflect the cartridge's state for accessible browser controls. Recording
  // itself lives in the ROM. Addresses are generated from assembler symbols.
  function updateReadout() {
    const mode = nes.cpu.mem[addresses.loop_state];
    const secondPart = Boolean(nes.cpu.mem[addresses.layer_present]);
    const state = mode + (secondPart ? 8 : 0);
    if (state === shownLoop) return;
    shownLoop = state;
    const messages = [gamepadConnected ? 'Controller connected. Play.' : 'Pick a note. Make a melody.',
      'Ready to record. Play a note.', 'Recording. Tap Enter to loop.',
      secondPart ? 'Two parts playing. Play along.' : 'Loop playing. Play along, or record a part.',
      'Adding a part. It repeats after one loop.'];
    const actions = ['Record', 'Cancel', 'Play loop', secondPart ? 'Redo part' : 'Add part', 'Finish part'];
    status.textContent = messages[mode];
    loopAction.textContent = actions[mode];
    loopAction.parentElement.setAttribute('aria-label', `${actions[mode]}, tap Start or Enter; hold to clear both parts`);
  }

  function showError(error) {
    console.error(error);
    running = false;
    cancelAnimationFrame(animation);
    speaker?.port.postMessage({ type: 'stop', epoch: ++epoch });
    launch.hidden = false;
    play.disabled = false;
    play.textContent = 'Try again';
    status.textContent = 'Could not start. Reload the page and try again.';
    if (audio) audio.suspend().catch(console.error);
  }

  function syncInputs() {
    const held = new Set(inputs.values());
    for (const name of Object.keys(jsnes.Controller).filter(k => k.startsWith('BUTTON_')).map(k => k.slice(7))) {
      if (held.has(name) === applied.has(name)) continue;
      const id = jsnes.Controller[`BUTTON_${name}`];
      if (held.has(name)) { nes?.buttonDown(1, id); applied.add(name); }
      else { nes?.buttonUp(1, id); applied.delete(name); }
    }
    for (const button of buttons) {
      const heldNow = held.has(button.dataset.button);
      button.classList.toggle('pressed', heldNow);
      button.setAttribute('aria-pressed', String(heldNow));
    }
  }

  function clearInputs() { inputs.clear(); syncInputs(); }
  function setInput(source, name, down) {
    if (!running) return;
    if (down) inputs.set(source, name); else inputs.delete(source);
    syncInputs();
  }

  function pollGamepad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.mapping === 'standard');
    for (const key of [...inputs.keys()]) if (key.startsWith('pad:')) inputs.delete(key);
    if (pad && document.hasFocus()) {
      const mapping = { 0: 'A', 1: 'B', 8: 'SELECT', 9: 'START', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT' };
      for (const [id, name] of Object.entries(mapping)) if (pad.buttons[id]?.pressed) inputs.set(`pad:${id}`, name);
      if (pad.axes[0] < -0.5) inputs.set('pad:x', 'LEFT');
      if (pad.axes[0] > 0.5) inputs.set('pad:x', 'RIGHT');
      if (pad.axes[1] < -0.5) inputs.set('pad:y', 'UP');
      if (pad.axes[1] > 0.5) inputs.set('pad:y', 'DOWN');
    }
    if (Boolean(pad) !== gamepadConnected) {
      gamepadConnected = Boolean(pad);
      shownLoop = -1;
    }
    syncInputs();
  }

  // Respond immediately to the audio clock; don't wait for an animation frame.
  function audioMessage({ data }) {
    if (data.type === 'stats') { reportTiming(data); return; }
    if (!running || data.type !== 'frame' || data.epoch !== epoch || data.request <= lastRequest) return;
    lastRequest = data.request;
    try {
      const began = performance.now();
      pollGamepad();
      samples = [];
      nes.frame();
      const buffer = new Float32Array(samples);
      samples = null;
      speaker.port.postMessage({ type: 'samples', epoch, request: data.request, samples: buffer }, [buffer.buffer]);
      const duration = performance.now() - began;
      frameWorkTotal += duration;
      frameWorkPeak = Math.max(frameWorkPeak, duration);
      framesProduced++;
    } catch (error) { showError(error); }
  }

  function tick() {
    if (!running) return;
    try {
      if (frameReady) {
        for (let i = 0; i < latestFrame.length; i++) pixels[i] = 0xff000000 | latestFrame[i];
        context.putImageData(image, 0, 0);
        frameReady = false;
      }
      updateReadout();
      animation = requestAnimationFrame(tick);
    } catch (error) { showError(error); }
  }

  async function start() {
    if (loading || running) return;
    loading = true;
    play.disabled = true;
    try {
      if (!audio) {
        audio = new AudioContext({ latencyHint: 'interactive' });
        await audio.audioWorklet.addModule('audio-worklet.js');
        speaker = new AudioWorkletNode(audio, 'gamebody-audio', {
          outputChannelCount: [1], processorOptions: { diagnostics: timingEnabled },
        });
        speaker.port.onmessage = audioMessage;
        speaker.onprocessorerror = () => showError(new Error('Audio playback stopped. Reload the page.'));
        speaker.connect(audio.destination);
      }
      await audio.resume();
      if (!nes) {
        nes = new jsnes.NES({
          sampleRate: audio.sampleRate,
          onFrame(frame) { latestFrame = frame; frameReady = true; },
          onAudioSample(left, right) { samples?.push((left + right) * 0.4); },
        });
        nes.loadROM(rom);
        for (let i = 0; i < 56; i++) nes.frame();
      }
      clearInputs();
      // Resume at the same frame. Advancing silently here would add rests to
      // a recording or skip part of a playing loop.
      samples = null;
      lastRequest = frameWorkTotal = frameWorkPeak = framesProduced = 0;
      running = true;
      speaker.port.postMessage({ type: 'start', epoch: ++epoch });
      launch.hidden = true;
      pause.hidden = false;
      pause.textContent = 'Pause sound';
      shownLoop = -1;
      updateReadout();
      animation = requestAnimationFrame(tick);
      play.blur();
    } catch (error) { showError(error); }
    finally { loading = false; play.disabled = false; }
  }

  function stop() {
    clearInputs();
    running = false;
    cancelAnimationFrame(animation);
    samples = null;
    speaker?.port.postMessage({ type: 'stop', epoch: ++epoch });
    audio?.suspend().catch(console.error);
    pause.textContent = 'Resume sound';
    status.textContent = 'Paused.';
  }

  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const name = keyMap[event.code];
    if (!name || !running) return;
    event.preventDefault();
    setInput(`key:${event.code}`, name, true);
  });
  document.addEventListener('keyup', event => {
    const name = keyMap[event.code];
    if (!name) return;
    if (running) event.preventDefault();
    setInput(`key:${event.code}`, name, false);
  });
  for (const button of buttons) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (!running) return;
      button.setPointerCapture(event.pointerId);
      setInput(`touch:${event.pointerId}`, button.dataset.button, true);
    });
    const release = event => setInput(`touch:${event.pointerId}`, button.dataset.button, false);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    // Native button keyboard activation remains available to assistive users.
    button.addEventListener('keydown', event => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      setInput(`space:${button.dataset.button}`, button.dataset.button, true);
    });
    button.addEventListener('keyup', event => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      setInput(`space:${button.dataset.button}`, button.dataset.button, false);
    });
  }
  window.addEventListener('blur', () => { if (running) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) stop(); });
  play.addEventListener('click', start);
  pause.addEventListener('click', () => running ? stop() : start());
  Promise.all([fetch('gamebody.nes'), fetch('rom-state.json')]).then(async ([romResponse, stateResponse]) => {
    if (!romResponse.ok || !stateResponse.ok) throw new Error('The cartridge did not load.');
    return Promise.all([romResponse.arrayBuffer(), stateResponse.json()]);
  }).then(([buffer, stateAddresses]) => {
    rom = new Uint8Array(buffer);
    addresses = stateAddresses;
    play.disabled = false;
    play.textContent = 'Make some noise →';
    status.textContent = 'Ready when you are.';
  }).catch(showError);
})();
