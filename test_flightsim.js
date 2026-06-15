// Test the FlightSim engine standalone
// Extract the core physics from the inline script

const GM = 3.986004418e14, RE = 6371000, g0 = 9.80665, OMEGA = 7.2921159e-5;

const ATM_LAYERS = [
  { h: 0, T: 288.15, L: -0.0065, P: 101325 },
  { h: 11000, T: 216.65, L: 0, P: 22632.1 },
  { h: 20000, T: 216.65, L: 0.001, P: 5474.89 },
  { h: 32000, T: 228.65, L: 0.0028, P: 868.019 },
  { h: 47000, T: 270.65, L: 0, P: 110.906 },
  { h: 51000, T: 270.65, L: -0.0028, P: 66.939 },
  { h: 71000, T: 214.65, L: -0.002, P: 3.9564 },
];

function atmosphere(alt) {
  if (alt < 0) alt = 0;
  if (alt > 300000) return { T: 1000, P: 0, rho: 0, a: 0 };
  if (alt > 86000) {
    const T = 186.87 + (alt - 86000) * 0.003;
    const P = 0.3734 * Math.exp(-(alt - 86000) / 6500);
    return { T, P, rho: P / (287.05 * T), a: Math.sqrt(1.4 * 287.05 * T) };
  }
  let layer = ATM_LAYERS[0];
  for (let i = ATM_LAYERS.length - 1; i >= 0; i--) {
    if (alt >= ATM_LAYERS[i].h) { layer = ATM_LAYERS[i]; break; }
  }
  const dh = alt - layer.h;
  let T, P;
  if (Math.abs(layer.L) < 1e-10) {
    T = layer.T;
    P = layer.P * Math.exp(-g0 * dh / (287.05 * T));
  } else {
    T = layer.T + layer.L * dh;
    P = layer.P * Math.pow(T / layer.T, -g0 / (287.05 * layer.L));
  }
  const rho = P / (287.05 * T);
  return { T, P, rho, a: Math.sqrt(1.4 * 287.05 * Math.max(T, 100)) };
}

function dragCd(mach) {
  if (mach < 0.8) return 0.29;
  if (mach < 1.1) return 0.29 + (mach - 0.8) * 0.7;
  if (mach < 1.5) return 0.50 - (mach - 1.1) * 0.5;
  return Math.max(0.15, 0.30 - (mach - 1.5) * 0.05);
}

const v3 = {
  add: (a,b) => ({x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}),
  sub: (a,b) => ({x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}),
  scale: (a,s) => ({x:a.x*s, y:a.y*s, z:a.z*s}),
  dot: (a,b) => a.x*b.x + a.y*b.y + a.z*b.z,
  mag: (a) => Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z),
  norm: (a) => { const m = v3.mag(a); return m > 0 ? v3.scale(a, 1/m) : {x:0,y:0,z:1}; },
  cross: (a,b) => ({x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}),
};

const Phase = {
  PRELAUNCH: 'PRELAUNCH', VERTICAL_RISE: 'VERTICAL_RISE',
  GRAVITY_TURN: 'GRAVITY_TURN', UPPER_STAGE: 'UPPER_STAGE',
  COAST: 'COAST', CIRCULARIZE: 'CIRCULARIZE',
  ORBIT_ACHIEVED: 'ORBIT_ACHIEVED', ABORT: 'ABORT',
};

