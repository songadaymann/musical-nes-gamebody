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
  const buttons = [...document.querySelectorAll('[data-button]')];
  const keyMap = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', KeyX: 'A', KeyZ: 'B', ShiftLeft: 'SELECT', ShiftRight: 'SELECT', Enter: 'START' };
  const inputs = new Map();
  const applied = new Set();
  let rom, nes, audio, speaker, running = false, loading = false;
  let animation, nextFrame = 0, samples = [], gamepadConnected = false;
  const frameMs = 1000 / 60.0988;

  function showError(error) {
    console.error(error);
    running = false;
    cancelAnimationFrame(animation);
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
      status.textContent = pad ? 'Controller connected. Play!' : 'Pick a note. Make a melody.';
    }
    syncInputs();
  }

  function tick(now) {
    if (!running) return;
    try {
      pollGamepad();
      if (now - nextFrame > 100) nextFrame = now;
      let count = 0;
      while (now >= nextFrame && count < 3) {
        nes.frame();
        nextFrame += frameMs;
        count++;
      }
      if (samples.length) {
        const buffer = new Float32Array(samples);
        samples = [];
        speaker.port.postMessage({ samples: buffer }, [buffer.buffer]);
      }
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
        speaker = new AudioWorkletNode(audio, 'gamebody-audio', { outputChannelCount: [1] });
        speaker.connect(audio.destination);
      }
      await audio.resume();
      if (!nes) {
        nes = new jsnes.NES({
          sampleRate: audio.sampleRate,
          onFrame(frame) {
            for (let i = 0; i < frame.length; i++) pixels[i] = 0xff000000 | frame[i];
            context.putImageData(image, 0, 0);
          },
          onAudioSample(left, right) { samples.push((left + right) * 0.4); },
        });
        nes.loadROM(rom);
        for (let i = 0; i < 8; i++) nes.frame();
      }
      clearInputs();
      // Finish any release tail before resuming after blur/pause.
      for (let i = 0; i < 48; i++) nes.frame();
      samples = [];
      speaker.port.postMessage({ type: 'clear' });
      running = true;
      launch.hidden = true;
      pause.hidden = false;
      pause.textContent = 'Pause sound';
      status.textContent = 'Pick a note. Make a melody.';
      nextFrame = performance.now();
      animation = requestAnimationFrame(tick);
      play.blur();
    } catch (error) { showError(error); }
    finally { loading = false; play.disabled = false; }
  }

  function stop() {
    clearInputs();
    running = false;
    cancelAnimationFrame(animation);
    samples = [];
    speaker?.port.postMessage({ type: 'clear' });
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
  fetch('gamebody.nes').then(response => {
    if (!response.ok) throw new Error(`ROM load failed: ${response.status}`);
    return response.arrayBuffer();
  }).then(buffer => {
    rom = new Uint8Array(buffer);
    play.disabled = false;
    play.textContent = 'Make some noise →';
    status.textContent = 'Ready when you are.';
  }).catch(showError);
})();
