// Small queue for real-time play. Samples come only from the emulated NES APU.
class GamebodyAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(8192);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'clear') { this.read = this.write = this.count = 0; return; }
      const buffer = data.samples;
      // Bound latency when a browser tab stalls, rather than playing old notes.
      const maximum = Math.round(sampleRate * 0.045);
      const drop = Math.max(0, this.count + buffer.length - maximum);
      this.read = (this.read + Math.min(drop, this.count)) % this.samples.length;
      this.count = Math.max(0, this.count - drop);
      for (const value of buffer) {
        this.samples[this.write] = value;
        this.write = (this.write + 1) % this.samples.length;
        this.count++;
      }
    };
  }
  process(inputs, outputs) {
    const channel = outputs[0][0];
    for (let i = 0; i < channel.length; i++) {
      if (this.count) {
        channel[i] = this.samples[this.read];
        this.read = (this.read + 1) % this.samples.length;
        this.count--;
      } else { channel[i] = 0; }
    }
    return true;
  }
}
registerProcessor('gamebody-audio', GamebodyAudio);
