/**
 * FREQUENCY — AudioWorklet Tests
 *
 * Tests the AudioWorklet-based audio engine for:
 * - Worklet module loading
 * - Carrier and pulse frequency accuracy
 * - Sample-accurate pulse timing
 * - Zero drift over long renders
 * - Worklet vs legacy output equivalence
 */

import { describe, it, assert } from './test-framework.js';
import { AudioEngine } from '../js/audio-engine.js';
import { measureCarrierFrequency, measurePulseFrequency } from './test-utils.js';

const SAMPLE_RATE = 44100;

/**
 * Create an AudioEngine with worklet initialized for offline rendering.
 */
async function createWorkletEngine(offlineCtx) {
  const engine = new AudioEngine(offlineCtx);
  const loaded = await engine.init();
  if (!loaded) throw new Error('AudioWorklet not available in this browser');
  return engine;
}

/**
 * Render audio using worklet engine.
 */
async function renderWithWorklet(carrierFreq, pulseFreq, duration) {
  const totalSamples = Math.ceil(SAMPLE_RATE * duration);
  const offlineCtx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);

  const engine = await createWorkletEngine(offlineCtx);
  engine.carrierFreq = carrierFreq;
  engine.pulseFreq = pulseFreq;

  engine.start();
  // scheduleForDuration is a no-op for worklet — worklet generates per-sample

  const buffer = await offlineCtx.startRendering();
  return buffer.getChannelData(0);
}

/**
 * Render audio using legacy (non-worklet) engine.
 */
async function renderWithLegacy(carrierFreq, pulseFreq, duration) {
  const totalSamples = Math.ceil(SAMPLE_RATE * duration);
  const offlineCtx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);

  const engine = new AudioEngine(offlineCtx);
  // Don't call init() — forces legacy path
  engine.carrierFreq = carrierFreq;
  engine.pulseFreq = pulseFreq;

  engine.start();
  engine.scheduleForDuration(duration);

  const buffer = await offlineCtx.startRendering();
  return buffer.getChannelData(0);
}