class FlightSim {
  constructor(rocketConfig, targetOrbit) {
    this.rocket = rocketConfig;
    this.target = targetOrbit;
    this.targetR = RE + targetOrbit.altitude;
    this.targetV = Math.sqrt(GM / this.targetR);
    this.targetInc = (targetOrbit.inclination || 28.5) * Math.PI / 180;

    const lat = (rocketConfig.launchLat || 28.5) * Math.PI / 180;
    const lon = (rocketConfig.launchLon || -80.6) * Math.PI / 180;

    this.state = {
      x: RE * Math.cos(lat) * Math.cos(lon),
      y: RE * Math.cos(lat) * Math.sin(lon),
      z: RE * Math.sin(lat),
      vx: -OMEGA * RE * Math.cos(lat) * Math.sin(lon),
      vy:  OMEGA * RE * Math.cos(lat) * Math.cos(lon),
      vz: 0,
      mass: this._totalMass(),
      time: 0,
    };

    this.phase = Phase.VERTICAL_RISE;
    this.currentStage = 0;
    this.stagePropUsed = 0;
    this.throttle = 1.0;
    this.pitchAngle = Math.PI / 2;
    this.maxQ = 0;
    this.maxG = 0;
    this.running = true;
    this.events = [{ t: 0, msg: 'LIFTOFF' }];
    this.trajectory = [];
  }

  _totalMass() {
    let m = this.rocket.payloadMass || 5000;
    for (const s of this.rocket.stages) m += (s.dryMass || 0) + (s.propMass || 0);
    return m;
  }

  _stage() { return this.rocket.stages[this.currentStage]; }

  _vEarth(pos) {
    return { x: -OMEGA * pos.y, y: OMEGA * pos.x, z: 0 };
  }

  _localFrame(pos) {
    const rHat = v3.norm(pos);
    let east = v3.norm(v3.cross({x:0,y:0,z:1}, rHat));
    if (v3.mag(east) < 0.01) east = {x:0,y:1,z:0};
    const north = v3.cross(rHat, east);
    return { up: rHat, east, north };
  }

  _deriv(st) {
    const pos = {x: st.x, y: st.y, z: st.z};
    const vel = {x: st.vx, y: st.vy, z: st.vz};
    const r = v3.mag(pos);
    const alt = r - RE;

    const grav = v3.scale(pos, -GM / (r * r * r));

    let thrustVec = {x:0, y:0, z:0};
    let dmass = 0;
    const stage = this._stage();

    if (stage && this.throttle > 0) {
      const { up, east, north } = this._localFrame(pos);

      const lat = Math.asin(pos.z / r);
      const sinAz = Math.max(-1, Math.min(1, Math.cos(this.targetInc) / Math.cos(lat)));
      let azimuth = Math.asin(sinAz);
      if (isNaN(azimuth)) azimuth = Math.PI / 4;
      azimuth = Math.max(azimuth, Math.PI / 6);

      const horizDir = v3.add(
        v3.scale(east, Math.sin(azimuth)),
        v3.scale(north, Math.cos(azimuth))
      );
      const thrustDir = v3.norm(v3.add(
        v3.scale(up, Math.sin(this.pitchAngle)),
        v3.scale(horizDir, Math.cos(this.pitchAngle))
      ));

      const ispFrac = Math.min(1, alt / 80000);
      const isp = stage.ispSL * (1 - ispFrac) + stage.ispVac * ispFrac;
      const thrust = stage.thrustSL * (1 - ispFrac) + stage.thrustVac * ispFrac;
      const F = thrust * this.throttle;

      thrustVec = v3.scale(thrustDir, F / st.mass);
      dmass = -F / (isp * g0);
    }

    let dragVec = {x:0, y:0, z:0};
    if (alt < 150000 && alt >= 0) {
      const vE = this._vEarth(pos);
      const vRel = v3.sub(vel, vE);
      const airspeed = v3.mag(vRel);
      if (airspeed > 1) {
        const atm = atmosphere(alt);
        const mach = airspeed / Math.max(atm.a, 100);
        const Cd = dragCd(mach);
        const Sref = stage ? (stage.refArea || 10.75) : 10.75;
        const dragMag = 0.5 * atm.rho * airspeed * airspeed * Cd * Sref;
        dragVec = v3.scale(v3.norm(vRel), -dragMag / st.mass);
      }
    }

    return {
      dx: vel.x, dy: vel.y, dz: vel.z,
      dvx: grav.x + thrustVec.x + dragVec.x,
      dvy: grav.y + thrustVec.y + dragVec.y,
      dvz: grav.z + thrustVec.z + dragVec.z,
      dm: dmass,
    };
  }

