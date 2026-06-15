// ============================================================================
// GNC PANEL — Phase badge, engine grid, throttle bar
// ============================================================================

/**
 * Build the engine dot grid for a given engine count.
 */
export function buildEngineGrid(count) {
  const grid = document.getElementById('engine-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'engine-dot';
    dot.dataset.index = i;
    grid.appendChild(dot);
  }
}

/**
 * Update engine grid dots based on throttle and active state.
 */
export function updateEngineGrid(throttle) {
  const dots = document.querySelectorAll('#engine-grid .engine-dot');
  dots.forEach(dot => {
    if (throttle > 0) {
      dot.className = 'engine-dot';
      dot.style.opacity = 0.6 + throttle * 0.4;
    } else {
      dot.className = 'engine-dot off';
      dot.style.opacity = 1;
    }
  });
}

/**
 * Update GNC panel from telemetry.
 */
export function updateGncDisplay(telem, engineCounts) {
  const phase = telem.phase || 'UNKNOWN';
  const stageIdx = telem.currentStage || 0;

  document.getElementById('g-phase').textContent = phase.replace(/_/g, ' ');
  document.getElementById('g-stage').textContent = stageIdx + 1;
  document.getElementById('g-throttle-fill').style.width = ((telem.throttle || 0) * 100) + '%';

  // Rebuild engine grid if stage changed
  const currentEngCount = (engineCounts && engineCounts[stageIdx]) || 1;
  const dots = document.querySelectorAll('#engine-grid .engine-dot');
  if (dots.length !== currentEngCount) {
    buildEngineGrid(currentEngCount);
  }
  updateEngineGrid(telem.throttle || 0);
}
