/**
 * FREQUENCY — UI Control Bindings
 *
 * Wires up sliders, buttons, and mode selectors to the SyncController.
 */

import {
  PULSE_FREQ_MIN, PULSE_FREQ_MAX,
  CARRIER_FREQ_MIN, CARRIER_FREQ_MAX,
  MODES,
  PRESETS,
  PROTOCOL_LABEL
} from './constants.js';
import { ProtocolRunner, PROTOCOL_DURATION } from './protocol-runner.js';

export class UIControls {
  /**
   * @param {import('./sync-controller.js').SyncController} controller
   * @param {import('./diagnostics.js').Diagnostics} [diagnostics]
   */
  constructor(controller, diagnostics) {
    this.controller = controller;
    this.diagnostics = diagnostics || null;

    // DOM elements
    this.pulseSlider = document.getElementById('pulse-freq');
    this.pulseValue = document.getElementById('pulse-freq-value');
    this.carrierSlider = document.getElementById('carrier-freq');
    this.carrierValue = document.getElementById('carrier-freq-value');
    this.toggleBtn = document.getElementById('btn-toggle');
    this.modeRadios = document.querySelectorAll('input[name="mode"]');
    this.refreshRateEl = document.getElementById('refresh-rate');
    this.flickerWarnEl = document.getElementById('flicker-warn');
    this.presetsContainer = document.getElementById('presets');
    this.colorSwatches = document.querySelectorAll('.color-swatch');
    this.colorPicker = document.getElementById('color-picker');
    this.flickerOverlay = document.getElementById('flicker-overlay');
    this.diagCarrierTarget = document.getElementById('diag-carrier-target');
    this.diagPulseTarget = document.getElementById('diag-pulse-target');
    this.diagVisualTarget = document.getElementById('diag-visual-target');
    this.headphoneWarn = document.getElementById('headphone-warn');
    this.flickerColorGroup = this.flickerOverlay
      ? document.querySelector('.color-selector')?.closest('.control-group')
      : null;
    this.entrainmentLabel = this.pulseSlider
      ? this.pulseSlider.closest('.control-group')?.querySelector('label')
      : null;

    // Protocol elements
    this.protocolStatus = document.getElementById('protocol-status');
    this.protocolPhaseEl = document.getElementById('protocol-phase');
    this.protocolElapsedEl = document.getElementById('protocol-elapsed');
    this.protocolProgressEl = document.getElementById('protocol-progress');
    this.protocolCancelBtn = document.getElementById('protocol-cancel');

    this._protocolRunner = null;
    this._presetButtons = [];
    this._flickerColor = localStorage.getItem('frequency_flicker_color') || '#ffffff';

    this._screenRefreshRate = 60;
    this._detectRefreshRate();
    this._bindEvents();
    this._buildPresets();
    this._applyFlickerColor(this._flickerColor);
    this._updateDisplays();
  }

