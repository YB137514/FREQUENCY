/**
 * FREQUENCY — Isochronic Tone Generator
 *
 * Uses Web Audio API to produce pulsed tones.
 * Pulse scheduling uses multiplication-based indexing to prevent drift:
 *   t = startTime + (pulseIndex / pulseFreq)
 *
 * Architecture:
 *   OscillatorNode (carrier) → GainNode (pulse gate) → destination
 */

import {
  CARRIER_FREQ_DEFAULT,
  PULSE_FREQ_DEFAULT,
  SCHEDULER_INTERVAL_MS,
  SCHEDULER_LOOKAHEAD_S,
  GAIN_ON,
  GAIN_OFF,
  DUTY_CYCLE
} from './constants.js';

export class AudioEngine {
  /**
   * @param {AudioContext|OfflineAudioContext} audioCtx
   */
  constructor(audioCtx) {
    this.audioCtx = audioCtx;
    this.carrierFreq = CARRIER_FREQ_DEFAULT;
    this.pulseFreq = PULSE_FREQ_DEFAULT;
    this.dutyCycle = DUTY_CYCLE;

    this.oscillator = null;
    this.gainNode = null;
    this.analyser = null;
    this.schedulerTimer = null;

    // Scheduling state
    this._startTime = 0;
    this._nextPulseIndex = 0;
    this._running = false;
  }

  /**
   * Build audio graph: Oscillator → Gain → destination
   */
  _createGraph() {
    this.oscillator = this.audioCtx.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.setValueAtTime(this.carrierFreq, this.audioCtx.currentTime);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(GAIN_OFF, this.audioCtx.currentTime);

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 32768;

    this.oscillator.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
  }

  /**
   * Schedule gain pulses from _nextPulseIndex up to lookahead window.
   * Uses multiplication-based timing: t = startTime + (index / pulseFreq)
   */
  _schedulePulses() {
    if (!this._running) return;

    const now = this.audioCtx.currentTime;
    const scheduleUntil = now + SCHEDULER_LOOKAHEAD_S;
    const period = 1.0 / this.pulseFreq;
    const onDuration = period * this.dutyCycle;

    while (true) {
      // Multiplication-based: no accumulated floating-point error
      const pulseStart = this._startTime + (this._nextPulseIndex * period);
      const pulseEnd = pulseStart + onDuration;

      if (pulseStart > scheduleUntil) break;

      // Only schedule future events
      if (pulseEnd > now) {
        if (pulseStart > now) {
          this.gainNode.gain.setValueAtTime(GAIN_ON, pulseStart);
        }
        this.gainNode.gain.setValueAtTime(GAIN_OFF, pulseEnd);
      }

      this._nextPulseIndex++;
    }
  }

  /**
   * Start generating isochronic tones.
   */
  start() {
    if (this._running) return;

    this._createGraph();
    this._startTime = this.audioCtx.currentTime;
    this._nextPulseIndex = 0;
    this._running = true;

    this.oscillator.start(this._startTime);

    // Initial schedule
    this._schedulePulses();

    // For OfflineAudioContext, no interval needed (render completes synchronously)
    if (this.audioCtx.constructor.name !== 'OfflineAudioContext' &&
        !(this.audioCtx instanceof OfflineAudioContext)) {
      this.schedulerTimer = setInterval(() => this._schedulePulses(), SCHEDULER_INTERVAL_MS);
    }
  }

  /**
   * For OfflineAudioContext: schedule all pulses for the entire render duration.
   * @param {number} duration — total render duration in seconds
   */
  scheduleForDuration(duration) {
    if (!this._running) return;

    const period = 1.0 / this.pulseFreq;
    const onDuration = period * this.dutyCycle;
    const totalPulses = Math.ceil(duration * this.pulseFreq) + 1;

    for (let i = this._nextPulseIndex; i < totalPulses; i++) {
      const pulseStart = this._startTime + (i * period);
      const pulseEnd = pulseStart + onDuration;

      if (pulseStart >= this._startTime + duration) break;

      this.gainNode.gain.setValueAtTime(GAIN_ON, pulseStart);
      this.gainNode.gain.setValueAtTime(GAIN_OFF, pulseEnd);
    }

    this._nextPulseIndex = totalPulses;
  }

  /**
   * Stop generating tones and tear down audio graph.
   */
  stop() {
    if (!this._running) return;
    this._running = false;

    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    try {
      this.oscillator.stop();
      this.oscillator.disconnect();
      this.gainNode.disconnect();
    } catch (e) {
      // Nodes may already be stopped/disconnected
    }

    this.oscillator = null;
    this.gainNode = null;
    this.analyser = null;
  }

  /**
   * Change pulse frequency mid-session.
   * Cancels scheduled gain values and re-schedules from current time.
   * @param {number} newFreq — new pulse frequency in Hz
   */
  setPulseFrequency(newFreq) {
    this.pulseFreq = newFreq;

    if (!this._running) return;

    // Cancel future scheduled gain values
    this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
    this.gainNode.gain.setValueAtTime(GAIN_OFF, this.audioCtx.currentTime);

    // Reset scheduling from current time
    this._startTime = this.audioCtx.currentTime;
    this._nextPulseIndex = 0;

    this._schedulePulses();
  }

  /**
   * Change carrier frequency.
   * @param {number} newFreq — new carrier frequency in Hz
   */
  setCarrierFrequency(newFreq) {
    this.carrierFreq = newFreq;
    if (this.oscillator) {
      this.oscillator.frequency.setValueAtTime(newFreq, this.audioCtx.currentTime);
    }
  }

  /**
   * Compute the current pulse ON/OFF state for a given time.
   * Used by VisualEngine for synchronization.
   *
   * @param {number} time — AudioContext.currentTime value
   * @returns {boolean} true if pulse is ON at this time
   */
  getCurrentPulseState(time) {
    if (!this._running) return false;
    const elapsed = time - this._startTime;
    if (elapsed < 0) return false;
    const phase = (elapsed * this.pulseFreq) % 1.0;
    return phase < this.dutyCycle;
  }

  /** @returns {boolean} */
  get running() {
    return this._running;
  }

  /** @returns {number} */
  get startTime() {
    return this._startTime;
  }
}
