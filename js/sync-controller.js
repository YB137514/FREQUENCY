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
    this._wakeLock = null;

    // Resume AudioContext when returning from lock screen / background
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._active) {
        if (this.audioCtx && (this.audioCtx.state === 'suspended' || this.audioCtx.state === 'interrupted')) {
          this.audioCtx.resume();
        }
        // Re-acquire wake lock (released when page becomes hidden)
        this._requestWakeLock();
      }
    });
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
   * Request a Wake Lock to keep the screen on during a session.
   * Prevents iOS/Android from sleeping, which would suspend audio.
   */
  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      // Wake lock request can fail (e.g. low battery)
    }
  }

  /**
   * Release the Wake Lock.
   */
  async _releaseWakeLock() {
    if (this._wakeLock) {
      try {
        await this._wakeLock.release();
      } catch (e) {}
      this._wakeLock = null;
    }
  }

  /**
   * Register Media Session metadata and handlers for lock screen controls.
   */
  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'FREQUENCY',
      artist: 'Brain Wave Entrainment',
      album: this.pulseFreq + ' Hz'
    });

    navigator.mediaSession.setActionHandler('play', () => {
      if (!this._active) this.start();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      if (this._active) this.stop();
    });
  }

  /**
   * Start entrainment session.
   */
  start() {
    this._ensureAudioContext();
    this._active = true;

    // Keep screen on to prevent audio suspension
    this._requestWakeLock();
    this._setupMediaSession();

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

    this._releaseWakeLock();
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

    // Update lock screen display
    if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.album = freq + ' Hz';
    }

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
