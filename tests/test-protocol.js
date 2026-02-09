/**
 * FREQUENCY — Protocol Runner Tests
 *
 * Tests the ProtocolRunner frequency computation, phase selection,
 * lifecycle (start/stop/complete), and callback behavior.
 * Uses a mock controller to capture setPulseFrequency calls.
 */

import { describe, it, assert } from './test-framework.js';
import {
  ProtocolRunner,
  PROTOCOL_PHASES,
  PROTOCOL_DURATION
} from '../js/protocol-runner.js';

/** Mock SyncController that records frequency update calls. */
function createMockController() {
  return {
    frequencies: [],
    active: true,
    setPulseFrequency(freq) {
      this.frequencies.push(freq);
    },
    rampPulseFrequency(freq) {
      this.frequencies.push(freq);
    }
  };
}

export async function runProtocolTests() {

  // --- Constants ---

  await describe('Protocol Constants', async () => {
    await it('PROTOCOL_DURATION is 1200 seconds (20 minutes)', async () => {
      assert.equal(PROTOCOL_DURATION, 1200, `Expected 1200, got ${PROTOCOL_DURATION}`);
    });

    await it('PROTOCOL_PHASES has 4 phases', async () => {
      assert.equal(PROTOCOL_PHASES.length, 4, `Expected 4 phases, got ${PROTOCOL_PHASES.length}`);
    });

    await it('phases cover the full duration with no gaps', async () => {
      assert.equal(PROTOCOL_PHASES[0].startSec, 0, 'First phase should start at 0');
      for (let i = 1; i < PROTOCOL_PHASES.length; i++) {
        assert.equal(PROTOCOL_PHASES[i].startSec, PROTOCOL_PHASES[i - 1].endSec,
          `Phase ${i} start should equal phase ${i-1} end`);
      }
      assert.equal(PROTOCOL_PHASES[PROTOCOL_PHASES.length - 1].endSec, PROTOCOL_DURATION,
        'Last phase should end at PROTOCOL_DURATION');
    });

    await it('phase names are correct', async () => {
      const names = PROTOCOL_PHASES.map(p => p.name);
      assert.equal(names[0], 'Adaptation');
      assert.equal(names[1], 'Transition');
      assert.equal(names[2], 'Entrainment');
      assert.equal(names[3], 'Recognition');
    });
  });

  // --- Phase Selection ---

  await describe('Phase Selection (_getCurrentPhase)', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('returns Adaptation at t=0', async () => {
      const phase = runner._getCurrentPhase(0);
      assert.equal(phase.name, 'Adaptation');
    });

    await it('returns Adaptation at t=60 (midpoint)', async () => {
      const phase = runner._getCurrentPhase(60);
      assert.equal(phase.name, 'Adaptation');
    });

    await it('returns Transition at t=120 (boundary)', async () => {
      const phase = runner._getCurrentPhase(120);
      assert.equal(phase.name, 'Transition');
    });

    await it('returns Transition at t=150', async () => {
      const phase = runner._getCurrentPhase(150);
      assert.equal(phase.name, 'Transition');
    });

    await it('returns Entrainment at t=180', async () => {
      const phase = runner._getCurrentPhase(180);
      assert.equal(phase.name, 'Entrainment');
    });

    await it('returns Entrainment at t=600 (midpoint)', async () => {
      const phase = runner._getCurrentPhase(600);
      assert.equal(phase.name, 'Entrainment');
    });

    await it('returns Recognition at t=1080', async () => {
      const phase = runner._getCurrentPhase(1080);
      assert.equal(phase.name, 'Recognition');
    });

    await it('returns Recognition at t=1199', async () => {
      const phase = runner._getCurrentPhase(1199);
      assert.equal(phase.name, 'Recognition');
    });
  });

  // --- Adaptation Phase (Linear Ramp 38→13 Hz) ---

  await describe('Adaptation Phase Frequency (38→13 Hz, 0–120s)', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('starts at 38 Hz (t=0)', async () => {
      const phase = runner._getCurrentPhase(0);
      const freq = runner._computeFrequency(0, phase);
      assert.approximately(freq, 38, 0.01, `Expected 38 Hz, got ${freq}`);
    });

    await it('reaches 25.5 Hz at midpoint (t=60)', async () => {
      const phase = runner._getCurrentPhase(60);
      const freq = runner._computeFrequency(60, phase);
      assert.approximately(freq, 25.5, 0.01, `Expected 25.5 Hz, got ${freq}`);
    });

    await it('approaches 13 Hz at end (t=119.9)', async () => {
      const phase = runner._getCurrentPhase(119.9);
      const freq = runner._computeFrequency(119.9, phase);
      assert.approximately(freq, 13, 0.1, `Expected ~13 Hz, got ${freq}`);
    });

    await it('is monotonically decreasing', async () => {
      let prev = 38;
      for (let t = 1; t <= 119; t++) {
        const phase = runner._getCurrentPhase(t);
        const freq = runner._computeFrequency(t, phase);
        assert(freq < prev, `Frequency should decrease: at t=${t}, ${freq} >= ${prev}`);
        prev = freq;
      }
    });
  });

  // --- Transition Phase (Linear Ramp 13→10 Hz) ---

  await describe('Transition Phase Frequency (13→10 Hz, 120–180s)', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('starts at 13 Hz (t=120)', async () => {
      const phase = runner._getCurrentPhase(120);
      const freq = runner._computeFrequency(120, phase);
      assert.approximately(freq, 13, 0.01, `Expected 13 Hz, got ${freq}`);
    });

    await it('reaches 11.5 Hz at midpoint (t=150)', async () => {
      const phase = runner._getCurrentPhase(150);
      const freq = runner._computeFrequency(150, phase);
      assert.approximately(freq, 11.5, 0.01, `Expected 11.5 Hz, got ${freq}`);
    });

    await it('approaches 10 Hz at end (t=179.9)', async () => {
      const phase = runner._getCurrentPhase(179.9);
      const freq = runner._computeFrequency(179.9, phase);
      assert.approximately(freq, 10, 0.1, `Expected ~10 Hz, got ${freq}`);
    });
  });

  // --- Entrainment Phase (Sinusoidal 10 ± 2 Hz) ---

  await describe('Entrainment Phase Frequency (sinusoidal 8–12 Hz, 180–1080s)', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('starts at 10 Hz (t=180, sin(0)=0)', async () => {
      const phase = runner._getCurrentPhase(180);
      const freq = runner._computeFrequency(180, phase);
      assert.approximately(freq, 10, 0.01, `Expected 10 Hz, got ${freq}`);
    });

    await it('troughs at 8 Hz at quarter period (t=195)', async () => {
      // period=60s, quarter=15s → t=180+15=195, -sin(π/2)=-1 → 10-2=8
      const phase = runner._getCurrentPhase(195);
      const freq = runner._computeFrequency(195, phase);
      assert.approximately(freq, 8, 0.01, `Expected 8 Hz, got ${freq}`);
    });

    await it('returns to 10 Hz at half period (t=210)', async () => {
      // half period=30s → t=180+30=210, -sin(π)=0 → 10
      const phase = runner._getCurrentPhase(210);
      const freq = runner._computeFrequency(210, phase);
      assert.approximately(freq, 10, 0.01, `Expected 10 Hz, got ${freq}`);
    });

    await it('peaks at 12 Hz at 3/4 period (t=225)', async () => {
      // 3/4 period=45s → t=180+45=225, -sin(3π/2)=1 → 10+2=12
      const phase = runner._getCurrentPhase(225);
      const freq = runner._computeFrequency(225, phase);
      assert.approximately(freq, 12, 0.01, `Expected 12 Hz, got ${freq}`);
    });

    await it('completes full cycle at t=240', async () => {
      const phase = runner._getCurrentPhase(240);
      const freq = runner._computeFrequency(240, phase);
      assert.approximately(freq, 10, 0.01, `Expected 10 Hz, got ${freq}`);
    });

    await it('stays within 8–12 Hz range over entire phase', async () => {
      for (let t = 180; t < 1080; t += 0.5) {
        const phase = runner._getCurrentPhase(t);
        const freq = runner._computeFrequency(t, phase);
        assert(freq >= 7.99 && freq <= 12.01,
          `At t=${t}, freq=${freq.toFixed(3)} out of [8, 12] range`);
      }
    });

    await it('oscillation period is 60 seconds', async () => {
      // Check two full cycles: troughs at t=195 and t=255
      const phase1 = runner._getCurrentPhase(195);
      const freq1 = runner._computeFrequency(195, phase1);
      const phase2 = runner._getCurrentPhase(255);
      const freq2 = runner._computeFrequency(255, phase2);
      assert.approximately(freq1, freq2, 0.01,
        `Trough at t=195 (${freq1}) should equal trough at t=255 (${freq2})`);
    });
  });

  // --- Recognition Phase (Linear Ramp 13→38 Hz) ---

  await describe('Recognition Phase Frequency (13→38 Hz, 1080–1200s)', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('starts at 13 Hz (t=1080)', async () => {
      const phase = runner._getCurrentPhase(1080);
      const freq = runner._computeFrequency(1080, phase);
      assert.approximately(freq, 13, 0.01, `Expected 13 Hz, got ${freq}`);
    });

    await it('reaches 25.5 Hz at midpoint (t=1140)', async () => {
      const phase = runner._getCurrentPhase(1140);
      const freq = runner._computeFrequency(1140, phase);
      assert.approximately(freq, 25.5, 0.01, `Expected 25.5 Hz, got ${freq}`);
    });

    await it('approaches 38 Hz at end (t=1199.9)', async () => {
      const phase = runner._getCurrentPhase(1199.9);
      const freq = runner._computeFrequency(1199.9, phase);
      assert.approximately(freq, 38, 0.1, `Expected ~38 Hz, got ${freq}`);
    });

    await it('is monotonically increasing', async () => {
      let prev = 13;
      for (let t = 1081; t <= 1199; t++) {
        const phase = runner._getCurrentPhase(t);
        const freq = runner._computeFrequency(t, phase);
        assert(freq > prev, `Frequency should increase: at t=${t}, ${freq} <= ${prev}`);
        prev = freq;
      }
    });
  });

  // --- Phase Boundary Continuity ---

  await describe('Phase Boundary Continuity', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('Adaptation→Transition boundary is continuous at ~13 Hz', async () => {
      const phaseBefore = runner._getCurrentPhase(119.99);
      const freqBefore = runner._computeFrequency(119.99, phaseBefore);
      const phaseAfter = runner._getCurrentPhase(120);
      const freqAfter = runner._computeFrequency(120, phaseAfter);
      assert.approximately(freqBefore, freqAfter, 0.1,
        `Boundary 120s: before=${freqBefore.toFixed(2)}, after=${freqAfter.toFixed(2)}`);
    });

    await it('Transition→Entrainment boundary is continuous at ~10 Hz', async () => {
      const phaseBefore = runner._getCurrentPhase(179.99);
      const freqBefore = runner._computeFrequency(179.99, phaseBefore);
      const phaseAfter = runner._getCurrentPhase(180);
      const freqAfter = runner._computeFrequency(180, phaseAfter);
      assert.approximately(freqBefore, freqAfter, 0.1,
        `Boundary 180s: before=${freqBefore.toFixed(2)}, after=${freqAfter.toFixed(2)}`);
    });
  });

  // --- Lifecycle ---

  await describe('Protocol Runner Lifecycle', async () => {
    await it('is not running before start()', async () => {
      const runner = new ProtocolRunner(createMockController());
      assert(!runner.running, 'Should not be running before start()');
    });

    await it('is running after start()', async () => {
      const runner = new ProtocolRunner(createMockController());
      runner.start();
      assert(runner.running, 'Should be running after start()');
      runner.stop();
    });

    await it('is not running after stop()', async () => {
      const runner = new ProtocolRunner(createMockController());
      runner.start();
      runner.stop();
      assert(!runner.running, 'Should not be running after stop()');
    });

    await it('stop() is safe to call when not running', async () => {
      const runner = new ProtocolRunner(createMockController());
      runner.stop(); // should not throw
      assert(!runner.running);
    });

    await it('pushes frequency to controller on start', async () => {
      const mock = createMockController();
      const runner = new ProtocolRunner(mock);
      runner.start();
      // First tick is immediate
      assert(mock.frequencies.length >= 1,
        `Expected at least 1 frequency push, got ${mock.frequencies.length}`);
      runner.stop();
    });

    await it('first frequency pushed is ~38 Hz (Adaptation start)', async () => {
      const mock = createMockController();
      const runner = new ProtocolRunner(mock);
      runner.start();
      assert.approximately(mock.frequencies[0], 38, 0.5,
        `Expected ~38 Hz, got ${mock.frequencies[0]}`);
      runner.stop();
    });
  });

  // --- Callbacks ---

  await describe('Protocol Runner Callbacks', async () => {
    await it('fires onTick with elapsed, phaseName, and freq', async () => {
      const mock = createMockController();
      const runner = new ProtocolRunner(mock);

      let tickCalled = false;
      let tickArgs = {};
      runner.onTick = (elapsed, phaseName, freq) => {
        if (!tickCalled) {
          tickCalled = true;
          tickArgs = { elapsed, phaseName, freq };
        }
      };

      runner.start();
      // Wait a tick
      await new Promise(r => setTimeout(r, 50));
      runner.stop();

      assert(tickCalled, 'onTick should have been called');
      assert.equal(typeof tickArgs.elapsed, 'number', 'elapsed should be a number');
      assert.equal(tickArgs.phaseName, 'Adaptation', 'First phase should be Adaptation');
      assert.approximately(tickArgs.freq, 38, 1, `freq should be ~38, got ${tickArgs.freq}`);
    });

    await it('fires multiple ticks over 350ms', async () => {
      const mock = createMockController();
      const runner = new ProtocolRunner(mock);
      let tickCount = 0;

      runner.onTick = () => { tickCount++; };
      runner.start();
      await new Promise(r => setTimeout(r, 350));
      runner.stop();

      // 100ms interval + immediate first → expect 3-5 ticks in 350ms
      assert(tickCount >= 3, `Expected ≥3 ticks in 350ms, got ${tickCount}`);
      assert(tickCount <= 6, `Expected ≤6 ticks in 350ms, got ${tickCount}`);
    });
  });

  // --- Full Sweep Sanity ---

  await describe('Full Protocol Sweep', async () => {
    const runner = new ProtocolRunner(createMockController());

    await it('frequency profile matches expected shape across all phases', async () => {
      const checkpoints = [
        { t: 0,     min: 37.5, max: 38.5, label: 'start' },
        { t: 60,    min: 25,   max: 26,   label: 'adapt midpoint' },
        { t: 120,   min: 12.5, max: 13.5, label: 'adapt→trans' },
        { t: 150,   min: 11,   max: 12,   label: 'trans midpoint' },
        { t: 180,   min: 9.5,  max: 10.5, label: 'trans→entrain' },
        { t: 195,   min: 7.5,  max: 8.5,  label: 'entrain trough' },
        { t: 225,   min: 11.5, max: 12.5, label: 'entrain peak' },
        { t: 1080,  min: 12.5, max: 13.5, label: 'entrain→recog' },
        { t: 1140,  min: 25,   max: 26,   label: 'recog midpoint' },
        { t: 1199.9, min: 37.5, max: 38.5, label: 'end' }
      ];

      for (const cp of checkpoints) {
        const phase = runner._getCurrentPhase(cp.t);
        const freq = runner._computeFrequency(cp.t, phase);
        assert(freq >= cp.min && freq <= cp.max,
          `At t=${cp.t} (${cp.label}): freq=${freq.toFixed(2)}, expected [${cp.min}, ${cp.max}]`);
      }
    });
  });
}
