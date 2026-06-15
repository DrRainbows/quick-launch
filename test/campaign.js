#!/usr/bin/env node
// ============================================================================
// MASS SIMULATION CAMPAIGN
// ============================================================================
// Generates and flies 200 rockets through the GNC system:
//   10 latitudes x 2 orbit classes x 10 rockets per combo = 200 flights
//
// Records success/failure, orbital parameters, vehicle statistics, and
// wall-clock timing for every flight. Outputs progress during the run,
// a summary table at the end, and a JSON report to test/campaign_results.json.
// ============================================================================

"use strict";

const fs   = require("fs");
const path = require("path");

// --- Load modules -----------------------------------------------------------
let generateRocket;
try {
    generateRocket = require('../lib/rocketGenerator.js').generateRocket;
} catch (e) {
    try {
        generateRocket = require('../rocketGenerator.js').generateRocket;
    } catch (e2) {
        console.error("ERROR: Cannot find rocketGenerator.js in ../lib/ or ../");
        process.exit(1);
    }
}

const {
    CONST,
    FlightPhase,
    Vec3,
    orbitalElements,
    GNCComputer,
    FlightSimulator,
    runSimulation,
} = require("../gnc.js");


// --- Utility ----------------------------------------------------------------

function pad(str, len) {
    return (str + " ".repeat(len)).slice(0, len);
}

function padLeft(str, len) {
    return (" ".repeat(len) + str).slice(-len);
}

/**
 * Map a generated rocket (from rocketGenerator.js) to a GNC rocket config
 * (the format expected by gnc.js FlightSimulator/GNCComputer).
 *
 * Copied from test_gnc_generated.js lines 55-110.
 */
function generatorToGNCConfig(genRocket, launchLat) {
    const nStages = genRocket.stages.length;
    const stages = genRocket.stages.map((gs, idx) => {
        const thrustSL  = gs.totalThrustSL || (gs.engine.thrustSL * gs.engineCount);
        const thrustVac = gs.totalThrustVac || (gs.engine.thrustVac * gs.engineCount);
        const ispSL     = gs.ispSL || gs.engine.ispSL;
        const ispVac    = gs.ispVac || gs.engine.ispVac;

        // Cap structural fraction at physically realistic values.
        const maxFrac = (idx === 0) ? 0.08 : 0.06;
        let dryMass = gs.dryMass;
        const propMass = gs.propellantMass;
        const actualFrac = dryMass / (dryMass + propMass);
        if (actualFrac > maxFrac) {
            dryMass = maxFrac * propMass / (1 - maxFrac);
        }

        return {
            name:           gs.designation || ("Stage " + (idx + 1)),
            dryMass:        dryMass,
            propellantMass: propMass,
            thrust:         thrustSL,
            thrustVac:      thrustVac,
            isp:            ispSL,
            ispVac:         ispVac,
            nEngines:       gs.engineCount,
        };
    });

    const fairingDiameter = genRocket.fairing
        ? genRocket.fairing.diameter
        : (genRocket.stages[0].diameter || 3.7);
    const diameter = genRocket.stages[0].diameter || fairingDiameter;

    return {
        name:                "Generated @ " + launchLat.toFixed(1) + " deg",
        diameter:            diameter,
        referenceArea:       Math.PI * Math.pow(diameter / 2, 2),
        payloadMass:         genRocket.payload ? genRocket.payload.mass : 1000,
        launchLatitude:      launchLat,
        countdownTime:       10,
        kickAngle:           5.0,
        kickAltitude:        300,
        maxQLimit:           35000,
        gimbalRateLimit:     5.0,
        stageSeparationDelay: 2.0,
        stages:              stages,
    };
}

/**
 * Compute total vehicle mass, TWR, and delta-V budget for a GNC config.
 */
