// ============================================================================
// PROCEDURAL AUDIO ENGINE — Flight telemetry drives sound synthesis
// ============================================================================
// Web Audio API graph driven by sim state: thrust, altitude, dynamic pressure,
// Mach number, phase. No samples — everything synthesized from oscillators and
// noise. Designed for low CPU: nodes created once, gain-ramped per frame.
//
// Audio design:
//   1. Engine rumble    — filtered white noise + oscillator harmonics, amplitude
//                         from thrust*throttle, frequency shifts with altitude
//   2. Staging events   — brief silence, then ignition transient burst
//   3. Atmospheric      — wind noise proportional to dynamic pressure,
//                         tonal sweep at Mach transition
//   4. Vacuum transition — all atmo sounds fade above 60km, mechanical hum remains
//   5. Orbit achieved   — gentle C-E-G major chord resolution tone

// ============================================================================
// STATE
// ============================================================================

let ctx = null;           // AudioContext
let masterGain = null;    // Master volume (mute control)
let initialized = false;  // Audio graph built?
let muted = false;
let suspended = true;     // AudioContext suspended until user gesture

// --- Engine rumble nodes ---
let rumbleNoise = null;       // White noise source (AudioBufferSourceNode)
let rumbleNoiseGain = null;   // Gain before filter
let rumbleBandpass = null;    // Bandpass filter — center freq shifts with altitude
let rumbleFilteredGain = null;// Post-filter gain — amplitude from thrust*throttle

// Oscillator layers for harmonic richness
let rumbleOsc1 = null;    // Fundamental (~80Hz at sea level)
let rumbleOsc2 = null;    // 2nd harmonic
let rumbleOsc3 = null;    // 3rd harmonic (sub)
let rumbleOscGain1 = null;
let rumbleOscGain2 = null;
let rumbleOscGain3 = null;

// --- Wind / atmospheric nodes ---
let windNoise = null;         // Separate noise source for wind
let windBandpass = null;
let windGain = null;

// --- Mach transition ---
let machSweepActive = false;
let lastMachBelow1 = true;    // Track Mach crossing

// --- Vacuum mechanical hum ---
let humOsc = null;
let humGain = null;

// --- Staging transient ---
let stagingTimeout = null;

// --- Orbit chord ---
let chordOscs = [];
let chordGains = [];

// Previous state for edge detection
let prevStage = -1;
let prevPhase = '';

// ============================================================================
// WHITE NOISE BUFFER — Create once, reuse
// ============================================================================

