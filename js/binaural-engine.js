/**
 * FREQUENCY — Binaural Beat Engine
 *
 * Generates stereo continuous tones for binaural beat entrainment.
 * Left ear hears carrierFreq, right ear hears carrierFreq + beatFreq.
 * The brain perceives the difference as a rhythmic beat.
 *
 * Primary path: AudioWorklet (sample-accurate, runs on audio thread)
 * Fallback path: Two OscillatorNodes → ChannelMerger → destination
 *
 * Architecture (worklet):
 *   AudioWorkletNode (stereo) → AnalyserNode → destination
 *
 * Architecture (legacy fallback):
 *   OscillatorNode(carrier) → GainNode(0.5) ──┐
 *   OscillatorNode(carrier+beat) → GainNode(0.5) → ChannelMerger(2) → AnalyserNode → destination
 */

import {
  CARRIER_FREQ_DEFAULT,
  PULSE_FREQ_DEFAULT
} from './constants.js';

export class BinauralEngine {
  /**
   * @param {AudioContext|OfflineAudioContext} audioCtx
   */
  constructor(audioCtx) {
    this.audioCtx = audioCtx;
    this.carrierFreq = CARRIER_FREQ_DEFAULT;
    this.beatFreq = PULSE_FREQ_DEFAULT;

    // Shared state
    this.analyser = null;
    this._running = false;

    // Worklet state
    this._useWorklet = false;
    this._workletNode = null;

    // Legacy state
    this._leftOsc = null;
    this._rightOsc = null;
    this._leftGain = null;
    this._rightGain = null;
    this._merger = null;
  }

  /**
   * Load the AudioWorklet module. Must be called before start().
   * @returns {Promise<boolean>} true if worklet is available
   */
  async init() {
    if (!this.audioCtx.audioWorklet) {
      this._useWorklet = false;
      return false;
    }

    try {
      const moduleUrl = new URL('./binaural-worklet-processor.js', import.meta.url).href;
      await this.audioCtx.audioWorklet.addModule(moduleUrl);
      this._useWorklet = true;
      return true;
    } catch (e) {
      this._useWorklet = false;
      return false;
    }
  }

  /**
   * Build stereo audio graph using AudioWorklet.
   * AudioWorkletNode (2ch) → AnalyserNode → destination
   */
  _createWorkletGraph() {
    this._workletNode = new AudioWorkletNode(this.audioCtx, 'binaural-worklet-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        carrierFreq: this.carrierFreq,
        beatFreq: this.beatFreq,
        active: 0
      }
    });

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 32768;

    this._workletNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
  }

  /**
   * Build stereo audio graph using legacy OscillatorNodes.
   * Two oscillators → individual gains → ChannelMerger → AnalyserNode → destination
   */
  _createLegacyGraph() {
    const now = this.audioCtx.currentTime;

    // Left channel: carrier frequency
    this._leftOsc = this.audioCtx.createOscillator();
    this._leftOsc.type = 'sine';
    this._leftOsc.frequency.setValueAtTime(this.carrierFreq, now);

    this._leftGain = this.audioCtx.createGain();
    this._leftGain.gain.setValueAtTime(0.5, now);

    // Right channel: carrier + beat frequency
    this._rightOsc = this.audioCtx.createOscillator();
    this._rightOsc.type = 'sine';
    this._rightOsc.frequency.setValueAtTime(this.carrierFreq + this.beatFreq, now);

    this._rightGain = this.audioCtx.createGain();
    this._rightGain.gain.setValueAtTime(0.5, now);

    // Merge into stereo
    this._merger = this.audioCtx.createChannelMerger(2);

    this._leftOsc.connect(this._leftGain);
    this._leftGain.connect(this._merger, 0, 0);   // left → ch 0

    this._rightOsc.connect(this._rightGain);
    this._rightGain.connect(this._merger, 0, 1);   // right → ch 1

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 32768;

    this._merger.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
  }

  /**
   * Start generating binaural tones.
   */
  start() {
    if (this._running) return;
    this._running = true;

    if (this._useWorklet) {
      this._createWorkletGraph();
      this._workletNode.parameters.get('active').setValueAtTime(1, this.audioCtx.currentTime);
    } else {
      this._createLegacyGraph();
      const now = this.audioCtx.currentTime;
      this._leftOsc.start(now);
      this._rightOsc.start(now);
    }
  }

  /**
   * Stop generating tones and tear down audio graph.
   */
  stop() {
    if (!this._running) return;
    this._running = false;

    if (this._useWorklet) {
      if (this._workletNode) {
        try {
          this._workletNode.parameters.get('active').setValueAtTime(0, this.audioCtx.currentTime);
          this._workletNode.disconnect();
        } catch (e) {}
        this._workletNode = null;
      }
    } else {
      try {
        if (this._leftOsc) { this._leftOsc.stop(); this._leftOsc.disconnect(); }
        if (this._rightOsc) { this._rightOsc.stop(); this._rightOsc.disconnect(); }
        if (this._leftGain) this._leftGain.disconnect();
        if (this._rightGain) this._rightGain.disconnect();
        if (this._merger) this._merger.disconnect();
      } catch (e) {}

      this._leftOsc = null;
      this._rightOsc = null;
      this._leftGain = null;
      this._rightGain = null;
      this._merger = null;
    }

    this.analyser = null;
  }

  /**
   * Change beat frequency (the binaural entrainment frequency).
   * @param {number} freq — new beat frequency in Hz
   */
  setBeatFrequency(freq) {
    this.beatFreq = freq;

    if (!this._running) return;

    if (this._useWorklet) {
      this._workletNode.parameters.get('beatFreq').setValueAtTime(freq, this.audioCtx.currentTime);
    } else if (this._rightOsc) {
      this._rightOsc.frequency.setValueAtTime(this.carrierFreq + freq, this.audioCtx.currentTime);
    }
  }

  /**
   * Change beat frequency smoothly without abrupt jumps.
   * Used by protocol runner for continuous frequency updates.
   * @param {number} freq — new beat frequency in Hz
   */
  rampBeatFrequency(freq) {
    this.beatFreq = freq;
    if (!this._running) return;

    const now = this.audioCtx.currentTime;
    if (this._useWorklet) {
      this._workletNode.parameters.get('beatFreq')
        .linearRampToValueAtTime(freq, now + 0.1);
    } else if (this._rightOsc) {
      this._rightOsc.frequency.linearRampToValueAtTime(
        this.carrierFreq + freq, now + 0.1);
    }
  }

  /**
   * Change carrier frequency.
   * @param {number} freq — new carrier frequency in Hz
   */
  setCarrierFrequency(freq) {
    this.carrierFreq = freq;

    if (!this._running) return;

    if (this._useWorklet) {
      this._workletNode.parameters.get('carrierFreq').setValueAtTime(freq, this.audioCtx.currentTime);
    } else {
      if (this._leftOsc) {
        this._leftOsc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      }
      if (this._rightOsc) {
        this._rightOsc.frequency.setValueAtTime(freq + this.beatFreq, this.audioCtx.currentTime);
      }
    }
  }

  /** @returns {boolean} */
  get running() {
    return this._running;
  }

  /** @returns {boolean} true if using AudioWorklet */
  get usingWorklet() {
    return this._useWorklet;
  }
}
