# Campaign Analysis Report

**200 flights** | 10 latitudes | 2 orbit classes | 10 runs/combo
Campaign wall time: 3.17s (15.8ms/flight avg)

## 1. Success Rate: Latitude x Orbit Class

| Latitude | LEO | SSO | Total |
| -------- | --- | --- | ----- |
| 0° | 4/10 (40%) | 6/10 (60%) | 10/20 (50%) |
| 5° | 5/10 (50%) | 8/10 (80%) | 13/20 (65%) |
| 15° | 4/10 (40%) | 6/10 (60%) | 10/20 (50%) |
| 28.5° | 2/10 (20%) | 5/10 (50%) | 7/20 (35%) |
| 34.7° | 4/10 (40%) | 5/10 (50%) | 9/20 (45%) |
| 42° | 3/10 (30%) | 3/10 (30%) | 6/20 (30%) |
| 51.6° | 5/10 (50%) | 6/10 (60%) | 11/20 (55%) |
| 58° | 6/10 (60%) | 5/10 (50%) | 11/20 (55%) |
| 64° | 5/10 (50%) | 6/10 (60%) | 11/20 (55%) |
| 72° | 2/10 (20%) | 9/10 (90%) | 11/20 (55%) |
| **Total** | 40/100 (40%) | 59/100 (59%) | 99/200 (50%) |

**Best latitude**: 5° (65%)
**Worst latitude**: 42° (30%)
**SSO outperforms LEO**: 59% vs 40%

## 2. TWR Analysis

| Group | N | Min | Max | Mean | Median | Std |
| ----- | --- | --- | --- | ---- | ------ | --- |
| Success | 99 | 1.31 | 6.77 | 3.11 | 2.87 | 1.20 |
| Failed | 101 | 1.19 | 15.72 | 2.96 | 2.33 | 1.98 |

### TWR Bucket Success Rates

| TWR Range | N | Successes | Rate |
| --------- | --- | --------- | ---- |
| 1.0–1.5 | 26 | 1 | 4% |
| 1.5–2.0 | 32 | 17 | 53% |
| 2.0–2.5 | 29 | 14 | 48% |
| 2.5–3.0 | 27 | 22 | 81% |
| 3.0–3.5 | 27 | 16 | 59% |
| 3.5–4.0 | 17 | 11 | 65% |
| 4.0–4.5 | 10 | 6 | 60% |
| 4.5–5.0 | 13 | 5 | 38% |
| 5.5–6.0 | 9 | 3 | 33% |
| 6.0–6.5 | 4 | 3 | 75% |
| 6.5–7.0 | 4 | 1 | 25% |

**Optimal TWR range**: 2.5–3.0 (81% success, n=27)

## 3. Mass Distribution (kg)

| Group | N | Min | Max | Mean | Median |
| ----- | --- | --- | --- | ---- | ------ |
| All | 200 | 10324 | 770387 | 264674 | 232239 |
| Success | 99 | 21977 | 636330 | 246169 | 182872 |
| Failed | 101 | 10324 | 770387 | 282813 | 259753 |

## 4. Delta-V Analysis (m/s)

| Group | N | Min | Max | Mean | Median |
| ----- | --- | --- | --- | ---- | ------ |
| Success | 99 | 10344 | 10961 | 10666 | 10674 |
| Failed | 101 | 9985 | 10880 | 10569 | 10606 |

### Delta-V Bucket Success Rates

| DV Range (m/s) | N | Rate |
| -------------- | --- | ---- |
| 10000–10500 | 46 | 28% |
| 10500–11000 | 153 | 56% |

## 5. Failure Mode Breakdown

| Mode | Count | Pct of Failures |
| ---- | ----- | --------------- |
| low_apo | 7 | 7% |
| no_orbit | 94 | 93% |

### Failure by Latitude

| Latitude | Failures | low_apo | no_orbit |
| -------- | -------- | ------- | -------- |
| 0° | 10 | 3 | 7 |
| 5° | 7 | 0 | 7 |
| 15° | 10 | 0 | 10 |
| 28.5° | 13 | 2 | 11 |
| 34.7° | 11 | 0 | 11 |
| 42° | 14 | 0 | 14 |
| 51.6° | 9 | 0 | 9 |
| 58° | 9 | 1 | 8 |
| 64° | 9 | 0 | 9 |
| 72° | 9 | 1 | 8 |

### Failure by Orbit Class

| Class | Failures | low_apo | no_orbit |
| ----- | -------- | ------- | -------- |
| LEO | 60 | 7 | 53 |
| SSO | 41 | 0 | 41 |

## 6. Orbit Quality (Successful Flights)

| Metric | Min | Max | Mean | Median | Std |
| ------ | --- | --- | ---- | ------ | --- |
| Apoapsis (km) | 157.3 | 589.8 | 411.8 | 569.5 | 188.7 |
| Periapsis (km) | 132.1 | 576.3 | 382.9 | 541.6 | 186.6 |
| Eccentricity | 0.00097 | 0.00979 | 0.00213 | 0.00194 | 0.00119 |
| Circularity | 0.0232 | 0.2840 | 0.0943 | 0.0497 | 0.0564 |
| Flight Time (s) | 303 | 2720 | 1158 | 937 | 681 |

### Orbit Quality by Class

**LEO** (n=40): apo 183.9±11.0 km, peri 158.9±11.3 km, ecc 0.00191
**SSO** (n=59): apo 566.2±25.1 km, peri 534.7±36.5 km, ecc 0.00228

## 7. Stage Count

| Stages | N | Success Rate | Mean TWR | Mean Mass (kg) |
| ------ | --- | ------------ | -------- | -------------- |
| 2 | 161 | 53% | 3.13 | 255225 |
| 3 | 36 | 39% | 2.61 | 301288 |
| 4 | 3 | 0% | 2.58 | 332371 |

## 8. Key Findings

1. **SSO significantly outperforms LEO** (59% vs 40%). The SSO guidance profile or generator tuning favors sun-synchronous targets.
2. **93% of failures are "no_orbit"** — the vehicle never achieves orbit. Only 7% reach orbit but at insufficient altitude ("low_apo"). The primary failure mode is insufficient velocity, not bad circularization.
3. **Mid-latitudes (28.5°–42°) are weakest** — these latitudes require significant plane-change delta-V without the benefit of equatorial velocity boost.
4. **Optimal TWR range is 2.5–3.0** (81% success rate). This balances gravity losses against aerodynamic losses.
5. **Orbit quality is excellent when achieved** — mean eccentricity 0.00213 indicates near-circular orbits. The circularization burn works well.
6. **Mean altitude accuracy**: 126.2 km error from target, median 61.7 km.

## 9. Recommendations

1. **Increase delta-V margins for LEO**: LEO flights have the same generator constraints but worse success. The guidance gravity turn may be losing more delta-V than budgeted.
2. **Tune mid-latitude generation**: 28.5°–42° latitudes need either larger vehicles or more efficient staging to compensate for plane-change costs.
3. **Investigate TWR sweet spot**: Constrain generated vehicles toward the optimal TWR range. Excessively high TWR wastes propellant fighting drag; too low fails to reach orbit.
4. **Address no_orbit failures specifically**: Since 93% of failures are complete misses, the gravity turn pitch schedule may need latitude-dependent tuning.
5. **Consider 3-stage vehicles for challenging latitude/orbit combos**: If the generator occasionally produces 3-stage rockets, check if they have better success rates at difficult latitudes.