function createWhiteNoiseBuffer(audioCtx, durationSec) {
  const sampleRate = audioCtx.sampleRate;
  const length = sampleRate * durationSec;
  const buffer = audioCtx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createLoopingNoise(audioCtx, buffer) {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start(0);
  return source;
}

// ============================================================================
// INIT — Call once on user gesture
// ============================================================================

export function initAudio() {
  if (initialized) {
    // If already initialized but suspended, try to resume
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
      suspended = false;
    }
    return;
  }

  try {
    ctx = new AudioContext();
  } catch (e) {
    console.warn('[Audio] AudioContext not available:', e);
    return;
  }

  // Resume if suspended (browser policy)
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => { suspended = false; });
  } else {
    suspended = false;
  }

  // Master gain (mute control)
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 1;
  masterGain.connect(ctx.destination);

  // --- Build noise buffer (2 seconds, looped) ---
  const noiseBuffer = createWhiteNoiseBuffer(ctx, 2);

  // =====================================================================
  // ENGINE RUMBLE — Filtered noise layer
  // =====================================================================
  rumbleNoise = createLoopingNoise(ctx, noiseBuffer);
  rumbleNoiseGain = ctx.createGain();
  rumbleNoiseGain.gain.value = 0;

  rumbleBandpass = ctx.createBiquadFilter();
  rumbleBandpass.type = 'bandpass';
  rumbleBandpass.frequency.value = 80;
  rumbleBandpass.Q.value = 1.2;

  rumbleFilteredGain = ctx.createGain();
  rumbleFilteredGain.gain.value = 0;

  rumbleNoise.connect(rumbleNoiseGain);
  rumbleNoiseGain.connect(rumbleBandpass);
  rumbleBandpass.connect(rumbleFilteredGain);
  rumbleFilteredGain.connect(masterGain);

  // =====================================================================
  // ENGINE RUMBLE — Oscillator harmonic layers
  // =====================================================================
  // Fundamental
  rumbleOsc1 = ctx.createOscillator();
  rumbleOsc1.type = 'sawtooth';
  rumbleOsc1.frequency.value = 80;
  rumbleOscGain1 = ctx.createGain();
  rumbleOscGain1.gain.value = 0;
  rumbleOsc1.connect(rumbleOscGain1);
  rumbleOscGain1.connect(masterGain);
  rumbleOsc1.start(0);

  // 2nd harmonic
  rumbleOsc2 = ctx.createOscillator();
  rumbleOsc2.type = 'triangle';
  rumbleOsc2.frequency.value = 160;
  rumbleOscGain2 = ctx.createGain();
  rumbleOscGain2.gain.value = 0;
  rumbleOsc2.connect(rumbleOscGain2);
  rumbleOscGain2.connect(masterGain);
  rumbleOsc2.start(0);

  // Sub-harmonic
  rumbleOsc3 = ctx.createOscillator();
  rumbleOsc3.type = 'sine';
  rumbleOsc3.frequency.value = 40;
  rumbleOscGain3 = ctx.createGain();
  rumbleOscGain3.gain.value = 0;
  rumbleOsc3.connect(rumbleOscGain3);
  rumbleOscGain3.connect(masterGain);
  rumbleOsc3.start(0);

  // =====================================================================
  // WIND NOISE — Proportional to dynamic pressure
  // =====================================================================
  windNoise = createLoopingNoise(ctx, noiseBuffer);
  windBandpass = ctx.createBiquadFilter();
  windBandpass.type = 'bandpass';
  windBandpass.frequency.value = 800;
  windBandpass.Q.value = 0.7;

  windGain = ctx.createGain();
  windGain.gain.value = 0;

  windNoise.connect(windBandpass);
  windBandpass.connect(windGain);
  windGain.connect(masterGain);

  // =====================================================================
  // VACUUM MECHANICAL HUM — Very quiet, always present when engines fire
  // =====================================================================
  humOsc = ctx.createOscillator();
  humOsc.type = 'sine';
  humOsc.frequency.value = 40;

  const humLowpass = ctx.createBiquadFilter();
  humLowpass.type = 'lowpass';
  humLowpass.frequency.value = 60;
  humLowpass.Q.value = 0.5;

  humGain = ctx.createGain();
  humGain.gain.value = 0;

  humOsc.connect(humLowpass);
  humLowpass.connect(humGain);
  humGain.connect(masterGain);
  humOsc.start(0);

  initialized = true;
  prevStage = -1;
  prevPhase = '';
  lastMachBelow1 = true;
  machSweepActive = false;
}

// ============================================================================
// UPDATE — Call every animation frame with current sim state
// ============================================================================
// simState shape:
//   { throttle, altitude, speed, machNumber, dynamicPressure,
//     phase, currentStage, engineCount }

