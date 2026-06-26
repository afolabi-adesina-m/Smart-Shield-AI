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
  document.getElementById("btn-route").addEventListener("click", findRoutes);
});

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([43.6532, -79.3832], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  markerGroup = L.layerGroup().addTo(map);
  document.getElementById("status").textContent = "Ready — enter routes and click Find safest routes.";
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

function renderRouteCards(scored) {
  const container = document.getElementById("route-cards");
  container.innerHTML = "";

  const sorted = [...scored].sort((a, b) => a.safety_rank - b.safety_rank);

  sorted.forEach((r) => {
    const idx = r.route_index;
    const isBest = r.safety_rank === 1;
    const card = document.createElement("div");
    card.className = "route-card" + (isBest ? " best" : "") + (idx === selectedIndex ? " selected" : "");

    card.innerHTML = `
      <div class="route-card-header">
        <div>
          ${isBest ? '<div class="rank-tag">★ Safest pick</div>' : `<div class="rank-tag">Option ${r.safety_rank}</div>`}
          <div class="route-title">${escapeHtml(r.summary)}</div>
        </div>
        <div class="safety-pill" style="background:${r.tier_color}">S ${r.safety_score}</div>
      </div>
      <div class="route-meta">
        <span>🕐 ${r.duration_text}</span>
        <span>📍 ${r.distance_km} km</span>
        <span>🚗 ${r.recommended_speed_kmh} km/h</span>
      </div>
      <div class="route-brains">
        ${r.tier} risk · T=${r.T_nlp} V=${r.V_vision} E=${r.E_index}
        ${r.collision_risk_index != null ? ` · Collision P=${r.collision_risk_index}` : ""}
      </div>
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
  badge.hidden = false;
  scoreEl.textContent = route.safety_score;
  scoreEl.style.color = route.tier_color;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
