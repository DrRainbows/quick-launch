// ============================================================================
// COUNTDOWN — T-10 countdown sequence
// ============================================================================

import { showPanel, hidePanel } from './panels.js';

/**
 * Run the countdown sequence.
 * @param {Function} onComplete - callback when countdown reaches 0
 * @returns {Function} cancel function to abort the countdown
 */
export function startCountdown(onComplete) {
  showPanel('countdown');
  let count = 10;
  const countEl = document.getElementById('countdown');
  if (!countEl) return () => {};

  document.getElementById('subtitle').textContent = '';
  countEl.textContent = `T-${count}`;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      countEl.textContent = `T-${count}`;
    } else {
      countEl.textContent = 'LIFTOFF';
      clearInterval(interval);
      setTimeout(() => {
        hidePanel('countdown');
        onComplete();
      }, 1000);
    }
  }, 1000);

  // Return cancel function
  return () => {
    clearInterval(interval);
    hidePanel('countdown');
  };
}
