/* Phone-style navigation chrome for the website map. */

(function () {
  const REPORTS_KEY = "smartshield.reports.v1";
  const MUTE_KEY = "smartshield.navMute.v1";
  const CAMERA_KEY = "smartshield.cameraAlerts.v1";
  const REPORTS = [
    { kind: "hazard", label: "Hazard" },
    { kind: "police", label: "Police" },
    { kind: "crash", label: "Crash" },
    { kind: "closure", label: "Road closure" },
    { kind: "camera", label: "Speed camera" },
  ];

  const state = {
    headingUp: false,
    following: false,
    bearing: 0,
    muted: false,
    route: null,
    position: null,
    roadName: "",
    spokenTurn: "",
    spokenRed: false,
    signCell: "",
    cameraCell: "",
    cameras: [],
    signs: [],
    torontoCameras: null,
    navigating: false,
    maneuver: null,
    spokenCameras: {},
    lastCameraSpeech: 0,
    posted: null,
    roadMode: "",
  };

  function haversineM(lat1, lon1, lat2, lon2) {
    const r = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function turnDelta(from, to) {
    let delta = to - from;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  }

  function kindFromDelta(delta) {
    const amount = Math.abs(delta);
    if (amount < 25) return "straight";
    if (amount > 150) return "uturn";
    if (amount < 55) return delta < 0 ? "slight-left" : "slight-right";
    return delta < 0 ? "left" : "right";
  }

  function shieldFrom(name) {
    if (!name) return null;
    if (/\bQEW\b/i.test(name)) return "QEW";
    const labeled = name.match(/\b(?:Highway|Hwy|Regional Road|County Road|Route|RR)\s+(\d{1,4}[A-Z]?)\b/i);
    return labeled ? labeled[1] : null;
  }

  function shortPlace(label) {
    const cut = (label || "").split(",")[0].trim() || label || "Destination";
    return cut.length > 32 ? `${cut.slice(0, 31)}…` : cut;
  }

  function formatDistance(meters) {
    if (meters < 30) return "Now";
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters / 1000)} km`;
  }

  function pathLength(line) {
    let total = 0;
    for (let i = 1; i < line.length; i += 1) {
      total += haversineM(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    }
    return total;
  }

  function toLatLon(geometry) {
    return (geometry || []).map((pair) => [pair[1], pair[0]]);
  }

  function progressAlong(line, lat, lon) {
    if (!line.length) return { ahead: [[lat, lon]], aheadM: 0, bearing: 0 };
    let best = 0;
    let bestD = Infinity;
    for (let index = 0; index < line.length; index += 1) {
      const distance = haversineM(lat, lon, line[index][0], line[index][1]);
      if (distance < bestD) {
        bestD = distance;
        best = index;
      }
    }
    const ahead = [[lat, lon], ...line.slice(best)];
    let bearing = 0;
    if (line.length >= 2) {
      const next = line[Math.min(best + 1, line.length - 1)];
      const prev = line[Math.max(best - 1, 0)];
      const from = best + 1 < line.length ? line[best] : prev;
      const to = best + 1 < line.length ? next : line[best];
      if (from !== to) bearing = bearingDeg(from[0], from[1], to[0], to[1]);
    }
    return { ahead, aheadM: pathLength(ahead), bearing };
  }

  function nextManeuver(ahead, streetHint, destLabel) {
    const dest = shortPlace(destLabel);
    const hint = (streetHint || "").trim();
    if (ahead.length < 2) {
      const point = ahead[0] || [0, 0];
      return { kind: "arrive", distanceM: 0, street: dest, shield: null, atLat: point[0], atLon: point[1] };
    }
    let walked = 0;
    let prevBearing = bearingDeg(ahead[0][0], ahead[0][1], ahead[1][0], ahead[1][1]);
    for (let index = 1; index < ahead.length - 1; index += 1) {
      walked += haversineM(ahead[index - 1][0], ahead[index - 1][1], ahead[index][0], ahead[index][1]);
      const nextBearing = bearingDeg(ahead[index][0], ahead[index][1], ahead[index + 1][0], ahead[index + 1][1]);
      const kind = kindFromDelta(turnDelta(prevBearing, nextBearing));
      if (kind !== "straight" && walked > 40) {
        const street = hint || dest;
        return {
          kind,
          distanceM: walked,
          street,
          shield: shieldFrom(street),
          atLat: ahead[index][0],
          atLon: ahead[index][1],
        };
      }
      prevBearing = nextBearing;
    }
    const total = pathLength(ahead);
    const last = ahead[ahead.length - 1];
    if (total < 280) {
      return { kind: "arrive", distanceM: total, street: dest, shield: null, atLat: last[0], atLon: last[1] };
    }
    const street = hint || dest;
    return {
      kind: "straight",
      distanceM: total,
      street,
      shield: shieldFrom(street),
      atLat: last[0],
      atLon: last[1],
    };
  }

  function instructionSpeech(maneuver) {
    const lead = maneuver.distanceM < 40 ? "" : `In ${formatDistance(maneuver.distanceM).toLowerCase()}, `;
    if (maneuver.kind === "arrive") return `${lead}you will arrive at ${maneuver.street}`.trim();
    if (maneuver.kind === "straight") return `${lead}continue on ${maneuver.street}`.trim();
    const turn = {
      left: "turn left",
      right: "turn right",
      "slight-left": "bear left",
      "slight-right": "bear right",
      uturn: "make a U-turn",
    }[maneuver.kind];
    return `${lead}${turn} onto ${maneuver.street}`.trim();
  }

  function speak(text) {
    if (state.muted || !text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-CA";
      window.speechSynthesis.speak(utter);
    } catch (err) {
      /* Autoplay can block speech until a click. The banner still shows the turn. */
    }
  }

  function loadMuted() {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (err) { return false; }
  }

  function saveMuted(muted) {
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (err) { /* ignore */ }
  }

  function loadReports() {
    try {
      const parsed = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveReport(kind) {
    const pos = state.position || { lat: 43.6532, lon: -79.3832 };
    const next = {
      id: String(Date.now()),
      kind,
      lat: pos.lat,
      lon: pos.lon,
      at: new Date().toISOString(),
    };
    const all = [next, ...loadReports()].slice(0, 40);
    try { localStorage.setItem(REPORTS_KEY, JSON.stringify(all)); } catch (err) { /* ignore */ }
    return all;
  }

  function map() {
    return window.SmartShieldMap ? window.SmartShieldMap() : null;
  }

  function narrow() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function syncDock() {
    const panel = document.getElementById("side-panel");
    let left = 0;
    if (panel && !narrow() && !panel.classList.contains("is-collapsed")) {
      left = Math.round(panel.getBoundingClientRect().width) + 28;
    }
    document.documentElement.style.setProperty("--dock-left", `${left}px`);
  }

  function openTools(which) {
    const panel = document.getElementById("side-panel");
    if (panel) {
      panel.classList.remove("is-collapsed");
      panel.classList.add("is-open");
      const button = document.getElementById("panel-collapse");
      if (button) {
        button.setAttribute("aria-expanded", "true");
        button.setAttribute("aria-label", "Collapse panel");
      }
    }
    const sheet = document.getElementById("bottom-sheet");
    if (sheet && typeof setSheetState === "function") setSheetState("half");
    if (which) {
      const section = document.querySelector(`.panel-section[data-panel-action="${which}"]`);
      if (section) section.open = true;
    }
    syncDock();
  }

  function closeTools() {
    const panel = document.getElementById("side-panel");
    if (!panel || !narrow()) return;
    panel.classList.add("is-collapsed");
    panel.classList.remove("is-open");
    syncDock();
  }

  function chromeHtml() {
    const reportRows = REPORTS.map((item) => (
      `<button type="button" class="nav-report-row" data-report="${item.kind}">${item.label}</button>`
    )).join("");
    return `
      <div id="nav-chrome" class="nav-chrome">
        <button type="button" id="nav-search-pill" class="nav-search-pill">
          <span class="nav-search-pill-text">Search an address or place</span>
          <span class="nav-search-pill-go">Directions</span>
        </button>
        <div id="nav-banner" class="nav-banner" hidden>
          <button type="button" id="nav-turn" class="nav-turn" aria-label="Show the next turn"></button>
          <div class="nav-banner-copy">
            <div id="nav-distance" class="nav-distance"></div>
            <div class="nav-street-row">
              <span id="nav-shield" class="nav-shield" hidden></span>
              <div id="nav-street" class="nav-street"></div>
            </div>
            <div id="nav-then" class="nav-then" hidden></div>
          </div>
        </div>
        <div class="nav-side">
          <div class="nav-side-stack">
            <button type="button" id="nav-compass" class="nav-round" aria-label="Compass">
              <span id="nav-needle" class="nav-needle" aria-hidden="true"></span>
            </button>
            <button type="button" id="nav-recenter" class="nav-round" aria-label="Recenter" hidden>◎</button>
            <button type="button" id="nav-layers" class="nav-round" aria-label="Settings">
              <span class="nav-layers-icon" aria-hidden="true"></span>
            </button>
            <button type="button" id="nav-search" class="nav-round" aria-label="Search">
              <span class="nav-search-icon" aria-hidden="true"></span>
            </button>
            <button type="button" id="nav-mute" class="nav-round" aria-label="Mute voice" aria-pressed="false">
              <span class="nav-speaker" aria-hidden="true"></span>
            </button>
            <button type="button" id="nav-routes" class="nav-round" aria-label="Route options">
              <span class="nav-fork" aria-hidden="true"></span>
            </button>
            <button type="button" id="nav-report" class="nav-report">
              <span class="nav-warn" aria-hidden="true"></span>
              Report
            </button>
          </div>
        </div>
        <section id="nav-card" class="nav-card" aria-label="Trip">
          <button type="button" id="nav-where" class="nav-card-main">
            <strong>Where to?</strong>
            <span>Search a destination</span>
          </button>
          <div id="nav-eta" class="nav-card-main" hidden>
            <strong id="nav-eta-title">—</strong>
            <span id="nav-eta-sub"></span>
            <span id="nav-score" class="nav-score" hidden></span>
          </div>
          <button type="button" id="nav-exit" class="nav-exit" hidden>Exit</button>
        </section>
        <div id="nav-report-layer" class="nav-report-layer" hidden>
          <button type="button" id="nav-report-back" class="nav-report-back" aria-label="Close report"></button>
          <div class="nav-report-sheet" role="dialog" aria-labelledby="nav-report-title">
            <h2 id="nav-report-title">Report</h2>
            <p>Saved in this browser. The server does not take reports.</p>
            ${reportRows}
            <p id="nav-report-note" class="nav-report-note" hidden>Saved on this browser.</p>
          </div>
        </div>
      </div>
    `;
  }

  function turnMarkup(kind) {
    if (kind === "arrive") return '<span class="nav-arrive"></span>';
    if (kind === "roundabout") return '<span class="nav-roundabout"></span>';
    if (kind === "merge") return '<span class="nav-merge"></span>';
    if (kind === "exit") return '<span class="nav-arrow nav-exit-arrow"></span>';
    const rotate = {
      straight: 0,
      left: -90,
      right: 90,
      "slight-left": -40,
      "slight-right": 40,
      uturn: 180,
    }[kind] || 0;
    return `<span class="nav-arrow" style="transform:rotate(${rotate}deg)"></span>`;
  }

  function renderManeuver(maneuver) {
    const banner = document.getElementById("nav-banner");
    if (!banner || !maneuver || !maneuver.kind) {
      if (banner) banner.hidden = true;
      return;
    }
    banner.hidden = false;
    document.getElementById("nav-turn").innerHTML = turnMarkup(maneuver.kind);
    const distance = document.getElementById("nav-distance");
    distance.textContent = maneuver.kind === "arrive"
      ? "Arrive"
      : maneuver.distanceM < 30 ? "Now" : formatDistance(maneuver.distanceM);
    const shield = document.getElementById("nav-shield");
    if (maneuver.shield) {
      shield.hidden = false;
      shield.textContent = maneuver.shield;
    } else {
      shield.hidden = true;
      shield.textContent = "";
    }
    document.getElementById("nav-street").textContent = maneuver.street;
    const thenRow = document.getElementById("nav-then");
    const follow = maneuver.then;
    if (thenRow) {
      if (!follow || !follow.kind) {
        thenRow.hidden = true;
        thenRow.innerHTML = "";
      } else {
        thenRow.hidden = false;
        thenRow.innerHTML = `<span class="nav-then-label">Then</span><span class="nav-then-icon">${turnMarkup(follow.kind)}</span><span class="nav-then-street"></span>`;
        thenRow.querySelector(".nav-then-street").textContent = follow.street || "Unnamed road";
      }
    }
  }

  function renderEta() {
    const where = document.getElementById("nav-where");
    const eta = document.getElementById("nav-eta");
    const exit = document.getElementById("nav-exit");
    const route = state.route;
    const pos = state.position;
    if (!route || !route.geometry || !pos) {
      where.hidden = false;
      eta.hidden = true;
      exit.hidden = true;
      renderManeuver(null);
      paintFeatures();
      return;
    }
    const line = toLatLon(route.geometry);
    const progress = progressAlong(line, pos.lat, pos.lon);
    state.bearing = progress.bearing;
    const needle = document.getElementById("nav-needle");
    if (needle) needle.style.transform = `rotate(${state.headingUp ? 0 : -state.bearing}deg)`;
    const dest = route.destination || "Destination";
    const guide = window.NavProgress && route.steps && route.steps.length
      ? window.NavProgress.upcomingManeuvers(route.steps, line, pos.lat, pos.lon)
      : { current: nextManeuver(progress.ahead, state.roadName, dest), then: null };
    const maneuver = guide.current;
    if (maneuver) {
      maneuver.then = guide.then;
      if (!maneuver.shield) maneuver.shield = shieldFrom(maneuver.street);
    }
    state.maneuver = maneuver;
    if (state.navigating) {
      renderManeuver(maneuver);
      maybeSpeakTurn(maneuver);
    } else {
      renderManeuver(null);
    }

    const totalM = route.distanceM || pathLength(line) || 1;
    const fraction = Math.min(1, Math.max(0, progress.aheadM / totalM));
    const seconds = Math.max(0, (route.durationS || 0) * fraction);
    const arriving = progress.aheadM < 350;
    const minutes = Math.max(1, Math.round(seconds / 60));
    const title = arriving
      ? "Arriving soon"
      : minutes < 60
        ? `${minutes} min`
        : `${Math.floor(minutes / 60)} hr ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
    const distance = progress.aheadM < 950
      ? `${Math.max(1, Math.round(progress.aheadM))} m`
      : `${(progress.aheadM / 1000).toFixed(progress.aheadM < 10000 ? 1 : 0)} km`;
    const clock = new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (!state.navigating) {
      where.hidden = true;
      eta.hidden = true;
      exit.hidden = true;
      paintFeatures();
      return;
    }
    where.hidden = true;
    eta.hidden = false;
    exit.hidden = false;
    document.getElementById("nav-eta-title").textContent = clock;
    document.getElementById("nav-eta-sub").textContent = arriving ? shortPlace(dest) : `${title} · ${distance}`;
    const score = document.getElementById("nav-score");
    if (score) {
      const value = route.safetyScore;
      score.hidden = value == null || value === "";
      score.textContent = value == null || value === "" ? "" : `Risk ${value}`;
    }
    paintFeatures();
    if (state.following) followCamera();
  }

  function maybeSpeakTurn(maneuver) {
    if (!maneuver || maneuver.kind === "straight") return;
    const bucket = maneuver.distanceM < 80 ? "now" : maneuver.distanceM < 300 ? "near" : maneuver.distanceM < 800 ? "mid" : "far";
    if (bucket === "far") return;
    const phrase = instructionSpeech(maneuver);
    const key = `${phrase}|${bucket}`;
    if (state.spokenTurn === key) return;
    state.spokenTurn = key;
    speak(phrase);
  }

  function followCamera() {
    const leaflet = map();
    const pos = state.position;
    if (!leaflet || !pos) return;
    const zoom = Math.max(leaflet.getZoom() || 0, 16);
    if (state.headingUp && typeof leaflet.setBearing === "function") {
      leaflet.setBearing(state.bearing || 0);
    }
    leaflet.setView([pos.lat, pos.lon], zoom, { animate: false });
  }

  function recenter() {
    state.following = true;
    const leaflet = map();
    if (leaflet && typeof leaflet.setBearing === "function") {
      leaflet.setBearing(state.headingUp ? (state.bearing || 0) : 0);
    }
    followCamera();
    const needle = document.getElementById("nav-needle");
    if (needle) needle.style.transform = `rotate(${state.headingUp ? 0 : -state.bearing}deg)`;
  }

  let signLayer = null;
  let cameraLayer = null;
  let reportLayer = null;
  let dotLayer = null;

  function routeLine() {
    return state.route && state.route.geometry ? toLatLon(state.route.geometry) : [];
  }

  function setFeatureCount(count) {
    const chip = document.getElementById("feature-count");
    if (!chip) return;
    const show = !state.navigating && count > 0;
    chip.hidden = !show;
    chip.textContent = count === 1 ? "1 alert on this route" : `${count} alerts on this route`;
  }

  function drawDots(features) {
    const leaflet = map();
    if (!leaflet || !window.L) return;
    if (!dotLayer) dotLayer = window.L.layerGroup().addTo(leaflet);
    dotLayer.clearLayers();
    (features || []).forEach((feature) => {
      window.L.circleMarker([feature.lat, feature.lon], {
        radius: 4,
        color: "#ffffff",
        weight: 1,
        fillColor: feature.kind === "stop" || feature.kind === "stop-all" ? "#d93025" : "#f5c542",
        fillOpacity: 0.85,
        interactive: false,
      }).addTo(dotLayer);
    });
  }

  function paintFeatures() {
    const progressApi = window.NavProgress;
    const line = routeLine();
    const pos = state.position;
    if (!progressApi || !pos || line.length < 2) {
      drawSigns([]);
      drawCameras([]);
      drawDots([]);
      setFeatureCount(0);
      return;
    }
    if (state.navigating) {
      drawDots([]);
      drawSigns(progressApi.featuresAhead(state.signs, line, pos.lat, pos.lon));
      drawCameras(cameraAlertsOn()
        ? progressApi.featuresAhead(state.cameras, line, pos.lat, pos.lon)
        : []);
      setFeatureCount(0);
      return;
    }
    const along = progressApi.featuresAlongRoute(
      (state.signs || []).concat(cameraAlertsOn() ? state.cameras || [] : []),
      line,
    );
    drawSigns([]);
    drawCameras([]);
    drawDots(along);
    setFeatureCount(along.length);
  }

  function cameraAlertsOn() {
    try { return localStorage.getItem(CAMERA_KEY) !== "0"; } catch (err) { return true; }
  }

  function drawCameras(features) {
    const api = window.SmartShieldCameras;
    const leaflet = map();
    if (!api || !leaflet || !window.L) return;
    if (!cameraLayer) cameraLayer = window.L.layerGroup().addTo(leaflet);
    cameraLayer.clearLayers();
    (features || []).forEach((feature) => {
      const wide = feature.kind === "variable";
      const icon = window.L.divIcon({
        className: "plain-sign",
        html: api.iconHtml(feature),
        iconSize: wide ? [34, 18] : [22, 22],
        iconAnchor: wide ? [17, 9] : [11, 11],
      });
      window.L.marker([feature.lat, feature.lon], { icon, interactive: false, keyboard: false }).addTo(cameraLayer);
    });
  }

  async function fetchOsmCameras(lat, lon) {
    const api = window.SmartShieldCameras;
    if (!api) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: `data=${encodeURIComponent(api.overpassQuery(lat, lon))}`,
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const data = await response.json();
      return api.parseOverpass(data.elements || []);
    } catch (err) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadCameras(lat, lon) {
    const api = window.SmartShieldCameras;
    if (!api) return;
    const cell = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (cell === state.cameraCell) return;
    state.cameraCell = cell;
    const cacheKey = `smartshield.osmCameras.v1.${cell}`;
    let osm = null;
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (saved && saved.at && Date.now() - saved.at < 6 * 60 * 60 * 1000 && Array.isArray(saved.features)) {
        osm = saved.features;
      }
    } catch (err) { /* fetch again */ }
    if (!osm) {
      osm = await fetchOsmCameras(lat, lon);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), features: osm }));
      } catch (err) { /* cache is optional */ }
    }
    if (!state.torontoCameras) {
      try {
        const response = await fetch("/api/cameras");
        const data = response.ok ? await response.json() : {};
        state.torontoCameras = Array.isArray(data.features) ? data.features : [];
      } catch (err) {
        state.torontoCameras = [];
      }
    }
    state.cameras = api.dedupeCameras(osm || [], state.torontoCameras || []);
    paintFeatures();
    maybeSpeakCameras();
  }

  function maybeSpeakCameras() {
    const api = window.SmartShieldCameras;
    if (!state.navigating || !api || !state.position || !state.cameras.length) return;
    if (state.muted || !cameraAlertsOn()) return;
    if (Date.now() - state.lastCameraSpeech < 4000) return;
    const lat = state.position.lat;
    const lon = state.position.lon;
    const line = state.route && state.route.geometry ? toLatLon(state.route.geometry) : [];
    const progress = line.length ? progressAlong(line, lat, lon) : null;
    const route = progress && progress.ahead && progress.ahead.length >= 2 ? progress.ahead : [];
    const heading = route.length ? progress.bearing : null;
    const alerts = api.alertsAhead(state.cameras, lat, lon, {
      heading,
      route,
      roadMode: state.roadMode,
      postedKmh: state.posted,
      spoken: state.spokenCameras,
    });
    if (!alerts.length) return;
    state.spokenCameras[alerts[0].id] = true;
    state.lastCameraSpeech = Date.now();
    speak(alerts[0].phrase);
  }

  function signIcon(kind) {
    if (kind === "signal") {
      return window.L.divIcon({
        className: "plain-sign",
        html: '<div class="nav-signal"><i></i><i class="on"></i><i></i></div>',
        iconSize: [12, 26],
        iconAnchor: [6, 13],
      });
    }
    const allWay = kind === "stop-all";
    const box = window.SmartShieldStop.layout(allWay);
    return window.L.divIcon({
      className: "plain-sign",
      html: window.SmartShieldStop.svg(allWay),
      iconSize: [box.width, box.height],
      iconAnchor: [box.cx, box.cy],
    });
  }

  function drawSigns(signs) {
    const leaflet = map();
    if (!leaflet || !window.L) return;
    if (!signLayer) signLayer = window.L.layerGroup().addTo(leaflet);
    signLayer.clearLayers();
    signs.forEach((sign) => {
      window.L.marker([sign.lat, sign.lon], { icon: signIcon(sign.kind), interactive: false, keyboard: false }).addTo(signLayer);
    });
  }

  function drawReports() {
    const leaflet = map();
    if (!leaflet || !window.L) return;
    if (!reportLayer) reportLayer = window.L.layerGroup().addTo(leaflet);
    reportLayer.clearLayers();
    loadReports().forEach((report) => {
      const icon = window.L.divIcon({
        className: "plain-sign",
        html: '<div class="nav-report-pin"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 12],
      });
      window.L.marker([report.lat, report.lon], { icon, interactive: false, keyboard: false }).addTo(reportLayer);
    });
  }

  function stopKind(tags) {
    const stop = String((tags && tags.stop) || "").toLowerCase().replace(/-/g, "_");
    const allWay = String((tags && (tags.all_way || tags["all-way"])) || "").toLowerCase();
    if (stop === "all" || stop === "all_way" || stop === "allway" || allWay === "yes") return "stop-all";
    return "stop";
  }

  async function loadSigns(lat, lon) {
    const cell = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (cell === state.signCell) return;
    state.signCell = cell;
    const cacheKey = `smartshield.osmSigns.v2.${cell}`;
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (saved && saved.at && Date.now() - saved.at < 6 * 60 * 60 * 1000 && Array.isArray(saved.signs)) {
        state.signs = saved.signs;
        paintFeatures();
        return;
      }
    } catch (err) { /* lookup again */ }
    const query = `[out:json][timeout:12];(node["highway"="traffic_signals"](around:1200,${lat},${lon});node["highway"="stop"](around:1200,${lat},${lon}););out body 50;`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      const signs = [];
      (data.elements || []).forEach((element) => {
        if (element.lat == null || element.lon == null) return;
        const highway = element.tags && element.tags.highway;
        if (highway !== "traffic_signals" && highway !== "stop") return;
        signs.push({
          lat: element.lat,
          lon: element.lon,
          kind: highway === "stop" ? stopKind(element.tags) : "signal",
        });
      });
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), signs }));
      } catch (err) { /* cache is optional */ }
      state.signs = signs;
      paintFeatures();
    } catch (err) {
      /* Best effort. A missed lookup leaves the previous icons, or none. */
    } finally {
      clearTimeout(timer);
    }
  }

  function bind() {
    state.muted = loadMuted();
    const mute = document.getElementById("nav-mute");
    mute.setAttribute("aria-pressed", state.muted ? "true" : "false");
    mute.setAttribute("aria-label", state.muted ? "Unmute voice" : "Mute voice");
    mute.classList.toggle("is-muted", state.muted);

    document.getElementById("nav-compass").addEventListener("click", () => {
      state.headingUp = !state.headingUp;
      document.getElementById("nav-compass").setAttribute("aria-label", state.headingUp ? "Heading up" : "North up");
      recenter();
    });
    const recenterBtn = document.getElementById("nav-recenter");
    if (recenterBtn) {
      recenterBtn.addEventListener("click", () => {
        state.following = true;
        recenterBtn.hidden = true;
        recenter();
      });
    }
    const turnBtn = document.getElementById("nav-turn");
    if (turnBtn) {
      turnBtn.addEventListener("click", () => {
        const leaflet = map();
        const maneuver = state.maneuver;
        if (!leaflet || !maneuver) return;
        leaflet.setView([maneuver.atLat, maneuver.atLon], Math.max(leaflet.getZoom() || 0, 16), { animate: true });
      });
    }
    const layers = document.getElementById("nav-layers");
    const settings = document.getElementById("nav-settings");
    if (layers && settings) {
      layers.addEventListener("click", () => { settings.hidden = false; });
    }
    const settingsClose = document.getElementById("nav-settings-close");
    const settingsBack = document.getElementById("nav-settings-back");
    if (settings) {
      if (settingsClose) settingsClose.addEventListener("click", () => { settings.hidden = true; });
      if (settingsBack) settingsBack.addEventListener("click", () => { settings.hidden = true; });
    }
    const voice = document.getElementById("nav-voice");
    if (voice) {
      voice.checked = !state.muted;
      voice.addEventListener("change", () => {
        state.muted = !voice.checked;
        saveMuted(state.muted);
        mute.setAttribute("aria-pressed", state.muted ? "true" : "false");
        mute.setAttribute("aria-label", state.muted ? "Unmute voice" : "Mute voice");
        mute.classList.toggle("is-muted", state.muted);
        if (state.muted && window.speechSynthesis) window.speechSynthesis.cancel();
      });
    }
    document.getElementById("nav-search").addEventListener("click", () => {
      openTools("directions");
      const input = document.getElementById("map-search-input") || document.getElementById("destination");
      if (input) input.focus();
    });
    const searchPill = document.getElementById("nav-search-pill");
    if (searchPill) {
      searchPill.addEventListener("click", (event) => {
        const directions = event.target.closest(".nav-search-pill-go");
        openTools("directions");
        const input = directions
          ? document.getElementById("destination")
          : (document.getElementById("map-search-input") || document.getElementById("destination"));
        if (input) input.focus();
      });
    }
    mute.addEventListener("click", () => {
      state.muted = !state.muted;
      saveMuted(state.muted);
      mute.setAttribute("aria-pressed", state.muted ? "true" : "false");
      mute.setAttribute("aria-label", state.muted ? "Unmute voice" : "Mute voice");
      mute.classList.toggle("is-muted", state.muted);
      const voiceBox = document.getElementById("nav-voice");
      if (voiceBox) voiceBox.checked = !state.muted;
      if (state.muted && window.speechSynthesis) window.speechSynthesis.cancel();
    });
    const cameraBox = document.getElementById("camera-alerts");
    if (cameraBox) {
      cameraBox.checked = cameraAlertsOn();
      cameraBox.addEventListener("change", () => {
        try { localStorage.setItem(CAMERA_KEY, cameraBox.checked ? "1" : "0"); } catch (err) { /* ignore */ }
        paintFeatures();
      });
    }
    document.getElementById("nav-routes").addEventListener("click", () => {
      openTools("directions");
      const safety = document.getElementById("safety-section");
      if (safety) safety.open = true;
      const routes = document.getElementById("routes-section");
      if (routes) routes.hidden = false;
    });
    document.getElementById("nav-where").addEventListener("click", () => {
      openTools("directions");
      const input = document.getElementById("destination") || document.getElementById("map-search-input");
      if (input) input.focus();
    });
    function leaveNavigation() {
      state.navigating = false;
      state.following = false;
      state.spokenTurn = "";
      document.body.classList.remove("is-navigating");
      const panel = document.getElementById("side-panel");
      const sheet = document.getElementById("bottom-sheet");
      if (panel) panel.classList.remove("is-collapsed");
      if (sheet) sheet.classList.remove("is-hidden");
      const recenterButton = document.getElementById("nav-recenter");
      if (recenterButton) recenterButton.hidden = true;
    }
    document.getElementById("nav-exit").addEventListener("click", () => {
      const drive = document.getElementById("speed-drive");
      if (drive && drive.textContent.trim() === "Stop") drive.click();
      state.route = null;
      leaveNavigation();
      document.dispatchEvent(new CustomEvent("smartshield:clear-nav"));
      const status = document.getElementById("status");
      if (status) status.textContent = "Set a start and destination.";
      renderEta();
    });
    document.addEventListener("smartshield:start-nav", () => {
      if (!state.route || !state.route.geometry) return;
      state.navigating = true;
      state.following = true;
      state.headingUp = true;
      state.spokenTurn = "";
      document.body.classList.add("is-navigating");
      const panel = document.getElementById("side-panel");
      const sheet = document.getElementById("bottom-sheet");
      if (panel) panel.classList.add("is-collapsed");
      if (sheet) sheet.classList.add("is-hidden");
      const line = toLatLon(state.route.geometry);
      if (line[0] && window.SmartShieldSetLocation) {
        window.SmartShieldSetLocation(line[0][0], line[0][1], "nav-start");
      }
      recenter();
      renderEta();
    });
    document.getElementById("nav-report").addEventListener("click", () => {
      document.getElementById("nav-report-layer").hidden = false;
    });
    document.getElementById("nav-report-back").addEventListener("click", () => {
      document.getElementById("nav-report-layer").hidden = true;
    });
    document.querySelectorAll(".nav-report-row").forEach((button) => {
      button.addEventListener("click", () => {
        saveReport(button.dataset.report);
        const note = document.getElementById("nav-report-note");
        note.hidden = false;
        note.textContent = "Saved on this browser.";
        drawReports();
      });
    });

    document.addEventListener("smartshield:nav-route", (event) => {
      state.route = event.detail || null;
      state.spokenTurn = "";
      renderEta();
    });
    document.addEventListener("smartshield:clear-nav", () => {
      state.route = null;
      state.navigating = false;
      document.body.classList.remove("is-navigating");
      renderEta();
    });
    document.addEventListener("smartshield:road", (event) => {
      const detail = event.detail || {};
      if (detail.lat != null && detail.lon != null) {
        state.position = { lat: detail.lat, lon: detail.lon };
        if (window.SmartShieldTheme) window.SmartShieldTheme.followSun(detail.lat, detail.lon);
        loadSigns(detail.lat, detail.lon);
        loadCameras(detail.lat, detail.lon);
      }
      if (detail.road_name) state.roadName = detail.road_name;
      if (detail.posted_kmh != null) state.posted = detail.posted_kmh;
      if (detail.road_mode) state.roadMode = detail.road_mode;
      maybeSpeakCameras();
      if (detail.warning === "red") {
        if (!state.spokenRed) {
          state.spokenRed = true;
          speak("You are over the speed limit.");
        }
      } else {
        state.spokenRed = false;
      }
      renderEta();
    });
    document.addEventListener("smartshield:usermove", (event) => {
      if (!event.detail || event.detail.reason !== "pan") return;
      state.following = false;
      const button = document.getElementById("nav-recenter");
      if (button && state.navigating) button.hidden = false;
    });

    const panel = document.getElementById("side-panel");
    if (panel && narrow()) {
      panel.classList.add("is-collapsed");
      panel.classList.remove("is-open");
    }
    const collapse = document.getElementById("panel-collapse");
    if (collapse) {
      collapse.addEventListener("click", () => setTimeout(syncDock, 40));
    }
    window.addEventListener("resize", syncDock);
    document.addEventListener("DOMContentLoaded", () => {
      syncDock();
      drawReports();
    });
    syncDock();
    drawReports();
    renderEta();

    const host = document.getElementById("nav-chrome");
    if (host && window.L && window.L.DomEvent) {
      window.L.DomEvent.disableClickPropagation(host);
      window.L.DomEvent.disableScrollPropagation(host);
    }
  }

  function mount() {
    const host = document.getElementById("map-wrap") || document.getElementById("map-stage");
    if (!host || document.getElementById("nav-chrome")) return;
    host.insertAdjacentHTML("beforeend", chromeHtml());
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
