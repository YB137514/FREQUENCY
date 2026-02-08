/**
 * FREQUENCY — Visual Flicker Engine
 *
 * Drives a full-screen flicker overlay synchronized to the audio clock.
 * Each requestAnimationFrame reads AudioContext.currentTime, computes
 * the pulse phase, and sets overlay opacity accordingly.
 *
 * Does NOT maintain its own timer — purely reactive to the audio clock.
 */

import { FLICKER_OPACITY_ON, FLICKER_OPACITY_OFF, DUTY_CYCLE } from './constants.js';

export class VisualEngine {
  /**
   * @param {AudioContext} audioCtx — shared audio context (clock source)
   * @param {HTMLElement} overlayElement — the flicker overlay DOM element
   */
  constructor(audioCtx, overlayElement) {
    this.audioCtx = audioCtx;
    this.overlay = overlayElement;
    this.pulseFreq = 10;
    this.dutyCycle = DUTY_CYCLE;

    this._startTime = 0;
    this._running = false;
    this._rafId = null;
    this._lastState = null;

    // Diagnostics: track real transition times
    this._transitionTimes = [];
    this._maxTransitionHistory = 300;
  }

  /**
   * Start the visual flicker loop.
   * @param {number} startTime — AudioContext.currentTime at session start
   */
  start(startTime) {
    this._startTime = startTime;
    this._running = true;
    this._lastState = null;
    this._transitionTimes = [];
    this._tick();
  }

  /**
   * Stop the visual flicker loop and hide overlay.
   */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.overlay) {
      this.overlay.style.opacity = FLICKER_OPACITY_OFF;
    }
    this._lastState = null;
  }

  /**
   * Compute the ON/OFF state for a given time.
   * Same formula used by AudioEngine.getCurrentPulseState().
   *
   * @param {number} time
   * @returns {boolean} true if ON
   */
  getPulseState(time) {
    const elapsed = time - this._startTime;
    if (elapsed < 0) return false;
    const phase = (elapsed * this.pulseFreq) % 1.0;
    return phase < this.dutyCycle;
  }

  /**
   * rAF callback: read audio clock, compute state, update overlay.
   */
  _tick() {
    if (!this._running) return;

    const time = this.audioCtx.currentTime;
    const isOn = this.getPulseState(time);

    // Only update DOM if state changed (avoid unnecessary repaints)
    if (isOn !== this._lastState) {
      this.overlay.style.opacity = isOn ? FLICKER_OPACITY_ON : FLICKER_OPACITY_OFF;
      this._lastState = isOn;

      // Record transition for diagnostics
      this._transitionTimes.push(time);
      if (this._transitionTimes.length > this._maxTransitionHistory) {
        this._transitionTimes.shift();
      }
    }

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  /**
   * Update pulse frequency.
   * @param {number} newFreq
   */
  setPulseFrequency(newFreq) {
    this.pulseFreq = newFreq;
  }

  /**
   * Update start time (used when audio engine resets on frequency change).
   * @param {number} newStartTime
   */
  setStartTime(newStartTime) {
    this._startTime = newStartTime;
  }

  /**
   * Measure actual visual flicker frequency from recent transitions.
   * @returns {number} measured frequency in Hz, or 0 if not enough data
   */
  getMeasuredFrequency() {
    const t = this._transitionTimes;
    if (t.length < 4) return 0;

    // Use last ~2 seconds of transitions
    const now = t[t.length - 1];
    const windowStart = now - 2.0;
    let startIdx = t.length - 1;
    while (startIdx > 0 && t[startIdx] > windowStart) startIdx--;

    const windowTransitions = t.length - 1 - startIdx;
    const windowDuration = now - t[startIdx];
    if (windowDuration < 0.1) return 0;

    // 2 transitions per cycle (on→off, off→on)
    return windowTransitions / (2 * windowDuration);
  }

  /** @returns {boolean} */
  get running() {
    return this._running;
  }
}
