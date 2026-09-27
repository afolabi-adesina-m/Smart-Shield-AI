/* Fleet trip log: street and exit warnings, driver score, CSV export.
   Highway safe speed still comes from the speed panel's existing rule. */

const FLEET_LABELS = {
  over_posted: "Over posted limit",
  above_safe: "Above safe speed",
  school_speeding: "School zone speeding",
  missed_bump: "Did not slow for bump",
  missed_signal: "Did not slow for signal",
  missed_stop: "Did not slow for stop",
  missed_exit: "Did not slow for exit",
  missed_crosswalk: "Did not slow for crosswalk",
  harsh_brake: "Harsh braking",
  harsh_accel: "Harsh acceleration",
};

const FLEET_ICONS = {
  traffic_signal: "🚦",
  stop_sign: "🛑",
  speed_bump: "⚠",
  school_zone: "🏫",
  crosswalk: "🚶",
};

let fleetRules = null;
let fleetRoute = null;
let fleetEvents = [];
let fleetScore = 100;
let fleetOpen = {};
let fleetLogged = {};
let fleetTrack = {};
let fleetTrackKind = {};
let fleetExitFast = false;
let fleetPrevExit = false;
let fleetLastSim = null;
let fleetLastSpeed = null;
let fleetLastSample = null;
let fleetPending = [];
let fleetPlaying = false;
let fleetStop = false;
let fleetRouteLine = null;
let fleetIconLayer = null;
let fleetIconMarkers = [];

const fleetRulesPromise = fetch("/api/street-rules")
  .then((resp) => resp.json())
  .then((data) => {
    fleetRules = data;
    const formula = document.getElementById("fleet-formula-text");
    if (formula && data.score && data.score.formula) formula.textContent = data.score.formula;
    if (fleetPending.length) observeFleet(fleetPending[fleetPending.length - 1]);
    fleetPending = [];
    return data;
  })
  .catch(() => {
    fleetPending = [];
    return null;
  });

document.addEventListener("smartshield:road", (event) => {
  const detail = event.detail || {};
  if (!fleetRules) {
    fleetPending.push(detail);
    return;
  }
  observeFleet(detail);
});

document.addEventListener("smartshield:usermove", () => {
  fleetStop = true;
  fleetPlaying = false;
  const btn = document.getElementById("fleet-play");
  if (btn) btn.textContent = "Play 403 exit demo";
});

document.addEventListener("DOMContentLoaded", () => {
  const play = document.getElementById("fleet-play");
  const csv = document.getElementById("fleet-csv");
  const reset = document.getElementById("fleet-reset");
  if (play) play.addEventListener("click", () => { playFleet().catch((err) => setFleetStatus(err.message)); });
  if (csv) csv.addEventListener("click", exportFleetCsv);
  if (reset) reset.addEventListener("click", () => resetFleet());
  renderFleet();
});

function setFleetStatus(text) {
  const el = document.getElementById("fleet-status");
  if (el) el.textContent = text || "";
}

function missKind(kind) {
  if (kind === "speed_bump") return "missed_bump";
  if (kind === "traffic_signal") return "missed_signal";
  if (kind === "stop_sign") return "missed_stop";
  if (kind === "crosswalk") return "missed_crosswalk";
  return null;
}

function fleetEvent(kind, detail, sample) {
  const when = sample.sim_ms != null ? sample.sim_ms : Date.now();
  return {
    time_iso: new Date(when).toISOString(),
    lat: roundFleet(sample.lat, 6),
    lon: roundFleet(sample.lon, 6),
    kind,
    detail,
    speed_kmh: sample.current_kmh,
    posted_kmh: sample.posted_kmh,
    safe_kmh: sample.safe_kmh,
    road_mode: sample.road_mode || "",
  };
}

function roundFleet(value, digits) {
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  return Number(n.toFixed(digits));
}

function recomputeFleetScore() {
  const start = fleetRules.score.start;
  let score = start;
  const penalties = fleetRules.score.penalties;
  fleetEvents.forEach((event) => {
    score -= penalties[event.kind] || 0;
  });
  fleetScore = Math.max(0, Math.min(100, score));
}

function pulseFleet(key, on, makeEvent) {
  if (on) {
    if (!fleetOpen[key]) {
      fleetOpen[key] = true;
      fleetEvents.push(makeEvent());
      recomputeFleetScore();
    }
  } else {
    fleetOpen[key] = false;
  }
}

function logFleetOnce(key, event) {
  if (fleetLogged[key]) return;
  fleetLogged[key] = true;
  fleetEvents.push(event);
  recomputeFleetScore();
}