function vehicleStats(gncConfig) {
    let totalMass = gncConfig.payloadMass;
    for (const s of gncConfig.stages) {
        totalMass += s.dryMass + s.propellantMass;
    }
    const twr = gncConfig.stages[0].thrust / (totalMass * CONST.g0);

    // Compute total delta-V (Tsiolkovsky) for all stages
    let totalDV = 0;
    let massAbove = gncConfig.payloadMass;
    const upperMasses = [];
    for (let i = gncConfig.stages.length - 1; i >= 0; i--) {
        upperMasses[i] = massAbove;
        massAbove += gncConfig.stages[i].dryMass + gncConfig.stages[i].propellantMass;
    }
    for (let i = 0; i < gncConfig.stages.length; i++) {
        const s = gncConfig.stages[i];
        const isp = s.ispVac || s.isp;
        const ve = isp * CONST.g0;
        let m0 = s.dryMass + s.propellantMass + upperMasses[i];
        let mf = s.dryMass + upperMasses[i];
        const dv = ve * Math.log(m0 / mf);
        totalDV += dv;
    }

    return { totalMass, twr, totalDV };
}

/**
 * Generate a viable rocket, trying up to maxAttempts times.
 * Pick the best candidate by TWR * delta-V score.
 */
function generateViableRocket(lat, orbitClass, minTWR, minDV, maxAttempts) {
    let bestConfig = null;
    let bestScore = 0;
    let bestStats = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let genRocket;
        try {
            genRocket = generateRocket(lat, orbitClass);
        } catch (err) {
            continue;
        }

        const config = generatorToGNCConfig(genRocket, lat);
        const stats = vehicleStats(config);

        const twrScore = Math.min(stats.twr / minTWR, 2.0);
        const dvScore = Math.min(stats.totalDV / minDV, 2.0);
        const score = twrScore * dvScore;

        if (score > bestScore) {
            bestScore = score;
            bestConfig = config;
            bestStats = stats;
        }
    }

    if (bestConfig) {
        return { config: bestConfig, stats: bestStats };
    }
    return null;
}


// --- Campaign configuration -------------------------------------------------

const LATITUDES     = [0, 5, 15, 28.5, 34.7, 42, 51.6, 58, 64, 72];
const ORBIT_CLASSES = ["LEO", "SSO"];
const RUNS_PER_COMBO = 10;
const TOTAL_FLIGHTS  = LATITUDES.length * ORBIT_CLASSES.length * RUNS_PER_COMBO;

const MAX_SIM_TIME = 3600;
const SIM_DT       = 0.1;
const MIN_TWR      = 1.3;
const MIN_DV       = 9000;
const GEN_ATTEMPTS = 5;

// Target orbit parameters per class
function targetOrbitForClass(orbitClass, latitude) {
    if (orbitClass === "SSO") {
        return { altitude: 600000, inclination: 97.5 };
    }
    // LEO: inclination at least 28.5 or the latitude
    return { altitude: 200000, inclination: Math.max(latitude, 28.5) };
}


// --- Run campaign -----------------------------------------------------------

console.log("=============================================================");
console.log("  MASS SIMULATION CAMPAIGN");
console.log("  " + TOTAL_FLIGHTS + " flights: " +
    LATITUDES.length + " latitudes x " +
    ORBIT_CLASSES.length + " orbit classes x " +
    RUNS_PER_COMBO + " rockets each");
console.log("=============================================================\n");

const allResults = [];
let flightNum = 0;
const campaignStart = Date.now();

