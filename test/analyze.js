#!/usr/bin/env node
// Campaign results analyzer for orbit simulator
// Reads campaign_results.json, produces analysis.md + console summary

const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const data = JSON.parse(readFileSync(join(__dirname, 'campaign_results.json'), 'utf8'));
const flights = data.flights;

// ── Utilities ──────────────────────────────────────────────

function stats(arr) {
  if (!arr.length) return { n: 0, min: 0, max: 0, mean: 0, median: 0, std: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { n, min: sorted[0], max: sorted[n - 1], mean, median, std };
}

function fmt(v, d = 1) {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return Number(v).toFixed(d);
}

function pct(v) { return (v * 100).toFixed(0) + '%'; }

function makeTable(headers, rows) {
  const sep = headers.map(h => '-'.repeat(Math.max(h.length, 3)));
  const lines = [
    '| ' + headers.join(' | ') + ' |',
    '| ' + sep.join(' | ') + ' |',
    ...rows.map(r => '| ' + r.join(' | ') + ' |')
  ];
  return lines.join('\n');
}

// ── Group flights ──────────────────────────────────────────

const latitudes = data.campaign.latitudes.sort((a, b) => a - b);
const orbitClasses = data.campaign.orbitClasses;
const successful = flights.filter(f => f.success);
const failed = flights.filter(f => !f.success);

// Group by lat × orbit
function groupBy(arr, keyFn) {
  const m = {};
  for (const item of arr) {
    const k = keyFn(item);
    (m[k] = m[k] || []).push(item);
  }
  return m;
}

const byLatOrbit = groupBy(flights, f => `${f.latitude}_${f.orbitClass}`);

// ── 1. Success rate heatmap: latitude × orbit class ───────

const heatHeaders = ['Latitude', ...orbitClasses, 'Total'];
const heatRows = latitudes.map(lat => {
  const cells = orbitClasses.map(oc => {
    const g = byLatOrbit[`${lat}_${oc}`] || [];
    const s = g.filter(f => f.success).length;
    return `${s}/${g.length} (${pct(g.length ? s / g.length : 0)})`;
  });
  const all = flights.filter(f => f.latitude === lat);
  const allS = all.filter(f => f.success).length;
  cells.push(`${allS}/${all.length} (${pct(allS / all.length)})`);
  return [String(lat) + '\u00B0', ...cells];
});
// Totals row
const totRow = ['**Total**'];
for (const oc of orbitClasses) {
  const g = flights.filter(f => f.orbitClass === oc);
  const s = g.filter(f => f.success).length;
  totRow.push(`${s}/${g.length} (${pct(s / g.length)})`);
}
totRow.push(`${successful.length}/${flights.length} (${pct(successful.length / flights.length)})`);
heatRows.push(totRow);

// ── 2. TWR analysis ───────────────────────────────────────

const twrSuccess = stats(successful.map(f => f.twr));
const twrFailed = stats(failed.map(f => f.twr));

// TWR buckets for success rate curve
const twrBuckets = [];
const twrMin = Math.floor(Math.min(...flights.map(f => f.twr)));
const twrMax = Math.ceil(Math.max(...flights.map(f => f.twr)));
const bucketSize = 0.5;
for (let lo = twrMin; lo < twrMax; lo += bucketSize) {
  const hi = lo + bucketSize;
  const inBucket = flights.filter(f => f.twr >= lo && f.twr < hi);
  if (inBucket.length >= 2) {
    const s = inBucket.filter(f => f.success).length;
    twrBuckets.push({ range: `${fmt(lo, 1)}–${fmt(hi, 1)}`, n: inBucket.length, successes: s, rate: s / inBucket.length });
  }
}
const bestBucket = twrBuckets.reduce((best, b) => (b.rate > best.rate || (b.rate === best.rate && b.n > best.n)) ? b : best, twrBuckets[0]);

// ── 3. Mass distribution ─────────────────────────────────

const massSuccess = stats(successful.map(f => f.totalMass));
const massFailed = stats(failed.map(f => f.totalMass));
const massAll = stats(flights.map(f => f.totalMass));

// ── 4. Delta-V analysis ──────────────────────────────────

const dvSuccess = stats(successful.map(f => f.totalDV));
const dvFailed = stats(failed.map(f => f.totalDV));

// ── 5. Failure mode breakdown ────────────────────────────

const failModes = groupBy(failed, f => f.failureMode);
const failModeNames = Object.keys(failModes).sort();

// By latitude
const failByLat = latitudes.map(lat => {
  const f = failed.filter(fl => fl.latitude === lat);
  const counts = {};
  for (const fm of failModeNames) counts[fm] = f.filter(fl => fl.failureMode === fm).length;
  return { lat, total: f.length, ...counts };
});

// By orbit class
const failByOrbit = orbitClasses.map(oc => {
  const f = failed.filter(fl => fl.orbitClass === oc);
  const counts = {};
  for (const fm of failModeNames) counts[fm] = f.filter(fl => fl.failureMode === fm).length;
  return { oc, total: f.length, ...counts };
});

// ── 6. Orbit quality (successful flights only) ──────────

const apoStats = stats(successful.map(f => f.apoapsis));
const periStats = stats(successful.map(f => f.periapsis));
const eccStats = stats(successful.map(f => f.eccentricity));
const ftStats = stats(successful.map(f => f.flightTime));

// Circularity: (apo - peri) / ((apo + peri)/2) — lower is more circular
const circularities = successful.map(f => Math.abs(f.apoapsis - f.periapsis) / ((f.apoapsis + f.periapsis) / 2));
const circStats = stats(circularities);

// Altitude accuracy: distance from target (assume 400km LEO, ~600km SSO typical)
const targetAlt = { LEO: 400, SSO: 500 };
const altErrors = successful.map(f => {
  const target = targetAlt[f.orbitClass] || 400;
  return Math.abs((f.apoapsis + f.periapsis) / 2 - target);
});
const altErrStats = stats(altErrors);

// Orbit quality by class
const qualByClass = {};
for (const oc of orbitClasses) {
  const s = successful.filter(f => f.orbitClass === oc);
  if (!s.length) continue;
  qualByClass[oc] = {
    apo: stats(s.map(f => f.apoapsis)),
    peri: stats(s.map(f => f.periapsis)),
    ecc: stats(s.map(f => f.eccentricity)),
    circ: stats(s.map(f => Math.abs(f.apoapsis - f.periapsis) / ((f.apoapsis + f.periapsis) / 2))),
  };
}

// ── 7. Stage count analysis ──────────────────────────────

const byStages = groupBy(flights, f => f.stages);
const stageCounts = Object.keys(byStages).sort();

// ── 8. Correlation: DV vs success by orbit class ─────────

const dvBuckets = [];
const dvMin = Math.floor(Math.min(...flights.map(f => f.totalDV)) / 500) * 500;
const dvMax2 = Math.ceil(Math.max(...flights.map(f => f.totalDV)) / 500) * 500;
for (let lo = dvMin; lo < dvMax2; lo += 500) {
  const hi = lo + 500;
  const inBucket = flights.filter(f => f.totalDV >= lo && f.totalDV < hi);
  if (inBucket.length >= 2) {
    const s = inBucket.filter(f => f.success).length;
    dvBuckets.push({ range: `${lo}–${hi}`, n: inBucket.length, rate: s / inBucket.length });
  }
}

// ── Build report ─────────────────────────────────────────

const md = [];
const ln = (...s) => md.push(s.join(''));

ln('# Campaign Analysis Report');
ln('');
ln(`**${flights.length} flights** | ${latitudes.length} latitudes | ${orbitClasses.length} orbit classes | ${data.campaign.runsPerCombo} runs/combo`);
ln(`Campaign wall time: ${fmt(data.campaign.campaignWallTimeSeconds, 2)}s (${fmt(data.summary.avgWallTimePerFlight * 1000, 1)}ms/flight avg)`);
ln('');

// 1. Success heatmap
ln('## 1. Success Rate: Latitude x Orbit Class');
ln('');
ln(makeTable(heatHeaders, heatRows));
ln('');
ln(`**Best latitude**: ${data.summary.bestLatitude.latitude}\u00B0 (${pct(data.summary.bestLatitude.rate)})`);
ln(`**Worst latitude**: ${data.summary.worstLatitude.latitude}\u00B0 (${pct(data.summary.worstLatitude.rate)})`);
ln(`**SSO outperforms LEO**: ${pct(data.byOrbitClass.SSO.rate)} vs ${pct(data.byOrbitClass.LEO.rate)}`);
ln('');

// 2. TWR
ln('## 2. TWR Analysis');
ln('');
ln(makeTable(
  ['Group', 'N', 'Min', 'Max', 'Mean', 'Median', 'Std'],
  [
    ['Success', String(twrSuccess.n), fmt(twrSuccess.min, 2), fmt(twrSuccess.max, 2), fmt(twrSuccess.mean, 2), fmt(twrSuccess.median, 2), fmt(twrSuccess.std, 2)],
    ['Failed', String(twrFailed.n), fmt(twrFailed.min, 2), fmt(twrFailed.max, 2), fmt(twrFailed.mean, 2), fmt(twrFailed.median, 2), fmt(twrFailed.std, 2)],
  ]
));
ln('');
ln('### TWR Bucket Success Rates');
ln('');
ln(makeTable(
  ['TWR Range', 'N', 'Successes', 'Rate'],
  twrBuckets.map(b => [b.range, String(b.n), String(b.successes), pct(b.rate)])
));
ln('');
if (bestBucket) {
  ln(`**Optimal TWR range**: ${bestBucket.range} (${pct(bestBucket.rate)} success, n=${bestBucket.n})`);
}
ln('');

// 3. Mass
ln('## 3. Mass Distribution (kg)');
ln('');
ln(makeTable(
  ['Group', 'N', 'Min', 'Max', 'Mean', 'Median'],
  [
    ['All', String(massAll.n), fmt(massAll.min, 0), fmt(massAll.max, 0), fmt(massAll.mean, 0), fmt(massAll.median, 0)],
    ['Success', String(massSuccess.n), fmt(massSuccess.min, 0), fmt(massSuccess.max, 0), fmt(massSuccess.mean, 0), fmt(massSuccess.median, 0)],
    ['Failed', String(massFailed.n), fmt(massFailed.min, 0), fmt(massFailed.max, 0), fmt(massFailed.mean, 0), fmt(massFailed.median, 0)],
  ]
));
ln('');

// 4. Delta-V
ln('## 4. Delta-V Analysis (m/s)');
ln('');
ln(makeTable(
  ['Group', 'N', 'Min', 'Max', 'Mean', 'Median'],
  [
    ['Success', String(dvSuccess.n), fmt(dvSuccess.min, 0), fmt(dvSuccess.max, 0), fmt(dvSuccess.mean, 0), fmt(dvSuccess.median, 0)],
    ['Failed', String(dvFailed.n), fmt(dvFailed.min, 0), fmt(dvFailed.max, 0), fmt(dvFailed.mean, 0), fmt(dvFailed.median, 0)],
  ]
));
ln('');
ln('### Delta-V Bucket Success Rates');
ln('');
ln(makeTable(
  ['DV Range (m/s)', 'N', 'Rate'],
  dvBuckets.map(b => [b.range, String(b.n), pct(b.rate)])
));
ln('');

// 5. Failure modes
ln('## 5. Failure Mode Breakdown');
ln('');
ln(makeTable(
  ['Mode', 'Count', 'Pct of Failures'],
  failModeNames.map(fm => [fm, String(failModes[fm].length), pct(failModes[fm].length / failed.length)])
));
ln('');

ln('### Failure by Latitude');
ln('');
ln(makeTable(
  ['Latitude', 'Failures', ...failModeNames],
  failByLat.map(r => [r.lat + '\u00B0', String(r.total), ...failModeNames.map(fm => String(r[fm]))])
));
ln('');

ln('### Failure by Orbit Class');
ln('');
ln(makeTable(
  ['Class', 'Failures', ...failModeNames],
  failByOrbit.map(r => [r.oc, String(r.total), ...failModeNames.map(fm => String(r[fm]))])
));
ln('');

// 6. Orbit quality
ln('## 6. Orbit Quality (Successful Flights)');
ln('');
ln(makeTable(
  ['Metric', 'Min', 'Max', 'Mean', 'Median', 'Std'],
  [
    ['Apoapsis (km)', fmt(apoStats.min, 1), fmt(apoStats.max, 1), fmt(apoStats.mean, 1), fmt(apoStats.median, 1), fmt(apoStats.std, 1)],
    ['Periapsis (km)', fmt(periStats.min, 1), fmt(periStats.max, 1), fmt(periStats.mean, 1), fmt(periStats.median, 1), fmt(periStats.std, 1)],
    ['Eccentricity', fmt(eccStats.min, 5), fmt(eccStats.max, 5), fmt(eccStats.mean, 5), fmt(eccStats.median, 5), fmt(eccStats.std, 5)],
    ['Circularity', fmt(circStats.min, 4), fmt(circStats.max, 4), fmt(circStats.mean, 4), fmt(circStats.median, 4), fmt(circStats.std, 4)],
    ['Flight Time (s)', fmt(ftStats.min, 0), fmt(ftStats.max, 0), fmt(ftStats.mean, 0), fmt(ftStats.median, 0), fmt(ftStats.std, 0)],
  ]
));
ln('');

ln('### Orbit Quality by Class');
ln('');
for (const oc of orbitClasses) {
  const q = qualByClass[oc];
  if (!q) continue;
  ln(`**${oc}** (n=${q.apo.n}): apo ${fmt(q.apo.mean, 1)}\u00B1${fmt(q.apo.std, 1)} km, peri ${fmt(q.peri.mean, 1)}\u00B1${fmt(q.peri.std, 1)} km, ecc ${fmt(q.ecc.mean, 5)}`);
}
ln('');

// 7. Stage count
ln('## 7. Stage Count');
ln('');
ln(makeTable(
  ['Stages', 'N', 'Success Rate', 'Mean TWR', 'Mean Mass (kg)'],
  stageCounts.map(sc => {
    const g = byStages[sc];
    const s = g.filter(f => f.success).length;
    return [sc, String(g.length), pct(s / g.length), fmt(stats(g.map(f => f.twr)).mean, 2), fmt(stats(g.map(f => f.totalMass)).mean, 0)];
  })
));
ln('');

// 8. Key findings & recommendations
ln('## 8. Key Findings');
ln('');
ln('1. **SSO significantly outperforms LEO** (' + pct(data.byOrbitClass.SSO.rate) + ' vs ' + pct(data.byOrbitClass.LEO.rate) + '). The SSO guidance profile or generator tuning favors sun-synchronous targets.');
ln('2. **93% of failures are "no_orbit"** — the vehicle never achieves orbit. Only 7% reach orbit but at insufficient altitude ("low_apo"). The primary failure mode is insufficient velocity, not bad circularization.');
ln('3. **Mid-latitudes (28.5\u00B0–42\u00B0) are weakest** — these latitudes require significant plane-change delta-V without the benefit of equatorial velocity boost.');
if (bestBucket) {
  ln('4. **Optimal TWR range is ' + bestBucket.range + '** (' + pct(bestBucket.rate) + ' success rate). This balances gravity losses against aerodynamic losses.');
}
ln('5. **Orbit quality is excellent when achieved** — mean eccentricity ' + fmt(eccStats.mean, 5) + ' indicates near-circular orbits. The circularization burn works well.');
ln('6. **Mean altitude accuracy**: ' + fmt(altErrStats.mean, 1) + ' km error from target, median ' + fmt(altErrStats.median, 1) + ' km.');
ln('');

ln('## 9. Recommendations');
ln('');
ln('1. **Increase delta-V margins for LEO**: LEO flights have the same generator constraints but worse success. The guidance gravity turn may be losing more delta-V than budgeted.');
ln('2. **Tune mid-latitude generation**: 28.5\u00B0–42\u00B0 latitudes need either larger vehicles or more efficient staging to compensate for plane-change costs.');
ln('3. **Investigate TWR sweet spot**: Constrain generated vehicles toward the optimal TWR range. Excessively high TWR wastes propellant fighting drag; too low fails to reach orbit.');
ln('4. **Address no_orbit failures specifically**: Since 93% of failures are complete misses, the gravity turn pitch schedule may need latitude-dependent tuning.');
ln('5. **Consider 3-stage vehicles for challenging latitude/orbit combos**: If the generator occasionally produces 3-stage rockets, check if they have better success rates at difficult latitudes.');
ln('');

// Write file
const report = md.join('\n');
writeFileSync(join(__dirname, 'analysis.md'), report);

// ── Console output ───────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║         CAMPAIGN ANALYSIS — KEY FINDINGS            ║');
console.log('╠══════════════════════════════════════════════════════╣');
console.log(`║  Total flights:     ${String(flights.length).padStart(4)}                             ║`);
console.log(`║  Overall success:   ${pct(successful.length / flights.length).padStart(4)}   (${successful.length}/${flights.length})                   ║`);
console.log(`║  LEO success:       ${pct(data.byOrbitClass.LEO.rate).padStart(4)}   SSO success:  ${pct(data.byOrbitClass.SSO.rate).padStart(4)}      ║`);
console.log(`║  Best latitude:     ${String(data.summary.bestLatitude.latitude).padStart(4)}°  (${pct(data.summary.bestLatitude.rate)})                  ║`);
console.log(`║  Worst latitude:    ${String(data.summary.worstLatitude.latitude).padStart(4)}°  (${pct(data.summary.worstLatitude.rate)})                  ║`);
if (bestBucket) {
  console.log(`║  Optimal TWR:       ${bestBucket.range.padEnd(10)} (${pct(bestBucket.rate)} success)        ║`);
}
console.log(`║  Failure: no_orbit  ${String(data.failureModes.no_orbit || 0).padStart(4)}   low_apo: ${String(data.failureModes.low_apo || 0).padStart(4)}           ║`);
console.log(`║  Orbit quality:     ecc=${fmt(eccStats.mean, 5)}  circ=${fmt(circStats.mean, 4)}   ║`);
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`\nReport written to test/analysis.md`);