function finishFleetPassing(sample) {
  Object.keys(fleetTrack).forEach((id) => {
    const state = fleetTrack[id];
    if (!state || !state.tooFast) return;
    const kind = missKind(fleetTrackKind[id]);
    const cap = fleetRules.caps[fleetTrackKind[id]];
    if (!kind || !cap) return;
    logFleetOnce("miss:" + id, fleetEvent(kind, `Passed ${cap.label} without slowing`, sample || fleetLastSample || {}));
    state.tooFast = false;
  });
  if (fleetExitFast) {
    logFleetOnce("missed_exit", fleetEvent("missed_exit", "Did not slow for the exit ramp", sample || fleetLastSample || {}));
    fleetExitFast = false;
  }
}

function observeFleet(sample) {
  if (!sample || sample.posted_kmh == null || sample.current_kmh == null) return;
  if (sample.sim_ms != null && sample.sim_ms === fleetLastSim && sample.current_kmh === fleetLastSpeed) return;

  const speed = Number(sample.current_kmh);
  const dt = fleetLastSim != null && sample.sim_ms != null ? (sample.sim_ms - fleetLastSim) / 1000 : null;
  const harshOk = sample.source === "fleet-demo" || sample.source === "gps";
  if (harshOk && dt > 0 && dt <= 5 && fleetLastSpeed != null) {
    const rate = (speed - fleetLastSpeed) / dt;
    const brakeAt = fleetRules.score.harsh_brake_kmh_per_s;
    const accelAt = fleetRules.score.harsh_accel_kmh_per_s;
    pulseFleet("harsh_brake", rate <= -brakeAt, () => fleetEvent(
      "harsh_brake",
      `Speed dropped ${Math.abs(Math.round(rate))} km/h in 1 s`,
      sample
    ));
    pulseFleet("harsh_accel", rate >= accelAt, () => fleetEvent(
      "harsh_accel",
      `Speed rose ${Math.round(rate)} km/h in 1 s`,
      sample
    ));
  }

  const schoolCap = fleetRules.caps.school_zone;
  const school = !!(sample.school_active && schoolCap && speed > schoolCap.safe_kmh);
  pulseFleet("over_posted", sample.warning === "red", () => fleetEvent(
    "over_posted",
    `${speed} km/h in a ${sample.posted_kmh} zone`,
    sample
  ));
  pulseFleet("school_speeding", school, () => fleetEvent(
    "school_speeding",
    `${speed} km/h in a school zone`,
    sample
  ));
  pulseFleet("above_safe", sample.warning === "amber" && !school, () => fleetEvent(
    "above_safe",
    `${speed} km/h above safe ${sample.safe_kmh}`,
    sample
  ));

  const exitOn = !!(sample.exit_warning && sample.exit_warning.text);
  if (exitOn && speed > fleetRules.exit_warning.slow_below_kmh) fleetExitFast = true;
  if (!exitOn && fleetPrevExit && fleetExitFast) {
    logFleetOnce("missed_exit", fleetEvent("missed_exit", "Did not slow for the exit ramp", sample));
    fleetExitFast = false;
  }
  fleetPrevExit = exitOn;

  const seen = new Set();
  (sample.hazards || []).forEach((hazard) => {
    if (!hazard || !hazard.id) return;
    seen.add(hazard.id);
    const cap = fleetRules.caps[hazard.kind];
    if (!cap) return;
    const state = fleetTrack[hazard.id] || { tooFast: false, min: 1e9 };
    state.min = Math.min(state.min, Number(hazard.distance_m));
    if (Number(hazard.distance_m) <= cap.pass_m && speed > cap.slow_below_kmh) state.tooFast = true;
    fleetTrack[hazard.id] = state;
    fleetTrackKind[hazard.id] = hazard.kind;
  });
  Object.keys(fleetTrack).forEach((id) => {
    if (seen.has(id) || !fleetTrack[id].tooFast) return;
    const kind = missKind(fleetTrackKind[id]);
    const cap = fleetRules.caps[fleetTrackKind[id]];
    if (!kind || !cap) return;
    logFleetOnce("miss:" + id, fleetEvent(kind, `Passed ${cap.label} without slowing`, sample));
    fleetTrack[id].tooFast = false;
  });

  fleetLastSim = sample.sim_ms != null ? sample.sim_ms : null;
  fleetLastSpeed = speed;
  fleetLastSample = sample;
  renderFleet(sample);
  drawFleetIcons(sample);
}