for (const lat of LATITUDES) {
    for (const orbitClass of ORBIT_CLASSES) {
        for (let run = 0; run < RUNS_PER_COMBO; run++) {
            flightNum++;
            const flightId = `L${lat}_${orbitClass}_R${run + 1}`;

            // --- Generate rocket ---
            const t0 = Date.now();
            const gen = generateViableRocket(lat, orbitClass, MIN_TWR, MIN_DV, GEN_ATTEMPTS);

            if (!gen) {
                const wallTime = (Date.now() - t0) / 1000;
                allResults.push({
                    flightId,
                    flightNum,
                    latitude: lat,
                    orbitClass,
                    run: run + 1,
                    success: false,
                    failureMode: "no_viable_rocket",
                    stages: 0,
                    totalMass: 0,
                    twr: 0,
                    totalDV: 0,
                    wallTime,
                });
                if (flightNum % 20 === 0 || flightNum === TOTAL_FLIGHTS) {
                    const elapsed = ((Date.now() - campaignStart) / 1000).toFixed(1);
                    const successes = allResults.filter(r => r.success).length;
                    console.log(
                        `  [${padLeft(String(flightNum), 3)}/${TOTAL_FLIGHTS}] ` +
                        `${successes} successes so far  (${elapsed}s elapsed)`
                    );
                }
                continue;
            }

            const { config: gncConfig, stats } = gen;
            const { totalMass, twr, totalDV } = stats;

            // Check minimum viability
            if (twr < 1.05 || totalDV < 7000) {
                const wallTime = (Date.now() - t0) / 1000;
                const failMode = twr < 1.05 ? "low_twr" : "low_dv";
                allResults.push({
                    flightId,
                    flightNum,
                    latitude: lat,
                    orbitClass,
                    run: run + 1,
                    success: false,
                    failureMode: failMode,
                    stages: gncConfig.stages.length,
                    totalMass,
                    twr,
                    totalDV,
                    wallTime,
                });
                if (flightNum % 20 === 0 || flightNum === TOTAL_FLIGHTS) {
                    const elapsed = ((Date.now() - campaignStart) / 1000).toFixed(1);
                    const successes = allResults.filter(r => r.success).length;
                    console.log(
                        `  [${padLeft(String(flightNum), 3)}/${TOTAL_FLIGHTS}] ` +
                        `${successes} successes so far  (${elapsed}s elapsed)`
                    );
                }
                continue;
            }

            // --- Run simulation ---
            const target = targetOrbitForClass(orbitClass, lat);
            let simResult;
            try {
                simResult = runSimulation(gncConfig, target, {
                    maxTime: MAX_SIM_TIME,
                    dt: SIM_DT,
                });
            } catch (err) {
                const wallTime = (Date.now() - t0) / 1000;
                allResults.push({
                    flightId,
                    flightNum,
                    latitude: lat,
                    orbitClass,
                    run: run + 1,
                    success: false,
                    failureMode: "sim_crash",
                    error: err.message,
                    stages: gncConfig.stages.length,
                    totalMass,
                    twr,
                    totalDV,
                    wallTime,
                });
                if (flightNum % 20 === 0 || flightNum === TOTAL_FLIGHTS) {
                    const elapsed = ((Date.now() - campaignStart) / 1000).toFixed(1);
                    const successes = allResults.filter(r => r.success).length;
                    console.log(
                        `  [${padLeft(String(flightNum), 3)}/${TOTAL_FLIGHTS}] ` +
                        `${successes} successes so far  (${elapsed}s elapsed)`
                    );
                }
                continue;
            }
            const wallTime = (Date.now() - t0) / 1000;

            // --- Evaluate orbit quality ---
            const tel = simResult.telemetry;
            const orb = tel.orbitalElements;
            const apoAlt  = orb.apoapsisAlt / 1000;   // km
            const periAlt = orb.periapsisAlt / 1000;   // km
            const ecc     = orb.e;

            const orbitReached = simResult.success;
            const apoOK  = apoAlt > 150;
            const periOK = periAlt > 100;
            const eccOK  = ecc < 0.1;
            const pass   = orbitReached && apoOK && periOK && eccOK;

            let failureMode = null;
            if (!pass) {
                if (!orbitReached) failureMode = "no_orbit";
                else if (!apoOK)   failureMode = "low_apo";
                else if (!periOK)  failureMode = "low_peri";
                else               failureMode = "high_ecc";
            }

            allResults.push({
                flightId,
                flightNum,
                latitude: lat,
                orbitClass,
                run: run + 1,
                success: pass,
                failureMode,
                orbitReached,
                apoapsis: apoAlt,
                periapsis: periAlt,
                eccentricity: ecc,
                flightTime: simResult.totalTime,
                stages: gncConfig.stages.length,
                totalMass,
                twr,
                totalDV,
                wallTime,
            });

            // --- Progress report every 20 flights ---
            if (flightNum % 20 === 0 || flightNum === TOTAL_FLIGHTS) {
                const elapsed = ((Date.now() - campaignStart) / 1000).toFixed(1);
                const successes = allResults.filter(r => r.success).length;
                console.log(
                    `  [${padLeft(String(flightNum), 3)}/${TOTAL_FLIGHTS}] ` +
                    `${successes} successes so far  (${elapsed}s elapsed)`
                );
            }
        }
    }
}

