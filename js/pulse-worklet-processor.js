/**
 * FREQUENCY — Pulse Worklet Processor
 *
 * Runs on the audio rendering thread, separate from the main thread.
 * Generates isochronic tones (carrier sine wave * pulse gate) with
 * true sample-accurate timing. Uses multiplication-based phase
 * computation to prevent drift.
 *
 * Audio graph: AudioWorkletNode → AnalyserNode → destination
 */

class PulseWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'carrierFreq', defaultValue: 200, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'pulseFreq', defaultValue: 10, minValue: 0.1, maxValue: 100, automationRate: 'a-rate' },
      { name: 'dutyCycle', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'active', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this._carrierPhase = 0;
    this._pulseStartFrame = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'set-start-frame') {
        this._pulseStartFrame = e.data.frame;
      } else if (e.data.type === 'reset-pulse') {
        // Reset pulse timing from a new reference frame
        this._pulseStartFrame = e.data.frame;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0][0];
    if (!output) return true;

    const active = parameters.active[0] >= 0.5;

    if (!active) {
      output.fill(0);
      return true;
    }

    const dutyCycle = parameters.dutyCycle[0];
    const carrierFreqArr = parameters.carrierFreq;
    const pulseFreqArr = parameters.pulseFreq;
    const isCarrierConstant = carrierFreqArr.length === 1;
    const isPulseConstant = pulseFreqArr.length === 1;

    for (let i = 0; i < output.length; i++) {
      const frame = currentFrame + i;
      const cf = isCarrierConstant ? carrierFreqArr[0] : carrierFreqArr[i];
      const pf = isPulseConstant ? pulseFreqArr[0] : pulseFreqArr[i];

      // Pulse gate: multiplication-based timing from start frame
      // elapsed = (frame - startFrame) / sampleRate
      // phase = (elapsed * pulseFreq) % 1.0
      const elapsed = (frame - this._pulseStartFrame) / sampleRate;
      const pulsePhase = (elapsed * pf) % 1.0;
      const gate = pulsePhase < dutyCycle ? 1.0 : 0.0;

      // Carrier: sine wave with phase accumulation
      const sample = Math.sin(2 * Math.PI * this._carrierPhase) * gate;
      this._carrierPhase += cf / sampleRate;

      // Keep phase in [0, 1) to prevent float precision loss over time
      if (this._carrierPhase >= 1.0) {
        this._carrierPhase -= Math.floor(this._carrierPhase);
      }

      output[i] = sample;
    }

    return true;
  }
}

registerProcessor('pulse-worklet-processor', PulseWorkletProcessor);
