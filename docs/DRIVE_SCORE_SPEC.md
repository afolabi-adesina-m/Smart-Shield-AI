# Drive Score — Design Spec (draft)

Status: DRAFT, docs only. No code changes yet.
Owner: Afolabi Adesina. In-house extension of the Smart-Shield-AI capstone (INFO53883).

## 1. Purpose

Drive Score gives each trip a 0–100 score for driving behaviour, using only the
phone's own sensors. It sits inside the existing Expo app (`mobile/`) and is
shown after a trip ends.

Smart-Shield already tells you how risky a **road** is. Drive Score adds how
the **driver** behaved on it. The two are shown side by side and never mixed.

### In scope
- Speed, hard braking (with severity in g), sharp turns, speeding against the
  posted limit, traffic lights passed and full stops at them.
- One score per trip, with thresholds per vehicle: car (the Drive travel mode),
  motorcycle, and truck. There is no truck travel mode yet.
- All maths on the phone. Works with no network once the trip has started.

### Out of scope
- Any change to the existing road-risk model, its training, or its scoring.
- Any change to existing files under `protected/` (append-only rule).
- Sending trip data to a server, insurers, or employers.
- Judging who was driving, or detecting phone use by name/app.
- Paid or keyed services. Only free, keyless sources already in the app.
- Bicycles, including the existing Cycle mode. Motor vehicles only for now.
- Branch `capstone-submitted` and tag `v1.0-capstone-submitted` are never touched.

## 2. Signals

Sensors come from `expo-sensors` (Accelerometer, Gyroscope, DeviceMotion) and
`expo-location` (already installed).

| Signal | Sensor | Sample rate | Filtering | Detection rule |
|---|---|---|---|---|
| Speed | GPS (`expo-location`, `BestForNavigation`) | 1 Hz | Drop fixes with accuracy worse than 20 m; drop jumps implying > 1.5× vehicle max speed | Use `coords.speed` (m/s → km/h). If missing, distance / time between good fixes. |
| Longitudinal accel (braking) | DeviceMotion `acceleration` (gravity removed) | 50 Hz | 0.5 s moving average; project onto direction of travel (see §2.1) | **Hard brake** event when deceleration ≥ T_brake_hard for ≥ 0.5 s while speed ≥ 15 km/h. **Harsh** if peak ≥ T_brake_harsh. One event ends when decel < 0.1 g for 1 s. |
| Brake check by GPS (cross-check) | GPS | 1 Hz | none | Speed drop ≥ T_brake_gps km/h/s over 2 s confirms an accel event. Without GPS confirmation, event is logged "unconfirmed" and not scored. |
| Sharp turn | Gyroscope yaw rate + GPS speed | 50 Hz | 0.5 s moving average | Lateral g = yaw rate (rad/s) × speed (m/s) / 9.81. **Sharp turn** when lateral ≥ T_turn for ≥ 0.5 s at speed ≥ 15 km/h. |
| Speeding | GPS speed + posted limit (`posted_kmh` on the speed reading) | 1 Hz | Ignore when no posted limit known | Speeding second when speed > limit + T_speed_margin. **Speeding episode** when ≥ 10 s continuous. |
| Traffic light passed | GPS track + `traffic_signals` nodes from `mobile/src/roadSigns.ts` (OSM Overpass) | 1 Hz | Snap only when fix accuracy ≤ 20 m | Light "passed" when the track comes within T_light_radius m of a node and then moves away > T_light_radius. |
| Full stop at light | GPS speed | 1 Hz | none | Full stop when speed ≤ T_stop_speed km/h for ≥ 2 s within T_light_radius m before the light. Counted, not penalised (a green light needs no stop). |

The posted limit the app already uses for over-speed alerts is `posted_kmh`
(`speed.posted_kmh` in `mobile/App.tsx`). `warningFor` compares current speed
to that value. `alertOverLimit()` in `mobile/src/overSpeedAlert.ts` only plays
the beep or vibration and does not take a limit. `postedKmh` is the
camera-phrase option in `mobile/src/cameras.ts`, not this field.

### 2.1 Direction of travel (mount-independent)
The phone can sit in any position. To find "forward":
1. Gravity vector = 5 s low-pass of raw accelerometer → defines "down".
2. During the first 3 GPS-confirmed speed-ups (> 1 m/s² by GPS), the average
   horizontal accel direction defines "forward".
3. Until calibrated, braking and turns are not scored (shown as "calibrating").
4. If gravity direction changes by > 30° (phone moved), calibration restarts.

