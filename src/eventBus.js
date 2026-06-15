// ============================================================================
// EVENT BUS — Lightweight typed event system
// ============================================================================
// Decouples physics from rendering from UI.
// Physics publishes; UI subscribes. No direct DOM manipulation from physics.
//
// Events:
//   sim:tick        { telemetry, simTime }           — every physics frame
//   sim:event       { type, msg, time, data }        — STAGING, MECO, etc.
//   phase:changed   { from, to }                     — state machine transition
//   orbital:tick    { objects }                       — persistent object update
//   orbital:impact  { object, position }              — object hit surface
//   vehicle:generated { rocket, mission }             — rocket created
//   mission:cancel  { phase }                         — user cancelled
//   camera:mode     { tracking }                      — camera mode change
//   warp:changed    { level }                         — time warp change

const bus = new EventTarget();

/** Emit a typed event */
export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

/** Subscribe to a typed event. Returns unsubscribe function. */
export function on(type, handler) {
  const wrapped = (e) => handler(e.detail);
  bus.addEventListener(type, wrapped);
  return () => bus.removeEventListener(type, wrapped);
}

/** Subscribe to a typed event, fires once only. */
export function once(type, handler) {
  const wrapped = (e) => handler(e.detail);
  bus.addEventListener(type, wrapped, { once: true });
}

/**
 * Create a subscription group that can be cleaned up at once.
 * Useful for per-mission subscriptions that should be cancelled.
 */
export function createGroup() {
  const unsubs = [];
  return {
    on(type, handler) {
      unsubs.push(on(type, handler));
    },
    dispose() {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
    },
  };
}