const campaignWallTime = (Date.now() - campaignStart) / 1000;

// --- Analysis ---------------------------------------------------------------

const successes = allResults.filter(r => r.success);
const failures  = allResults.filter(r => !r.success);

// Success rate by latitude
const byLatitude = {};
for (const lat of LATITUDES) {
    const subset = allResults.filter(r => r.latitude === lat);
    const wins   = subset.filter(r => r.success).length;
    byLatitude[lat] = { total: subset.length, successes: wins, rate: wins / subset.length };
}

// Success rate by orbit class
const byOrbitClass = {};
for (const oc of ORBIT_CLASSES) {
    const subset = allResults.filter(r => r.orbitClass === oc);
    const wins   = subset.filter(r => r.success).length;
    byOrbitClass[oc] = { total: subset.length, successes: wins, rate: wins / subset.length };
}

// Failure mode breakdown
const failureModes = {};
for (const f of failures) {
    failureModes[f.failureMode] = (failureModes[f.failureMode] || 0) + 1;
}

// Orbit quality averages (successful flights only)
let avgApo = 0, avgPeri = 0, avgEcc = 0, avgFlightTime = 0;
if (successes.length > 0) {
    avgApo       = successes.reduce((s, r) => s + r.apoapsis, 0) / successes.length;
    avgPeri      = successes.reduce((s, r) => s + r.periapsis, 0) / successes.length;
    avgEcc       = successes.reduce((s, r) => s + r.eccentricity, 0) / successes.length;
    avgFlightTime = successes.reduce((s, r) => s + r.flightTime, 0) / successes.length;
}

// Best and worst latitude
let bestLat = null, bestRate = -1, worstLat = null, worstRate = 2;
for (const lat of LATITUDES) {
    const rate = byLatitude[lat].rate;
    if (rate > bestRate)  { bestRate = rate;  bestLat = lat; }
    if (rate < worstRate) { worstRate = rate; worstLat = lat; }
}

// Average wall time
const avgWallTime = allResults.reduce((s, r) => s + r.wallTime, 0) / allResults.length;


// --- Output summary ---------------------------------------------------------

console.log("\n=============================================================");
console.log("  CAMPAIGN RESULTS");
console.log("=============================================================\n");

console.log(`  Total flights:    ${TOTAL_FLIGHTS}`);
console.log(`  Successes:        ${successes.length}  (${(successes.length / TOTAL_FLIGHTS * 100).toFixed(1)}%)`);
console.log(`  Failures:         ${failures.length}  (${(failures.length / TOTAL_FLIGHTS * 100).toFixed(1)}%)`);
console.log(`  Campaign time:    ${campaignWallTime.toFixed(1)}s`);
console.log(`  Avg sim time:     ${avgWallTime.toFixed(2)}s per flight`);