  _bindEvents() {
    // Pulse frequency slider — no-op during protocol
    this.pulseSlider.addEventListener('input', () => {
      if (this._protocolRunner && this._protocolRunner.running) return;
      const val = parseFloat(this.pulseSlider.value);
      this.controller.setPulseFrequency(val);
      if (this.diagnostics) this.diagnostics.resetPulseReadings();
      this._updateDisplays();
      this._updateActivePreset();
    });

    // Carrier frequency slider
    this.carrierSlider.addEventListener('input', () => {
      const val = parseFloat(this.carrierSlider.value);
      this.controller.setCarrierFrequency(val);
      this._updateDisplays();
    });

    // Start/Stop button — also cancels protocol
    this.toggleBtn.addEventListener('click', async () => {
      if (this.controller.active) {
        if (this._protocolRunner && this._protocolRunner.running) {
          this._stopProtocol(false);
        }
        this.controller.stop();
        if (this.diagnostics) this.diagnostics.stop();
        this.toggleBtn.textContent = 'Start';
        this.toggleBtn.classList.remove('active');
      } else {
        this.toggleBtn.disabled = true;
        this.toggleBtn.textContent = 'Loading...';
        await this.controller.start();
        if (this.diagnostics) this.diagnostics.start();
        this.toggleBtn.textContent = 'Stop';
        this.toggleBtn.classList.add('active');
        this.toggleBtn.disabled = false;
        this._updateDiagTargets();
      }
    });

    // Protocol cancel button
    if (this.protocolCancelBtn) {
      this.protocolCancelBtn.addEventListener('click', () => {
        this._stopProtocol(false);
      });
    }

    // Mode radio buttons
    this.modeRadios.forEach(radio => {
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          this._updateModeUI(radio.value);
          await this.controller.setMode(radio.value);
        }
      });
    });

    // Color swatches
    this.colorSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        this._applyFlickerColor(color);
        this.colorPicker.value = color;
      });
    });

    // Custom color picker
    this.colorPicker.addEventListener('input', () => {
      this._applyFlickerColor(this.colorPicker.value);
    });
  }

  /**
   * Update UI elements based on selected mode.
   * Shows/hides headphone warning and flicker color controls.
   * @param {string} mode
   */
  _updateModeUI(mode) {
    const isBinaural = mode === MODES.BINAURAL;

    // Headphone warning
    if (this.headphoneWarn) {
      this.headphoneWarn.classList.toggle('hidden', !isBinaural);
    }

    // Hide flicker color controls in binaural mode
    if (this.flickerColorGroup) {
      this.flickerColorGroup.classList.toggle('hidden', isBinaural);
    }

    // Update entrainment label
    if (this.entrainmentLabel) {
      const labelText = this.entrainmentLabel.childNodes[0];
      if (labelText) {
        labelText.textContent = isBinaural ? 'Beat Frequency ' : 'Entrainment ';
      }
    }

    this._updateDisplays();
  }

  _applyFlickerColor(color) {
    this._flickerColor = color;
    this.flickerOverlay.style.backgroundColor = color;
    localStorage.setItem('frequency_flicker_color', color);

    // Update active states on swatches
    let matchedSwatch = false;
    this.colorSwatches.forEach(swatch => {
      const isMatch = swatch.dataset.color.toLowerCase() === color.toLowerCase();
      swatch.classList.toggle('active', isMatch);
      if (isMatch) matchedSwatch = true;
    });

    // If no swatch matched, highlight the custom picker
    this.colorPicker.classList.toggle('active', !matchedSwatch);
  }

  _buildPresets() {
    if (!this.presetsContainer) return;

    for (const [name, freq] of Object.entries(PRESETS)) {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        if (this._protocolRunner && this._protocolRunner.running) return;
        this.pulseSlider.value = freq;
        this.controller.setPulseFrequency(freq);
        if (this.diagnostics) this.diagnostics.resetPulseReadings();
        this._updateDisplays();
        this._updateActivePreset();
      });
      this.presetsContainer.appendChild(btn);
      this._presetButtons.push({ btn, freq });
    }

    // Protocol preset button
    const protocolBtn = document.createElement('button');
    protocolBtn.textContent = PROTOCOL_LABEL;
    protocolBtn.classList.add('protocol-btn');
    protocolBtn.addEventListener('click', () => {
      if (this._protocolRunner && this._protocolRunner.running) return;
      this._startProtocol();
    });
    this.presetsContainer.appendChild(protocolBtn);

    this._updateActivePreset();
  }

  _updateActivePreset() {
    const val = parseFloat(this.pulseSlider.value);
    for (const { btn, freq } of this._presetButtons) {
      btn.classList.toggle('active', val === freq);
    }
  }

  _updateDisplays() {
    const pulseFreq = parseFloat(this.pulseSlider.value);
    const carrierFreq = parseFloat(this.carrierSlider.value);

    this.pulseValue.textContent = pulseFreq.toFixed(pulseFreq % 1 === 0 ? 0 : 2) + ' Hz';
    this.carrierValue.textContent = carrierFreq.toFixed(0) + ' Hz';

    // Flicker warning: can only display up to half the refresh rate
    const maxVisualFreq = this._screenRefreshRate / 2;
    if (pulseFreq > maxVisualFreq) {
      this.flickerWarnEl.textContent =
        `Visual limited to ${maxVisualFreq} Hz on ${this._screenRefreshRate} Hz display`;
      this.flickerWarnEl.classList.add('warn');
    } else {
      this.flickerWarnEl.textContent = '';
      this.flickerWarnEl.classList.remove('warn');
    }

    this._updateDiagTargets();
  }

  _updateDiagTargets() {
    const pulseFreq = parseFloat(this.pulseSlider.value);
    const carrierFreq = parseFloat(this.carrierSlider.value);

    if (this.diagCarrierTarget) {
      this.diagCarrierTarget.textContent = carrierFreq.toFixed(0) + ' Hz';
    }
    if (this.diagPulseTarget) {
      this.diagPulseTarget.textContent = pulseFreq.toFixed(pulseFreq % 1 === 0 ? 0 : 2) + ' Hz';
    }
    if (this.diagVisualTarget) {
      const mode = this.controller.mode;
      if (mode === 'visual' || mode === 'both') {
        this.diagVisualTarget.textContent = pulseFreq.toFixed(pulseFreq % 1 === 0 ? 0 : 2) + ' Hz';
      } else {
        this.diagVisualTarget.textContent = '--';
      }
    }
  }

  /**
   * Start the timed protocol.
   */
  async _startProtocol() {
    // Start the controller if not already running
    if (!this.controller.active) {
      this.toggleBtn.disabled = true;
      this.toggleBtn.textContent = 'Loading...';
      await this.controller.start();
      if (this.diagnostics) this.diagnostics.start();
      this.toggleBtn.textContent = 'Stop';
      this.toggleBtn.classList.add('active');
      this.toggleBtn.disabled = false;
      this._updateDiagTargets();
    }

    this._protocolRunner = new ProtocolRunner(this.controller);

    this._protocolRunner.onTick = (elapsed, phaseName, freq) => {
      this._updateProtocolDisplay(elapsed, phaseName, freq);
    };

    this._protocolRunner.onComplete = () => {
      this._stopProtocol(true);
    };

    // Show status, lock slider
    if (this.protocolStatus) this.protocolStatus.classList.remove('hidden');
    this.pulseSlider.classList.add('protocol-locked');

    this._protocolRunner.start();
  }

  /**
   * Stop the timed protocol.
   * @param {boolean} completed — true if protocol finished naturally
   */
  _stopProtocol(completed) {
    if (this._protocolRunner) {
      this._protocolRunner.stop();
      this._protocolRunner = null;
    }

    // Hide status, unlock slider
    if (this.protocolStatus) this.protocolStatus.classList.add('hidden');
    this.pulseSlider.classList.remove('protocol-locked');

    if (completed) {
      this.controller.stop();
      if (this.diagnostics) this.diagnostics.stop();
      this.toggleBtn.textContent = 'Start';
      this.toggleBtn.classList.remove('active');
    }
  }

  /**
   * Update protocol status display.
   * @param {number} elapsed — seconds elapsed
   * @param {string} phaseName
   * @param {number} freq — current frequency
   */
  _updateProtocolDisplay(elapsed, phaseName, freq) {
    if (this.protocolPhaseEl) {
      this.protocolPhaseEl.textContent = phaseName;
    }

    if (this.protocolElapsedEl) {
      const mins = Math.floor(elapsed / 60);
      const secs = Math.floor(elapsed % 60);
      this.protocolElapsedEl.textContent =
        String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    if (this.protocolProgressEl) {
      const pct = (elapsed / PROTOCOL_DURATION) * 100;
      this.protocolProgressEl.style.width = pct + '%';
    }

    // Sync slider position and display
    this.pulseSlider.value = freq;
    this._updateDisplays();
    this._updateActivePreset();
  }

  /**
   * Detect screen refresh rate by measuring rAF intervals.
   */
  _detectRefreshRate() {
    let frames = 0;
    let lastTime = 0;
    const samples = [];

    const measure = (timestamp) => {
      if (lastTime > 0) {
        samples.push(timestamp - lastTime);
      }
      lastTime = timestamp;
      frames++;

      if (frames < 30) {
        requestAnimationFrame(measure);
      } else {
        const avgInterval = samples.reduce((a, b) => a + b, 0) / samples.length;
        this._screenRefreshRate = Math.round(1000 / avgInterval);
        if (this.refreshRateEl) {
          this.refreshRateEl.textContent = this._screenRefreshRate + ' Hz';
        }
        this._updateDisplays();
      }
    };

    requestAnimationFrame(measure);
  }
}
