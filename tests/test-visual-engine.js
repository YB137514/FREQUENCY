/**
 * FREQUENCY — Visual Engine Tests
 *
 * Verifies visual flicker timing using simulated rAF frames.
 */

import { describe, it, assert } from './test-framework.js';
import { simulateVisualFrames } from './test-utils.js';
import { DUTY_CYCLE } from '../js/constants.js';

export async function runVisualEngineTests() {

  await describe('Visual Flicker Timing', async () => {

    await it('10 Hz at 60fps: transition count matches target (5s)', async () => {
      const pulseFreq = 10;
      const fps = 60;
      const duration = 5;

      const { frames, transitions } = simulateVisualFrames(pulseFreq, duration, fps, 0, DUTY_CYCLE);

      // Expected: 10 Hz = 10 full cycles/s, each cycle has 2 transitions
      // Over 5s: ~100 transitions (on→off and off→on)
      const expectedTransitions = pulseFreq * duration * 2;
      const measuredFreq = transitions / (2 * duration);

      assert.approximately(measuredFreq, pulseFreq, 0.5,
        `Measured visual freq: ${measuredFreq.toFixed(2)} Hz (expected ${pulseFreq} ±0.5 Hz)`);
    });

    await it('1 Hz at 60fps: transition count matches target (10s)', async () => {
      const pulseFreq = 1;
      const fps = 60;
      const duration = 10;

      const { transitions } = simulateVisualFrames(pulseFreq, duration, fps, 0, DUTY_CYCLE);
      const measuredFreq = transitions / (2 * duration);

      assert.approximately(measuredFreq, pulseFreq, 0.5,
        `Measured visual freq: ${measuredFreq.toFixed(2)} Hz (expected ${pulseFreq} ±0.5 Hz)`);
    });

    await it('40 Hz at 60fps: aliases due to Nyquist limit (expected ~20 Hz)', async () => {
      const pulseFreq = 40;
      const fps = 60;
      const duration = 5;

      const { transitions } = simulateVisualFrames(pulseFreq, duration, fps, 0, DUTY_CYCLE);
      const measuredFreq = transitions / (2 * duration);

      // 40 Hz exceeds Nyquist limit of 30 Hz at 60fps, so it aliases.
      // The aliased frequency is fps - pulseFreq = 20 Hz.
      const aliasedFreq = fps - pulseFreq;
      assert.approximately(measuredFreq, aliasedFreq, 2.0,
        `Measured visual freq: ${measuredFreq.toFixed(2)} Hz (expected alias ~${aliasedFreq} Hz at ${fps}fps)`);
    });

    await it('50 Hz at 60fps: ON/OFF ratio is ~50/50 (±5%)', async () => {
      const pulseFreq = 50;
      const fps = 60;
      const duration = 5;

      const { frames } = simulateVisualFrames(pulseFreq, duration, fps, 0, DUTY_CYCLE);

      const onFrames = frames.filter(f => f.on).length;
      const offFrames = frames.filter(f => !f.on).length;
      const total = frames.length;
      const onRatio = onFrames / total;

      assert.approximately(onRatio, 0.5, 0.05,
        `ON ratio: ${(onRatio * 100).toFixed(1)}% ` +
        `(${onFrames} on, ${offFrames} off, ${total} total)`);
    });

    await it('7.83 Hz at 60fps: accurate frequency (10s)', async () => {
      const pulseFreq = 7.83;
      const fps = 60;
      const duration = 10;

      const { transitions } = simulateVisualFrames(pulseFreq, duration, fps, 0, DUTY_CYCLE);
      const measuredFreq = transitions / (2 * duration);

      assert.approximately(measuredFreq, pulseFreq, 0.5,
        `Measured visual freq: ${measuredFreq.toFixed(2)} Hz (expected ${pulseFreq} ±0.5 Hz)`);
    });

    await it('visual state at 120fps matches 60fps (same phase formula)', async () => {
      const pulseFreq = 10;
      const duration = 5;

      const result60 = simulateVisualFrames(pulseFreq, duration, 60, 0, DUTY_CYCLE);
      const result120 = simulateVisualFrames(pulseFreq, duration, 120, 0, DUTY_CYCLE);

      const freq60 = result60.transitions / (2 * duration);
      const freq120 = result120.transitions / (2 * duration);

      // Both should measure the same frequency
      assert.approximately(freq60, freq120, 0.5,
        `60fps measured ${freq60.toFixed(2)} Hz, 120fps measured ${freq120.toFixed(2)} Hz`);
    });
  });
}
