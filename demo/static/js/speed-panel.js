/* Posted limit, safe speed, current speed, and over-speed warnings. */

let speedMap = null;
let speedState = {
  lat: null,
  lon: null,
  posted: null,
  safe: null,
  estimated: false,
  highway: null,
  roadName: null,
  detail: "",
  summary: "",
  rule: "",
  current: 70,
  source: "demo",
  warning: "ok",
  demo: true,
  beep: true,
  geometry: null,
  route: null,
  weather: "auto",
};

let gpsWatch = null;
let driveTimer = null;
let positionMarker = null;
let audioCtx = null;
let lookupToken = 0;
let pendingSafe = Promise.resolve();
let speedSeeded = false;

function initSpeedAwareness(map) {
  speedMap = map;
  const host = document.getElementById("map-wrap") || document.getElementById("map-stage");
  if (!host || document.getElementById("speed-panel")) return;

  host.insertAdjacentHTML("beforeend", speedPanelHtml());
  bindSpeedPanel();
  applyPublicLinks();

  const center = map.getCenter();
  setSpeedLocation(center.lat, center.lng, "map");

  map.on("click", (e) => {
    stopDrive();
    setSpeedLocation(e.latlng.lat, e.latlng.lng, "map");
  });

  document.addEventListener("smartshield:context", (e) => {
    const detail = e.detail || {};
    speedState.route = detail.route || null;
    speedState.geometry = detail.geometry || speedState.geometry;
    speedState.weather = detail.weather || weatherValue();
    if (detail.snapToRoute && speedState.geometry && speedState.geometry.length) {
      const mid = speedState.geometry[Math.floor(speedState.geometry.length / 2)];
      setSpeedLocation(mid[1], mid[0], "route");
    } else {
      refreshSafeSpeed();
    }
  });

  const weather = document.getElementById("weather");
  if (weather) {
    weather.addEventListener("change", () => {
      speedState.weather = weather.value;
      pendingSafe = refreshSafeSpeed();
    });
  }
}

function speedPanelHtml() {
  return `
    <section id="speed-panel" class="speed-panel" aria-label="Speed limit and current speed">
      <div class="speed-signs">
        <div id="posted-sign" class="limit-sign" title="Posted speed limit">
          <span class="est-tab">EST</span>
          <span class="sign-caption">MAXIMUM</span>
          <span id="posted-num" class="sign-num">—</span>
          <span class="sign-unit">km/h</span>
        </div>
        <div id="safe-sign" class="limit-sign safe" title="Safe speed">
          <span class="sign-caption">SAFE</span>
          <span id="safe-num" class="sign-num">—</span>
          <span class="sign-unit">km/h</span>
        </div>
        <div class="speed-now-wrap">
          <div id="speed-now" class="speed-now" aria-live="polite">
            <span id="speed-now-num" class="now-num">—</span>
            <span class="now-unit">km/h</span>
          </div>
          <span class="speed-now-caption">Your speed</span>
        </div>
      </div>
      <p id="speed-road" class="speed-road">Looking up the posted limit…</p>
      <p id="speed-safe-note" class="speed-safe-note"></p>
      <div id="speed-alert" class="speed-alert ok" role="status" aria-live="assertive">Within the safe speed</div>
      <div class="speed-controls">
        <div class="speed-toggle-row">
          <label><input id="speed-demo" type="checkbox" checked /> Demo speed</label>
          <label><input id="speed-beep" type="checkbox" checked /> Beep</label>
          <button type="button" id="speed-gps" class="speed-drive" style="width:auto;margin:0;flex:0 0 auto;padding:4px 10px;">Use GPS</button>
        </div>
        <div class="speed-slider-row">
          <input id="speed-slider" type="range" min="0" max="160" step="1" value="70" aria-label="Simulated speed" />
          <span id="speed-slider-readout" class="speed-slider-readout">70 km/h</span>
        </div>
        <div class="speed-presets">
          <button type="button" data-preset="ok">Under safe</button>
          <button type="button" data-preset="amber">Above safe</button>
          <button type="button" data-preset="red">Over limit</button>
        </div>
        <button type="button" id="speed-drive" class="speed-drive">Drive selected route</button>
        <p id="speed-gps-note" class="speed-gps-note"></p>
        <details class="speed-rule">
          <summary>How safe speed is calculated</summary>
          <p id="speed-rule-text"></p>
        </details>
      </div>
    </section>
  `;
}