function renderFleet(sample) {
  const scoreEl = document.getElementById("fleet-score");
  if (scoreEl) {
    scoreEl.textContent = String(fleetScore);
    scoreEl.classList.remove("warn", "poor");
    if (fleetScore < 60) scoreEl.classList.add("poor");
    else if (fleetScore < 85) scoreEl.classList.add("warn");
  }
  const modeEl = document.getElementById("fleet-mode");
  if (modeEl) modeEl.textContent = sample && sample.road_mode ? sample.road_mode : "NO TRIP YET";
  const hazardEl = document.getElementById("fleet-hazard");
  if (hazardEl) {
    const lines = [];
    if (sample && sample.exit_warning && sample.exit_warning.text) lines.push(sample.exit_warning.text);
    (sample && sample.hazards ? sample.hazards : []).forEach((hazard) => {
      lines.push(`${hazard.label} ahead in ${hazard.distance_m} m`);
    });
    hazardEl.textContent = lines.join(" · ");
  }
  const list = document.getElementById("fleet-events");
  if (list) {
    const rows = fleetEvents.slice().reverse().slice(0, 12);
    if (!rows.length) {
      list.innerHTML = "<li>No safety events yet. Play the 403 demo.</li>";
    } else {
      list.innerHTML = rows.map((event) => (
        `<li><strong>${escapeFleet(FLEET_LABELS[event.kind] || event.kind)}</strong>` +
        `<span>${escapeFleet(event.detail)}</span></li>`
      )).join("");
    }
  }
}

