/**
 * FREQUENCY — Constants and defaults
 */

export const PULSE_FREQ_MIN = 0.25;
export const PULSE_FREQ_MAX = 50;
export const PULSE_FREQ_DEFAULT = 40;

export const CARRIER_FREQ_MIN = 100;
export const CARRIER_FREQ_MAX = 500;
export const CARRIER_FREQ_DEFAULT = 250;

export const MODES = {
  AUDIO: 'audio',
  VISUAL: 'visual',
  BOTH: 'both',
  BINAURAL: 'binaural'
};

export const MODE_DEFAULT = MODES.AUDIO;

// Scheduler settings
export const SCHEDULER_INTERVAL_MS = 100;
export const SCHEDULER_LOOKAHEAD_S = 2.0;

// Gain values for isochronic pulses (hard on/off)
export const GAIN_ON = 1.0;
export const GAIN_OFF = 0.0;

// Visual flicker
export const FLICKER_OPACITY_ON = 1.0;
export const FLICKER_OPACITY_OFF = 0.0;

// Duty cycle (fraction of period the tone is ON)
export const DUTY_CYCLE = 0.5;

// Presets (name → pulse/beat frequency in Hz)
export const PRESETS = {
  'Sleep (0.25 Hz)': 0.25,
  'Delta (2 Hz)': 2,
  'Theta (6 Hz)': 6,
  'Schumann (7.83 Hz)': 7.83,
  'Alpha (10 Hz)': 10,
  'Beta (20 Hz)': 20,
  'Gamma (40 Hz)': 40
};
