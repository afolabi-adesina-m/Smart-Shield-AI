/* Smart-Shield mobile — portrait map + bottom sheet (iPhone / Android) */

let map;
let routeLayers = [];
let markerGroup;
let lastScoredRoutes = [];
let lastOsrmRoutes = [];
let selectedIndex = 0;
let lastBounds = null;

const ROUTE_COLORS = ["#1a73e8", "#e8710a", "#9334e6"];

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initBottomSheet();
  initWeatherPicker(null, "weather");
  updateWeatherSummary(document.getElementById("weather").value);
  document.getElementById("weather").addEventListener("weather-change", (e) => {
    updateWeatherSummary(e.detail.value);
  });
  document.getElementById("weather").addEventListener("change", (e) => {
    updateWeatherSummary(e.target.value);
  });
  document.getElementById("btn-route").addEventListener("click", findRoutes);
  document.getElementById("btn-locate-map").addEventListener("click", fitMapToRoute);
  window.addEventListener("orientationchange", () => {
    setTimeout(() => map && map.invalidateSize(), 300);
  });
});

function updateWeatherSummary(value) {
  const el = document.getElementById("weather-summary");
  if (el) {
    el.innerHTML = `Selected: <strong>${getWeatherLabel(value)}</strong>`;
  }
}

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
  }).setView([43.6532, -79.3832], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OSM',
  }).addTo(map);

  markerGroup = L.layerGroup().addTo(map);
  document.getElementById("status").textContent = "Enter a route and tap Find safest routes.";
}

function initBottomSheet() {
  const sheet = document.getElementById("bottom-sheet");
  const handle = document.getElementById("sheet-handle");
  let startY = 0;
  let startState = "peek";

  const states = ["peek", "half", "full"];

  handle.addEventListener("click", () => {
    const i = states.indexOf(sheet.dataset.state);
    sheet.dataset.state = states[Math.min(i + 1, states.length - 1)];
    setTimeout(() => map && map.invalidateSize(), 320);
  });

  handle.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    startState = sheet.dataset.state;
  }, { passive: true });

  handle.addEventListener("touchend", (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    const idx = states.indexOf(startState);
    if (dy < -40 && idx < states.length - 1) {
      sheet.dataset.state = states[idx + 1];
    } else if (dy > 40 && idx > 0) {
      sheet.dataset.state = states[idx - 1];
    }
    setTimeout(() => map && map.invalidateSize(), 320);
  }, { passive: true });
}

function setSheetState(state) {
  const sheet = document.getElementById("bottom-sheet");
  if (sheet) {
    sheet.dataset.state = state;
    setTimeout(() => map && map.invalidateSize(), 320);
  }
}

