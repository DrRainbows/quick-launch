// ============================================================================
// VEC3 — Lightweight {x, y, z} vector operations
// ============================================================================
// Used by FlightSim, orbital propagator, and coordinate transforms.
// These operate on plain objects {x, y, z} — no class overhead.

export const vec3 = {
  add:   (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub:   (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a, s) => ({ x: a.x * s,   y: a.y * s,   z: a.z * s }),
  dot:   (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  mag:   (a)    => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  mag2:  (a)    => a.x * a.x + a.y * a.y + a.z * a.z,
  norm:  (a)    => {
    const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    return m > 0 ? { x: a.x / m, y: a.y / m, z: a.z / m } : { x: 0, y: 0, z: 1 };
  },
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  zero:  ()     => ({ x: 0, y: 0, z: 0 }),
  clone: (a)    => ({ x: a.x, y: a.y, z: a.z }),
};
