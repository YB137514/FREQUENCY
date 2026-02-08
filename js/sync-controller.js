/**
 * FREQUENCY — Sync Controller
 *
 * Orchestrates AudioEngine and VisualEngine with a shared AudioContext.
 * Manages mode switching (audio / visual / both), frequency changes,
 * and AudioContext lifecycle (created on first user gesture).
 */

import { AudioEngine } from './audio-engine.js';
import { VisualEngine } from './visual-engine.js';
import {
  MODES,
  MODE_DEFAULT,
  PULSE_FREQ_DEFAULT,
  CARRIER_FREQ_DEFAULT
} from './constants.js';

export class SyncController {
  /**
   * @param {HTMLElement} flickerOverlay — the flicker overlay DOM element
   */
  constructor(flickerOverlay) {
    this.flickerOverlay = flickerOverlay;
    this.audioCtx = null;
    this.audioEngine = null;
    this.visualEngine = null;

    this.mode = MODE_DEFAULT;
    this.pulseFreq = PULSE_FREQ_DEFAULT;
    this.carrierFreq = CARRIER_FREQ_DEFAULT;
    this._active = false;
  }

  /**
   * Create AudioContext (must be called from user gesture).
   */
  _ensureAudioContext() {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Start entrainment session.
   */
  start() {
    this._ensureAudioContext();
    this._active = true;

    // Create engines
    this.audioEngine = new AudioEngine(this.audioCtx);
    this.audioEngine.carrierFreq = this.carrierFreq;
    this.audioEngine.pulseFreq = this.pulseFreq;

    this.visualEngine = new VisualEngine(this.audioCtx, this.flickerOverlay);
    this.visualEngine.pulseFreq = this.pulseFreq;

    // Start based on mode
    if (this.mode === MODES.AUDIO || this.mode === MODES.BOTH) {
      this.audioEngine.start();
    }

    if (this.mode === MODES.VISUAL || this.mode === MODES.BOTH) {
      const startTime = this.audioEngine.running
        ? this.audioEngine.startTime
        : this.audioCtx.currentTime;
      this.visualEngine.start(startTime);
    }

    // If audio-only mode, still need a start time reference for visual
    if (this.mode === MODES.AUDIO) {
      // Visual not started, but we store startTime for potential mode switch
      this.visualEngine._startTime = this.audioEngine.startTime;
    }
    if (this.mode === MODES.VISUAL && !this.audioEngine.running) {
      // Start audio engine silently for clock, or just use audioCtx time
      this.visualEngine._startTime = this.audioCtx.currentTime;
    }
  }

  /**
   * Stop entrainment session.
   */
  stop() {
    this._active = false;

    if (this.audioEngine) {
      this.audioEngine.stop();
    }
    if (this.visualEngine) {
      this.visualEngine.stop();
    }
  }

  /**
   * Set the entrainment mode.
   * @param {string} newMode — 'audio', 'visual', or 'both'
   */
  setMode(newMode) {
    this.mode = newMode;

    if (!this._active) return;

    // Stop and restart to apply new mode cleanly
    this.stop();
    this._active = true;
    this.start();
  }

  /**
   * Set pulse frequency for both engines.
   * @param {number} freq
   */
  setPulseFrequency(freq) {
    this.pulseFreq = freq;

    if (this.audioEngine && this.audioEngine.running) {
      this.audioEngine.setPulseFrequency(freq);
      // Sync visual engine's start time with audio engine's reset
      if (this.visualEngine) {
        this.visualEngine.setPulseFrequency(freq);
        this.visualEngine.setStartTime(this.audioEngine.startTime);
      }
    } else if (this.visualEngine && this.visualEngine.running) {
      this.visualEngine.setPulseFrequency(freq);
    }
  }

  /**
   * Set carrier frequency.
   * @param {number} freq
   */
  setCarrierFrequency(freq) {
    this.carrierFreq = freq;
    if (this.audioEngine) {
      this.audioEngine.setCarrierFrequency(freq);
    }
  }

  /** @returns {boolean} */
  get active() {
    return this._active;
  }
}