  _rk4(dt) {
    const s = this.state;
    const applyK = (s0, k, h) => ({
      x: s0.x + k.dx * h, y: s0.y + k.dy * h, z: s0.z + k.dz * h,
      vx: s0.vx + k.dvx * h, vy: s0.vy + k.dvy * h, vz: s0.vz + k.dvz * h,
      mass: s0.mass + k.dm * h, time: s0.time + h,
    });

    const k1 = this._deriv(s);
    const k2 = this._deriv(applyK(s, k1, dt/2));
    const k3 = this._deriv(applyK(s, k2, dt/2));
    const k4 = this._deriv(applyK(s, k3, dt));

    s.x  += (k1.dx  + 2*k2.dx  + 2*k3.dx  + k4.dx)  * dt / 6;
    s.y  += (k1.dy  + 2*k2.dy  + 2*k3.dy  + k4.dy)  * dt / 6;
    s.z  += (k1.dz  + 2*k2.dz  + 2*k3.dz  + k4.dz)  * dt / 6;
    s.vx += (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx) * dt / 6;
    s.vy += (k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy) * dt / 6;
    s.vz += (k1.dvz + 2*k2.dvz + 2*k3.dvz + k4.dvz) * dt / 6;
    s.mass += (k1.dm + 2*k2.dm + 2*k3.dm + k4.dm) * dt / 6;
    s.time += dt;
  }

