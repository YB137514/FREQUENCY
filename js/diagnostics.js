/**
 * FREQUENCY — Live Diagnostics
 *
 * Measures real-time carrier frequency (via FFT) and pulse frequency
 * (via windowed RMS envelope within each AnalyserNode buffer), plus
 * actual visual flicker rate from recorded screen transitions.
 */

export class Diagnostics {
  /**
   * @param {import('./sync-controller.js').SyncController} controller
   * @param {object} elements — DOM elements for display
   */
  constructor(controller, elements) {
    this.controller = controller;
    this.els = elements;

    this._timer = null;
    this._pulseEma = 0;
    this._pulseEmaReady = false;
    this._carrierEma = 0;
    this._carrierEmaReady = false;
    this._visualEma = 0;
    this._visualEmaReady = false;
    // Lower alpha = smoother (0.1 = very stable, 0.3 = responsive)
    this._emaAlpha = 0.08;
  }

  start() {
    this._pulseEma = 0;
    this._pulseEmaReady = false;
    this._carrierEma = 0;
    this._carrierEmaReady = false;
    this._visualEma = 0;
    this._visualEmaReady = false;
    this._timer = setInterval(() => this._update(), 250);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._clearDisplay();
  }

  _update() {
    const engine = this.controller.audioEngine;
    const binaural = this.controller.binauralEngine;
    const visual = this.controller.visualEngine;
    const active = this.controller.active;

    if (!active) {
      this._clearDisplay();
      return;
    }

    // --- Binaural mode: both carrier and beat from two-peak FFT analysis ---
    if (binaural && binaural.analyser && binaural.running) {
      const peaks = this._measureBinauralPeaks(binaural.analyser);

      if (peaks.carrier > 0) {
        this._carrierEma = this._emaUpdate(this._carrierEma, peaks.carrier, this._carrierEmaReady);
        this._carrierEmaReady = true;
        this.els.carrierMeasured.textContent = this._carrierEma.toFixed(1) + ' Hz';
      } else if (!this._carrierEmaReady) {
        this.els.carrierMeasured.textContent = '--';
      }

      if (peaks.beat > 0) {
        this._pulseEma = this._emaUpdate(this._pulseEma, peaks.beat, this._pulseEmaReady);
        this._pulseEmaReady = true;
        this.els.pulseMeasured.textContent = this._pulseEma.toFixed(1) + ' Hz';
      } else if (!this._pulseEmaReady) {
        this.els.pulseMeasured.textContent = '--';
      }

      this.els.visualMeasured.textContent = '--';
      return;
    }

    // --- Isochronic mode: carrier frequency from FFT ---
    if (engine && engine.analyser && engine.running) {
      const carrierHz = this._measureCarrier(engine.analyser);
      if (carrierHz > 0) {
        this._carrierEma = this._emaUpdate(this._carrierEma, carrierHz, this._carrierEmaReady);
        this._carrierEmaReady = true;
        this.els.carrierMeasured.textContent = this._carrierEma.toFixed(1) + ' Hz';
      } else if (!this._carrierEmaReady) {
        this.els.carrierMeasured.textContent = '--';
      }

      // --- Pulse frequency from windowed RMS envelope ---
      const pulseHz = this._measurePulse(engine.analyser);
      if (pulseHz > 0) {
        this._pulseEma = this._emaUpdate(this._pulseEma, pulseHz, this._pulseEmaReady);
        this._pulseEmaReady = true;
        this.els.pulseMeasured.textContent = this._pulseEma.toFixed(1) + ' Hz';
      } else if (!this._pulseEmaReady) {
        this.els.pulseMeasured.textContent = '--';
      }
    } else {
      this.els.carrierMeasured.textContent = '--';
      this.els.pulseMeasured.textContent = '--';
    }

    // --- Visual flicker frequency from actual transitions ---
    if (visual && visual.running) {
      const visualHz = visual.getMeasuredFrequency();
      if (visualHz > 0) {
        this._visualEma = this._emaUpdate(this._visualEma, visualHz, this._visualEmaReady);
        this._visualEmaReady = true;
        this.els.visualMeasured.textContent = this._visualEma.toFixed(1) + ' Hz';
      } else if (!this._visualEmaReady) {
        this.els.visualMeasured.textContent = '--';
      }
    } else {
      this.els.visualMeasured.textContent = '--';
    }
  }

