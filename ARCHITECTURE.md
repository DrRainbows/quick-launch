# Launch Grammar — Architecture

Public repository for a zero-build-step generative launch simulator. This document describes module boundaries, data flow, and extension points.

## Design principles

1. **No bundler** — Browser loads UMD engines via `<script>` tags; application code is native ESM.
2. **Single source of truth** — Shared logic lives in `lib/shared/` and is imported by both browser and Node.
3. **Pattern language integrity** — No hardcoded fallback vehicles. Viability is proven by GNC achieving orbit.
4. **Thin adapters** — `src/adapters/` bridges UMD globals (`window.RocketGen`, etc.) to ESM imports.

## Directory layout

```
launch-grammar/
├── index.html              # Browser shell; loads engines then src/main.js
├── gnc.js                  # UMD: atmosphere, GNC, flight integrator
├── server.js               # Static file server (port 8042)
│
├── lib/
│   ├── rocketGenerator.js  # UMD: generative pattern language
│   ├── orbitalMechanics.js # UMD: mission planning, ΔV budgets
│   ├── shared/             # Reusable ESM modules (browser + Node)
│   │   ├── constants.js    # Physical constants (SI)
│   │   ├── stageConfig.js  # Generator → flight stage configs
│   │   ├── stagesToGNCConfig.js
│   │   └── orbitAssessment.js
│   └── pipeline/
│       └── missionPipeline.mjs  # Headless: generate → plan → GNC → orbit
│
├── src/                    # Browser application (ESM)
│   ├── main.js             # Composition root
│   ├── adapters/           # UMD global → ESM facades
│   ├── coords/             # Coordinate transforms (documented once)
│   ├── mission/            # Mission orchestration
│   ├── physics/            # FlightSim wrapper, propagator
│   ├── render/             # Three.js scene layers
│   ├── rocket/             # Vehicle model, stage re-exports
│   └── ui/                 # Telemetry, panels, timeline
│
└── tests/                  # Headless verification
    ├── audit.js            # Runs all suites
    ├── coords.test.mjs
    ├── generator.test.js
    ├── flightsim.test.mjs
    ├── gnc.test.js
    └── gnc-generated.test.mjs
```

## Data flow

### Browser path

```
Click Earth
  → missionFlow.generateRocketForMission()
      → adapters/rocketGenerator.generateRocket()
      → adapters/orbitalMechanics.planMission()
      → lib/shared/stageConfig.buildStageConfigs()
  → missionFlow.initiateLaunch()
      → physics/flightSim.js (wraps gnc.js)
  → ORBIT_ACHIEVED → orbitalPropagator persists payload
```

### Headless test path

```
lib/pipeline/missionPipeline.mjs
  → require(lib/rocketGenerator.js)     # UMD via createRequire
  → require(lib/orbitalMechanics.js)
  → import lib/shared/stageConfig.js    # Same logic as browser
  → require(gnc.js)
  → lib/shared/orbitAssessment.js
```

## Module responsibilities

| Module | Responsibility |
|--------|----------------|
| `lib/rocketGenerator.js` | Constraint cascade: latitude → ΔV → propellant → engines → vehicle |
| `lib/orbitalMechanics.js` | Orbit selection, launch azimuth, achievable-orbit analysis |
| `lib/shared/stageConfig.js` | Validate generator `simulationParams` for flight; fold SRBs into stage 1 |
| `lib/shared/stagesToGNCConfig.js` | Map stage configs to `gnc.js` rocket object shape |
| `gnc.js` | RK4 integrator, US Standard 1976 atmosphere, phase-state GNC |
| `src/physics/flightSim.js` | Browser-facing wrapper: telemetry mapping, event emission |
| `src/coords/transforms.js` | ECI ↔ scene ↔ lat/lon (conventions documented in-file) |

## Coordinate conventions

- **ECI**: X through vernal equinox, Z north pole, Y completes right-hand system.
- **Three.js scene**: Y-up; mapping `X_eci → X_scene`, `Z_eci → Y_scene`, `Y_eci → -Z_scene`.
- Earth shader UVs derived from object-space lat/lon (not mesh UVs).

## Extension points

- **New propellant families**: `PROPELLANTS` and `ENGINE_CYCLES` tables in `rocketGenerator.js`.
- **New orbit classes**: `ORBIT_CLASSES` in generator + `computeDeltaVBudget` in orbital mechanics.
- **SRB separation**: Currently approximated in `mergeBoostersIntoStage1`; full modeling would extend `gnc.js` staging.
- **Persistence**: `orbitalPropagator.js` and `store.js` are the hooks for localStorage / multi-session worlds.

## Testing

```bash
npm test                  # Full audit (all suites)
npm run test:generator    # 200-sample validation rate ≥ 80%
npm run test:flightsim    # Generated rocket → orbit (Cape Canaveral)
npm run test:gnc-generated # 7/10 latitude bar
```

Integration tests use Monte Carlo generation — occasional failure on an unlucky draw is expected; re-run to confirm.

## Dependencies

- **Runtime**: Node ≥ 18, modern browser with ES modules
- **CDN**: Three.js r128 (no npm dependencies)
