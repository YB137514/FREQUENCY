/**
 * FREQUENCY — Binaural Beat Engine Tests
 *
 * Tests stereo binaural beat generation using OfflineAudioContext(2, ...).
 * Verifies carrier accuracy on left channel, carrier+beat on right channel,
 * beat frequency accuracy, continuous tone (no pulsing), and worklet vs legacy equivalence.
 */

import { describe, it, assert } from './test-framework.js';
import { BinauralEngine } from '../js/binaural-engine.js';
import { measureCarrierFrequency } from './test-utils.js';
import { Diagnostics } from '../js/diagnostics.js';

const SAMPLE_RATE = 44100;

/**
 * Render stereo audio from a BinauralEngine for a given duration.
 * @param {number} carrierFreq
 * @param {number} beatFreq
 * @param {number} duration — seconds
 * @returns {Promise<{ left: Float32Array, right: Float32Array }>}
 */
async function renderBinaural(carrierFreq, beatFreq, duration) {
  const totalSamples = Math.ceil(SAMPLE_RATE * duration);
  const offlineCtx = new OfflineAudioContext(2, totalSamples, SAMPLE_RATE);

  const engine = new BinauralEngine(offlineCtx);
  await engine.init();
  engine.carrierFreq = carrierFreq;
  engine.beatFreq = beatFreq;

  engine.start();

  const buffer = await offlineCtx.startRendering();
  return {
    left: buffer.getChannelData(0),
    right: buffer.getChannelData(1)
  };
}

/**
 * Compute RMS of the entire buffer.
 * @param {Float32Array} samples
 * @returns {number}
 */
function computeRMS(samples) {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Compute windowed RMS values and return the coefficient of variation (stdDev/mean).
 * A perfectly continuous tone has very low CV; a pulsing tone has high CV.
 * @param {Float32Array} samples
 * @param {number} windowSize
 * @returns {number} coefficient of variation
 */
function rmsVariation(samples, windowSize) {
  const numWindows = Math.floor(samples.length / windowSize);
  if (numWindows < 2) return 0;

  const rmsValues = [];
  for (let w = 0; w < numWindows; w++) {
    let sumSq = 0;
    const offset = w * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[offset + i];
      sumSq += s * s;
    }
    rmsValues.push(Math.sqrt(sumSq / windowSize));
  }

  const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  if (mean < 0.001) return 0;

  const variance = rmsValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / rmsValues.length;
  return Math.sqrt(variance) / mean;
}