function bindSpeedPanel() {
  document.getElementById("speed-demo").addEventListener("change", (e) => {
    speedState.demo = e.target.checked;
    document.getElementById("speed-slider").disabled = !speedState.demo;
    if (speedState.demo) {
      applyCurrentSpeed(Number(document.getElementById("speed-slider").value), "demo");
    } else {
      noteGps("Demo speed is off. GPS speed is used when the browser reports it.");
    }
  });
  document.getElementById("speed-beep").addEventListener("change", (e) => {
    speedState.beep = e.target.checked;
  });
  document.getElementById("speed-slider").addEventListener("input", (e) => {
    document.getElementById("speed-demo").checked = true;
    speedState.demo = true;
    speedSeeded = true;
    applyCurrentSpeed(Number(e.target.value), "demo");
  });
  document.querySelectorAll(".speed-presets button").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
  document.getElementById("speed-gps").addEventListener("click", startGps);
  document.getElementById("speed-drive").addEventListener("click", toggleDrive);
  if (!window.isSecureContext) {
    noteGps("GPS needs a secure page (HTTPS). This visit is not one, so use Demo speed.");
  } else {
    noteGps("Laptop browsers usually have no travel speed. Demo speed drives the warnings.");
  }
}

function weatherValue() {
  const el = document.getElementById("weather");
  return el ? el.value : "auto";
}

function setSpeedLocation(lat, lon, source) {
  speedState.lat = lat;
  speedState.lon = lon;
  showPositionMarker(lat, lon);
  refreshPostedAndSafe(source);
}

function showPositionMarker(lat, lon) {
  if (!speedMap || typeof L === "undefined") return;
  if (!positionMarker) {
    positionMarker = L.circleMarker([lat, lon], {
      radius: 7,
      color: "#1a73e8",
      weight: 2,
      fillColor: "#1a73e8",
      fillOpacity: 0.9,
    }).addTo(speedMap);
  } else {
    positionMarker.setLatLng([lat, lon]);
  }
}

