// ============================================================================
// DESIGN PANEL — Vehicle design card with stage specs and dV budget
// ============================================================================

/**
 * Build the design panel HTML from rocket and mission data.
 * Wires the launch button to the provided callback.
 * @param {Object} rocket
 * @param {Object} mission
 * @param {string} orbitClass
 * @param {number} lat
 * @param {number} lon
 * @param {Function} onLaunch - callback when INITIATE LAUNCH is clicked
 */
export function buildDesignPanel(rocket, mission, orbitClass, lat, lon, onLaunch) {
  const panel = document.getElementById('design-panel');
  if (!panel) return;

  const stages = rocket.stages || [];
  const sel = mission.selected || {};
  const budget = mission.budget || {};

  let stagesHTML = '';
  stages.forEach((s, i) => {
    const engName = s.engine?.name || s.engine?.cycle || s.engineCycle || 'Unknown';
    const engCount = s.engineCount || s.engines?.count || 1;
    const thrustVac = s.totalThrustVac || (s.engines?.thrustVac || s.engine?.thrustVac || 0) * engCount;
    const isp = s.ispVac || s.engine?.ispVac || s.engines?.ispVac || 0;
    const prop = s.propellant || s.engine?.propellant || 'LOX/RP-1';

    stagesHTML += `
      <div class="stage-card">
        <h4>STAGE ${i + 1} — ${prop}</h4>
        <div class="spec-grid">
          <div class="spec-item"><span class="label">Engine</span><span class="val">${engName}</span></div>
          <div class="spec-item"><span class="label">Count</span><span class="val">${engCount}x</span></div>
          <div class="spec-item"><span class="label">Thrust (vac)</span><span class="val">${(thrustVac / 1000).toFixed(0)} kN</span></div>
          <div class="spec-item"><span class="label">Isp (vac)</span><span class="val">${isp.toFixed(0)} s</span></div>
          <div class="spec-item"><span class="label">Prop Mass</span><span class="val">${((s.propellantMass || 0) / 1000).toFixed(1)} t</span></div>
          <div class="spec-item"><span class="label">Dry Mass</span><span class="val">${((s.dryMass || 0) / 1000).toFixed(1)} t</span></div>
          <div class="spec-item"><span class="label">ΔV</span><span class="val">${(s.deltaV || 0).toFixed(0)} m/s</span></div>
          <div class="spec-item"><span class="label">Burn</span><span class="val">${(s.burnTime || 0).toFixed(0)} s</span></div>
        </div>
      </div>`;
  });

  const dvTotal = budget.total || 9400;
  const dvItems = [
    { label: 'Orbital V', val: dvTotal - (budget.gravityLoss || 1400) - (budget.dragLoss || 200) - (budget.steeringLoss || 150), color: '#2196f3' },
    { label: 'Gravity', val: budget.gravityLoss || 1400, color: '#ff6d00' },
    { label: 'Drag', val: budget.dragLoss || 200, color: '#ff1744' },
    { label: 'Steering', val: budget.steeringLoss || 150, color: '#ffd600' },
  ];

  let dvBarsHTML = '<div class="dv-bar-container">';
  dvItems.forEach(item => {
    const pct = (item.val / dvTotal * 100).toFixed(1);
    dvBarsHTML += `<div class="dv-bar-row">
      <div class="dv-bar-label">${item.label}</div>
      <div class="dv-bar-track"><div class="dv-bar-fill" style="width:${pct}%;background:${item.color}"></div></div>
      <div class="dv-bar-val">${item.val.toFixed(0)} m/s</div>
    </div>`;
  });
  dvBarsHTML += '</div>';

  panel.innerHTML = `
    <div class="panel-title">LAUNCH SITE</div>
    <div style="margin-bottom:12px; font-size:13px; color:var(--cyan)">
      ${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}
    </div>

    <div class="panel-title">TARGET ORBIT — ${orbitClass}</div>
    <div class="spec-grid" style="margin-bottom:12px">
      <div class="spec-item"><span class="label">Type</span><span class="val">${sel.name || orbitClass}</span></div>
      <div class="spec-item"><span class="label">Altitude</span><span class="val">${(sel.altitudeKm || 400).toFixed(0)} km</span></div>
      <div class="spec-item"><span class="label">Inclination</span><span class="val">${(sel.inclinationDeg || 28.5).toFixed(1)}°</span></div>
      <div class="spec-item"><span class="label">ΔV Req.</span><span class="val">${(sel.deltaVRequired || 9400).toFixed(0)} m/s</span></div>
    </div>

    <div class="panel-title">VEHICLE — ${rocket.id || rocket.name || 'Generated Rocket'}</div>
    <div class="spec-grid" style="margin-bottom:8px">
      <div class="spec-item"><span class="label">Total Mass</span><span class="val">${((rocket.totalMass || 340000) / 1000).toFixed(1)} t</span></div>
      <div class="spec-item"><span class="label">Payload</span><span class="val">${((rocket.payload?.mass || rocket.payloadMass || rocket.performance?.payloadToOrbit || 5000) / 1000).toFixed(1)} t</span></div>
      <div class="spec-item"><span class="label">Stages</span><span class="val">${rocket.stageCount || stages.length}</span></div>
      <div class="spec-item"><span class="label">Liftoff T/W</span><span class="val">${(rocket.performance?.liftoffTWR || 1.2).toFixed(2)}</span></div>
    </div>
    ${stagesHTML}

    <div class="panel-title" style="margin-top:12px">ΔV BUDGET</div>
    ${dvBarsHTML}

    <button id="launch-btn" style="
      display:block; width:100%; margin-top:20px; padding:14px;
      background:linear-gradient(135deg, #ff6d00, #ff3d00);
      color:#fff; font-family:inherit; font-size:15px; font-weight:700;
      letter-spacing:2px; border:none; border-radius:4px; cursor:pointer;
      text-transform:uppercase;
    ">INITIATE LAUNCH</button>
  `;

  document.getElementById('launch-btn').addEventListener('click', onLaunch);
}
