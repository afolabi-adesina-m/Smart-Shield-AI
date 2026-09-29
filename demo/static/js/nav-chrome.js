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
    spokenCues: {},
    spokenSigns: {},
    lastSignSpeech: 0,
    speedSpeech: { spoken: false, at: 0 },
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
    match: null,
    bearingSmooth: null,
    speedKmh: null,
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
    if (total <= 150) {
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
    document.body.classList.add("nav-tools-open");
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
            <div id="nav-lanes" class="nav-lanes" hidden></div>
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
        <div id="nav-road" class="nav-road" hidden></div>
        <section id="nav-card" class="nav-card" aria-label="Trip">
          <button type="button" id="nav-where" class="nav-card-main">
            <strong>Where to?</strong>
            <span>Search a destination</span>
          </button>
          <div id="nav-eta" class="nav-eta" hidden>
            <div class="nav-eta-col"><strong id="nav-eta-title">—</strong><span>arrival</span></div>
            <div class="nav-eta-col"><strong id="nav-eta-mins">—</strong><span>min</span></div>
            <div class="nav-eta-col"><strong id="nav-eta-km">—</strong><span id="nav-eta-unit">km</span></div>
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
    const laneRow = document.getElementById("nav-lanes");
    if (laneRow) {
      const lanes = maneuver.lanes || [];
      if (!lanes.length) {
        laneRow.hidden = true;
        laneRow.innerHTML = "";
      } else {
        laneRow.hidden = false;
        laneRow.innerHTML = lanes.map((lane) => {
          const hint = (lane.indications && lane.indications[0]) || "straight";
          const arrow = /left/i.test(hint) ? "←" : /right/i.test(hint) ? "→" : /uturn/i.test(hint) ? "↩" : "↑";
          return `<span class="nav-lane${lane.valid ? " is-valid" : ""}">${arrow}</span>`;
        }).join("");
      }
    }
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
    const progressApi = window.NavProgress;
    const previous = state.match;
    const matched = progressApi
      ? progressApi.matchAlong(line, pos.lat, pos.lon, previous)
      : null;
    const progress = progressAlong(line, pos.lat, pos.lon);
    const aheadM = matched ? matched.remainingM : progress.aheadM;
    const bearingTarget = matched ? matched.bearing : progress.bearing;
    state.jumpCamera = state.bearingSmooth == null;
    state.aim = bearingTarget;
    state.bearing = progressApi
      ? progressApi.smoothBearing(state.bearingSmooth, bearingTarget, state.bearingSmooth == null ? 360 : 24)
      : bearingTarget;
    state.bearingSmooth = state.bearing;
    const needle = document.getElementById("nav-needle");
    if (needle) needle.style.transform = `rotate(${state.headingUp ? 0 : -state.bearing}deg)`;
    const dest = route.destination || "Destination";
    const guide = progressApi && route.steps && route.steps.length
      ? progressApi.upcomingManeuvers(route.steps, line, pos.lat, pos.lon, previous)
      : { current: nextManeuver(matched && progressApi ? progressApi.cutLine(line, matched.alongM).ahead : progress.ahead, state.roadName, dest), then: null, match: matched };
    state.match = guide.match || matched;
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

    const totalM = route.distanceM || (state.match && state.match.totalM) || pathLength(line) || 1;
    const fraction = Math.min(1, Math.max(0, aheadM / totalM));
    const seconds = Math.max(0, (route.durationS || 0) * fraction);
    const arriving = aheadM <= 150;
    const minutes = Math.max(arriving ? 0 : 1, Math.round(seconds / 60));
    const minuteValue = arriving ? "0" : minutes < 60 ? String(minutes) : `${Math.floor(minutes / 60)} hr ${minutes % 60 ? minutes % 60 : ""}`.trim();
    const distanceValue = aheadM < 950
      ? String(Math.max(1, Math.round(aheadM)))
      : (aheadM / 1000).toFixed(aheadM < 10000 ? 1 : 0);
    const distanceUnit = aheadM < 950 ? "m" : "km";
    const clock = new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (!state.navigating) {
      where.hidden = true;
      eta.hidden = true;
      exit.hidden = true;
      paintRouteProgress(line);
      document.dispatchEvent(new CustomEvent("smartshield:nav-frame", { detail: { navigating: false } }));
      paintFeatures();
      return;
    }
    where.hidden = true;
    eta.hidden = false;
    exit.hidden = false;
    document.getElementById("nav-eta-title").textContent = clock;
    const mins = document.getElementById("nav-eta-mins");
    const km = document.getElementById("nav-eta-km");
    if (mins) mins.textContent = minuteValue;
    if (km) km.textContent = distanceValue;
    const unit = document.getElementById("nav-eta-unit");
    if (unit) unit.textContent = distanceUnit;
    const road = document.getElementById("nav-road");
    const roadName = (guide.road && guide.road !== "Unnamed road" ? guide.road : "") || state.roadName || "";
    if (road) {
      road.hidden = !roadName;
      road.textContent = roadName;
    }
    maybeSpeakSigns();
    paintRouteProgress(line);
    publishNavFrame(line);
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
    const api = window.NavProgress;
    if (!api || !maneuver) return;
    const cue = api.voiceCue(maneuver, state.roadMode, state.spokenCues);
    if (!cue) return;
    cue.mark.forEach((flag) => { state.spokenCues[flag] = true; });
    state.spokenTurn = cue.key;
    speak(cue.phrase);
  }

  function maybeSpeakSigns() {
    const api = window.NavProgress;
    if (!state.navigating || !api || state.muted || !state.position) return;
    const line = routeLine();
    if (line.length < 2) return;
    const ahead = api.featuresAhead(state.signs || [], line, state.position.lat, state.position.lon);
    const cue = api.signAlert(ahead, state.spokenSigns, Date.now(), state.lastSignSpeech, 8000);
    if (!cue) return;
    state.spokenSigns[cue.key] = true;
    state.lastSignSpeech = Date.now();
    speak(cue.phrase);
  }

  let progressLayer = null;

  function paintRouteProgress(line) {
    const leaflet = map();
    if (!leaflet || !window.L || !window.NavProgress) return;
    if (!progressLayer) progressLayer = window.L.layerGroup().addTo(leaflet);
    progressLayer.clearLayers();
    if (!state.navigating || !state.match || line.length < 2) return;
    const parts = window.NavProgress.cutLine(line, state.match.alongM);
    if (parts.traveled.length >= 2) {
      window.L.polyline(parts.traveled, {
        color: "#8b97a6", weight: 8, opacity: 0.95, smoothFactor: 0, interactive: false,
      }).addTo(progressLayer);
    }
  }

  function publishNavFrame(line) {
    if (!state.navigating || !state.position || !window.NavProgress) return;
    const parts = state.match ? window.NavProgress.cutLine(line, state.match.alongM) : { traveled: [], ahead: line };
    const target = state.match && state.match.snapped
      ? { lat: state.match.lat, lon: state.match.lon }
      : state.position;
    document.dispatchEvent(new CustomEvent("smartshield:nav-frame", {
      detail: {
        navigating: true,
        lat: target.lat,
        lon: target.lon,
        bearing: state.headingUp ? (state.aim == null ? state.bearing : state.aim) : 0,
        jump: !!state.jumpCamera,
        zoom: window.NavProgress.navZoom(state.speedKmh, state.maneuver && state.maneuver.distanceM),
        pitch: 52,
        night: document.documentElement.getAttribute("data-theme") === "dark",
        traveled: parts.traveled,
        ahead: parts.ahead,
        signs: window.NavProgress.featuresAhead(state.signs || [], line, state.position.lat, state.position.lon),
      },
    }));
  }

  function followCamera() {
    if (document.body.classList.contains("nav-gl-live")) return;
    const leaflet = map();
    const pos = state.match && state.match.snapped
      ? { lat: state.match.lat, lon: state.match.lon }
      : state.position;
    if (!leaflet || !pos) return;
    const zoom = window.NavProgress
      ? window.NavProgress.navZoom(state.speedKmh, state.maneuver && state.maneuver.distanceM)
      : 17;
    if (state.headingUp && typeof leaflet.setBearing === "function") {
      leaflet.setBearing(state.bearing || 0);
    } else if (typeof leaflet.setBearing === "function") {
      leaflet.setBearing(0);
    }
    leaflet.setView([pos.lat, pos.lon], zoom, { animate: true, duration: 0.6 });
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
    if (!alerts.length || Date.now() - state.lastCameraSpeech < 8000) return;
    state.spokenCameras[alerts[0].id] = true;
    state.lastCameraSpeech = Date.now();
    speak(alerts[0].phrase);
  }

  function signIcon(kind) {
    if (kind === "signal") {
      return window.L.divIcon({
        className: "plain-sign",
        html: '<div class="nav-signal" style="transform:scale(0.8)"><i></i><i class="on"></i><i></i></div>',
        iconSize: [10, 20],
        iconAnchor: [5, 10],
      });
    }
    const allWay = kind === "stop-all";
    const box = window.SmartShieldStop.layout(allWay);
    const scale = 0.62;
    const width = Math.round(box.width * scale);
    const height = Math.round(box.height * scale);
    return window.L.divIcon({
      className: "plain-sign",
      html: `<div style="width:${box.width}px;height:${box.height}px;transform:scale(${scale});transform-origin:top left">${window.SmartShieldStop.svg(allWay)}</div>`,
      iconSize: [width, height],
      iconAnchor: [Math.round(box.cx * scale), Math.round(box.cy * scale)],
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

  function signQuery(lat, lon) {
    const line = routeLine();
    const along = state.match && typeof state.match.alongM === "number" ? state.match.alongM : 0;
    const ahead = window.NavProgress && line.length > 1 ? window.NavProgress.cutLine(line, along).ahead : [];
    if (state.navigating && ahead.length > 1) {
      const sample = [];
      let walked = 0;
      let mark = 0;
      ahead.forEach((point, index) => {
        if (index > 0) walked += haversineM(ahead[index - 1][0], ahead[index - 1][1], point[0], point[1]);
        if (walked > 1600) return;
        if (index === 0 || walked - mark >= 90) {
          sample.push(point);
          mark = walked;
        }
      });
      const coords = sample.slice(0, 16).map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join(",");
      const key = sample.length ? `along:${sample[0][0].toFixed(3)},${sample[0][1].toFixed(3)}` : `${lat.toFixed(2)},${lon.toFixed(2)}`;
      return {
        key,
        query: `[out:json][timeout:20];(node["highway"="traffic_signals"](around:70,${coords});node["highway"="stop"](around:70,${coords}););out body;`,
      };
    }
    return {
      key: `${lat.toFixed(2)},${lon.toFixed(2)}`,
      query: `[out:json][timeout:12];(node["highway"="traffic_signals"](around:1200,${lat},${lon});node["highway"="stop"](around:1200,${lat},${lon}););out body;`,
    };
  }

  async function overpassElements(query) {
    const hosts = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];
    for (let index = 0; index < hosts.length; index += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(hosts[index], {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const data = await response.json();
        return data.elements || [];
      } catch (err) {
        /* Try the next Overpass host. */
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function loadSigns(lat, lon) {
    const request = signQuery(lat, lon);
    if (request.key === state.signCell) return;
    state.signCell = request.key;
    const cacheKey = `smartshield.osmSigns.v2.${request.key}`;
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (saved && saved.at && Date.now() - saved.at < 6 * 60 * 60 * 1000 && Array.isArray(saved.signs) && saved.signs.length) {
        state.signs = saved.signs;
        paintFeatures();
        return;
      }
    } catch (err) { /* lookup again */ }
    const elements = await overpassElements(request.query);
    if (!elements) return;
    const signs = [];
    elements.forEach((element) => {
      if (element.lat == null || element.lon == null) return;
      const highway = element.tags && element.tags.highway;
      if (highway !== "traffic_signals" && highway !== "stop") return;
      signs.push({
        lat: element.lat,
        lon: element.lon,
        kind: highway === "stop" ? stopKind(element.tags) : "signal",
      });
    });
    if (signs.length) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), signs }));
      } catch (err) { /* cache is optional */ }
      state.signs = signs;
    }
    paintFeatures();
    if (state.navigating && routeLine().length) publishNavFrame(routeLine());
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
        document.body.classList.remove("nav-panned");
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
      state.spokenCues = {};
      state.spokenSigns = {};
      state.match = null;
      document.body.classList.remove("nav-panned");
      state.bearingSmooth = null;
      state.jumpCamera = true;
      document.dispatchEvent(new CustomEvent("smartshield:nav-frame", { detail: { navigating: false } }));
      document.body.classList.remove("is-navigating");
      document.body.classList.remove("nav-tools-open");
      const panel = document.getElementById("side-panel");
      const sheet = document.getElementById("bottom-sheet");
      if (panel) panel.classList.remove("is-collapsed");
      if (sheet) sheet.classList.remove("is-hidden");
      const recenterButton = document.getElementById("nav-recenter");
      if (recenterButton) recenterButton.hidden = true;
    }
    document.getElementById("nav-exit").addEventListener("click", () => {
      if (state.navigating && !window.confirm("End route? This stops guidance.")) return;
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
      state.spokenCues = {};
      state.spokenSigns = {};
      state.match = null;
      document.body.classList.remove("nav-panned");
      state.bearingSmooth = null;
      state.jumpCamera = true;
      document.body.classList.add("is-navigating");
      const panel = document.getElementById("side-panel");
      const sheet = document.getElementById("bottom-sheet");
      if (panel) {
        panel.classList.add("is-collapsed");
        panel.classList.remove("is-open");
      }
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
      state.spokenCues = {};
      renderEta();
    });
    document.addEventListener("smartshield:clear-nav", () => {
      state.route = null;
      state.navigating = false;
      document.body.classList.remove("is-navigating");
      document.body.classList.remove("nav-tools-open");
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
      if (detail.current_kmh != null) state.speedKmh = detail.current_kmh;
      if (detail.road_name) state.roadName = detail.road_name;
      if (detail.posted_kmh != null) state.posted = detail.posted_kmh;
      if (detail.road_mode) state.roadMode = detail.road_mode;
      maybeSpeakCameras();
      if (window.NavProgress) {
        const speedCue = window.NavProgress.speedAlert(detail.warning, state.speedSpeech, Date.now());
        state.speedSpeech = speedCue.state;
        if (speedCue.speak) speak(speedCue.phrase);
      }
      renderEta();
    });
    document.addEventListener("smartshield:usermove", (event) => {
      if (!event.detail || event.detail.reason !== "pan") return;
      state.following = false;
      const button = document.getElementById("nav-recenter");
      if (button && state.navigating) button.hidden = false;
      document.body.classList.toggle("nav-panned", !!state.navigating);
    });

    const panel = document.getElementById("side-panel");
    if (panel && narrow()) {
      panel.classList.add("is-collapsed");
      panel.classList.remove("is-open");
    }
    const collapse = document.getElementById("panel-collapse");
    if (collapse) {
      collapse.addEventListener("click", () => setTimeout(() => {
        syncDock();
        const panel = document.getElementById("side-panel");
        if (panel && panel.classList.contains("is-collapsed")) {
          document.body.classList.remove("nav-tools-open");
        }
      }, 40));
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