function escapeFleet(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function drawFleetIcons(sample) {
  const map = window.SmartShieldMap && window.SmartShieldMap();
  if (!map || typeof L === "undefined") return;
  if (!fleetIconLayer) fleetIconLayer = L.layerGroup().addTo(map);
  fleetIconMarkers.forEach((marker) => fleetIconLayer.removeLayer(marker));
  fleetIconMarkers = [];
  (sample.hazards || []).slice(0, 4).forEach((hazard) => {
    if (hazard.lat == null || hazard.lon == null) return;
    const icon = L.divIcon({
      className: "fleet-divicon",
      html: `<div class="fleet-icon" title="${escapeFleet(hazard.label)}">${FLEET_ICONS[hazard.kind] || "•"}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const marker = L.marker([hazard.lat, hazard.lon], { icon, interactive: false });
    marker.addTo(fleetIconLayer);
    fleetIconMarkers.push(marker);
  });
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function fleetCsvText() {
  const header = ["time_iso", "lat", "lon", "kind", "detail", "speed_kmh", "posted_kmh", "safe_kmh", "road_mode"];
  const lines = [header.join(",")];
  fleetEvents.forEach((event) => {
    lines.push(header.map((key) => csvEscape(event[key])).join(","));
  });
  return lines.join("\n");
}

function exportFleetCsv() {
  const blob = new Blob([fleetCsvText()], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "smart-shield-trip.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setFleetStatus(`Exported ${fleetEvents.length} events.`);
}

function resetFleet(options) {
  fleetStop = true;
  fleetEvents = [];
  fleetScore = 100;
  fleetOpen = {};
  fleetLogged = {};
  fleetTrack = {};
  fleetTrackKind = {};
  fleetExitFast = false;
  fleetPrevExit = false;
  fleetLastSim = null;
  fleetLastSpeed = null;
  fleetLastSample = null;
  if (!options || !options.keepRoute) {
    if (fleetRouteLine && window.SmartShieldMap) {
      const map = window.SmartShieldMap();
      if (map) map.removeLayer(fleetRouteLine);
    }
    fleetRouteLine = null;
  }
  fleetIconMarkers.forEach((marker) => {
    if (fleetIconLayer) fleetIconLayer.removeLayer(marker);
  });
  fleetIconMarkers = [];
  const btn = document.getElementById("fleet-play");
  if (btn) btn.textContent = "Play 403 exit demo";
  renderFleet(null);
  setFleetStatus("");
}

async function loadFleetRoute() {
  if (fleetRoute) return fleetRoute;
  const resp = await fetch("/api/fleet-demo-route");
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Demo route failed");
  fleetRoute = data;
  return data;
}

function speedAtFleet(route, distance) {
  const bands = route.speed_profile || [];
  for (let i = 0; i < bands.length; i += 1) {
    if (distance < Number(bands[i].to_m)) return Number(bands[i].kmh);
  }
  return bands.length ? Number(bands[bands.length - 1].kmh) : 50;
}

function pointAtFleet(route, distance) {
  const coords = route.coordinates;
  const cum = route.cumulative_m;
  if (!coords || !coords.length) return [0, 0];
  if (distance <= 0 || !cum) return [coords[0][1], coords[0][0]];
  if (distance >= cum[cum.length - 1]) {
    const last = coords[coords.length - 1];
    return [last[1], last[0]];
  }
  let index = 1;
  while (index < cum.length && cum[index] < distance) index += 1;
  const span = (cum[index] - cum[index - 1]) || 1;
  const t = (distance - cum[index - 1]) / span;
  const lon = coords[index - 1][0] + t * (coords[index][0] - coords[index - 1][0]);
  const lat = coords[index - 1][1] + t * (coords[index][1] - coords[index - 1][1]);
  return [lat, lon];
}

function showFleetRoute(route) {
  const map = window.SmartShieldMap && window.SmartShieldMap();
  if (!map || typeof L === "undefined") return;
  const latlngs = route.coordinates.map((pair) => [pair[1], pair[0]]);
  if (fleetRouteLine) map.removeLayer(fleetRouteLine);
  fleetRouteLine = L.polyline(latlngs, { color: "#1a73e8", weight: 5, opacity: 0.85 }).addTo(map);
  if (window.SmartShieldSetRouteGeometry) window.SmartShieldSetRouteGeometry(route.coordinates);
}

async function gotoFleet(along, speed) {
  await fleetRulesPromise;
  const route = await loadFleetRoute();
  if (window.SmartShieldFleetDemo) window.SmartShieldFleetDemo(true);
  showFleetRoute(route);
  const kmh = speed == null ? speedAtFleet(route, along) : speed;
  const pair = pointAtFleet(route, along);
  if (window.SmartShieldSetSpeed) window.SmartShieldSetSpeed(kmh, { silent: true });
  if (window.SmartShieldSetLocation) {
    await window.SmartShieldSetLocation(pair[0], pair[1], "fleet-demo", { simMs: Date.now() });
  }
  const map = window.SmartShieldMap && window.SmartShieldMap();
  if (map) map.setView(pair, 16, { animate: false });
  return { lat: pair[0], lon: pair[1], kmh };
}

async function playFleet() {
  if (fleetPlaying) {
    fleetStop = true;
    return;
  }
  fleetPlaying = true;
  fleetStop = false;
  const btn = document.getElementById("fleet-play");
  try {
    await fleetRulesPromise;
    const route = await loadFleetRoute();
    resetFleet({ keepRoute: true });
    fleetStop = false;
    if (window.SmartShieldFleetDemo) window.SmartShieldFleetDemo(true);
    showFleetRoute(route);
    if (btn) btn.textContent = "Stop demo";
    setFleetStatus("Driving Highway 403 to Mavis Road…");
    let along = 0;
    let sim = Date.parse("2026-09-27T18:00:00Z");
    const total = Number(route.total_m);
    const map = window.SmartShieldMap && window.SmartShieldMap();
    while (along < total && !fleetStop) {
      const kmh = speedAtFleet(route, along);
      const pair = pointAtFleet(route, along);
      if (window.SmartShieldSetSpeed) window.SmartShieldSetSpeed(kmh, { silent: true });
      if (window.SmartShieldSetLocation) {
        await window.SmartShieldSetLocation(pair[0], pair[1], "fleet-demo", { simMs: sim });
      }
      if (map) map.setView(pair, 15, { animate: false });
      along += Math.max(8, kmh / 3.6);
      sim += 1000;
    }
    if (!fleetStop) finishFleetPassing(fleetLastSample);
    renderFleet(fleetLastSample);
    setFleetStatus(fleetStop ? "Demo stopped." : `Trip complete. Score ${fleetScore}.`);
  } catch (err) {
    setFleetStatus(err && err.message ? err.message : "Demo failed.");
    throw err;
  } finally {
    fleetPlaying = false;
    if (btn) btn.textContent = "Play 403 exit demo";
  }
}

window.SmartShieldFleet = {
  play: playFleet,
  goto: async (sceneOrAlong) => {
    const route = await loadFleetRoute();
    let along = Number(sceneOrAlong);
    let speed = null;
    if (Number.isNaN(along) && route.scenes && route.scenes[sceneOrAlong]) {
      along = Number(route.scenes[sceneOrAlong].along_m);
      speed = speedAtFleet(route, along);
    }
    return gotoFleet(along, speed);
  },
  csvText: fleetCsvText,
  reset: () => resetFleet(),
  score: () => fleetScore,
  events: () => fleetEvents.slice(),
};
