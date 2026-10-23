# Drive Score phase 1

Pure functions for the draft in `docs/DRIVE_SCORE_SPEC.md`. No sensors, no recorder,
no storage, and no UI. Existing road-risk scoring is not used here.

| Function | File | Spec |
|---|---|---|
| `estimate`, `VEHICLE_ESTIMATES`, `SHARED_ESTIMATES`, `limitsFor` | `thresholds.ts` | §3 threshold table, §4 weights and caps. Every estimate is labelled `Initial estimate, to be calibrated`. |
| `orientTrip` | `orientation.ts` | §2.1 mount-independent forward axis. Braking and turns stay unscored until three GPS speed-ups calibrate it. A gravity swing over 30° starts calibration again. |
| `classifyBrake`, `classifyTurn`, `isSpeeding`, `acceptFixes`, `detectTrip` | `detectors.ts` | §2 hard and harsh braking (peak g is the severity), sharp turns, speeding seconds and episodes against `posted_kmh`. A brake without the GPS speed drop is returned unconfirmed and is not counted in the score. |
| `matchLights`, `haversineM` | `lightMatch.ts` | §2 traffic lights passed and full stops. Information only. |
| `scoreTrip`, `bandFor`, `lightsShown` | `score.ts` | §4 formula, caps, rounding, and bands. Light counts are shown and do not change the score. A trip under 1 km or 3 min has no score. |

Truck values are in the table and marked with `TRUCK_PLACEHOLDER`. There is no truck
travel mode yet. Car is the Drive mode. Bicycles are out of scope.

Motion fixtures use g (gravity included) and rad/s. GPS `speed` is km/h and
`posted_kmh` is the same field the app already uses for over-speed alerts.
`maxSpeedKmh` is an estimate because §2 drops impossible jumps but does not
publish a vehicle maximum.

Tests: `node demo/test_drive_score_client.js`. Fixtures live in
`demo/fixtures/drive_score/`. `generate.mjs` in that folder rebuilds the
synthetic traces; the test reads the JSON.
