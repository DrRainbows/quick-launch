# Quick Launch

**Click anywhere on Earth. A unique rocket materializes from physical constraints. It launches with real GNC into orbit.**

A browser-based generative aerospace simulator. No build step. No framework. One click produces a physically plausible launch vehicle — propellant chemistry, stage count, engine cycle, mass fractions — then flies it through a full ascent simulation with atmosphere, guidance, staging, and orbital mechanics.

Portfolio demo extracted from the [orbit simulator](https://github.com/DrRainbows/quick-launch) research codebase. For deep-time Earth astronomy see [Deep-Time-Earth](https://github.com/DrRainbows/Deep-Time-Earth) (Solar Find).

---

## Run it

```bash
node server.js
# → http://localhost:8042
```

Or any static file server pointing at this directory.

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
| **Flight physics** | `src/physics/flightSim.js` — RK4 integration, US Standard 1976 atmosphere, variable drag, thrust vs ambient pressure |
| **GNC** | `gnc.js` — phase-state guidance: vertical rise → pitch program → gravity turn → coast → circularize |
| **World** | Persistent orbital objects, ground tracks, impact markers, time warp |

---

## Coordinate system

Documented once in `src/coords/transforms.js`:

- **ECI** (physics): X through vernal equinox, Z north pole
- **Scene** (Three.js): Y-up; `X_eci → X_scene`, `Z_eci → Y_scene`, `Y_eci → -Z_scene`
- **Earth texture UV**: derived from object-space lat/lon in the earth shader (not mesh UVs), keeping click coordinates aligned with the map — same principle as [Deep-Time-Earth](https://github.com/DrRainbows/Deep-Time-Earth)'s ECEF→equirectangular mapping

Earth uses NASA Blue Marble textures (`earth_texture.jpg`, `earth_night.jpg`) with day/night terminator shader and atmosphere rim glow.

---

## Tests

Headless verification — no browser required:

```bash
npm test                  # full audit (all suites)
npm run test:generator    # 200 random rockets
npm run test:flightsim    # single ascent to orbit
npm run test:gnc          # GNC phase transitions
npm run test:gnc-generated # generated rockets through GNC
npm run test:coords       # lat/lon ↔ scene ↔ ECI round-trips
```

---

## Architecture

```
index.html          UI shell + script tags for CJS engines
src/main.js         ES module entry — scene, loop, event bus
lib/                Rocket generator + orbital mechanics (CJS)
gnc.js              Guidance / navigation / control
src/physics/        FlightSim, atmosphere, propagator
src/render/         Earth, rocket, camera, ground tracks
src/mission/        Click → design → countdown → ascent flow
```

Single-file server (`server.js`). Three.js from CDN. No npm install needed to run.

---

## Name

Working title: **Quick Launch**. Earlier internal names: orbit simulator, Solar Find (reserved for the astronomy project). Open to renaming before portfolio publish.

---

## License

MIT
