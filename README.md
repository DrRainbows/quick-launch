# Launch Grammar

**Click anywhere on Earth. A unique rocket materializes from physical constraints. It launches with real GNC into orbit.**

A browser-based generative aerospace simulator. No build step. No framework. One click produces a physically plausible launch vehicle — propellant chemistry, stage count, engine cycle, mass fractions — then flies it through a full ascent simulation with atmosphere, guidance, staging, and orbital mechanics.

Portfolio demo. Sister project: [Deep-Time-Earth](https://github.com/DrRainbows/Deep-Time-Earth) (originally *Solar Find*).

---

## Run it

```bash
node server.js
# → http://localhost:8042
```

### First launch

1. **Click** anywhere on the globe to select a launch site
2. **Generate Vehicle** — the pattern language grows a rocket for that latitude and orbit class
3. **Initiate Launch** — watch real-time telemetry as GNC guides the ascent
4. Payload persists in orbit; spent stages fall back and impact

---

## What it does

| Layer | Detail |
|-------|--------|
| **Generative design** | `lib/rocketGenerator.js` — constraint cascade from latitude → inclination → delta-V → propellant → engines |
| **Mission planning** | `lib/orbitalMechanics.js` — Tsiolkovsky budgets, orbit selection, launch azimuth |
| **Flight physics** | `src/physics/flightSim.js` — RK4 integration, US Standard 1976 atmosphere, variable drag |
| **GNC** | `gnc.js` — phase-state guidance through gravity turn to circularization |
| **World** | Persistent orbital objects, ground tracks, impact markers, time warp |

---

## Coordinate system

Documented in `src/coords/transforms.js`. Earth texture UVs are derived from object-space lat/lon in the shader (not mesh UVs), matching click coordinates to the map — same principle as Deep-Time-Earth's ECEF→equirectangular mapping.

---

## Tests

```bash
npm test                  # full audit
npm run test:generator    # 200 random rockets — checks validation.valid rate
npm run test:flightsim    # single hardcoded ascent to orbit
npm run test:gnc          # GNC unit tests
npm run test:gnc-generated # generated rockets through GNC (6/10 bar)
npm run test:coords       # lat/lon round-trips
```

### What the tests actually prove

| Suite | Trust level | Notes |
|-------|-------------|-------|
| `test_flightsim` | **High** | Hardcoded vehicle, exits non-zero if no orbit. Real telemetry. |
| `test_gnc` | **High** | 27 explicit assertions on atmosphere, PID, orbital elements, full sim. |
| `test_coords` | **High** | Round-trip lat/lon ↔ scene ↔ ECI at 8 sites. |
| `test_generator` | **Medium** | Checks `validation.valid` rate ≥50% on 200 samples. Many designs are physically incomplete by design. |
| `test_gnc_generated` | **Low bar** | Only requires 3/10 latitudes to reach orbit; generator + GNC adapter mismatch is a known gap. |

---

## License

MIT