  /**
   * Detect carrier frequency from FFT peak.
   */
  _measureCarrier(analyser) {
    const bufLen = analyser.frequencyBinCount;
    const data = new Float32Array(bufLen);
    analyser.getFloatFrequencyData(data);

    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / analyser.fftSize;

    // Find peak bin (skip DC bin 0)
    let peakBin = 1;
    let peakVal = -Infinity;
    for (let i = 1; i < bufLen; i++) {
      if (data[i] > peakVal) {
        peakVal = data[i];
        peakBin = i;
      }
    }

    if (peakVal < -80) return 0;

    // Parabolic interpolation for sub-bin accuracy
    // Uses the peak bin and its two neighbors to find the true peak
    if (peakBin > 0 && peakBin < bufLen - 1) {
      const alpha = data[peakBin - 1];
      const beta = data[peakBin];
      const gamma = data[peakBin + 1];
      const denom = alpha - 2 * beta + gamma;
      if (denom !== 0) {
        const correction = 0.5 * (alpha - gamma) / denom;
        return (peakBin + correction) * binWidth;
      }
    }

    return peakBin * binWidth;
  }

  /**
   * Detect binaural carrier and beat from two FFT peaks.
   * The AnalyserNode downmixes stereo to mono, producing two peaks:
   * one at carrierFreq and one at carrierFreq + beatFreq.
   * Carrier = lower peak, beat = difference between peaks.
   * @returns {{ carrier: number, beat: number }}
   */
  _measureBinauralPeaks(analyser) {
    const result = { carrier: 0, beat: 0 };
    const bufLen = analyser.frequencyBinCount;
    const data = new Float32Array(bufLen);
    analyser.getFloatFrequencyData(data);

    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / analyser.fftSize;

    // Find the two strongest peaks (skip DC bin 0)
    let peak1Bin = 1, peak1Val = -Infinity;
    for (let i = 1; i < bufLen; i++) {
      if (data[i] > peak1Val) {
        peak1Val = data[i];
        peak1Bin = i;
      }
    }

    if (peak1Val < -80) return result;

    // Parabolic interpolation helper
    const interpolate = (bin) => {
      if (bin > 0 && bin < bufLen - 1) {
        const a = data[bin - 1], b = data[bin], g = data[bin + 1];
        const denom = a - 2 * b + g;
        if (denom !== 0) return (bin + 0.5 * (a - g) / denom) * binWidth;
      }
      return bin * binWidth;
    };

    // Find second peak: must be at least 3 bins away from first
    let peak2Bin = 1, peak2Val = -Infinity;
    for (let i = 1; i < bufLen; i++) {
      if (Math.abs(i - peak1Bin) >= 3 && data[i] > peak2Val) {
        peak2Val = data[i];
        peak2Bin = i;
      }
    }

    // If only one peak found, return it as carrier with no beat
    if (peak2Val < -80 || peak1Val - peak2Val > 30) {
      result.carrier = interpolate(peak1Bin);
      return result;
    }

    const freq1 = interpolate(peak1Bin);
    const freq2 = interpolate(peak2Bin);

    // Lower frequency = carrier, difference = beat
    result.carrier = Math.min(freq1, freq2);
    result.beat = Math.abs(freq2 - freq1);
    return result;
  }

