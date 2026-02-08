/**
 * FREQUENCY — Minimal Browser Test Framework
 *
 * Provides describe/it/assert with async support and DOM reporting.
 */

const results = [];
let currentSuite = '';

export async function describe(name, fn) {
  currentSuite = name;
  await fn();
}

export async function it(name, fn) {
  const testName = `${currentSuite} > ${name}`;
  const entry = { name: testName, status: 'running', error: null, duration: 0 };
  results.push(entry);
  renderResults();

  const start = performance.now();
  try {
    await fn();
    entry.status = 'pass';
  } catch (e) {
    entry.status = 'fail';
    entry.error = e.message || String(e);
  }
  entry.duration = performance.now() - start;
  renderResults();
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

assert.equal = function (actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
};

assert.approximately = function (actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      message || `Expected ${expected} ± ${tolerance}, got ${actual} (diff: ${diff})`
    );
  }
};

assert.lessThan = function (actual, limit, message) {
  if (actual >= limit) {
    throw new Error(message || `Expected < ${limit}, got ${actual}`);
  }
};

assert.greaterThan = function (actual, limit, message) {
  if (actual <= limit) {
    throw new Error(message || `Expected > ${limit}, got ${actual}`);
  }
};

assert.throws = function (fn, message) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) {
    throw new Error(message || 'Expected function to throw');
  }
};

function renderResults() {
  const container = document.getElementById('test-results');
  if (!container) return;

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const running = results.filter(r => r.status === 'running').length;
  const total = results.length;

  let html = `<div class="summary">
    <strong>Tests:</strong> ${passed} passed, ${failed} failed, ${running} running / ${total} total
  </div>`;

  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '⏳';
    const cls = r.status;
    const dur = r.duration ? ` (${r.duration.toFixed(0)}ms)` : '';
    html += `<div class="test ${cls}">
      <span class="icon">${icon}</span>
      <span class="name">${r.name}</span>
      <span class="dur">${dur}</span>
      ${r.error ? `<pre class="error">${escapeHtml(r.error)}</pre>` : ''}
    </div>`;
  }

  container.innerHTML = html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function getResults() {
  return results;
}