export function updateAudio(simState) {
  if (!initialized || !ctx || ctx.state === 'suspended') return;

  const {
    throttle = 0,
    altitude = 0,
    speed = 0,
    machNumber = 0,
    dynamicPressure = 0,
    phase = '',
    currentStage = 0,
    engineCount = 1,
  } = simState;

  const now = ctx.currentTime;
  const rampTime = 0.05; // 50ms ramp to avoid clicks

  // Is the vehicle in a powered-flight phase?
  const isPowered = (
    phase === 'VERTICAL_RISE' ||
    phase === 'GRAVITY_TURN' ||
    phase === 'UPPER_STAGE' ||
    phase === 'CIRCULARIZE'
  );
  const isCoasting = phase === 'COAST_TO_APOAPSIS' || phase === 'COAST';

  // ------------------------------------------------------------------
  // Atmospheric attenuation factor: sounds fade above 60km
  // Full volume below 40km, silent above 80km
  // ------------------------------------------------------------------
  const atmoFactor = altitude < 40000 ? 1.0
    : altitude > 80000 ? 0.0
    : 1.0 - (altitude - 40000) / 40000;

  // ==================================================================
  // 1. ENGINE RUMBLE
  // ==================================================================
  if (isPowered && throttle > 0) {
    // Thrust amplitude: louder with more engines
    const engineScale = Math.min(1.0, 0.3 + 0.7 * Math.sqrt(engineCount / 9));
    const thrustAmplitude = throttle * engineScale;

    // --- Noise layer ---
    // Noise amplitude blends atmo rumble with a minimum vacuum rumble
    const noiseLevel = thrustAmplitude * (0.15 + 0.85 * atmoFactor);
    rumbleNoiseGain.gain.linearRampToValueAtTime(1.0, now + rampTime);
    rumbleFilteredGain.gain.linearRampToValueAtTime(noiseLevel * 0.35, now + rampTime);

    // Center frequency: low at sea level, shifts higher as atmo thins
    // Sea level: ~80Hz, 50km: ~200Hz, vacuum: ~300Hz (thinner sound)
    const centerFreq = 80 + (altitude / 80000) * 220;
    rumbleBandpass.frequency.linearRampToValueAtTime(
      Math.min(centerFreq, 300), now + rampTime
    );
    // Narrower Q at altitude (less broadband)
    rumbleBandpass.Q.linearRampToValueAtTime(
      1.2 + (1.0 - atmoFactor) * 2.0, now + rampTime
    );

    // --- Oscillator layers ---
    // Scale frequencies with altitude (higher pitch in thinner air)
    const freqShift = 1.0 + (altitude / 100000) * 0.5;
    const baseFreq = 80 * freqShift;

    rumbleOsc1.frequency.linearRampToValueAtTime(baseFreq, now + rampTime);
    rumbleOsc2.frequency.linearRampToValueAtTime(baseFreq * 2, now + rampTime);
    rumbleOsc3.frequency.linearRampToValueAtTime(baseFreq * 0.5, now + rampTime);

    // Oscillator amplitudes: fundamental strongest, harmonics add color
    // Stage 1 (many engines): deeper, more sub-harmonic
    // Upper stage: cleaner, less sub
    const isFirstStage = currentStage === 0;
    const subWeight = isFirstStage ? 0.12 : 0.03;
    const fundWeight = isFirstStage ? 0.08 : 0.06;
    const harmWeight = isFirstStage ? 0.04 : 0.02;

    rumbleOscGain1.gain.linearRampToValueAtTime(thrustAmplitude * fundWeight * (0.3 + 0.7 * atmoFactor), now + rampTime);
    rumbleOscGain2.gain.linearRampToValueAtTime(thrustAmplitude * harmWeight * (0.2 + 0.8 * atmoFactor), now + rampTime);
    rumbleOscGain3.gain.linearRampToValueAtTime(thrustAmplitude * subWeight * (0.4 + 0.6 * atmoFactor), now + rampTime);

    // --- Vacuum mechanical hum ---
    // Fades IN as atmosphere fades out — structural vibration only
    const humLevel = throttle * (1.0 - atmoFactor) * 0.04;
    humGain.gain.linearRampToValueAtTime(humLevel, now + rampTime);
  } else {
    // Engines off — silence all engine sounds
    rumbleNoiseGain.gain.linearRampToValueAtTime(0, now + rampTime);
    rumbleFilteredGain.gain.linearRampToValueAtTime(0, now + rampTime);
    rumbleOscGain1.gain.linearRampToValueAtTime(0, now + rampTime);
    rumbleOscGain2.gain.linearRampToValueAtTime(0, now + rampTime);
    rumbleOscGain3.gain.linearRampToValueAtTime(0, now + rampTime);
    humGain.gain.linearRampToValueAtTime(0, now + rampTime);
  }

  // ==================================================================
  // 2. WIND / ATMOSPHERIC NOISE — proportional to dynamic pressure
  // ==================================================================
  // Dynamic pressure peaks at max-Q (~30-40 kPa typically)
  // Normalize to ~35 kPa as "full wind"
  const windLevel = Math.min(1.0, dynamicPressure / 35000) * atmoFactor * 0.25;
  windGain.gain.linearRampToValueAtTime(windLevel, now + rampTime);

  // Wind frequency shifts with speed: lower at subsonic, broader at supersonic
  const windFreq = 400 + Math.min(speed, 3000) * 0.5;
  windBandpass.frequency.linearRampToValueAtTime(windFreq, now + rampTime);

  // ==================================================================
  // 3. MACH TRANSITION — tonal sweep at Mach 1 crossing
  // ==================================================================
  if (!machSweepActive) {
    const isBelowMach1 = machNumber < 0.95;
    const isAboveMach1 = machNumber > 1.05;

    if (lastMachBelow1 && isAboveMach1) {
      // Just crossed Mach 1 upward
      playMachSweep(true);
      lastMachBelow1 = false;
      machSweepActive = true;
    } else if (!lastMachBelow1 && isBelowMach1) {
      // Crossed back below (reentry case)
      lastMachBelow1 = true;
    }
  }

  // ==================================================================
  // 4. PHASE EDGE DETECTION — orbit achieved handled via triggerOrbitAchieved()
  // ==================================================================
  // Reset Mach tracking on new flights
  if (phase !== prevPhase) {
    if (phase === 'VERTICAL_RISE') {
      lastMachBelow1 = true;
      machSweepActive = false;
      prevStage = 0;
    }
    prevPhase = phase;
  }
}