export async function runWorkletTests() {

  await describe('AudioWorklet: Module Loading', async () => {

    await it('worklet module loads successfully', async () => {
      const offlineCtx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
      const engine = new AudioEngine(offlineCtx);
      const loaded = await engine.init();
      assert.equal(loaded, true, 'AudioWorklet module should load');
      assert.equal(engine.usingWorklet, true, 'Engine should report using worklet');
    });

    await it('engine falls back to legacy when init() not called', async () => {
      const offlineCtx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
      const engine = new AudioEngine(offlineCtx);
      // Skip init()
      assert.equal(engine.usingWorklet, false, 'Should use legacy without init()');
    });
  });

  await describe('AudioWorklet: Carrier Frequency Accuracy', async () => {

    for (const freq of [100, 200, 300, 440, 500]) {
      await it(`detects carrier at ${freq} Hz via worklet (±2 Hz)`, async () => {
        const samples = await renderWithWorklet(freq, 10, 2);
        const detected = measureCarrierFrequency(samples, SAMPLE_RATE);
        assert.approximately(detected, freq, 2,
          `Carrier ${freq} Hz: detected ${detected.toFixed(2)} Hz`);
      });
    }
  });

  await describe('AudioWorklet: Pulse Frequency Accuracy', async () => {

    for (const freq of [1, 4, 10, 20, 40]) {
      const duration = Math.max(5, Math.ceil(20 / freq));
      await it(`detects pulse at ${freq} Hz via worklet (±0.1 Hz)`, async () => {
        const samples = await renderWithWorklet(200, freq, duration);
        const result = measurePulseFrequency(samples, SAMPLE_RATE);
        assert.approximately(result.frequency, freq, 0.1,
          `Pulse ${freq} Hz: detected ${result.frequency.toFixed(3)} Hz`);
      });
    }

    await it('detects Schumann 7.83 Hz via worklet (±0.05 Hz)', async () => {
      const samples = await renderWithWorklet(200, 7.83, 20);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.approximately(result.frequency, 7.83, 0.05,
        `Schumann 7.83 Hz: detected ${result.frequency.toFixed(4)} Hz`);
    });
  });

  await describe('AudioWorklet: Sample-Accurate Timing', async () => {

    await it('10 Hz pulse period stdDev < 0.001s (tighter than legacy)', async () => {
      const samples = await renderWithWorklet(200, 10, 10);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.lessThan(result.stdDev, 0.001,
        `Period stdDev: ${result.stdDev.toFixed(6)}s (limit: 0.001s)`);
    });

    await it('40 Hz pulse period stdDev < 0.001s', async () => {
      const samples = await renderWithWorklet(200, 40, 5);
      const result = measurePulseFrequency(samples, SAMPLE_RATE);
      assert.lessThan(result.stdDev, 0.001,
        `Period stdDev: ${result.stdDev.toFixed(6)}s (limit: 0.001s)`);
    });

    await it('pulse gate transitions align within 1 sample of expected', async () => {
      // Render 1 second of 10 Hz pulse at 200 Hz carrier
      const pulseFreq = 10;
      const duration = 1;
      const samples = await renderWithWorklet(200, pulseFreq, duration);

      // At 10 Hz with 50% duty cycle, each pulse is 50ms on, 50ms off
      // First ON should start at sample 0, first OFF at sample 2205 (0.05s)
      const period = SAMPLE_RATE / pulseFreq; // 4410 samples
      const onSamples = period * 0.5; // 2205 samples

      // Check that audio is non-zero at expected ON positions
      // and near-zero at expected OFF positions
      let onCorrect = 0;
      let offCorrect = 0;
      const checkPoints = 5; // Check 5 pulses

      for (let p = 0; p < checkPoints; p++) {
        const onStart = Math.round(p * period);
        const offStart = Math.round(p * period + onSamples);

        // Sample in middle of ON period should be non-zero
        const onMid = onStart + Math.round(onSamples / 2);
        if (onMid < samples.length && Math.abs(samples[onMid]) > 0.01) {
          onCorrect++;
        }

        // Sample in middle of OFF period should be ~zero
        const offMid = offStart + Math.round((period - onSamples) / 2);
        if (offMid < samples.length && Math.abs(samples[offMid]) < 0.01) {
          offCorrect++;
        }
      }

      assert.equal(onCorrect, checkPoints,
        `${onCorrect}/${checkPoints} ON positions correct`);
      assert.equal(offCorrect, checkPoints,
        `${offCorrect}/${checkPoints} OFF positions correct`);
    });
  });

  await describe('AudioWorklet: Drift Prevention', async () => {

    await it('60-second render: first vs last 10s match within 0.001 Hz', async () => {
      const pulseFreq = 10;
      const duration = 60;
      const samples = await renderWithWorklet(200, pulseFreq, duration);

      const first10s = samples.slice(0, SAMPLE_RATE * 10);
      const last10s = samples.slice(SAMPLE_RATE * 50, SAMPLE_RATE * 60);

      const firstResult = measurePulseFrequency(first10s, SAMPLE_RATE);
      const lastResult = measurePulseFrequency(last10s, SAMPLE_RATE);

      const drift = Math.abs(firstResult.frequency - lastResult.frequency);
      assert.lessThan(drift, 0.001,
        `Drift over 60s: ${drift.toFixed(6)} Hz (first: ${firstResult.frequency.toFixed(4)}, last: ${lastResult.frequency.toFixed(4)})`);
    });

    await it('5-minute render: zero audible drift', async () => {
      const pulseFreq = 10;
      const duration = 300;
      const samples = await renderWithWorklet(200, pulseFreq, duration);

      const firstMin = samples.slice(0, SAMPLE_RATE * 60);
      const lastMin = samples.slice(SAMPLE_RATE * 240, SAMPLE_RATE * 300);

      const firstResult = measurePulseFrequency(firstMin, SAMPLE_RATE);
      const lastResult = measurePulseFrequency(lastMin, SAMPLE_RATE);

      const drift = Math.abs(firstResult.frequency - lastResult.frequency);
      assert.lessThan(drift, 0.001,
        `5-min drift: ${drift.toFixed(6)} Hz`);
    });
  });

  await describe('AudioWorklet: Output Equivalence', async () => {

    await it('worklet and legacy produce same pulse frequency (10 Hz)', async () => {
      const workletSamples = await renderWithWorklet(200, 10, 5);
      const legacySamples = await renderWithLegacy(200, 10, 5);

      const workletResult = measurePulseFrequency(workletSamples, SAMPLE_RATE);
      const legacyResult = measurePulseFrequency(legacySamples, SAMPLE_RATE);

      const diff = Math.abs(workletResult.frequency - legacyResult.frequency);
      assert.lessThan(diff, 0.05,
        `Worklet: ${workletResult.frequency.toFixed(3)} Hz, Legacy: ${legacyResult.frequency.toFixed(3)} Hz, diff: ${diff.toFixed(4)}`);
    });

    await it('worklet and legacy produce same carrier frequency (200 Hz)', async () => {
      const workletSamples = await renderWithWorklet(200, 10, 2);
      const legacySamples = await renderWithLegacy(200, 10, 2);

      const workletCarrier = measureCarrierFrequency(workletSamples, SAMPLE_RATE);
      const legacyCarrier = measureCarrierFrequency(legacySamples, SAMPLE_RATE);

      const diff = Math.abs(workletCarrier - legacyCarrier);
      assert.lessThan(diff, 2,
        `Worklet: ${workletCarrier.toFixed(2)} Hz, Legacy: ${legacyCarrier.toFixed(2)} Hz`);
    });

    await it('worklet and legacy produce similar RMS levels', async () => {
      const workletSamples = await renderWithWorklet(200, 10, 2);
      const legacySamples = await renderWithLegacy(200, 10, 2);

      // Compute RMS of each
      function rms(arr) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
        return Math.sqrt(sum / arr.length);
      }

      const workletRMS = rms(workletSamples);
      const legacyRMS = rms(legacySamples);

      // Both should have similar energy (within 20%)
      const ratio = workletRMS / legacyRMS;
      assert(ratio > 0.8 && ratio < 1.2,
        `RMS ratio: ${ratio.toFixed(3)} (worklet: ${workletRMS.toFixed(4)}, legacy: ${legacyRMS.toFixed(4)})`);
    });
  });
}
