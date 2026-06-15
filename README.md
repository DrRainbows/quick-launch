# Launch Grammar

**Click anywhere on Earth. A unique rocket materializes from physical constraints. It launches with real GNC into orbit.**

A browser-based generative aerospace simulator. No build step. No framework. One click produces a physically plausible launch vehicle — propellant chemistry, stage count, engine cycle, mass fractions — then flies it through a full ascent simulation with atmosphere, guidance, staging, and orbital mechanics.

Portfolio demo. Sister project: [Deep-Time-Earth](https://github.com/DrRainbows/Deep-Time-Earth).

---

## Run it

```bash
npm start
# → http://localhost:8042
```

### First launch

1. **Click** anywhere on the globe to select a launch site
2. **Generate Vehicle** — the pattern language grows a rocket for that latitude and orbit class
3. **Initiate Launch** — watch real-time telemetry as GNC guides the ascent
4. Payload persists in orbit; spent stages fall back and impact

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module boundaries, data flow, and extension points.

| Layer | Module | Role |
|-------|--------|------|
| Pattern language | `lib/rocketGenerator.js` | Constraint cascade: latitude → ΔV → propellant → engines |
| Mission planning | `lib/orbitalMechanics.js` | Tsiolkovsky budgets, orbit selection, launch azimuth |
| Shared logic | `lib/shared/` | Constants, stage config, orbit criteria (browser + Node) |
| Flight physics | `gnc.js` + `src/physics/flightSim.js` | RK4 integration, atmosphere, phase-state GNC |
| Application | `src/` | Rendering, UI, mission orchestration |
| Verification | `tests/` | Headless audit pipeline |

---

## Coordinate system

Documented in `src/coords/transforms.js`. Earth texture UVs are derived from object-space lat/lon in the shader (not mesh UVs), matching click coordinates to the map.

---

## Tests

```bash
npm test                  # full audit
npm run test:generator    # 200 random rockets — validation.valid ≥ 80%
npm run test:flightsim    # generated rocket → orbit (Cape Canaveral)
npm run test:gnc          # GNC unit tests (atmosphere, PID, GenericLEO)
npm run test:gnc-generated # generated rockets through GNC (7/10 latitude bar)
npm run test:coords       # lat/lon round-trips via canonical transforms module
```

### What the tests prove

| Suite | Trust level | Criterion |
|-------|-------------|-----------|
| `test:flightsim` | **High** | GNC achieves orbit with a generated vehicle; exits non-zero on failure |
| `test:gnc` | **High** | 27 explicit assertions on atmosphere, PID, orbital elements, reference sim |
| `test:coords` | **High** | Round-trip lat/lon ↔ scene ↔ ECI at 8 sites using `src/coords/transforms.js` |
| `test:generator` | **High** | `validation.valid` rate ≥ 80% on 200 Monte Carlo samples |
| `test:gnc-generated` | **Medium** | 7/10 launch latitudes reach orbit (stochastic; high latitudes are harder) |

Integration tests use Monte Carlo rocket generation — an occasional failure on an unlucky draw is expected. Re-run to confirm.

---

## License

MIT
