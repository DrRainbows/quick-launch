// ============================================================================
// CONTROLS — Time warp, camera toggle, advanced toggle, scroll/zoom handlers
// ============================================================================

import { showPanel, hidePanel } from './panels.js';
import { getState, dispatch, WARP_LEVELS } from '../store.js';

/** Update the time-warp display label and style. */
function updateWarpDisplay() {
  const state = getState();
  const el = document.getElementById('time-warp');
  if (!el) return;
  el.textContent = state.timeWarp + 'x';
  // Add visual emphasis when warp is high
  if (state.timeWarp >= 10) {
    el.classList.add('fast');
  } else {
    el.classList.remove('fast');
  }
}

/**
 * Initialize all keyboard and button controls.
 * @param {HTMLElement} rendererDom - renderer.domElement
 */
export function initControls(rendererDom) {
  // Time warp (comma/period keys)
  window.addEventListener('keydown', (e) => {
    if (e.key === ',' || e.key === '<') {
      dispatch('CYCLE_WARP', -1);
      updateWarpDisplay();
    } else if (e.key === '.' || e.key === '>') {
      dispatch('CYCLE_WARP', +1);
      updateWarpDisplay();
    }
  });

  // Time warp buttons (visible on-screen controls)
  document.getElementById('warp-down')?.addEventListener('click', () => {
    dispatch('CYCLE_WARP', -1);
    updateWarpDisplay();
  });
  document.getElementById('warp-up')?.addEventListener('click', () => {
    dispatch('CYCLE_WARP', +1);
    updateWarpDisplay();
  });

  // Camera tracking toggle
  document.getElementById('track-btn')?.addEventListener('click', () => {
    dispatch('TOGGLE_TRACKING');
    updateTrackButton();
  });

  // Advanced engineering telemetry toggle
  document.getElementById('adv-btn')?.addEventListener('click', () => {
    dispatch('TOGGLE_ADVANCED');
    const state = getState();
    const btn = document.getElementById('adv-btn');
    if (state.showAdvanced) {
      showPanel('adv-panel');
      btn.style.background = 'rgba(0,230,118,0.15)';
      btn.style.color = 'var(--green)';
      btn.style.borderColor = 'var(--green)';
    } else {
      hidePanel('adv-panel');
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.color = 'var(--text-dim)';
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
    }
  });

  // Disable tracking on manual camera interaction
  rendererDom.addEventListener('mousedown', () => {
    const state = getState();
    if (state.phase === 'ASCENT' && state.cameraTracking) {
      const moved = () => {
        dispatch('SET_TRACKING', false);
        updateTrackButton();
        rendererDom.removeEventListener('mousemove', moved);
      };
      rendererDom.addEventListener('mousemove', moved, { once: true });
    }
  });

  // Scroll wheel: prevent browser zoom, disable tracking on scroll
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }, { passive: false });

  rendererDom.addEventListener('wheel', () => {
    const state = getState();
    if (state.phase === 'ASCENT' && state.cameraTracking) {
      dispatch('SET_TRACKING', false);
      updateTrackButton();
    }
  });
}

/** Update the track button style to reflect current tracking state. */
export function updateTrackButton() {
  const btn = document.getElementById('track-btn');
  if (!btn) return;
  const state = getState();
  if (state.cameraTracking) {
    btn.textContent = 'TRACKING';
    btn.style.background = 'rgba(0,229,255,0.15)';
    btn.style.color = 'var(--cyan)';
    btn.style.borderColor = 'var(--cyan)';
  } else {
    btn.textContent = 'FREE CAM';
    btn.style.background = 'rgba(255,109,0,0.15)';
    btn.style.color = 'var(--orange)';
    btn.style.borderColor = 'var(--orange)';
  }
}
