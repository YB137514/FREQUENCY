/**
 * FREQUENCY — App Initialization
 *
 * Wires up SyncController, UIControls, Diagnostics, and handles
 * epilepsy warning + Bluetooth warning dismissal.
 */

import { SyncController } from './sync-controller.js';
import { UIControls } from './ui-controls.js';
import { Diagnostics } from './diagnostics.js';

const EPILEPSY_DISMISSED_KEY = 'frequency_epilepsy_dismissed';
const BT_DISMISSED_KEY = 'frequency_bt_dismissed';

function init() {
  const flickerOverlay = document.getElementById('flicker-overlay');
  const controller = new SyncController(flickerOverlay);

  // Diagnostics
  const diag = new Diagnostics(controller, {
    carrierMeasured: document.getElementById('diag-carrier-measured'),
    pulseMeasured: document.getElementById('diag-pulse-measured'),
    visualMeasured: document.getElementById('diag-visual-measured'),
  });

  // UI controls (pass diag for target display updates)
  const ui = new UIControls(controller, diag);

  // Epilepsy warning modal
  const epilepsyModal = document.getElementById('epilepsy-modal');
  const epilepsyBtn = document.getElementById('epilepsy-accept');

  if (localStorage.getItem(EPILEPSY_DISMISSED_KEY)) {
    epilepsyModal.classList.add('hidden');
  }

  epilepsyBtn.addEventListener('click', () => {
    localStorage.setItem(EPILEPSY_DISMISSED_KEY, '1');
    epilepsyModal.classList.add('hidden');
  });

  // Bluetooth warning banner
  const btBanner = document.getElementById('bt-banner');
  const btDismiss = document.getElementById('bt-dismiss');

  if (localStorage.getItem(BT_DISMISSED_KEY)) {
    btBanner.classList.add('hidden');
  }

  btDismiss.addEventListener('click', () => {
    localStorage.setItem(BT_DISMISSED_KEY, '1');
    btBanner.classList.add('hidden');
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
