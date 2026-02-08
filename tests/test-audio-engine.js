/**
 * FREQUENCY — Audio Engine Tests
 *
 * Tests carrier frequency accuracy and pulse frequency accuracy
 * using OfflineAudioContext for deterministic rendering.
 */

import { describe, it, assert } from './test-framework.js';
import { AudioEngine } from '../js/audio-engine.js';
import { measureCarrierFrequency, measurePulseFrequency } from './test-utils.js';

const SAMPLE_RATE = 44100;

/**
 * Render audio from an AudioEngine for a given duration.
 * @param {number} carrierFreq
 * @param {number} pulseFreq
 * @param {number} duration — seconds
 * @returns {Promise<Float32Array>}
 */
async function renderAudio(carrierFreq, pulseFreq, duration) {
  const totalSamples = Math.ceil(SAMPLE_RATE * duration);
  const offlineCtx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);

  const engine = new AudioEngine(offlineCtx);
  engine.carrierFreq = carrierFreq;
  engine.pulseFreq = pulseFreq;

  engine.start();
  engine.scheduleForDuration(duration);

  const buffer = await offlineCtx.startRendering();
  return buffer.getChannelData(0);
}

export async function runAudioEngineTests() {

  // --- Carrier Frequency Accuracy ---

  await describe('Carrier Frequency Accuracy', async () => {
    const carrierFreqs = [100, 200, 300, 440, 500];

    for (const freq of carrierFreqs) {
      await it(`detects carrier at ${freq} Hz (±2 Hz)`, async () => {
        const samples = await renderAudio(freq, 10, 2);
        const detected = measureCarrierFrequency(samples, SAMPLE_RATE);
        assert.approximately(detected, freq, 2,
          `Carrier ${freq} Hz: detected ${detected.toFixed(2)} Hz`);
      });
    }
  });

  // --- Pulse Frequency Accuracy ---

  await describe('Pulse Frequency Accuracy', async () => {
    const pulseFreqs = [1, 4, 10, 14, 20, 40, 50];

    for (const freq of pulseFreqs) {
      const duration = Math.max(5, Math.ceil(20 / freq));
      await it(`detects pulse at ${freq} Hz (±0.1 Hz, ${duration}s render)`, async () => {
        const samples = await renderAudio(200, freq, duration);
        const result = measurePulseFrequency(samples, SAMPLE_RATE);
        assert.approximately(result.frequency, freq, 0.1,
          `Pulse ${freq} Hz: detected ${result.frequency.toFixed(3)} Hz`);
      });
    }

    // Low frequency needs longer render
    await it('detects pulse at 0.5 Hz (±0.1 Hz, 40s render)', async () => {
      const samples = await renderAudio(200, 0.5, 40);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.approximately(result.frequency, 0.5, 0.1,
        `Pulse 0.5 Hz: detected ${result.frequency.toFixed(3)} Hz`);
    });

    // Schumann resonance - extra precision
    await it('detects Schumann resonance 7.83 Hz (±0.05 Hz, 20s render)', async () => {
      const samples = await renderAudio(200, 7.83, 20);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.approximately(result.frequency, 7.83, 0.05,
        `Schumann 7.83 Hz: detected ${result.frequency.toFixed(4)} Hz`);
    });
  });

  // --- Pulse Period Consistency ---

  await describe('Pulse Period Consistency', async () => {
    await it('10 Hz pulse period stdDev < 0.002s over 10s', async () => {
      const samples = await renderAudio(200, 10, 10);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.lessThan(result.stdDev, 0.002,
        `Period stdDev: ${result.stdDev.toFixed(6)}s (limit: 0.002s)`);
    });

    await it('40 Hz pulse period stdDev < 0.002s over 5s', async () => {
      const samples = await renderAudio(200, 40, 5);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.lessThan(result.stdDev, 0.002,
        `Period stdDev: ${result.stdDev.toFixed(6)}s (limit: 0.002s)`);
    });
  });
}
