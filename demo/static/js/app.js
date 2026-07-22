/* Smart-Shield × Leaflet / OpenStreetMap — free map demo */

let map;
let routeLayers = [];
let markerGroup;
let lastScoredRoutes = [];
let lastOsrmRoutes = [];
let selectedIndex = 0;

const ROUTE_COLORS = ["#1a73e8", "#e8710a", "#9334e6"];

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initWeatherPicker(null, "weather");
  updateWeatherSummary(document.getElementById("weather").value);
  document.getElementById("weather").addEventListener("weather-change", (e) => {
    updateWeatherSummary(e.detail.value);
  });
  document.getElementById("weather").addEventListener("change", (e) => {
    updateWeatherSummary(e.target.value);
  });
  document.getElementById("btn-route").addEventListener("click", findRoutes);
});

function updateWeatherSummary(value) {
  const el = document.getElementById("weather-summary");
  if (el) {
    el.innerHTML = `Selected: <strong>${getWeatherLabel(value)}</strong>`;
  }
}

function initMap() {
  map = L.map("map", { zoomControl: false }).setView([43.6532, -79.3832], 9);

  L.control.zoom({ position: "topright" }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  markerGroup = L.layerGroup().addTo(map);
  initMapBadgeControl();
  document.getElementById("status").textContent = "Ready — enter routes and click Find safest routes.";
}

function initMapBadgeControl() {
  const BadgeControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "map-badge");
      container.id = "map-badge";
      container.hidden = true;
      container.innerHTML = '<strong id="badge-score">—</strong><span>Safety Score</span>';
      L.DomEvent.disableClickPropagation(container);
      return container;
    },
  });
  new BadgeControl().addTo(map);
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
  status.textContent = "Looking up addresses (OpenStreetMap)…";

  try {
    const [o, d] = await Promise.all([
      geocode(origin),
      geocode(destination),
    ]);

    status.textContent = "Fetching route options (OSRM)…";
    const osrmData = await fetchRoutes(o, d);

    if (!osrmData.routes || osrmData.routes.length === 0) {
      throw new Error("No driving routes found between these points.");
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

    status.textContent = "Scoring routes with Smart-Shield models…";

    const resp = await fetch("/api/score-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes, weather }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "API error");

    lastScoredRoutes = data.routes;
    selectedIndex = data.best_route_index ?? 0;

    renderHighRiskBanner(lastScoredRoutes);
    renderRouteCards(lastScoredRoutes);
    drawRoutesOnMap(lastOsrmRoutes, selectedIndex, o, d);
    document.getElementById("routes-section").hidden = false;
    status.textContent = `${routes.length} route(s) · safest highlighted · free OSM data`;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }

  btn.disabled = false;
}

async function geocode(query) {
  const resp = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Could not find: ${query}`);
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
  if (route.tier === "HIGH") {
    return "Consider postponing this trip — conditions are hazardous.";
  }
  if (route.tier === "MEDIUM") {
    return "Increase caution — reduce speed and following distance.";
  }
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
        "Right lane, hazard lights, match truck pace — avoid isolated slow driving in passing lanes.",
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

  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
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
        : `<span>🚗 ~${r.recommended_speed_kmh} km/h advisory</span>`;

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
      <div class="route-brains">
        ${r.tier} risk · T=${r.T_nlp} V=${r.V_vision} E=${r.E_index}
        ${r.collision_risk_index != null && !r.collision_risk_calibrated ? " · Collision model (uncalibrated demo)" : ""}
      </div>
      ${renderLiveDetails(r)}
    `;

    card.addEventListener("click", () => {
      selectedIndex = idx;
      document.querySelectorAll(".route-card").forEach((el) => el.classList.remove("selected"));
      card.classList.add("selected");
      drawRoutesOnMap(lastOsrmRoutes, idx);
      updateMapBadge(r);
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

  routes.forEach((route, i) => {
    const latlngs = route.geometry.map(([lon, lat]) => [lat, lon]);
    latlngs.forEach((ll) => bounds.extend(ll));

    const isActive = i === activeIndex;
    const layer = L.polyline(latlngs, {
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      weight: isActive ? 7 : 4,
      opacity: isActive ? 0.92 : 0.35,
    }).addTo(map);
    routeLayers.push(layer);
  });

  if (origin && dest) {
    L.marker([origin.lat, origin.lon], { title: "Start" }).addTo(markerGroup)
      .bindPopup(`Start: ${origin.display_name || "Origin"}`);
    L.marker([dest.lat, dest.lon], { title: "End" }).addTo(markerGroup)
      .bindPopup(`End: ${dest.display_name || "Destination"}`);
    bounds.extend([origin.lat, origin.lon]);
    bounds.extend([dest.lat, dest.lon]);
  }

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  const scored = lastScoredRoutes.find((r) => r.route_index === activeIndex);
  if (scored) updateMapBadge(scored);
}

function updateMapBadge(route) {
  const badge = document.getElementById("map-badge");
  const scoreEl = document.getElementById("badge-score");
  if (!badge || !scoreEl) return;

  badge.hidden = false;
  badge.removeAttribute("hidden");
  scoreEl.textContent = route.safety_score;
  scoreEl.style.color = route.tier_color;
  badge.style.borderColor = route.tier_color;
}