async function findRoutes() {
  const btn = document.getElementById("btn-route");
  const status = document.getElementById("status");
  const origin = document.getElementById("origin").value.trim();
  const destination = document.getElementById("destination").value.trim();
  const weather = document.getElementById("weather").value;

  if (!origin || !destination) {
    status.textContent = "Enter origin and destination.";
    return;
  }

  btn.disabled = true;
  setSheetState("half");
  status.textContent = "Looking up addresses…";

  try {
    const [o, d] = await Promise.all([geocode(origin), geocode(destination)]);

    status.textContent = "Fetching routes (OSRM)…";
    const osrmData = await fetchRoutes(o, d);
    if (!osrmData.routes || osrmData.routes.length === 0) {
      throw new Error("No driving routes found.");
    }

    lastOsrmRoutes = osrmData.routes.slice(0, 3);
    const routes = lastOsrmRoutes.map((route, i) => ({
      route_index: i,
      distance_m: route.distance,
      duration_s: route.duration,
      summary: route.summary || `Route ${i + 1}`,
      // Fix 2/3: midpoint from /api/directions lets the backend look up
      // real nearby 511 alerts + real weather for this route.
      mid_lat: route.mid_lat,
      mid_lon: route.mid_lon,
    }));

    status.textContent = "Scoring with Smart-Shield…";
    const resp = await fetch("/api/score-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes, weather }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "API error");

    lastScoredRoutes = data.routes;
    selectedIndex = data.best_route_index ?? 0;

    document.getElementById("results-block").hidden = false;
    renderHighRiskBanner(lastScoredRoutes);
    renderRouteCards(lastScoredRoutes);
    drawRoutesOnMap(lastOsrmRoutes, selectedIndex, o, d);

    const worst = lastScoredRoutes.reduce(
      (a, b) => (a.safety_score >= b.safety_score ? a : b),
      lastScoredRoutes[0]
    );
    setSheetState(worst && worst.tier === "HIGH" ? "full" : "half");
    status.textContent = `${routes.length} route(s) ranked · tap card for map`;

    document.getElementById("high-risk-banner").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }

  btn.disabled = false;
}

async function geocode(query) {
  const resp = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Not found: ${query}`);
  return data;
}

async function fetchRoutes(origin, dest) {
  const url = `/api/directions?from_lon=${origin.lon}&from_lat=${origin.lat}&to_lon=${dest.lon}&to_lat=${dest.lat}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Routing failed");
  return data;
}

function primaryGuidance(route) {
  if (route.operational_message) return route.operational_message;
  if (route.tier === "HIGH") return "Consider postponing this trip — conditions are hazardous.";
  if (route.tier === "MEDIUM") return "Increase caution — reduce speed and following distance.";
  return "Conditions appear favourable — drive to posted limit and stay alert.";
}

function relativeSpeedText(route) {
  if (route.relative_speed_text) return route.relative_speed_text;
  if (route.tier === "HIGH") {
    return "If driving, reduce speed well below typical highway flow and stay in the right lane.";
  }
  return "";
}

function renderHighRiskBanner(scored) {
  const el = document.getElementById("high-risk-banner");
  if (!el) return;

  const worst = scored.reduce(
    (a, b) => (a.safety_score >= b.safety_score ? a : b),
    scored[0]
  );

  if (!worst || worst.tier !== "HIGH") {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  el.hidden = false;
  const message = primaryGuidance(worst);
  const steps = (worst.guidance_steps && worst.guidance_steps.length
    ? worst.guidance_steps
    : [
        "Consider postponing travel or waiting until conditions improve.",
        "If you must travel, use the lowest Safety Score route shown.",
        "Right lane, hazard lights, match truck pace.",
      ]
  )
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("");

  el.innerHTML = `
    <div class="high-risk-banner-title">⚠ HIGH RISK — TRIP ADVISORY</div>
    <strong class="high-risk-banner-lead">${escapeHtml(message)}</strong>
    <ul class="guidance-steps">${steps}</ul>
    <p class="relative-speed">${escapeHtml(relativeSpeedText(worst))}</p>
  `;
}

function renderRouteCards(scored) {
  const container = document.getElementById("route-cards");
  container.innerHTML = "";

  const sorted = [...scored].sort((a, b) => a.safety_rank - b.safety_rank);

  sorted.forEach((r) => {
    const idx = r.route_index;
    const isBest = r.safety_rank === 1;
    const card = document.createElement("div");
    card.className = "route-card" + (isBest ? " best" : "") + (idx === selectedIndex ? " selected" : "");

    const guidance = primaryGuidance(r);
    const relText = relativeSpeedText(r);
    const speedLine =
      r.tier === "HIGH"
        ? `<span class="speed-advisory">⚠ ${escapeHtml(relText)}</span>`
        : `<span>🚗 ~${r.recommended_speed_kmh} km/h</span>`;

    const highAlert =
      r.tier === "HIGH"
        ? `<div class="card-high-alert">⚠ ${escapeHtml(guidance)}</div>`
        : `<div class="operational-msg">${escapeHtml(guidance)}</div>`;

    card.innerHTML = `
      <div class="route-card-header">
        <div>
          ${isBest ? '<div class="rank-tag">★ Safest pick</div>' : `<div class="rank-tag">Option ${r.safety_rank}</div>`}
          <div class="route-title">${escapeHtml(r.summary)}</div>
        </div>
        <div class="safety-pill" style="background:${r.tier_color}">S ${r.safety_score}</div>
      </div>
      ${highAlert}
      <div class="route-meta">
        <span>🕐 ${r.duration_text}</span>
        <span>📍 ${r.distance_km} km</span>
        ${speedLine}
      </div>
      <div class="route-brains">${r.tier} · T=${r.T_nlp} V=${r.V_vision} E=${r.E_index}</div>
      ${renderLiveDetails(r)}
    `;

    card.addEventListener("click", () => {
      selectedIndex = idx;
      document.querySelectorAll(".route-card").forEach((el) => el.classList.remove("selected"));
      card.classList.add("selected");
      drawRoutesOnMap(lastOsrmRoutes, idx);
      updateMapBadge(r);
      setSheetState("half");
    });

    container.appendChild(card);
  });

  const best = sorted[0];
  if (best) updateMapBadge(best);
}

function drawRoutesOnMap(routes, activeIndex, origin = null, dest = null) {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeLayers = [];
  markerGroup.clearLayers();

  const bounds = L.latLngBounds([]);
  const pad = window.matchMedia("(orientation: landscape)").matches
    ? [30, 30]
    : [20, 80];

  routes.forEach((route, i) => {
    const latlngs = route.geometry.map(([lon, lat]) => [lat, lon]);
    latlngs.forEach((ll) => bounds.extend(ll));

    const isActive = i === activeIndex;
    const layer = L.polyline(latlngs, {
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      weight: isActive ? 6 : 3,
      opacity: isActive ? 0.92 : 0.35,
    }).addTo(map);
    routeLayers.push(layer);
  });

  if (origin && dest) {
    L.marker([origin.lat, origin.lon]).addTo(markerGroup);
    L.marker([dest.lat, dest.lon]).addTo(markerGroup);
    bounds.extend([origin.lat, origin.lon]);
    bounds.extend([dest.lat, dest.lon]);
  }

  if (bounds.isValid()) {
    lastBounds = bounds;
    map.fitBounds(bounds, { padding: pad });
  }

  const scored = lastScoredRoutes.find((r) => r.route_index === activeIndex);
  if (scored) updateMapBadge(scored);
}

function fitMapToRoute() {
  if (lastBounds && lastBounds.isValid()) {
    const pad = window.matchMedia("(orientation: landscape)").matches ? [30, 30] : [20, 80];
    map.fitBounds(lastBounds, { padding: pad });
  }
}

function updateMapBadge(route) {
  const badge = document.getElementById("map-badge");
  const scoreEl = document.getElementById("badge-score");
  badge.hidden = false;
  scoreEl.textContent = route.safety_score;
  scoreEl.style.color = route.tier_color;
}