  _guidance() {
    const s = this.state;
    const pos = {x:s.x, y:s.y, z:s.z};
    const vel = {x:s.vx, y:s.vy, z:s.vz};
    const r = v3.mag(pos);
    const alt = r - RE;
    const vE = this._vEarth(pos);
    const vRel = v3.sub(vel, vE);
    const vRelMag = v3.mag(vRel);

    const stage = this._stage();
    if (!stage) { this.throttle = 0; return; }

    if (this.stagePropUsed >= stage.propMass * 0.99) {
      if (this.currentStage < this.rocket.stages.length - 1) {
        this.events.push({ t: s.time, msg: 'STAGE ' + (this.currentStage+1) + ' SEP' });
        s.mass -= stage.dryMass;
        this.currentStage++;
        this.stagePropUsed = 0;
        this.throttle = 0;
        this.events.push({ t: s.time, msg: 'STAGE ' + (this.currentStage+1) + ' IGNITION' });
        this.phase = Phase.UPPER_STAGE;
        return;
      } else {
        this.throttle = 0;
        this.events.push({ t: s.time, msg: 'PROPELLANT DEPLETED' });
        if (alt > 80000) {
          this.phase = Phase.COAST;
        } else {
          this.phase = Phase.ORBIT_ACHIEVED;
          this.events.push({ t: s.time, msg: 'SUBORBITAL TRAJECTORY' });
        }
        return;
      }
    }

    switch (this.phase) {
      case Phase.VERTICAL_RISE:
        this.throttle = 1.0;
        this.pitchAngle = Math.PI / 2;
        if (alt > 300) {
          this.phase = Phase.GRAVITY_TURN;
          this.events.push({ t: s.time, msg: 'PITCH PROGRAM' });
        }
        break;

      case Phase.GRAVITY_TURN: {
        this.throttle = 1.0;
        const altKm = Math.max(0, alt / 1000);
        const scheduled = (Math.PI / 2) * Math.max(0.10, 1.0 - altKm / 90);

        if (vRelMag > 100) {
          const rHat = v3.norm(pos);
          const vRadial = v3.dot(vRel, rHat);
          const vHoriz = Math.sqrt(Math.max(0, vRelMag*vRelMag - vRadial*vRadial));
          const progradePitch = Math.atan2(Math.max(0, vRadial), vHoriz);
          this.pitchAngle = Math.min(scheduled, progradePitch);
        } else {
          this.pitchAngle = scheduled;
        }

        const atm = atmosphere(alt);
        const q = 0.5 * atm.rho * vRelMag * vRelMag;
        if (q > this.maxQ) this.maxQ = q;
        if (q > 35000) this.throttle = Math.min(1, 35000 / q);

        break;
      }

      case Phase.UPPER_STAGE: {
        this.throttle = 1.0;
        const rHat = v3.norm(pos);
        const vRadial = v3.dot(vel, rHat);
        const vTangVec = v3.sub(vel, v3.scale(rHat, vRadial));
        const vTang = v3.mag(vTangVec);

        const altDeficit = this.targetR - r;
        const desiredVr = Math.max(-20, Math.min(120, altDeficit * 0.0008));
        const vrErr2 = desiredVr - vRadial;
        this.pitchAngle = Math.max(-0.08, Math.min(0.25, vrErr2 * 0.004));

        const energy = 0.5 * (vTang*vTang + vRadial*vRadial) - GM / r;
        const sma = -GM / (2 * energy);
        const hMag2 = vTang * r;
        const ecc = Math.sqrt(Math.max(0, 1 - (hMag2*hMag2) / (GM * sma)));
        const periR = sma * (1 - ecc);
        const apoR = sma * (1 + ecc);

        if (apoR > this.targetR * 0.95 && periR > RE + 80000 && Math.abs(vRadial) < 200) {
          this.phase = Phase.COAST;
          this.throttle = 0;
          this.events.push({ t: s.time, msg: 'MECO' });
        }
        if (vTang > this.targetV * 1.02 && periR > RE + 60000) {
          this.phase = Phase.COAST;
          this.throttle = 0;
          this.events.push({ t: s.time, msg: 'MECO' });
        }
        break;
      }

      case Phase.COAST: {
        this.throttle = 0;
        const rHat = v3.norm(pos);
        const vRadial = v3.dot(vel, rHat);
        const vTangVec = v3.sub(vel, v3.scale(rHat, vRadial));
        const vTang = v3.mag(vTangVec);

        if (r > RE + 80000 && vRadial < 5 && vTang > this.targetV * 0.85) {
          if (this._stage() && this.stagePropUsed < this._stage().propMass * 0.9) {
            this.phase = Phase.CIRCULARIZE;
            this.events.push({ t: s.time, msg: 'CIRC BURN START' });
          } else {
            this.phase = Phase.ORBIT_ACHIEVED;
            this.events.push({ t: s.time, msg: 'ORBIT INSERTION' });
          }
        }

        if (vRadial < -200) {
          this.phase = Phase.ORBIT_ACHIEVED;
          this.events.push({ t: s.time, msg: 'ORBIT INSERTION (BALLISTIC)' });
        }
        break;
      }

      case Phase.CIRCULARIZE: {
        this.throttle = 1.0;
        const rHat = v3.norm(pos);
        const vRadial = v3.dot(vel, rHat);
        const vTangVec = v3.sub(vel, v3.scale(rHat, vRadial));
        const vTang = v3.mag(vTangVec);

        this.pitchAngle = Math.max(-0.1, -vRadial * 0.01);

        if (vTang >= this.targetV * 0.98 && Math.abs(vRadial) < 50) {
          this.phase = Phase.ORBIT_ACHIEVED;
          this.throttle = 0;
          this.events.push({ t: s.time, msg: 'ORBIT ACHIEVED' });
        }
        break;
      }
    }
  }

  step(dt) {
    if (!this.running) return;
    if (this.phase === Phase.ORBIT_ACHIEVED) { this.running = false; return; }

    this._guidance();

    const substeps = (this.state.time < 120) ? 4 : 2;
    const h = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      this._rk4(h);
    }