// ============================================================================
// MACH SWEEP — Brief tonal sweep when passing Mach 1
// ============================================================================

function playMachSweep(ascending) {
  if (!ctx || !initialized) return;

  const now = ctx.currentTime;

  // Short sine sweep: 800Hz -> 200Hz over 300ms (ascending Mach)
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(ascending ? 800 : 200, now);
  osc.frequency.exponentialRampToValueAtTime(ascending ? 200 : 800, now + 0.3);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.15);
  gain.gain.linearRampToValueAtTime(0, now + 0.3);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.35);

  // Reset machSweepActive after sweep completes
  setTimeout(() => { machSweepActive = false; }, 400);
}

// ============================================================================
// STAGING — Brief silence then ignition transient
// ============================================================================

export function triggerStaging() {
  if (!ctx || !initialized) return;

  const now = ctx.currentTime;

  // 1. Brief silence: ramp all engine sounds to 0 over 20ms
  rumbleFilteredGain.gain.linearRampToValueAtTime(0, now + 0.02);
  rumbleOscGain1.gain.linearRampToValueAtTime(0, now + 0.02);
  rumbleOscGain2.gain.linearRampToValueAtTime(0, now + 0.02);
  rumbleOscGain3.gain.linearRampToValueAtTime(0, now + 0.02);
  humGain.gain.linearRampToValueAtTime(0, now + 0.02);

  // 2. After 100ms silence, ignition transient
  if (stagingTimeout) clearTimeout(stagingTimeout);
  stagingTimeout = setTimeout(() => {
    if (!ctx || ctx.state === 'closed') return;
    playIgnitionBurst();
    stagingTimeout = null;
  }, 100);
}

// ============================================================================
// IGNITION BURST — Sharp attack white noise burst (50ms) settling into rumble
// ============================================================================

function playIgnitionBurst() {
  if (!ctx || !initialized) return;

  const now = ctx.currentTime;

  // Create a short burst noise source
  const burstLength = 0.15;
  const burstBuffer = createWhiteNoiseBuffer(ctx, burstLength + 0.1);
  const burstSource = ctx.createBufferSource();
  burstSource.buffer = burstBuffer;

  // Bandpass at mid-frequency for "crack" character
  const burstFilter = ctx.createBiquadFilter();
  burstFilter.type = 'bandpass';
  burstFilter.frequency.value = 500;
  burstFilter.Q.value = 0.8;

  const burstGain = ctx.createGain();
  // Sharp attack, quick decay
  burstGain.gain.setValueAtTime(0, now);
  burstGain.gain.linearRampToValueAtTime(0.4, now + 0.01);   // 10ms attack
  burstGain.gain.linearRampToValueAtTime(0.25, now + 0.05);  // settle
  burstGain.gain.linearRampToValueAtTime(0, now + burstLength); // fade out

  burstSource.connect(burstFilter);
  burstFilter.connect(burstGain);
  burstGain.connect(masterGain);
  burstSource.start(now);
  burstSource.stop(now + burstLength + 0.05);
}

// ============================================================================
// ORBIT ACHIEVED — Gentle C-E-G major chord
// ============================================================================

