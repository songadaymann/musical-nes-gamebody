// The audio clock asks for one NES frame at a time. Screen refresh never gates
// sound, and a slow main thread cannot build a backlog of old notes.
class GamebodyAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.samples = new Float32Array(Math.ceil(sampleRate * 0.04));
    // Leave enough time for a frame's CPU work and the message round trip.
    // Allow for observed 13 ms CPU bursts plus the message round trip. The
    // queue stays below 35 ms, including the newly generated NES frame.
    this.headroom = Math.ceil(sampleRate * 0.018);
    this.diagnostics = Boolean(options?.processorOptions?.diagnostics);
    this.running = false;
    this.epoch = 0;
    this.sequence = 0;
    this.reset();
    this.port.onmessage = ({ data }) => this.receive(data);
  }

  reset() {
    this.read = this.write = this.count = 0;
    this.pending = null;
    this.primed = false;
    this.peak = this.total = this.blocks = this.underrun = 0;
    this.elapsed = this.frames = 0;
  }

  receive(data) {
    if (data.type === 'start' || data.type === 'stop') {
      this.reset();
      this.epoch = data.epoch;
      this.running = data.type === 'start';
      this.requestFrame();
      return;
    }
    if (data.type !== 'samples' || !this.running || data.epoch !== this.epoch ||
        this.pending === null || data.request !== this.pending) return;
    const buffer = data.samples;
    // A single NTSC frame is about 16.64 ms. Keep a little allowance for
    // sample rounding, but never accept a batch of catch-up frames.
    if (!(buffer instanceof Float32Array) || !buffer.length ||
        buffer.length > Math.ceil(sampleRate / 50) ||
        this.count + buffer.length > this.samples.length) {
      throw new Error('Invalid NES audio frame');
    }
    for (const value of buffer) {
      this.samples[this.write] = value;
      this.write = (this.write + 1) % this.samples.length;
      this.count++;
    }
    this.pending = null;
    this.primed = true;
    this.frames++;
    this.peak = Math.max(this.peak, this.count);
  }

  requestFrame() {
    if (!this.running || this.pending !== null || this.count > this.headroom) return;
    this.pending = ++this.sequence;
    this.port.postMessage({ type: 'frame', epoch: this.epoch, request: this.pending });
  }

  process(inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;
    channel.fill(0);
    if (!this.running) return true;
    // Don't count the intentional silence while the first frame is prepared.
    if (!this.primed) { this.requestFrame(); return true; }
    this.total += this.count;
    this.blocks++;
    this.elapsed += channel.length;
    for (let i = 0; i < channel.length; i++) {
      if (this.count) {
        channel[i] = this.samples[this.read];
        this.read = (this.read + 1) % this.samples.length;
        this.count--;
      } else this.underrun++;
    }
    this.requestFrame();
    if (this.diagnostics && this.blocks % 180 === 0) {
      this.port.postMessage({ type: 'stats', epoch: this.epoch,
        queueMeanMs: this.total / this.blocks / sampleRate * 1000,
        queuePeakMs: this.peak / sampleRate * 1000,
        underrunMs: this.underrun / sampleRate * 1000,
        elapsedSeconds: this.elapsed / sampleRate, frames: this.frames });
    }
    return true;
  }
}
registerProcessor('gamebody-audio', GamebodyAudio);