## 3. Threshold table

Every number the code uses lives in one file: `mobile/src/driveScore/thresholds.ts`.
No published standard was checked for these values. **All are initial
estimates, to be calibrated** with real drives (§7.2). No citations are claimed.
Columns are car (Drive), motorcycle, and truck. Bicycles are out of scope.

| ID | Meaning | Car | Motorcycle | Truck | Source |
|---|---|---|---|---|---|
| T_brake_hard | Hard brake decel (g) | 0.30 | 0.30 | 0.25 | Initial estimate, to be calibrated |
| T_brake_harsh | Harsh brake peak (g) | 0.45 | 0.45 | 0.35 | Initial estimate, to be calibrated |
| T_brake_gps | GPS speed drop confirming a brake (km/h per s) | 10 | 10 | 8 | Initial estimate, to be calibrated |
| T_turn | Sharp turn lateral (g) | 0.35 | 0.30 | 0.25 | Initial estimate, to be calibrated |
| T_speed_margin | Allowed over posted limit (km/h) | 5 | 5 | 5 | Initial estimate, to be calibrated |
| T_light_radius | Match radius to a light (m) | 30 | 30 | 35 | Initial estimate, to be calibrated |
| T_stop_speed | "Stopped" speed (km/h) | 3 | 3 | 3 | Initial estimate, to be calibrated |
| Min speed for events | (km/h) | 15 | 15 | 15 | Initial estimate, to be calibrated |
| GPS accuracy cut-off | (m) | 20 | 20 | 20 | Initial estimate, to be calibrated |
| Min scorable trip | (km / min) | 1 km and 3 min | same | same | Initial estimate, to be calibrated |

## 4. Scoring formula

Events are normalised per 10 km so long trips are not punished for length.

```
km10 = max(trip_km, 1) / 10

P_brake   = 4 × hard_brakes/km10 + 8 × harsh_brakes/km10      (cap 40)
P_turn    = 3 × sharp_turns/km10                              (cap 20)
P_speed   = 30 × (speeding_seconds / moving_seconds)
          + 2 × speeding_episodes/km10                        (cap 30)
score     = round( clamp(100 − P_brake − P_turn − P_speed, 0, 100) )
```

- A harsh brake also counts as hard brake? **No.** Each event is one or the
  other (harsh replaces hard), so there is no double counting.
- Traffic-light numbers, including full stops, are shown but carry **no** points.
- Weights (4, 8, 3, 30, 2) and caps (40, 20, 30) are the initial v1 estimates,
  accepted for v1 and to be calibrated later.
- Bands: 90–100 Excellent, 75–89 Good, 50–74 Fair, < 50 Needs work.

### Worked example (car)
Trip: 12 km, 20 min, 18 min moving (1080 s).
2 hard brakes, 1 harsh brake, 3 sharp turns, 54 s speeding, 1 speeding episode,
9 lights passed, 4 full stops.

- km10 = 1.2
- P_brake = 4 × 2/1.2 + 8 × 1/1.2 = 6.67 + 6.67 = 13.33
- P_turn  = 3 × 3/1.2 = 7.50
- P_speed = 30 × 54/1080 + 2 × 1/1.2 = 1.50 + 1.67 = 3.17
- score = round(100 − 13.33 − 7.50 − 3.17) = round(76.0) = **76 (Good)**
- Shown: "9 lights passed, stopped at 4".

## 5. Data flow and privacy

```
sensors → ring buffer (RAM, last 10 s) → event detectors → trip summary
GPS     → filtered track (RAM)       ↗                      ↓
                                               AsyncStorage (on device only)
```

- Nothing is uploaded. No new network calls; traffic lights come from the
  Overpass query the app already makes.
- Stored per trip (AsyncStorage key `smartshield.driveScore.v1`): date, vehicle,
  km, minutes, score, event counts, and each event's time, type, peak g and
  rounded location (3 decimals ≈ 100 m).
- **Not** stored: raw sensor streams or the full GPS track.
- Retention: last 50 trips or 90 days of trip summaries, whichever is fewer
  (confirmed 2026-10-23). "Delete all trips" button in Settings. Uninstalling
  the app removes everything.
- Recording starts automatically when navigation starts in Drive or Motorcycle
  mode, and in truck mode once that mode exists. A Recording badge stays
  visible while a trip is recording. Settings has a switch to turn Drive Score
  off.
- Debug fixture recording (§7) is a developer-only switch, off in release.

