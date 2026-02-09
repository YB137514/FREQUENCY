/**
 * FREQUENCY — Timed Entrainment Protocol Runner
 *
 * 20-minute protocol based on Kanzler et al. study on acoustic
 * neurostimulation for depression/anxiety/stress.
 *
 * Phases:
 *   Adaptation   0:00–2:00  Cosine-eased ramp 38 Hz → 13 Hz
 *   Transition   2:00–3:00  Cosine-eased ramp 13 Hz → 10 Hz
 *   Entrainment  3:00–18:00 Sinusoidal f(t) = 10 − 2·sin(2π/60·t), range 8–12 Hz
 *   Recognition  18:00–20:00 Cosine-eased ramp 13 Hz → 38 Hz
 */

export const PROTOCOL_DURATION = 1200; // 20 minutes in seconds

export const PROTOCOL_PHASES = [
  { name: 'Adaptation',  startSec:    0, endSec:  120, type: 'ramp', freqStart: 38, freqEnd: 13 },
  { name: 'Transition',  startSec:  120, endSec:  180, type: 'ramp', freqStart: 13, freqEnd: 10 },
  { name: 'Entrainment', startSec:  180, endSec: 1080, type: 'sine', center: 10, amplitude: 2, period: 60 },
  { name: 'Recognition', startSec: 1080, endSec: 1200, type: 'ramp', freqStart: 13, freqEnd: 38 }
];

export class ProtocolRunner {
  /**
   * @param {import('./sync-controller.js').SyncController} controller
   */
  constructor(controller) {
    this.controller = controller;
    this._startTime = 0;
    this._intervalId = null;
    this._onTick = null;
    this._onComplete = null;
  }

  /** @param {(elapsed: number, phaseName: string, freq: number) => void} fn */
  set onTick(fn) { this._onTick = fn; }

  /** @param {() => void} fn */
  set onComplete(fn) { this._onComplete = fn; }

  /** Start the protocol. */
  start() {
    this._startTime = performance.now();
    this._tick(); // immediate first tick
    this._intervalId = setInterval(() => this._tick(), 100);
  }

  /** Stop the protocol (does NOT stop the controller). */
  stop() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /** @returns {boolean} */
  get running() {
    return this._intervalId !== null;
  }

  /** Internal tick — compute frequency, push to controller, fire callback. */
  _tick() {
    const elapsedSec = (performance.now() - this._startTime) / 1000;

    if (elapsedSec >= PROTOCOL_DURATION) {
      this.stop();
      if (this._onComplete) this._onComplete();
      return;
    }

    const phase = this._getCurrentPhase(elapsedSec);
    const freq = this._computeFrequency(elapsedSec, phase);

    this.controller.rampPulseFrequency(freq);

    if (this._onTick) {
      this._onTick(elapsedSec, phase.name, freq);
    }
  }

  /**
   * Get the current phase for the given elapsed time.
   * @param {number} elapsedSec
   * @returns {object}
   */
  _getCurrentPhase(elapsedSec) {
    for (const phase of PROTOCOL_PHASES) {
      if (elapsedSec < phase.endSec) {
        return phase;
      }
    }
    return PROTOCOL_PHASES[PROTOCOL_PHASES.length - 1];
  }

  /**
   * Compute entrainment frequency for the given time and phase.
   * @param {number} elapsedSec
   * @param {object} phase
   * @returns {number}
   */
  _computeFrequency(elapsedSec, phase) {
    if (phase.type === 'ramp') {
      const t = (elapsedSec - phase.startSec) / (phase.endSec - phase.startSec);
      // Cosine easing: rate is 0 at both ends for smooth phase transitions
      const eased = (1 - Math.cos(Math.PI * t)) / 2;
      return phase.freqStart + (phase.freqEnd - phase.freqStart) * eased;
    }

    // Sinusoidal: f(t) = center - amplitude * sin(2π/period * t)
    // Phase-shifted by π so oscillation begins descending (matches prior ramp direction)
    const phaseTime = elapsedSec - phase.startSec;
    return phase.center - phase.amplitude * Math.sin(2 * Math.PI * (1 / phase.period) * phaseTime);
  }
}
