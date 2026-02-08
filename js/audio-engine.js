/**
 * FREQUENCY — Isochronic Tone Generator
 *
 * Uses Web Audio API to produce pulsed tones.
 *
 * Primary path: AudioWorklet (sample-accurate, runs on audio thread)
 * Fallback path: OscillatorNode + GainNode with scheduled setValueAtTime
 *
 * Architecture (worklet):
 *   AudioWorkletNode (carrier * pulse gate) → AnalyserNode → destination
 *
 * Architecture (legacy fallback):
 *   OscillatorNode (carrier) → GainNode (pulse gate) → AnalyserNode → destination
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

    // Shared state
    this.analyser = null;
    this._startTime = 0;
    this._running = false;

    // Worklet state
    this._useWorklet = false;
    this._workletNode = null;

    // Legacy state
    this.oscillator = null;
    this.gainNode = null;
    this.schedulerTimer = null;
    this._nextPulseIndex = 0;
  }

  /**
   * Load the AudioWorklet module. Must be called before start().
   * Safe to call multiple times — module is loaded once per AudioContext.
   * @returns {Promise<boolean>} true if worklet is available
   */
  async init() {
    if (!this.audioCtx.audioWorklet) {
      this._useWorklet = false;
      return false;
    }

    try {
      // Resolve module URL relative to this file
      const moduleUrl = new URL('./pulse-worklet-processor.js', import.meta.url).href;
      await this.audioCtx.audioWorklet.addModule(moduleUrl);
      this._useWorklet = true;
      return true;
    } catch (e) {
      this._useWorklet = false;
      return false;
    }
  }

  /**
   * Build audio graph using AudioWorklet.
   * AudioWorkletNode → AnalyserNode → destination
   */
  _createWorkletGraph() {
    this._workletNode = new AudioWorkletNode(this.audioCtx, 'pulse-worklet-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      parameterData: {
        carrierFreq: this.carrierFreq,
        pulseFreq: this.pulseFreq,
        dutyCycle: this.dutyCycle,
        active: 0
      }
    });

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 32768;

    this._workletNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
  }

  /**
   * Build audio graph using legacy OscillatorNode + GainNode.
   * OscillatorNode → GainNode → AnalyserNode → destination
   */
  _createLegacyGraph() {
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
   * Schedule gain pulses for legacy path.
   * Uses multiplication-based timing: t = startTime + (index / pulseFreq)
   */
  _schedulePulses() {
    if (!this._running || this._useWorklet) return;

    const now = this.audioCtx.currentTime;
    const scheduleUntil = now + SCHEDULER_LOOKAHEAD_S;
    const period = 1.0 / this.pulseFreq;
    const onDuration = period * this.dutyCycle;

    while (true) {
      const pulseStart = this._startTime + (this._nextPulseIndex * period);
      const pulseEnd = pulseStart + onDuration;

      if (pulseStart > scheduleUntil) break;

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

    this._startTime = this.audioCtx.currentTime;
    this._running = true;

    if (this._useWorklet) {
      this._createWorkletGraph();

      // Tell the worklet where t=0 is (in frames)
      const startFrame = Math.round(this._startTime * this.audioCtx.sampleRate);
      this._workletNode.port.postMessage({
        type: 'set-start-frame',
        frame: startFrame
      });

      // Activate the worklet
      this._workletNode.parameters.get('active').setValueAtTime(1, this._startTime);
    } else {
      this._createLegacyGraph();
      this._nextPulseIndex = 0;
      this.oscillator.start(this._startTime);

      // Initial schedule
      this._schedulePulses();

      // For OfflineAudioContext, no interval needed
      if (this.audioCtx.constructor.name !== 'OfflineAudioContext' &&
          !(this.audioCtx instanceof OfflineAudioContext)) {
        this.schedulerTimer = setInterval(() => this._schedulePulses(), SCHEDULER_INTERVAL_MS);
      }
    }
  }

  /**
   * For OfflineAudioContext (legacy path): schedule all pulses for the entire
   * render duration. No-op for worklet path (worklet generates per-sample).
   * @param {number} duration — total render duration in seconds
   */
  scheduleForDuration(duration) {
    if (!this._running) return;

    // Worklet generates audio per-sample — no pre-scheduling needed
    if (this._useWorklet) return;

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

    if (this._useWorklet) {
      if (this._workletNode) {
        try {
          this._workletNode.parameters.get('active').setValueAtTime(0, this.audioCtx.currentTime);
          this._workletNode.disconnect();
        } catch (e) {}
        this._workletNode = null;
      }
    } else {
      if (this.schedulerTimer) {
        clearInterval(this.schedulerTimer);
        this.schedulerTimer = null;
      }

      try {
        this.oscillator.stop();
        this.oscillator.disconnect();
        this.gainNode.disconnect();
      } catch (e) {}

      this.oscillator = null;
      this.gainNode = null;
    }

    this.analyser = null;
  }

  /**
   * Change pulse frequency mid-session.
   * @param {number} newFreq — new pulse frequency in Hz
   */
  setPulseFrequency(newFreq) {
    this.pulseFreq = newFreq;

    if (!this._running) return;

    if (this._useWorklet) {
      // Update AudioParam (sample-accurate)
      this._workletNode.parameters.get('pulseFreq').setValueAtTime(newFreq, this.audioCtx.currentTime);

      // Reset pulse phase from current time
      this._startTime = this.audioCtx.currentTime;
      const startFrame = Math.round(this._startTime * this.audioCtx.sampleRate);
      this._workletNode.port.postMessage({
        type: 'reset-pulse',
        frame: startFrame
      });
    } else {
      // Legacy: cancel and re-schedule
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.setValueAtTime(GAIN_OFF, this.audioCtx.currentTime);

      this._startTime = this.audioCtx.currentTime;
      this._nextPulseIndex = 0;

      this._schedulePulses();
    }
  }

  /**
   * Change carrier frequency.
   * @param {number} newFreq — new carrier frequency in Hz
   */
  setCarrierFrequency(newFreq) {
    this.carrierFreq = newFreq;

    if (this._useWorklet && this._workletNode) {
      this._workletNode.parameters.get('carrierFreq').setValueAtTime(newFreq, this.audioCtx.currentTime);
    } else if (this.oscillator) {
      this.oscillator.frequency.setValueAtTime(newFreq, this.audioCtx.currentTime);
    }
  }

  /**
   * Compute the current pulse ON/OFF state for a given time.
   * Used by VisualEngine for synchronization.
   * Pure math — same formula regardless of worklet or legacy.
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

  /** @returns {boolean} true if using AudioWorklet */
  get usingWorklet() {
    return this._useWorklet;
  }
}
