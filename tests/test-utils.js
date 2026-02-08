/**
 * FREQUENCY — Test Measurement Utilities
 *
 * Algorithms for measuring carrier frequency, pulse frequency,
 * and simulating visual frames.
 */

/**
 * Compute RMS envelope of an audio buffer with a given window size.
 * @param {Float32Array} samples
 * @param {number} windowSize — number of samples per RMS window
 * @returns {Float32Array} — RMS values, one per window
 */
export function computeRMSEnvelope(samples, windowSize) {
  const numWindows = Math.floor(samples.length / windowSize);
  const envelope = new Float32Array(numWindows);

  for (let w = 0; w < numWindows; w++) {
    let sumSq = 0;
    const offset = w * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[offset + i];
      sumSq += s * s;
    }
    envelope[w] = Math.sqrt(sumSq / windowSize);
  }

  return envelope;
}

/**
 * Detect rising edges in an RMS envelope using a threshold.
 * A rising edge is where the value crosses from below to above threshold.
 *
 * @param {Float32Array} envelope — RMS envelope values
 * @param {number} threshold — crossing threshold
 * @returns {number[]} — indices of rising edges
 */
export function detectRisingEdges(envelope, threshold) {
  const edges = [];
  let below = envelope[0] < threshold;

  for (let i = 1; i < envelope.length; i++) {
    const nowBelow = envelope[i] < threshold;
    if (below && !nowBelow) {
      edges.push(i);
    }
    below = nowBelow;
  }

  return edges;
}

/**
 * Measure pulse frequency from audio samples.
 *
 * Process: RMS envelope → threshold → rising edges → average period → frequency
 *
 * @param {Float32Array} samples — raw audio samples
 * @param {number} sampleRate
 * @param {number} [windowSize=128] — RMS window size in samples
 * @returns {{ frequency: number, periods: number[], stdDev: number }}
 */
export function measurePulseFrequency(samples, sampleRate, windowSize = 128) {
  const envelope = computeRMSEnvelope(samples, windowSize);

  // Auto-threshold: halfway between min and max RMS
  let minVal = Infinity, maxVal = -Infinity;
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] < minVal) minVal = envelope[i];
    if (envelope[i] > maxVal) maxVal = envelope[i];
  }
  const threshold = (minVal + maxVal) / 2;

  const edges = detectRisingEdges(envelope, threshold);

  if (edges.length < 2) {
    return { frequency: 0, periods: [], stdDev: 0 };
  }

  // Convert edge indices to time, compute periods
  const windowDuration = windowSize / sampleRate;
  const periods = [];
  for (let i = 1; i < edges.length; i++) {
    const dt = (edges[i] - edges[i - 1]) * windowDuration;
    periods.push(dt);
  }

  const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
  const frequency = 1.0 / avgPeriod;

  // Standard deviation of periods
  const variance = periods.reduce((sum, p) => sum + (p - avgPeriod) ** 2, 0) / periods.length;
  const stdDev = Math.sqrt(variance);

  return { frequency, periods, stdDev };
}

/**
 * Measure carrier frequency using autocorrelation.
 *
 * Finds a high-amplitude segment, computes autocorrelation,
 * then finds the first positive peak to determine the period.
 *
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {number} [segmentDuration=0.05] — analysis segment duration in seconds
 * @returns {number} — detected carrier frequency in Hz
 */
export function measureCarrierFrequency(samples, sampleRate, segmentDuration = 0.05) {
  const segLen = Math.floor(sampleRate * segmentDuration);

  // Find a segment with high amplitude (during a pulse ON period)
  let bestOffset = 0;
  let bestRMS = 0;
  const step = Math.floor(segLen / 2);

  for (let offset = 0; offset + segLen < samples.length; offset += step) {
    let sumSq = 0;
    for (let i = 0; i < segLen; i++) {
      sumSq += samples[offset + i] ** 2;
    }
    const rms = Math.sqrt(sumSq / segLen);
    if (rms > bestRMS) {
      bestRMS = rms;
      bestOffset = offset;
    }
  }

  // Extract segment
  const segment = samples.slice(bestOffset, bestOffset + segLen);

  // Autocorrelation
  const maxLag = Math.floor(segLen / 2);
  const autocorr = new Float32Array(maxLag);

  for (let lag = 0; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < segLen - lag; i++) {
      sum += segment[i] * segment[i + lag];
    }
    autocorr[lag] = sum;
  }

  // Normalize
  const norm = autocorr[0];
  if (norm === 0) return 0;
  for (let i = 0; i < maxLag; i++) {
    autocorr[i] /= norm;
  }

  // Find first peak after zero crossing
  // First, move past the initial descent
  let i = 1;
  while (i < maxLag && autocorr[i] > autocorr[i - 1]) i++;
  while (i < maxLag && autocorr[i] >= 0) i++;
  // Now find zero crossing back to positive
  while (i < maxLag && autocorr[i] < 0) i++;

  if (i >= maxLag) return 0;

  // Find peak
  let peakIdx = i;
  while (i < maxLag && autocorr[i] >= autocorr[i - 1]) {
    peakIdx = i;
    i++;
  }

  return sampleRate / peakIdx;
}

/**
 * Simulate requestAnimationFrame at a given frame rate and record
 * visual pulse states using the same phase calculation as VisualEngine.
 *
 * @param {number} pulseFreq — pulse frequency in Hz
 * @param {number} duration — simulation duration in seconds
 * @param {number} fps — simulated frame rate
 * @param {number} startTime — simulated audio start time
 * @param {number} dutyCycle — duty cycle (0-1)
 * @returns {{ frames: { time: number, on: boolean }[], transitions: number }}
 */
export function simulateVisualFrames(pulseFreq, duration, fps, startTime = 0, dutyCycle = 0.5) {
  const frames = [];
  const frameDuration = 1.0 / fps;
  const numFrames = Math.floor(duration * fps);

  let transitions = 0;
  let lastState = null;

  for (let i = 0; i < numFrames; i++) {
    const time = startTime + i * frameDuration;
    const elapsed = time - startTime;
    const phase = (elapsed * pulseFreq) % 1.0;
    const on = phase < dutyCycle;

    frames.push({ time, on });

    if (lastState !== null && on !== lastState) {
      transitions++;
    }
    lastState = on;
  }

  return { frames, transitions };
}

/**
 * Compute the standard deviation of an array of numbers.
 * @param {number[]} values
 * @returns {number}
 */
export function stdDev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