export function triggerOrbitAchieved() {
  if (!ctx || !initialized) return;

  // Silence any remaining engine sounds
  const now = ctx.currentTime;
  rumbleFilteredGain.gain.linearRampToValueAtTime(0, now + 0.2);
  rumbleOscGain1.gain.linearRampToValueAtTime(0, now + 0.2);
  rumbleOscGain2.gain.linearRampToValueAtTime(0, now + 0.2);
  rumbleOscGain3.gain.linearRampToValueAtTime(0, now + 0.2);
  humGain.gain.linearRampToValueAtTime(0, now + 0.2);
  windGain.gain.linearRampToValueAtTime(0, now + 0.2);

  // C major chord: C4=261.63, E4=329.63, G4=392.00
  const freqs = [261.63, 329.63, 392.00];
  const chordVolume = 0.08; // Gentle

  // Clean up any previous chord
  cleanupChord();

  const fadeIn = 0.5;
  const sustain = 2.0;
  const fadeOut = 1.0;
  const totalDuration = fadeIn + sustain + fadeOut;

  freqs.forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(chordVolume, now + fadeIn);
    gain.gain.setValueAtTime(chordVolume, now + fadeIn + sustain);
    gain.gain.linearRampToValueAtTime(0, now + totalDuration);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + totalDuration + 0.1);

    chordOscs.push(osc);
    chordGains.push(gain);
  });

  // Add a very quiet octave-up C5 for shimmer
  const shimmer = ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.value = 523.25; // C5
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.setValueAtTime(0, now);
  shimmerGain.gain.linearRampToValueAtTime(chordVolume * 0.3, now + fadeIn);
  shimmerGain.gain.setValueAtTime(chordVolume * 0.3, now + fadeIn + sustain);
  shimmerGain.gain.linearRampToValueAtTime(0, now + totalDuration);

  shimmer.connect(shimmerGain);
  shimmerGain.connect(masterGain);
  shimmer.start(now);
  shimmer.stop(now + totalDuration + 0.1);

  chordOscs.push(shimmer);
  chordGains.push(shimmerGain);

  // Auto-cleanup after chord ends
  setTimeout(() => cleanupChord(), (totalDuration + 0.2) * 1000);
}

function cleanupChord() {
  chordOscs.forEach(osc => {
    try { osc.stop(); } catch (_) { /* already stopped */ }
    try { osc.disconnect(); } catch (_) { /* already disconnected */ }
  });
  chordGains.forEach(g => {
    try { g.disconnect(); } catch (_) { /* already disconnected */ }
  });
  chordOscs = [];
  chordGains = [];
}

// ============================================================================
// MUTE / UNMUTE
// ============================================================================

export function setMuted(isMuted) {
  muted = isMuted;
  if (masterGain && ctx) {
    const now = ctx.currentTime;
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.05);
  }
}

export function isMuted() {
  return muted;
}

// ============================================================================
// CLEANUP — Stop all audio, close context
// ============================================================================

export function cleanup() {
  if (stagingTimeout) {
    clearTimeout(stagingTimeout);
    stagingTimeout = null;
  }

  cleanupChord();

  // Stop all persistent sources
  const sources = [rumbleNoise, windNoise];
  sources.forEach(src => {
    if (src) {
      try { src.stop(); } catch (_) {}
      try { src.disconnect(); } catch (_) {}
    }
  });

  const oscs = [rumbleOsc1, rumbleOsc2, rumbleOsc3, humOsc];
  oscs.forEach(osc => {
    if (osc) {
      try { osc.stop(); } catch (_) {}
      try { osc.disconnect(); } catch (_) {}
    }
  });

  if (ctx && ctx.state !== 'closed') {
    ctx.close().catch(() => {});
  }

  // Reset all references
  ctx = null;
  masterGain = null;
  rumbleNoise = null;
  rumbleNoiseGain = null;
  rumbleBandpass = null;
  rumbleFilteredGain = null;
  rumbleOsc1 = null;
  rumbleOsc2 = null;
  rumbleOsc3 = null;
  rumbleOscGain1 = null;
  rumbleOscGain2 = null;
  rumbleOscGain3 = null;
  windNoise = null;
  windBandpass = null;
  windGain = null;
  humOsc = null;
  humGain = null;
  chordOscs = [];
  chordGains = [];
  initialized = false;
  suspended = true;
  prevStage = -1;
  prevPhase = '';
  lastMachBelow1 = true;
  machSweepActive = false;
}