## 6. Build plan (phased, file-level)

| Phase | Files | What |
|---|---|---|
| 0 | `docs/DRIVE_SCORE_SPEC.md` | This spec. Review only. |
| 1 | `mobile/src/driveScore/thresholds.ts`, `score.ts`, `detectors.ts`, `orientation.ts`, `lightMatch.ts`; `demo/test_drive_score_client.js` + `demo/fixtures/drive_score/*.json` | Pure functions, no UI, no sensors. Unit tests on recorded fixtures. |
| 2 | `mobile/src/driveScore/recorder.ts`; `mobile/package.json` (+`expo-sensors`) | Sensor subscription, ring buffer, calibration. Dev-only fixture export. |
| 3 | `mobile/src/driveScore/DriveScoreCard.tsx`, `tripStore.ts`; small hooks in `mobile/App.tsx` (trip start/end), Settings switch | Trip summary screen, history, delete button. Recording follows navigation in Drive or Motorcycle (truck once that mode exists) unless the Settings switch is off. |
| 4 | `docs/DRIVE_SCORE_SPEC.md` (threshold table update) | Real-drive calibration; thresholds updated with measured values and a change log. |

Untouched: `protected/`, server scoring, model files, `mobile/src/overSpeedAlert.ts`
behaviour (only read from), `driverLock.ts` behaviour.

## 7. Test and validation plan

### 7.1 Unit tests (Phase 1)
Recorded fixtures: JSON with `{t, ax, ay, az, gx, gy, gz}` at 50 Hz and
`{t, lat, lon, speed, accuracy}` at 1 Hz, plus expected results.
- Synthetic: steady cruise (0 events), one 0.35 g brake (1 hard), one 0.5 g
  brake (1 harsh, 0 hard), 0.2 s spike (0 events — too short), turn at 0.4 g
  (1 sharp turn), 60 s at limit+10 (1 episode), stop at light (1 passed, 1 stop),
  bad-accuracy fixes (ignored).
- Phone mounted three ways (flat, upright, sideways) give the same event counts.
- Worked example in §4 reproduces exactly 76.
- Boundary tests: exactly at threshold counts; just below does not.

### 7.2 Real-drive calibration checklist
- [ ] Same route driven 3× with phone in 3 mounts; counts agree within ±1.
- [ ] Planned hard stops from 50 km/h counted; gentle stops not counted.
- [ ] Compare GPS speed to vehicle speedometer at 30/50/80 km/h (note offset).
- [ ] 10 signalised intersections logged by hand vs app count.
- [ ] Speeding seconds checked on a road with a known posted limit.
- [ ] Repeat for motorcycle, and for truck once that travel mode exists.
- [ ] Record every threshold change in the table with date and reason.

## 8. Known limitations
- Phone loose in a cup holder or pocket adds noise; mount recommended.
- GPS speed lags ~1 s and drifts in tunnels and downtown towers.
- OSM traffic-light and speed-limit data can be missing or out of date.
- "Full stop at light" cannot know if the light was red or green.
- Sharp turns from roundabouts or lane changes on slow roads may be counted.
- Passenger phones will score the driver's driving — the score is about the trip, not a person.
- Battery: 50 Hz sensors + GPS add drain; recorder stops when the trip ends.
- Not an insurance-grade or legal measure.

## 9. Open decisions
1. **Resolved (2026-10-23).** Full stops at lights are information only, with no score points.
2. **Accepted for v1, calibrate later.** Penalty weights and caps stay the estimates above.
3. **Resolved (2026-10-23).** Bicycles are out of scope. Score motor vehicles only: car, motorcycle, truck.
4. **Resolved (2026-10-23).** Recording starts automatically when navigation starts in Drive or Motorcycle mode (truck once that mode exists). A Recording badge stays visible, and Settings can turn Drive Score off.
5. **Resolved (2026-10-23).** Retention of 50 trips / 90 days of trip summaries is confirmed.

## Decisions (2026-10-23)
1. Full stops at lights are information only. They do not change the score.
2. Weights and caps stay the initial v1 estimates and will be calibrated later.
3. Scope is motor vehicles only: car, motorcycle, and truck. The bicycle column and bicycle rules are removed. Bicycles are out of scope for now.
4. Recording starts automatically when navigation starts in Drive or Motorcycle mode, and in truck mode once that mode exists. A Recording badge stays visible. Settings has a switch to turn Drive Score off.
5. Retention of 50 trips or 90 days of trip summaries, whichever is fewer, is confirmed.
