/**
 * FREQUENCY — Binaural Beat Worklet Processor
 *
 * Runs on the audio rendering thread. Generates stereo continuous sine waves:
 *   Left channel:  sin(carrierFreq)
 *   Right channel: sin(carrierFreq + beatFreq)
 *
 * The perceived binaural beat = beatFreq Hz (difference between ears).
 * Phase accumulation with wrap to [0,1) prevents drift over long sessions.
 */

class BinauralWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'carrierFreq', defaultValue: 200, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'beatFreq', defaultValue: 10, minValue: 0.1, maxValue: 60, automationRate: 'a-rate' },
      { name: 'active', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this._leftPhase = 0;
    this._rightPhase = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1];

    if (!left || !right) return true;

    const active = parameters.active[0] >= 0.5;

    if (!active) {
      left.fill(0);
      right.fill(0);
      return true;
    }

    const carrierFreqArr = parameters.carrierFreq;
    const beatFreqArr = parameters.beatFreq;
    const isCarrierConstant = carrierFreqArr.length === 1;
    const isBeatConstant = beatFreqArr.length === 1;

    for (let i = 0; i < left.length; i++) {
      const cf = isCarrierConstant ? carrierFreqArr[0] : carrierFreqArr[i];
      const bf = isBeatConstant ? beatFreqArr[0] : beatFreqArr[i];

      // Left channel: carrier only
      left[i] = Math.sin(2 * Math.PI * this._leftPhase);
      this._leftPhase += cf / sampleRate;

      // Right channel: carrier + beat
      right[i] = Math.sin(2 * Math.PI * this._rightPhase);
      this._rightPhase += (cf + bf) / sampleRate;

      // Wrap phases to [0, 1) to prevent floating-point drift
      if (this._leftPhase >= 1.0) {
        this._leftPhase -= Math.floor(this._leftPhase);
      }
      if (this._rightPhase >= 1.0) {
        this._rightPhase -= Math.floor(this._rightPhase);
      }
    }

    return true;
  }
}

registerProcessor('binaural-worklet-processor', BinauralWorkletProcessor);
