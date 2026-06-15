// ============================================================================
// TIMELINE — Mission timeline bar with milestones
// ============================================================================

const TIMELINE_MILESTONES = [
  { key: 'LIFTOFF', label: 'LIFTOFF', estTime: 0 },
  { key: 'MAX-Q', label: 'MAX-Q', estTime: 60 },
  { key: 'MECO', label: 'MECO', estTime: 150 },
  { key: 'SEP', label: 'STG SEP', estTime: 155 },
  { key: 'SES', label: 'SES', estTime: 160 },
  { key: 'SECO', label: 'SECO', estTime: 480 },
  { key: 'ORBIT', label: 'ORBIT', estTime: 600 },
];

let estimatedFlightDuration = 600;
let timelineReached = new Set();
let timelineEventTimes = {};
let timelineMilestones = [];

/**
 * Build the mission timeline bar with milestone markers.
 * @param {number} numStages
 * @param {Object} rocket - rocket object with stages[].burnTime
 */
export function buildMissionTimeline(numStages, rocket) {
  const container = document.getElementById('timeline-events');
  if (!container) return;
  container.innerHTML = '';
  timelineReached = new Set();
  timelineEventTimes = {};

  // Estimate total flight duration from burn times
  const stages = rocket?.stages || [];
  let totalBurn = 0;
  stages.forEach(s => { totalBurn += (s.burnTime || 120); });
  estimatedFlightDuration = Math.max(300, totalBurn * 1.3);

  const milestones = TIMELINE_MILESTONES.filter(m => {
    if (numStages < 3 && m.key === 'FAIRING') return false;
    return true;
  });
  timelineMilestones = milestones;

  milestones.forEach(m => {
    const pct = Math.min(100, (m.estTime / estimatedFlightDuration) * 100);
    const el = document.createElement('div');
    el.className = 'timeline-event';
    el.id = `tl-${m.key}`;
    el.style.left = pct + '%';
    el.textContent = m.label;
    container.appendChild(el);
  });

  // Mark liftoff immediately
  timelineReached.add('LIFTOFF');
  timelineEventTimes['LIFTOFF'] = 0;
  const liftoffEl = document.getElementById('tl-LIFTOFF');
  if (liftoffEl) liftoffEl.classList.add('reached');
}

/**
 * Check an event message against milestones and illuminate if matched.
 */
export function updateTimeline(eventMsg, simTime) {
  if (!timelineMilestones) return;
  const msg = eventMsg.toUpperCase();

  for (const m of timelineMilestones) {
    let matched = false;
    if (m.key === 'SES' && msg.includes('IGNITION') && !msg.includes('STAGE 1')) matched = true;
    else if (m.key === 'ORBIT' && (msg.includes('ORBIT') || msg.includes('INSERTION'))) matched = true;
    else if (msg.includes(m.key)) matched = true;

    if (matched && !timelineReached.has(m.key)) {
      timelineReached.add(m.key);
      timelineEventTimes[m.key] = simTime;
      const el = document.getElementById(`tl-${m.key}`);
      if (el) el.classList.add('reached');
      if (m.key === 'MECO' && simTime > 0) {
        estimatedFlightDuration = Math.max(estimatedFlightDuration, simTime * 2.5);
      }
    }
  }
}

/**
 * Update the timeline progress bar each frame.
 */
export function updateTimelineProgress(simTime) {
  if (!timelineMilestones) return;
  const pct = Math.min(100, (simTime / estimatedFlightDuration) * 100);
  const prog = document.getElementById('timeline-progress');
  if (prog) prog.style.width = pct + '%';

  for (const m of timelineMilestones) {
    const mPct = Math.min(100, (m.estTime / estimatedFlightDuration) * 100);
    if (pct >= mPct && !timelineReached.has(m.key)) {
      timelineReached.add(m.key);
      const el = document.getElementById(`tl-${m.key}`);
      if (el) el.classList.add('reached');
    }
  }
}

export function getTimelineState() {
  return { timelineReached, timelineEventTimes, timelineMilestones };
}
