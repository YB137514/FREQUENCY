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
    this._silentAudio = null;

    // Resume AudioContext when returning from lock screen / background
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._active && this.audioCtx) {
        if (this.audioCtx.state === 'suspended' || this.audioCtx.state === 'interrupted') {
          this.audioCtx.resume();
        }
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
   * Create a silent looping <audio> element to keep iOS audio session alive
   * during screen lock. iOS suspends Web Audio API when there's no active
   * HTMLMediaElement — this tiny silent loop prevents that.
   */
  _startSilentAudioKeepAlive() {
    if (this._silentAudio) return;

    // Generate a tiny silent WAV (1 sample, 1 channel, 8-bit, 8kHz)
    const header = new Uint8Array([
      0x52,0x49,0x46,0x46, 0x25,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
      0x66,0x6D,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00,0x01,0x00,
      0x40,0x1F,0x00,0x00, 0x40,0x1F,0x00,0x00, 0x01,0x00,0x08,0x00,
      0x64,0x61,0x74,0x61, 0x01,0x00,0x00,0x00, 0x80
    ]);
    const blob = new Blob([header], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    this._silentAudio = new Audio(url);
    this._silentAudio.loop = true;
    this._silentAudio.volume = 0;
    this._silentAudio.play().catch(() => {});
  }

  /**
   * Stop the silent keep-alive audio element.
   */
  _stopSilentAudioKeepAlive() {
    if (this._silentAudio) {
      this._silentAudio.pause();
      this._silentAudio.src = '';
      this._silentAudio = null;
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

    // Keep audio alive during screen lock (iOS)
    this._startSilentAudioKeepAlive();
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

    this._stopSilentAudioKeepAlive();
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
