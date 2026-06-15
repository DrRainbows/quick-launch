// Batch test: generate 200 rockets from the pattern language and analyze
const RG = require('./rocketGenerator.js');

const results = {
  total: 0, success: 0, errors: 0,
  orbitClasses: {},
  stageCountDist: {},
  engineCounts: {},
  propellants: {},
  massRange: { min: Infinity, max: 0 },
  dvRange: { min: Infinity, max: 0 },
  thrustRange: { min: Infinity, max: 0 },
  ispRange: { min: Infinity, max: 0 },
  issues: [],
};

const lats = [-70, -45, -28.5, -10, 0, 10, 28.5, 45, 60, 70];
const classes = ['LEO', 'SSO'];

for (let i = 0; i < 200; i++) {
  const lat = lats[Math.floor(Math.random() * lats.length)];
  const cls = classes[Math.floor(Math.random() * classes.length)];
  results.total++;

  try {
    const r = RG.generateRocket(lat, cls);

    if (!r || !r.stages || r.stages.length === 0) {
      results.issues.push(`#${i}: No stages returned (lat=${lat}, ${cls})`);
      results.errors++;
      continue;
    }

    results.success++;
    results.orbitClasses[cls] = (results.orbitClasses[cls] || 0) + 1;

    const nStages = r.stages.length;
    results.stageCountDist[nStages] = (results.stageCountDist[nStages] || 0) + 1;

    // Check total mass
    const mass = r.totalMass || 0;
    if (mass < 5000) results.issues.push(`#${i}: Tiny mass ${mass}kg (lat=${lat}, ${cls})`);
    if (mass > 3000000) results.issues.push(`#${i}: Huge mass ${mass}kg (lat=${lat}, ${cls})`);
    results.massRange.min = Math.min(results.massRange.min, mass);
    results.massRange.max = Math.max(results.massRange.max, mass);

    // Check deltaV
    const dv = r.totalDeltaV || 0;
    if (dv < 7000) results.issues.push(`#${i}: Low dV ${dv.toFixed(0)}m/s (lat=${lat}, ${cls}, ${r.name})`);
    if (dv > 20000) results.issues.push(`#${i}: High dV ${dv.toFixed(0)}m/s (lat=${lat}, ${cls})`);
    results.dvRange.min = Math.min(results.dvRange.min, dv);
    results.dvRange.max = Math.max(results.dvRange.max, dv);

    // Check each stage
    for (let si = 0; si < r.stages.length; si++) {
      const s = r.stages[si];
      const prop = s.propellant || 'unknown';
      results.propellants[prop] = (results.propellants[prop] || 0) + 1;

      const nEng = s.engines?.count || 1;
      results.engineCounts[nEng] = (results.engineCounts[nEng] || 0) + 1;

      const thrustVac = s.engines?.thrustVac ? s.engines.thrustVac * nEng : 0;
      const ispVac = s.engines?.ispVac || s.ispVac || 0;

      if (si === 0 && thrustVac < 100000) {
        results.issues.push(`#${i}: Stage 1 low thrust ${(thrustVac/1000).toFixed(0)}kN (${nEng} engines, ${r.name})`);
      }
      if (ispVac < 200) {
        results.issues.push(`#${i}: Stage ${si+1} low Isp ${ispVac}s`);
      }
      if (ispVac > 0) {
        results.ispRange.min = Math.min(results.ispRange.min, ispVac);
        results.ispRange.max = Math.max(results.ispRange.max, ispVac);
      }
      if (thrustVac > 0) {
        results.thrustRange.min = Math.min(results.thrustRange.min, thrustVac);
        results.thrustRange.max = Math.max(results.thrustRange.max, thrustVac);
      }

      // Check mass ratio
      const wet = (s.dryMass || 0) + (s.propellantMass || 0);
      const dry = s.dryMass || 1;
      const massRatio = wet / dry;
      if (massRatio < 2) {
        results.issues.push(`#${i}: Stage ${si+1} poor mass ratio ${massRatio.toFixed(1)} (dry=${dry}kg, prop=${s.propellantMass}kg)`);
      }

      // Check T/W for stage 1
      if (si === 0) {
        const totalW = (r.totalMass || 300000) * 9.81;
        const thrustSL = s.engines?.thrustSL ? s.engines.thrustSL * nEng : thrustVac * 0.85;
        const tw = thrustSL / totalW;
        if (tw < 1.0) {
          results.issues.push(`#${i}: Stage 1 T/W=${tw.toFixed(2)} < 1 — can't lift off! (${r.name})`);
        }
      }
    }
  } catch (e) {
    results.errors++;
    results.issues.push(`#${i}: ERROR ${e.message} (lat=${lat}, ${cls})`);
  }
}

console.log('=== ROCKET GENERATOR BATCH TEST: 200 rockets ===\n');
console.log(`Success: ${results.success}/${results.total} (${results.errors} errors)\n`);
console.log('Orbit classes:', results.orbitClasses);
console.log('Stage counts:', results.stageCountDist);
console.log('Engine counts per stage:', results.engineCounts);
console.log('Propellants:', results.propellants);
console.log(`\nMass range: ${(results.massRange.min/1000).toFixed(0)}t — ${(results.massRange.max/1000).toFixed(0)}t`);
console.log(`DeltaV range: ${results.dvRange.min.toFixed(0)} — ${results.dvRange.max.toFixed(0)} m/s`);
console.log(`Thrust range: ${(results.thrustRange.min/1000).toFixed(0)} — ${(results.thrustRange.max/1000).toFixed(0)} kN`);
console.log(`Isp range: ${results.ispRange.min.toFixed(0)} — ${results.ispRange.max.toFixed(0)} s`);

if (results.issues.length > 0) {
  console.log(`\n=== ISSUES (${results.issues.length}) ===`);
  // Show first 30 issues
  results.issues.slice(0, 30).forEach(issue => console.log('  ' + issue));
  if (results.issues.length > 30) console.log(`  ... and ${results.issues.length - 30} more`);
}