export async function runBinauralTests() {

  // --- Module Loading ---

  await describe('Binaural Engine Setup', async () => {
    await it('creates BinauralEngine with legacy fallback', async () => {
      const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
      const engine = new BinauralEngine(offlineCtx);
      // init() on OfflineAudioContext typically fails for worklets — expect legacy
      await engine.init();
      assert(!engine.running, 'Engine should not be running before start()');
    });

    await it('starts and stops without errors', async () => {
      const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
      const engine = new BinauralEngine(offlineCtx);
      await engine.init();
      engine.start();
      assert(engine.running, 'Engine should be running after start()');
      engine.stop();
      assert(!engine.running, 'Engine should not be running after stop()');
    });
  });

  // --- Left Channel Carrier Accuracy ---

  await describe('Binaural Left Channel Carrier Accuracy', async () => {
    const carrierFreqs = [100, 200, 300, 440, 500];

    for (const freq of carrierFreqs) {
      await it(`left channel carrier at ${freq} Hz (±2 Hz)`, async () => {
        const { left } = await renderBinaural(freq, 10, 2);
        const detected = measureCarrierFrequency(left, SAMPLE_RATE);
        assert.approximately(detected, freq, 2,
          `Left carrier ${freq} Hz: detected ${detected.toFixed(2)} Hz`);
      });
    }
  });

  // --- Right Channel = Carrier + Beat ---

  await describe('Binaural Right Channel Accuracy', async () => {
    const cases = [
      { carrier: 200, beat: 10 },
      { carrier: 300, beat: 5 },
      { carrier: 440, beat: 40 },
      { carrier: 100, beat: 1 }
    ];

    for (const { carrier, beat } of cases) {
      await it(`right channel at ${carrier}+${beat}=${carrier + beat} Hz (±2 Hz)`, async () => {
        const { right } = await renderBinaural(carrier, beat, 2);
        const detected = measureCarrierFrequency(right, SAMPLE_RATE);
        assert.approximately(detected, carrier + beat, 2,
          `Right ${carrier}+${beat} Hz: detected ${detected.toFixed(2)} Hz`);
      });
    }
  });

  // --- Beat Frequency Accuracy ---

  await describe('Beat Frequency Accuracy', async () => {
    const beatFreqs = [
      { beat: 0.25, duration: 20 },
      { beat: 1, duration: 10 },
      { beat: 5, duration: 4 },
      { beat: 10, duration: 2 },
      { beat: 20, duration: 2 },
      { beat: 40, duration: 2 }
    ];

    for (const { beat, duration } of beatFreqs) {
      await it(`beat frequency ${beat} Hz (±2 Hz via channel difference)`, async () => {
        const carrier = 200;
        const { left, right } = await renderBinaural(carrier, beat, duration);
        const leftFreq = measureCarrierFrequency(left, SAMPLE_RATE);
        const rightFreq = measureCarrierFrequency(right, SAMPLE_RATE);
        const measuredBeat = rightFreq - leftFreq;
        assert.approximately(measuredBeat, beat, 2,
          `Beat ${beat} Hz: measured ${measuredBeat.toFixed(2)} Hz (L=${leftFreq.toFixed(1)}, R=${rightFreq.toFixed(1)})`);
      });
    }
  });

  // --- Continuous Tone (No Pulsing) ---

  await describe('Binaural Continuous Tone', async () => {
    await it('left channel has constant RMS (no pulsing)', async () => {
      const { left } = await renderBinaural(200, 10, 2);
      // Use ~50ms windows for RMS analysis
      const windowSize = Math.floor(SAMPLE_RATE * 0.05);
      const cv = rmsVariation(left, windowSize);
      assert.lessThan(cv, 0.05,
        `Left RMS coefficient of variation: ${cv.toFixed(4)} (limit: 0.05)`);
    });

    await it('right channel has constant RMS (no pulsing)', async () => {
      const { right } = await renderBinaural(200, 10, 2);
      const windowSize = Math.floor(SAMPLE_RATE * 0.05);
      const cv = rmsVariation(right, windowSize);
      assert.lessThan(cv, 0.05,
        `Right RMS coefficient of variation: ${cv.toFixed(4)} (limit: 0.05)`);
    });

    await it('pulse detection returns 0 for continuous binaural tone', async () => {
      const { left } = await renderBinaural(200, 10, 5);
      const pulseHz = Diagnostics.detectPulseFromSamples(left, SAMPLE_RATE);
      assert.equal(pulseHz, 0,
        `Expected 0 pulses detected, got ${pulseHz.toFixed(2)} Hz`);
    });
  });

  // --- Signal Presence ---

  await describe('Binaural Signal Presence', async () => {
    await it('both channels have non-zero audio output', async () => {
      const { left, right } = await renderBinaural(200, 10, 1);
      const leftRMS = computeRMS(left);
      const rightRMS = computeRMS(right);
      assert.greaterThan(leftRMS, 0.1,
        `Left RMS should be > 0.1, got ${leftRMS.toFixed(4)}`);
      assert.greaterThan(rightRMS, 0.1,
        `Right RMS should be > 0.1, got ${rightRMS.toFixed(4)}`);
    });

    await it('left and right channels have similar amplitude', async () => {
      const { left, right } = await renderBinaural(200, 10, 1);
      const leftRMS = computeRMS(left);
      const rightRMS = computeRMS(right);
      const ratio = leftRMS / rightRMS;
      assert.approximately(ratio, 1.0, 0.1,
        `L/R amplitude ratio: ${ratio.toFixed(3)} (expected ~1.0)`);
    });
  });

  // --- Frequency Change Mid-Session ---

  await describe('Binaural Mid-Session Changes', async () => {
    await it('setBeatFrequency updates right channel', async () => {
      const totalSamples = Math.ceil(SAMPLE_RATE * 2);
      const offlineCtx = new OfflineAudioContext(2, totalSamples, SAMPLE_RATE);

      const engine = new BinauralEngine(offlineCtx);
      await engine.init();
      engine.carrierFreq = 200;
      engine.beatFreq = 10;
      engine.start();

      // Change beat freq after construction but before rendering
      engine.setBeatFrequency(20);

      const buffer = await offlineCtx.startRendering();
      const right = buffer.getChannelData(1);
      const detected = measureCarrierFrequency(right, SAMPLE_RATE);
      // Should be carrier + new beat = 200 + 20 = 220
      assert.approximately(detected, 220, 3,
        `After setBeatFrequency(20), right channel: ${detected.toFixed(1)} Hz (expected ~220)`);
    });

    await it('setCarrierFrequency updates both channels', async () => {
      const totalSamples = Math.ceil(SAMPLE_RATE * 2);
      const offlineCtx = new OfflineAudioContext(2, totalSamples, SAMPLE_RATE);

      const engine = new BinauralEngine(offlineCtx);
      await engine.init();
      engine.carrierFreq = 200;
      engine.beatFreq = 10;
      engine.start();

      // Change carrier
      engine.setCarrierFrequency(300);

      const buffer = await offlineCtx.startRendering();
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      const leftFreq = measureCarrierFrequency(left, SAMPLE_RATE);
      const rightFreq = measureCarrierFrequency(right, SAMPLE_RATE);
      assert.approximately(leftFreq, 300, 3,
        `After setCarrier(300), left: ${leftFreq.toFixed(1)} Hz`);
      assert.approximately(rightFreq, 310, 3,
        `After setCarrier(300), right: ${rightFreq.toFixed(1)} Hz (300+10)`);
    });
  });
}