async function refreshPostedAndSafe() {
  if (speedState.lat == null) return;
  const token = ++lookupToken;
  const road = document.getElementById("speed-road");
  if (road) road.textContent = "Looking up the posted limit…";
  const params = contextParams();
  params.set("lat", String(speedState.lat));
  params.set("lon", String(speedState.lon));
  try {
    const resp = await fetch(`/api/speed-limit?${params.toString()}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Speed limit lookup failed");
    if (token !== lookupToken) return;
    applyLimitPayload(data);
  } catch (err) {
    if (token !== lookupToken) return;
    if (road) road.textContent = `Speed limit unavailable (${err.message}).`;
  }
}

async function refreshSafeSpeed() {
  if (speedState.posted == null) {
    refreshPostedAndSafe();
    return;
  }
  const params = contextParams();
  params.set("posted", String(speedState.posted));
  params.set("highway", speedState.highway || "");
  try {
    const resp = await fetch(`/api/safe-speed?${params.toString()}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Safe speed failed");
    speedState.safe = data.safe_kmh;
    speedState.summary = data.summary || "";
    speedState.rule = data.rule || "";
    renderSpeedPanel();
  } catch (err) {
    const note = document.getElementById("speed-safe-note");
    if (note) note.textContent = err.message;
  }
}

function contextParams() {
  const params = new URLSearchParams();
  const route = speedState.route;
  speedState.weather = weatherValue();
  if (route && route.recommended_speed_kmh != null) {
    params.set("recommended_kmh", String(route.recommended_speed_kmh));
  }
  if (route && route.tier) params.set("tier", route.tier);
  if (speedState.weather) params.set("weather", speedState.weather);
  return params;
}

function applyLimitPayload(data) {
  speedState.posted = data.posted_kmh;
  speedState.safe = data.safe_kmh;
  speedState.estimated = !!data.estimated;
  speedState.highway = data.highway;
  speedState.roadName = data.road_name;
  speedState.detail = data.detail || "";
  speedState.summary = data.summary || "";
  speedState.rule = data.rule || "";
  if (speedState.demo && !speedSeeded && data.safe_kmh != null) {
    speedSeeded = true;
    speedState.current = Math.max(0, data.safe_kmh - 12);
    const slider = document.getElementById("speed-slider");
    const readout = document.getElementById("speed-slider-readout");
    if (slider) slider.value = String(speedState.current);
    if (readout) readout.textContent = `${speedState.current} km/h`;
  }
  renderSpeedPanel();
}

function applyCurrentSpeed(kmh, source) {
  speedState.current = Math.max(0, Math.round(kmh));
  speedState.source = source;
  const slider = document.getElementById("speed-slider");
  const readout = document.getElementById("speed-slider-readout");
  if (slider && source === "demo") slider.value = String(speedState.current);
  if (readout) readout.textContent = `${speedState.current} km/h`;
  renderSpeedPanel();
}

function warningFor(current, posted, safe) {
  if (current == null || posted == null || safe == null) return "unknown";
  if (current > posted) return "red";
  if (current > safe) return "amber";
  return "ok";
}

function renderSpeedPanel() {
  const postedEl = document.getElementById("posted-num");
  const safeEl = document.getElementById("safe-num");
  const nowEl = document.getElementById("speed-now-num");
  const nowWrap = document.getElementById("speed-now");
  const sign = document.getElementById("posted-sign");
  const road = document.getElementById("speed-road");
  const note = document.getElementById("speed-safe-note");
  const alertEl = document.getElementById("speed-alert");
  const panel = document.getElementById("speed-panel");
  const rule = document.getElementById("speed-rule-text");
  if (!postedEl || speedState.posted == null) return;

  postedEl.textContent = String(speedState.posted);
  safeEl.textContent = speedState.safe == null ? "—" : String(speedState.safe);
  nowEl.textContent = speedState.current == null ? "—" : String(speedState.current);
  sign.classList.toggle("estimated", !!speedState.estimated);

  const name = speedState.roadName || (speedState.highway ? speedState.highway.replace(/_/g, " ") : "Road");
  const tag = speedState.estimated
    ? '<span class="src-tag estimated">ESTIMATED</span>'
    : '<span class="src-tag">OSM</span>';
  const extra = speedState.detail ? ` · ${escapeHtml(speedState.detail)}` : "";
  road.innerHTML = `${escapeHtml(name)}${extra} ${tag}`;
  note.textContent = speedState.summary || "";
  if (rule) rule.textContent = speedState.rule || "";

  const next = warningFor(speedState.current, speedState.posted, speedState.safe);
  const prev = speedState.warning;
  speedState.warning = next;
  nowWrap.classList.remove("amber", "red");
  panel.classList.remove("amber-alert", "red-alert");
  alertEl.classList.remove("ok", "amber", "red");
  if (next === "red") {
    nowWrap.classList.add("red");
    panel.classList.add("red-alert");
    alertEl.classList.add("red");
    alertEl.textContent = `Over the speed limit — ${speedState.current} km/h in a ${speedState.posted} km/h zone`;
  } else if (next === "amber") {
    nowWrap.classList.add("amber");
    panel.classList.add("amber-alert");
    alertEl.classList.add("amber");
    alertEl.textContent = `Above the safe speed — ${speedState.current} km/h, limit is ${speedState.posted}`;
  } else {
    alertEl.classList.add("ok");
    alertEl.textContent = "Within the safe speed";
  }
  if (next !== prev && (next === "red" || next === "amber")) {
    playBeep(next);
  }
}

async function applyPreset(kind) {
  document.getElementById("speed-demo").checked = true;
  speedState.demo = true;
  speedSeeded = true;
  document.getElementById("speed-slider").disabled = false;
  if (kind === "amber" && !(speedState.posted > speedState.safe)) {
    const weather = document.getElementById("weather");
    if (weather && !["wet", "blizzard", "ice_storm"].includes(weather.value)) {
      weather.value = "wet";
      weather.dispatchEvent(new Event("change", { bubbles: true }));
      await pendingSafe;
    }
  }
  const posted = speedState.posted;
  const safe = speedState.safe;
  if (posted == null || safe == null) return;
  let kmh = speedState.current;
  if (kind === "ok") kmh = Math.max(0, safe - 12);
  if (kind === "amber") {
    kmh = Math.round((safe + posted) / 2);
    if (!(kmh > safe && kmh <= posted)) kmh = Math.min(posted, safe + 1);
  }
  if (kind === "red") kmh = Math.min(160, posted + 15);
  if (kind === "amber" && !(kmh > speedState.safe && kmh <= posted)) {
    noteGps("This route's advisory matches the posted limit, so there is no amber band. Choose Wet, Blizzard, or Ice storm and score the route again.");
    return;
  }
  applyCurrentSpeed(kmh, "demo");
}

function startGps() {
  if (!navigator.geolocation) {
    noteGps("This browser has no geolocation.");
    return;
  }
  if (!window.isSecureContext) {
    noteGps("GPS is blocked until the page is served over HTTPS (or localhost).");
    return;
  }
  if (gpsWatch != null) {
    navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null;
  }
  noteGps("Waiting for a GPS fix…");
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setSpeedLocation(lat, lon, "gps");
      const speed = pos.coords.speed;
      if (!speedState.demo && speed != null && speed >= 0 && !Number.isNaN(speed)) {
        applyCurrentSpeed(speed * 3.6, "gps");
        noteGps("Using browser geolocation speed.");
      } else if (speed == null) {
        noteGps("GPS position is updating, but this device is not reporting speed. Leave Demo speed on.");
      } else {
        noteGps("GPS position is on. Demo speed still controls the number until you turn it off.");
      }
    },
    (err) => {
      noteGps(err && err.message ? `GPS: ${err.message}` : "GPS permission was denied.");
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
  );
}

