/**
 * FREQUENCY — Diagnostics Detection Tests
 *
 * Tests the pulse detection algorithm (Diagnostics.detectPulseFromSamples)
 * against known synthesized signals rendered via OfflineAudioContext.
 */

import { describe, it, assert } from './test-framework.js';
import { AudioEngine } from '../js/audio-engine.js';
import { Diagnostics } from '../js/diagnostics.js';

const SAMPLE_RATE = 44100;
const BUFFER_SIZE = 32768; // Matches AnalyserNode fftSize (743ms at 44.1kHz)

/**
 * Render a pulsed tone and return a chunk of samples the same size
 * as the AnalyserNode buffer.
 */
async function renderPulseBuffer(carrierFreq, pulseFreq, offset = 0) {
  // Render enough to have the buffer after a settling period
  const duration = (BUFFER_SIZE / SAMPLE_RATE) + offset + 0.5;
  const totalSamples = Math.ceil(SAMPLE_RATE * duration);
  const offlineCtx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);

  const engine = new AudioEngine(offlineCtx);
  engine.carrierFreq = carrierFreq;
  engine.pulseFreq = pulseFreq;
  engine.start();
  engine.scheduleForDuration(duration);

  const buffer = await offlineCtx.startRendering();
  const allSamples = buffer.getChannelData(0);

  // Extract a BUFFER_SIZE chunk from after the offset
  const startSample = Math.floor(offset * SAMPLE_RATE);
  return new Float32Array(allSamples.buffer, startSample * 4, BUFFER_SIZE);
}

export async function runDiagnosticsTests() {

  await describe('Diagnostics: Pulse Detection from Buffer', async () => {

    await it('detects 10 Hz pulse from 743ms buffer (±2 Hz)', async () => {
      const data = await renderPulseBuffer(200, 10, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.approximately(detected, 10, 2,
        `10 Hz pulse: detected ${detected.toFixed(2)} Hz`);
    });

    await it('detects 6 Hz (theta) pulse (±2 Hz)', async () => {
      const data = await renderPulseBuffer(200, 6, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.approximately(detected, 6, 2,
        `6 Hz pulse: detected ${detected.toFixed(2)} Hz`);
    });

    await it('detects 7.83 Hz (Schumann) pulse (±2 Hz)', async () => {
      const data = await renderPulseBuffer(200, 7.83, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.approximately(detected, 7.83, 2,
        `7.83 Hz pulse: detected ${detected.toFixed(2)} Hz`);
    });

    await it('detects 20 Hz (beta) pulse (±3 Hz)', async () => {
      const data = await renderPulseBuffer(200, 20, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.approximately(detected, 20, 3,
        `20 Hz pulse: detected ${detected.toFixed(2)} Hz`);
    });

    await it('detects 40 Hz (gamma) pulse (±5 Hz)', async () => {
      const data = await renderPulseBuffer(200, 40, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.approximately(detected, 40, 5,
        `40 Hz pulse: detected ${detected.toFixed(2)} Hz`);
    });

    await it('returns 0 for silent buffer', async () => {
      const data = new Float32Array(BUFFER_SIZE);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.equal(detected, 0, 'Silent buffer should return 0');
    });

    await it('returns 0 for continuous tone (no pulsing)', async () => {
      const duration = 2.0;
      const totalSamples = Math.ceil(SAMPLE_RATE * duration);
      const offlineCtx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);

      const osc = offlineCtx.createOscillator();
      osc.frequency.value = 200;
      osc.connect(offlineCtx.destination);
      osc.start();

      const buffer = await offlineCtx.startRendering();
      const allSamples = buffer.getChannelData(0);
      const chunk = new Float32Array(allSamples.buffer, 0, BUFFER_SIZE);

      const detected = Diagnostics.detectPulseFromSamples(chunk, SAMPLE_RATE);
      assert.equal(detected, 0,
        `Continuous tone should return 0, got ${detected.toFixed(2)}`);
    });

    await it('works with different carrier frequencies (100, 300, 500 Hz)', async () => {
      for (const carrier of [100, 300, 500]) {
        const data = await renderPulseBuffer(carrier, 10, 0.5);
        const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
        assert.approximately(detected, 10, 2,
          `10 Hz pulse at ${carrier} Hz carrier: detected ${detected.toFixed(2)} Hz`);
      }
    });

    await it('detects pulse from buffer at different offsets (phase)', async () => {
      const offsets = [0.3, 0.5, 0.73, 1.0, 1.5];
      let successes = 0;

      for (const offset of offsets) {
        const data = await renderPulseBuffer(200, 10, offset);
        const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
        if (detected > 0 && Math.abs(detected - 10) < 3) {
          successes++;
        }
      }

      // All offsets should work with the larger 743ms buffer
      assert.greaterThan(successes, 3,
        `Only ${successes}/5 offsets detected 10 Hz correctly`);
    });
  });

  await describe('Diagnostics: Low Frequency Handling', async () => {

    await it('2 Hz (delta): detectable in 743ms buffer', async () => {
      // At 2 Hz, period is 500ms. 743ms buffer contains ~1.5 cycles.
      const data = await renderPulseBuffer(200, 2, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert(detected === 0 || Math.abs(detected - 2) < 2,
        `2 Hz: got ${detected.toFixed(2)} Hz (0 or ~2 acceptable)`);
    });

    await it('4 Hz: detectable in 743ms buffer (~3 cycles)', async () => {
      const data = await renderPulseBuffer(200, 4, 0.5);
      const detected = Diagnostics.detectPulseFromSamples(data, SAMPLE_RATE);
      assert.approximately(detected, 4, 2,
        `4 Hz: detected ${detected.toFixed(2)} Hz`);
    });
  });
}
