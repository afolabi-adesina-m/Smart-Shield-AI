# Drive Score phase 1

Pure functions for `docs/DRIVE_SCORE_SPEC.md`. No sensors, recorder, storage, or UI.
This does not call the existing road-risk score.

| Function | File | Spec |
|---|---|---|
| `VEHICLE_ESTIMATES`, `SHARED_ESTIMATES`, `limitsFor` | `thresholds.ts` | §3 table and §4 weights. Each value is labelled `Initial estimate, to be calibrated`. |
| `orientTrip` | `orientation.ts` | §2.1. Brakes and turns wait for three GPS speed-ups. A gravity swing over 30° recalibrates. |
| `detectTrip`, `classifyBrake`, `classifyTurn`, `isSpeeding`, `acceptFixes` | `detectors.ts` | §2 braking (peak g is the severity), sharp turns, and speeding against `posted_kmh`. An unconfirmed brake is not scored. |
| `matchLights` | `lightMatch.ts` | §2 lights passed and full stops. Information only. |
| `scoreTrip`, `bandFor` | `score.ts` | §4 formula, caps, and bands. Under 1 km or 3 min, no score. |

`TRUCK_PLACEHOLDER` marks the truck column: there is no truck travel mode yet.
Car is Drive. Bicycles are out of scope.

Run `node demo/test_drive_score_client.js`. The test builds the sample trips in code.
