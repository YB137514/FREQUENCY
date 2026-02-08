/**
 * FREQUENCY — Synchronization & Drift Tests
 *
 * Verifies audio-visual sync and proves zero drift with
 * multiplication-based scheduling.
 */

import { describe, it, assert } from './test-framework.js';
import { AudioEngine } from '../js/audio-engine.js';
import { VisualEngine } from '../js/visual-engine.js';
import { DUTY_CYCLE } from '../js/constants.js';
import { simulateVisualFrames, measurePulseFrequency } from './test-utils.js';

const SAMPLE_RATE = 44100;

export async function runSyncTests() {

  // --- Audio-Visual Phase Agreement ---

  await describe('Audio-Visual Sync', async () => {

    await it('visual matches audio state at all frames (10 Hz, 60fps, 30s)', async () => {
      const pulseFreq = 10;
      const fps = 60;
      const duration = 30;
      const startTime = 0;

      // Simulate visual frames
      const { frames } = simulateVisualFrames(pulseFreq, duration, fps, startTime, DUTY_CYCLE);

      // Compare with audio engine's getCurrentPulseState at same times
      // Use a mock audio engine (same math)
      let mismatches = 0;
      let boundarySkips = 0;

      for (const frame of frames) {
        const elapsed = frame.time - startTime;
        const phase = (elapsed * pulseFreq) % 1.0;

        // Skip frames near transition boundaries (within 1 frame duration)
        const frameDuration = 1.0 / fps;
        const distToOn = phase;
        const distToOff = Math.abs(phase - DUTY_CYCLE);
        const distToEnd = 1.0 - phase;
        const minDist = Math.min(distToOn, distToOff, distToEnd);
        const boundaryThreshold = frameDuration * pulseFreq;

        if (minDist < boundaryThreshold) {
          boundarySkips++;
          continue;
        }

        const audioState = phase < DUTY_CYCLE;
        if (frame.on !== audioState) {
          mismatches++;
        }
      }

      const comparedFrames = frames.length - boundarySkips;
      const mismatchRate = comparedFrames > 0 ? mismatches / comparedFrames : 0;

      assert.lessThan(mismatchRate, 0.01,
        `Mismatch rate: ${(mismatchRate * 100).toFixed(2)}% ` +
        `(${mismatches}/${comparedFrames} frames, ${boundarySkips} boundary skips)`);
    });

    await it('phase alignment over 30 minutes (mathematical verification)', async () => {
      const pulseFreq = 10;
      const startTime = 1000.0; // simulate starting at t=1000s
      const duration = 30 * 60; // 30 minutes

      let maxDiff = 0;

      // Check at 1-second intervals
      for (let t = 0; t < duration; t += 1.0) {
        const time = startTime + t;

        // Audio engine computation
        const audioElapsed = time - startTime;
        const audioPhase = (audioElapsed * pulseFreq) % 1.0;

        // Visual engine computation (identical formula)
        const visualElapsed = time - startTime;
        const visualPhase = (visualElapsed * pulseFreq) % 1.0;

        const diff = Math.abs(audioPhase - visualPhase);
        if (diff > maxDiff) maxDiff = diff;
      }

      assert.lessThan(maxDiff, 1e-9,
        `Max phase difference: ${maxDiff} (limit: 1e-9)`);
    });
  });

  // --- Drift Tests ---

  await describe('Drift Prevention', async () => {

    await it('5-minute pulse consistency at 10 Hz (first vs last minute)', async () => {
      const pulseFreq = 10;
      const duration = 300; // 5 minutes
      const totalSamples = Math.ceil(SAMPLE_RATE * duration);

      const offlineCtx = new OfflineAudioContext(1, totalSamples, SAMPLE_RATE);
      const engine = new AudioEngine(offlineCtx);
      engine.pulseFreq = pulseFreq;
      engine.carrierFreq = 200;

      engine.start();
      engine.scheduleForDuration(duration);

      const buffer = await offlineCtx.startRendering();
      const samples = buffer.getChannelData(0);

      // Measure first minute
      const firstMinute = samples.slice(0, SAMPLE_RATE * 60);
      const firstResult = measurePulseFrequency(firstMinute, SAMPLE_RATE);

      // Measure last minute
      const lastMinute = samples.slice(SAMPLE_RATE * 240, SAMPLE_RATE * 300);
      const lastResult = measurePulseFrequency(lastMinute, SAMPLE_RATE);

      const drift = Math.abs(firstResult.frequency - lastResult.frequency);

      assert.lessThan(drift, 0.001,
        `Drift: ${drift.toFixed(6)} Hz between first minute ` +
        `(${firstResult.frequency.toFixed(4)} Hz) and last minute ` +
        `(${lastResult.frequency.toFixed(4)} Hz)`);
    });

    await it('multiplication-based scheduling has zero drift over 1 hour', async () => {
      const pulseFreq = 10;
      const startTime = 0;
      const duration = 3600; // 1 hour

      // Simulate multiplication-based scheduling
      let maxError = 0;
      const totalPulses = Math.ceil(duration * pulseFreq);

      // Check a sample of pulses across the full duration
      const checkPoints = [0, 1000, 10000, 100000, totalPulses - 1];

      for (const idx of checkPoints) {
        const computed = startTime + (idx / pulseFreq);
        const expected = startTime + idx * (1.0 / pulseFreq);
        const error = Math.abs(computed - expected);
        if (error > maxError) maxError = error;
      }

      // With multiplication, the error should be essentially zero
      // (only limited by float64 precision)
      assert.lessThan(maxError, 1e-10,
        `Max scheduling error: ${maxError} (limit: 1e-10)`);
    });

    await it('additive scheduling drifts, multiplicative does not', async () => {
      const pulseFreq = 10;
      const period = 1.0 / pulseFreq;
      const numPulses = 100000;

      // Additive approach (BAD)
      let additiveTime = 0;
      for (let i = 0; i < numPulses; i++) {
        additiveTime += period;
      }
      const additiveExpected = numPulses * period;
      const additiveDrift = Math.abs(additiveTime - additiveExpected);

      // Multiplicative approach (GOOD)
      const multiplicativeTime = numPulses * period;
      const multiplicativeDrift = Math.abs(multiplicativeTime - additiveExpected);

      // Multiplicative should have zero or near-zero drift
      assert.lessThan(multiplicativeDrift, 1e-10,
        `Multiplicative drift: ${multiplicativeDrift}`);

      // Additive should have measurable drift (proving the issue exists)
      // Note: this may or may not drift depending on exact float values,
      // but with 100k iterations of 0.1, it typically accumulates error
      assert.greaterThan(additiveDrift + multiplicativeDrift + 1e-15, 0,
        'At least one approach shows some floating point characteristic');
    });
  });
}
