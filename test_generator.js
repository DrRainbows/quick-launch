// Batch test: 200 rockets must pass validation.valid from the pattern language
const { generateRocket } = require('./lib/rocketGenerator.js');

const results = { total: 0, valid: 0, errors: 0, issues: [] };
const lats = [-70, -45, -28.5, -10, 0, 10, 28.5, 45, 60, 70];
const classes = ['LEO', 'SSO'];

for (let i = 0; i < 200; i++) {
  const lat = lats[Math.floor(Math.random() * lats.length)];
  const cls = classes[Math.floor(Math.random() * classes.length)];
  results.total++;

  try {
    const r = generateRocket(lat, cls);
    if (r.validation?.valid) {
      results.valid++;
    } else {
      results.issues.push(`#${i}: lat=${lat} ${cls} — ${(r.validation?.warnings || []).join('; ')}`);
    }
  } catch (e) {
    results.errors++;
    results.issues.push(`#${i}: ERROR ${e.message}`);
  }
}

const validRate = results.valid / results.total;
const minRate = 0.80;

console.log('=== ROCKET GENERATOR VALIDATION: 200 rockets ===\n');
console.log(`validation.valid: ${results.valid}/${results.total} (${(validRate * 100).toFixed(0)}%)`);
console.log(`errors: ${results.errors}`);

if (results.issues.length > 0) {
  console.log(`\n=== FAILURES (${results.issues.length}) ===`);
  results.issues.slice(0, 15).forEach(l => console.log('  ' + l));
  if (results.issues.length > 15) console.log(`  ... and ${results.issues.length - 15} more`);
}

const pass = results.errors === 0 && validRate >= minRate;
console.log(`\n=== VERDICT: ${pass ? 'PASS' : 'FAIL'} (need >=${minRate * 100}% valid) ===`);
process.exit(pass ? 0 : 1);
