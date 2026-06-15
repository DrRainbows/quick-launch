# Launch Grammar

**Click anywhere on Earth. A unique rocket materializes from physical constraints. It launches with simplified GNC into orbit.**

A browser-based generative aerospace demo. No build step. No npm install. One click produces a launch vehicle from a constraint cascade — propellant, staging, engine cycle, mass fractions — then flies it through a simplified ascent simulation.

Portfolio demo. Sister project: [Deep-Time-Earth](https://github.com/DrRainbows/Deep-Time-Earth).

---

## Quick start

**Requirements:** [Node.js](https://nodejs.org/) 18 or newer. A modern browser with WebGL.

```bash
# Clone (GitHub repo is still named quick-launch)
git clone https://github.com/DrRainbows/quick-launch.git
cd quick-launch

# Start the static server
npm start
# or: node server.js
```

Open **http://localhost:8042** in your browser.

No `npm install` — there are no dependencies. Three.js loads from CDN in `index.html`.

### First launch

1. **Click** anywhere on the globe to select a launch site
2. **Generate Vehicle** — the pattern language grows a rocket for that latitude and orbit class
3. **Initiate Launch** — telemetry updates as the ascent sim runs
4. Payload persists in orbit; spent stages fall back and impact

### Controls

| Action | How |
|--------|-----|
| Orbit / pan globe | Mouse drag |
| Zoom | Scroll |
| Time warp | UI controls (1× → 100×) |
| Mute audio | MUTE button (bottom-right) |

### Run tests (optional)

```bash
npm test                  # full audit — all suites
npm run test:generator    # 200 random rockets, validation.valid ≥ 80%
npm run test:flightsim      # one generated vehicle → orbit (Cape Canaveral)
npm run test:gnc            # atmosphere, PID, GenericLEO reference sim
npm run test:gnc-generated  # generated rockets at 10 latitudes (7/10 bar)
npm run test:coords         # coordinate round-trips
```

Integration tests use Monte Carlo generation — re-run if a suite fails on an unlucky draw.

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

See **Run tests** under [Quick start](#quick-start) above.

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