console.log("\n  --- Success Rate by Latitude ---");
console.log("  " + pad("Lat", 8) + pad("Flights", 10) + pad("Success", 10) + "Rate");
console.log("  " + "-".repeat(38));
for (const lat of LATITUDES) {
    const b = byLatitude[lat];
    console.log(
        "  " + pad(lat.toFixed(1), 8) +
        pad(String(b.total), 10) +
        pad(String(b.successes), 10) +
        (b.rate * 100).toFixed(1) + "%"
    );
}

console.log("\n  --- Success Rate by Orbit Class ---");
console.log("  " + pad("Class", 8) + pad("Flights", 10) + pad("Success", 10) + "Rate");
console.log("  " + "-".repeat(38));
for (const oc of ORBIT_CLASSES) {
    const b = byOrbitClass[oc];
    console.log(
        "  " + pad(oc, 8) +
        pad(String(b.total), 10) +
        pad(String(b.successes), 10) +
        (b.rate * 100).toFixed(1) + "%"
    );
}

console.log("\n  --- Failure Mode Breakdown ---");
for (const [mode, count] of Object.entries(failureModes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(mode, 20)} ${count} (${(count / failures.length * 100).toFixed(1)}%)`);
}

if (successes.length > 0) {
    console.log("\n  --- Orbit Quality (successful flights) ---");
    console.log(`  Avg apoapsis:      ${avgApo.toFixed(1)} km`);
    console.log(`  Avg periapsis:     ${avgPeri.toFixed(1)} km`);
    console.log(`  Avg eccentricity:  ${avgEcc.toFixed(5)}`);
    console.log(`  Avg flight time:   ${avgFlightTime.toFixed(0)} s`);
}

console.log("\n  --- Key Statistics ---");
console.log(`  Overall success rate:  ${(successes.length / TOTAL_FLIGHTS * 100).toFixed(1)}%`);
console.log(`  Best latitude:         ${bestLat} deg (${(bestRate * 100).toFixed(1)}%)`);
console.log(`  Worst latitude:        ${worstLat} deg (${(worstRate * 100).toFixed(1)}%)`);

console.log("\n=============================================================\n");


// --- Save JSON report -------------------------------------------------------

const report = {
    campaign: {
        totalFlights: TOTAL_FLIGHTS,
        latitudes: LATITUDES,
        orbitClasses: ORBIT_CLASSES,
        runsPerCombo: RUNS_PER_COMBO,
        generationAttempts: GEN_ATTEMPTS,
        minTWR: MIN_TWR,
        minDV: MIN_DV,
        simDt: SIM_DT,
        maxSimTime: MAX_SIM_TIME,
        timestamp: new Date().toISOString(),
        campaignWallTimeSeconds: campaignWallTime,
    },
    summary: {
        totalSuccesses: successes.length,
        totalFailures: failures.length,
        overallSuccessRate: successes.length / TOTAL_FLIGHTS,
        bestLatitude: { latitude: bestLat, rate: bestRate },
        worstLatitude: { latitude: worstLat, rate: worstRate },
        avgWallTimePerFlight: avgWallTime,
        orbitQuality: successes.length > 0 ? {
            avgApoapsis: avgApo,
            avgPeriapsis: avgPeri,
            avgEccentricity: avgEcc,
            avgFlightTime: avgFlightTime,
        } : null,
    },
    byLatitude,
    byOrbitClass,
    failureModes,
    flights: allResults,
};

const reportPath = path.join(__dirname, "campaign_results.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`  JSON report saved to: ${reportPath}\n`);

// Exit code: 0 if overall success rate >= 30%
const overallRate = successes.length / TOTAL_FLIGHTS;
if (overallRate >= 0.30) {
    console.log(`  Overall success rate ${(overallRate * 100).toFixed(1)}% >= 30%. CAMPAIGN PASS.\n`);
    process.exit(0);
} else {
    console.log(`  Overall success rate ${(overallRate * 100).toFixed(1)}% < 30%. CAMPAIGN BELOW THRESHOLD.\n`);
    process.exit(1);
}