  /**
   * Detect pulse frequency within a single AnalyserNode buffer.
   * Computes windowed RMS envelope, finds rising edges, measures
   * average period between them.
   *
   * @returns {number} detected frequency in Hz, or 0 if insufficient data
   */
  _measurePulse(analyser) {
    const bufLen = analyser.fftSize;
    const data = new Float32Array(bufLen);
    analyser.getFloatTimeDomainData(data);

    const sampleRate = analyser.context.sampleRate;
    return Diagnostics.detectPulseFromSamples(data, sampleRate);
  }

  /**
   * Static method: detect pulse frequency from raw samples.
   * Exported for testing.
   *
   * @param {Float32Array} data — time-domain audio samples
   * @param {number} sampleRate
   * @returns {number} detected frequency in Hz, or 0
   */
  static detectPulseFromSamples(data, sampleRate) {
    const bufLen = data.length;

    // Step 1: Fine RMS envelope (~4ms windows for good pulse resolution)
    const windowSize = Math.max(32, Math.floor(sampleRate * 0.004));
    const numWindows = Math.floor(bufLen / windowSize);
    if (numWindows < 8) return 0;

    const rawEnvelope = new Float32Array(numWindows);
    for (let w = 0; w < numWindows; w++) {
      let sumSq = 0;
      const offset = w * windowSize;
      for (let i = 0; i < windowSize; i++) {
        const s = data[offset + i];
        sumSq += s * s;
      }
      rawEnvelope[w] = Math.sqrt(sumSq / windowSize);
    }

    // Step 2: Smooth envelope with moving average to remove carrier ripple
    // Kernel of 3 windows = ~12ms, smooths 100 Hz carrier (10ms period)
    // while preserving 40 Hz pulse edges (12.5ms on/off)
    const kernel = 3;
    const half = Math.floor(kernel / 2);
    const envelope = new Float32Array(numWindows);
    for (let i = 0; i < numWindows; i++) {
      let sum = 0;
      let count = 0;
      for (let k = -half; k <= half; k++) {
        const idx = i + k;
        if (idx >= 0 && idx < numWindows) {
          sum += rawEnvelope[idx];
          count++;
        }
      }
      envelope[i] = sum / count;
    }

    // Find min/max of smoothed envelope
    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < numWindows; i++) {
      if (envelope[i] < minVal) minVal = envelope[i];
      if (envelope[i] > maxVal) maxVal = envelope[i];
    }

    // Need meaningful on/off contrast
    if (maxVal < 0.001 || (maxVal - minVal) < maxVal * 0.3) return 0;

    const threshold = (minVal + maxVal) / 2;

    // Find rising edge positions
    const edges = [];
    let wasHigh = envelope[0] > threshold;
    for (let i = 1; i < numWindows; i++) {
      const isHigh = envelope[i] > threshold;
      if (isHigh && !wasHigh) {
        edges.push(i);
      }
      wasHigh = isHigh;
    }

    if (edges.length < 2) return 0;

    // Compute average period from edge intervals
    const windowDuration = windowSize / sampleRate;
    let totalPeriod = 0;
    for (let i = 1; i < edges.length; i++) {
      totalPeriod += (edges[i] - edges[i - 1]) * windowDuration;
    }
    const avgPeriod = totalPeriod / (edges.length - 1);

    if (avgPeriod <= 0) return 0;
    return 1.0 / avgPeriod;
  }

  /**
   * Exponential moving average update.
   * @param {number} prev — previous EMA value
   * @param {number} value — new measurement
   * @param {boolean} initialized — if false, seeds with the raw value
   * @returns {number} updated EMA
   */
  _emaUpdate(prev, value, initialized) {
    if (!initialized) return value;
    return prev + this._emaAlpha * (value - prev);
  }

  /**
   * Clear readings when frequency changes so stale data doesn't linger.
   */
  resetPulseReadings() {
    this._pulseEma = 0;
    this._pulseEmaReady = false;
    this._visualEma = 0;
    this._visualEmaReady = false;
  }

  _clearDisplay() {
    this.els.carrierMeasured.textContent = '--';
    this.els.pulseMeasured.textContent = '--';
    this.els.visualMeasured.textContent = '--';
  }
}
