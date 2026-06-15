// ============================================================================
// TRAJECTORY PLOT — 2D canvas plot (altitude vs downrange)
// ============================================================================
// Phase-colored trajectory with grid lines, axis labels, and event markers.

/** Phase → color mapping for trajectory segments. */
const PHASE_COLORS = {
  VERTICAL_RISE: '#00e5ff',  // cyan
  GRAVITY_TURN:  '#2196f3',  // blue
  UPPER_STAGE:   '#00e676',  // green
  COAST:         '#ffd600',  // yellow
  CIRCULARIZE:   '#ff6d00',  // orange
  ORBIT_ACHIEVED:'#00e676',  // green
  ABORT:         '#ff1744',  // red
};
const DEFAULT_PHASE_COLOR = '#00e5ff';

/**
 * Pick nice round grid intervals for an axis.
 * Returns an array of tick values from 0 up to (but not exceeding) max.
 */
function niceGridTicks(maxVal, targetCount) {
  if (maxVal <= 0) return [];
  const rough = maxVal / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step;
  if (rough / mag < 1.5) step = mag;
  else if (rough / mag < 3.5) step = 2 * mag;
  else if (rough / mag < 7.5) step = 5 * mag;
  else step = 10 * mag;
  const ticks = [];
  for (let v = step; v < maxVal; v += step) {
    ticks.push(v);
  }
  return ticks;
}

/**
 * Redraw the trajectory plot from accumulated trajectory points.
 * @param {Array} points - [{ alt, downrange, time, phase }, ...]
 * @param {Array} [events] - [{ time, label }, ...] event markers
 */
export function updateTrajectoryPlot(points, events) {
  const canvas = document.getElementById('trajectory-canvas');
  if (!canvas || points.length < 2) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 2;
  const w = canvas.width = canvas.clientWidth * dpr;
  const h = canvas.height = canvas.clientHeight * dpr;
  ctx.clearRect(0, 0, w, h);

  const padL = 52 * dpr / 2;  // left padding for Y-axis labels
  const padR = 14 * dpr / 2;
  const padT = 14 * dpr / 2;
  const padB = 30 * dpr / 2;  // bottom padding for X-axis labels

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxAlt = Math.max(50, ...points.map(p => p.alt));
  const maxDR = Math.max(50, ...points.map(p => p.downrange));

  // Helper: data -> canvas
  const toX = (dr) => padL + (dr / maxDR) * plotW;
  const toY = (alt) => (padT + plotH) - (alt / maxAlt) * plotH;

  // ---- Grid lines ----
  ctx.strokeStyle = 'rgba(0,229,255,0.08)';
  ctx.lineWidth = 1;

  const altTicks = niceGridTicks(maxAlt, 4);
  const drTicks = niceGridTicks(maxDR, 4);

  for (const v of altTicks) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }
  for (const v of drTicks) {
    const x = toX(v);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
  }

  // ---- Axes ----
  ctx.strokeStyle = 'rgba(0,229,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(w - padR, padT + plotH);
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL, padT);
  ctx.stroke();

  // ---- Axis tick labels ----
  const fontSize = Math.round(10 * dpr / 2);
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = 'rgba(0,229,255,0.45)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of altTicks) {
    ctx.fillText(`${v.toFixed(0)}`, padL - 4, toY(v));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of drTicks) {
    ctx.fillText(`${v.toFixed(0)}`, toX(v), padT + plotH + 4);
  }

  // ---- Axis titles ----
  const titleSize = Math.round(8 * dpr / 2);
  ctx.font = `${titleSize}px monospace`;
  ctx.fillStyle = 'rgba(0,229,255,0.35)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('DOWNRANGE (km)', padL + plotW / 2, padT + plotH + 14);
  // Vertical axis label
  ctx.save();
  ctx.translate(10, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'top';
  ctx.fillText('ALT (km)', 0, 0);
  ctx.restore();

  // ---- Phase-colored trajectory ----
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let prevX = toX(points[0].downrange);
  let prevY = toY(points[0].alt);

  // Draw segments grouped by phase for efficiency
  let currentPhase = points[0].phase;
  ctx.beginPath();
  ctx.strokeStyle = PHASE_COLORS[currentPhase] || DEFAULT_PHASE_COLOR;
  ctx.moveTo(prevX, prevY);

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const px = toX(p.downrange);
    const py = toY(p.alt);

    if (p.phase !== currentPhase) {
      // Finish current segment
      ctx.lineTo(px, py);
      ctx.stroke();
      // Start new segment with new color
      currentPhase = p.phase;
      ctx.beginPath();
      ctx.strokeStyle = PHASE_COLORS[currentPhase] || DEFAULT_PHASE_COLOR;
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
    prevX = px;
    prevY = py;
  }
  ctx.stroke();

  // ---- Event markers ----
  if (events && events.length > 0) {
    const markerSize = Math.round(3 * dpr / 2);
    const labelSize = Math.round(8 * dpr / 2);
    ctx.font = `bold ${labelSize}px monospace`;

    for (const ev of events) {
      // Find the closest trajectory point by time
      let closest = points[0];
      let minDt = Math.abs(ev.time - points[0].time);
      for (let i = 1; i < points.length; i++) {
        const dt = Math.abs(ev.time - points[i].time);
        if (dt < minDt) { minDt = dt; closest = points[i]; }
      }

      const mx = toX(closest.downrange);
      const my = toY(closest.alt);

      // Marker diamond
      ctx.fillStyle = '#ffd600';
      ctx.beginPath();
      ctx.moveTo(mx, my - markerSize);
      ctx.lineTo(mx + markerSize, my);
      ctx.lineTo(mx, my + markerSize);
      ctx.lineTo(mx - markerSize, my);
      ctx.closePath();
      ctx.fill();

      // Label
      ctx.fillStyle = 'rgba(255,214,0,0.8)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(ev.label, mx + markerSize + 2, my - 2);
    }
  }

  // ---- Phase legend (small, bottom-right of plot) ----
  const legendSize = Math.round(7 * dpr / 2);
  ctx.font = `${legendSize}px monospace`;
  const legendPhases = [];
  const seenPhases = new Set();
  for (const p of points) {
    if (p.phase && !seenPhases.has(p.phase)) {
      seenPhases.add(p.phase);
      legendPhases.push(p.phase);
    }
  }
  // Draw only if space allows (don't clutter)
  if (legendPhases.length <= 6) {
    let ly = padT + 4;
    for (const phase of legendPhases) {
      const color = PHASE_COLORS[phase] || DEFAULT_PHASE_COLOR;
      ctx.fillStyle = color;
      ctx.fillRect(w - padR - 80, ly, 6, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const label = phase.replace(/_/g, ' ');
      ctx.fillText(label, w - padR - 70, ly - 1);
      ly += 10;
    }
  }
}