    const stage = this._stage();
    if (stage && this.throttle > 0) {
      const ispFrac = Math.min(1, (v3.mag({x:this.state.x,y:this.state.y,z:this.state.z}) - RE) / 80000);
      const isp = stage.ispSL * (1 - ispFrac) + stage.ispVac * ispFrac;
      const thrust = stage.thrustSL * (1 - ispFrac) + stage.thrustVac * ispFrac;
      this.stagePropUsed += (thrust * this.throttle / (isp * g0)) * dt;
    }

    const accel = this.throttle > 0 && stage ? (stage.thrustVac * this.throttle / this.state.mass) / g0 : 0;
    if (accel > this.maxG) this.maxG = accel;

    const r = Math.sqrt(this.state.x**2 + this.state.y**2 + this.state.z**2);
    if (r < RE - 500 && this.state.time > 5) {
      this.running = false;
      this.phase = Phase.ABORT;
      this.events.push({ t: this.state.time, msg: 'IMPACT' });
    }

    if (this.state.time > 3600) {
      this.running = false;
      this.phase = Phase.ORBIT_ACHIEVED;
    }

    if (this.trajectory.length === 0 || this.state.time - this.trajectory[this.trajectory.length-1].t > 1) {
      this.trajectory.push({
        t: this.state.time,
        x: this.state.x, y: this.state.y, z: this.state.z,
        vx: this.state.vx, vy: this.state.vy, vz: this.state.vz,
        mass: this.state.mass, phase: this.phase,
      });
    }
  }

  getTelemetry() {
    const s = this.state;
    const pos = {x:s.x, y:s.y, z:s.z};
    const vel = {x:s.vx, y:s.vy, z:s.vz};
    const r = v3.mag(pos);
    const alt = r - RE;
    const speed = v3.mag(vel);
    const vE = this._vEarth(pos);
    const vRel = v3.sub(vel, vE);
    const airspeed = v3.mag(vRel);
    const atm = atmosphere(Math.max(0, alt));
    const mach = atm.a > 0 ? airspeed / atm.a : 0;
    const q = 0.5 * atm.rho * airspeed * airspeed;
    const rHat = v3.norm(pos);
    const vRadial = v3.dot(vel, rHat);
    const vTangVec = v3.sub(vel, v3.scale(rHat, vRadial));
    const vTang = v3.mag(vTangVec);
    const stage = this._stage();
    const propRemaining = stage ? Math.max(0, 1 - this.stagePropUsed / stage.propMass) : 0;

    const hVec = v3.cross(pos, vel);
    const hMag = v3.mag(hVec);
    const energy = 0.5 * speed * speed - GM / r;
    const a = -GM / (2 * energy);
    const eVec = v3.sub(v3.scale(v3.cross(vel, hVec), 1/GM), v3.norm(pos));
    const e = v3.mag(eVec);
    const inc = Math.acos(Math.max(-1, Math.min(1, hVec.z / hMag))) * 180 / Math.PI;
    const apoAlt = a * (1 + e) - RE;
    const periAlt = a * (1 - e) - RE;
    const period = 2 * Math.PI * Math.sqrt(a * a * a / GM);

    return {
      altitude: alt, speed, airspeed, mach, dynamicPressure: q,
      acceleration: stage && this.throttle > 0 ? (stage.thrustVac * this.throttle / s.mass) : 0,
      pitchAngle: this.pitchAngle * 180 / Math.PI,
      heading: 0,
      throttle: this.throttle,
      phase: this.phase,
      currentStage: this.currentStage,
      propellantRemaining: propRemaining,
      gimbalPitch: 0, gimbalYaw: 0,
      time: s.time, maxQ: this.maxQ, maxG: this.maxG,
      orbitalElements: { a, e, inc, apoAlt, periAlt, period },
    };
  }
}

// ====================================================
// Test with a Falcon-9-like rocket configuration
// ====================================================

