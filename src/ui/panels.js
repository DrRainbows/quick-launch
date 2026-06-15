// ============================================================================
// PANELS — Show/hide helpers for UI panel elements
// ============================================================================

const ALL_PANELS = [
  'telemetry-panel', 'gnc-panel', 'design-panel', 'countdown', 'orbit-panel',
  'stage-log', 'trajectory-plot', 'met-display', 'timeline-bar', 'adv-panel',
  'tracking-panel', 'site-selected',
];

export function showPanel(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

export function hidePanel(id) {
  document.getElementById(id)?.classList.add('hidden');
}

export function hideAll() {
  ALL_PANELS.forEach(hidePanel);
}