function toggleDrive() {
  if (driveTimer) {
    stopDrive();
    return;
  }
  const geom = speedState.geometry;
  if (!geom || geom.length < 2) {
    noteGps("Find a route first, then drive it. The slider still sets your speed.");
    return;
  }
  document.getElementById("speed-demo").checked = true;
  speedState.demo = true;
  let index = 0;
  const step = Math.max(1, Math.round(geom.length / 36));
  const btn = document.getElementById("speed-drive");
  btn.textContent = "Stop route";
  driveTimer = setInterval(() => {
    const pair = geom[Math.min(index, geom.length - 1)];
    setSpeedLocation(pair[1], pair[0], "sim-route");
    index += step;
    if (index >= geom.length) stopDrive();
  }, 1200);
}

function stopDrive() {
  if (driveTimer) {
    clearInterval(driveTimer);
    driveTimer = null;
  }
  const btn = document.getElementById("speed-drive");
  if (btn) btn.textContent = "Drive selected route";
}

function noteGps(text) {
  const el = document.getElementById("speed-gps-note");
  if (el) el.textContent = text;
}

function playBeep(kind) {
  if (!speedState.beep) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = kind === "red" ? 880 : 620;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (kind === "red" ? 0.22 : 0.14));
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (err) {
    /* Autoplay policies can block audio until a gesture; the visual alert still shows. */
  }
}

async function applyPublicLinks() {
  let cfg = {};
  try {
    const resp = await fetch("/api/config");
    if (resp.ok) cfg = await resp.json();
  } catch (err) {
    return;
  }
  const mobile = document.getElementById("mobile-demo-link");
  const desktop = document.getElementById("desktop-demo-link");
  if (mobile) mobile.href = cfg.mobile_url || "/mobile";
  if (!desktop) return;
  if (cfg.desktop_url) {
    desktop.href = cfg.desktop_url;
    return;
  }
  const onDedicatedMobile =
    document.body.dataset.speedLayout === "mobile" &&
    location.pathname === "/" &&
    String(location.port || "") === String(cfg.mobile_port || "5051");
  if (onDedicatedMobile) {
    const port = cfg.desktop_port || 5050;
    desktop.href = `${location.protocol}//${location.hostname}:${port}/`;
  } else {
    desktop.href = "/";
  }
}