const rocket = {
  launchLat: 28.5,
  launchLon: -80.6,
  payloadMass: 5000,
  stages: [
    {
      dryMass: 25000,
      propMass: 400000,
      thrustSL: 7600000,    // ~7.6 MN (9 Merlins SL)
      thrustVac: 8200000,
      ispSL: 282,
      ispVac: 311,
      refArea: 10.75,       // ~3.7m diameter
    },
    {
      dryMass: 4000,
      propMass: 107000,
      thrustSL: 981000,     // MVac (but SL doesn't matter, starts in vacuum)
      thrustVac: 981000,
      ispSL: 348,
      ispVac: 348,
      refArea: 10.75,
    },
  ],
};

const targetOrbit = {
  altitude: 200000,  // 200 km LEO
  inclination: 28.5,
};

console.log('=== FlightSim Test ===');
console.log(`Target orbit: ${targetOrbit.altitude/1000} km, ${targetOrbit.inclination}° inc`);
console.log(`Target orbital velocity: ${Math.sqrt(GM / (RE + targetOrbit.altitude)).toFixed(1)} m/s`);
console.log(`Initial mass: ${rocket.payloadMass + rocket.stages.reduce((s,st)=>s+st.dryMass+st.propMass,0)} kg`);
console.log();

const sim = new FlightSim(rocket, targetOrbit);
const dt = 0.5;  // 0.5s timestep
let lastReport = 0;

while (sim.running && sim.state.time < 3600) {
  sim.step(dt);

  // Report every 30 seconds
  if (sim.state.time - lastReport >= 30) {
    const t = sim.getTelemetry();
    console.log(`T+${t.time.toFixed(0).padStart(4)}s | Phase: ${t.phase.padEnd(15)} | Alt: ${(t.altitude/1000).toFixed(1).padStart(7)} km | Speed: ${t.speed.toFixed(0).padStart(6)} m/s | Mach: ${t.mach.toFixed(1).padStart(5)} | Pitch: ${t.pitchAngle.toFixed(1).padStart(5)}° | Mass: ${sim.state.mass.toFixed(0).padStart(7)} kg | Q: ${t.dynamicPressure.toFixed(0).padStart(6)} Pa | Stage: ${t.currentStage+1}`);
    lastReport = sim.state.time;
  }
}

console.log();
console.log('=== FINAL STATE ===');
console.log(`Phase: ${sim.phase}`);
const final = sim.getTelemetry();
console.log(`Altitude: ${(final.altitude/1000).toFixed(1)} km`);
console.log(`Speed: ${final.speed.toFixed(1)} m/s`);
console.log(`Orbital Elements:`);
console.log(`  Semi-major axis: ${(final.orbitalElements.a/1000).toFixed(1)} km`);
console.log(`  Eccentricity: ${final.orbitalElements.e.toFixed(4)}`);
console.log(`  Inclination: ${final.orbitalElements.inc.toFixed(1)}°`);
console.log(`  Apoapsis alt: ${(final.orbitalElements.apoAlt/1000).toFixed(1)} km`);
console.log(`  Periapsis alt: ${(final.orbitalElements.periAlt/1000).toFixed(1)} km`);
console.log(`  Period: ${(final.orbitalElements.period/60).toFixed(1)} min`);
console.log(`Max Q: ${sim.maxQ.toFixed(0)} Pa`);
console.log(`Max G: ${sim.maxG.toFixed(1)} g`);
console.log();
console.log('Events:');
for (const e of sim.events) {
  console.log(`  T+${e.t.toFixed(1)}s: ${e.msg}`);
}

// Verdict
const success = sim.phase === Phase.ORBIT_ACHIEVED && final.orbitalElements.periAlt > 100000;
console.log();
console.log(success ? '✓ ORBIT ACHIEVED' : '✗ ORBIT NOT ACHIEVED');
process.exit(success ? 0 : 1);
