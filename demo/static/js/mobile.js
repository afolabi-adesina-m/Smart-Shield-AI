/* Smart-Shield mobile — portrait map + bottom sheet (iPhone / Android) */

let map;
let routeLayers = [];
let markerGroup;
let lastScoredRoutes = [];
let lastOsrmRoutes = [];
let lastTravelPayload = null;
let selectedItinerary = 0;
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
  const mapOptions = { zoomControl: false, attributionControl: true, zoomSnap: 1, zoomDelta: 1 };
  try {
    map = L.map("map", Object.assign({
      rotate: true,
      bearing: 0,
      touchRotate: false,
      rotateControl: false,
    }, mapOptions)).setView([43.6532, -79.3832], 9);
  } catch (err) {
    map = L.map("map", mapOptions).setView([43.6532, -79.3832], 9);
  }
  document.addEventListener("smartshield:clear-nav", () => {
    routeLayers.forEach((layer) => map.removeLayer(layer));
    routeLayers = [];
    if (markerGroup) markerGroup.clearLayers();
    clearDirectionPreview();
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  if (window.SmartShieldTheme) window.SmartShieldTheme.attachMap(map);

  markerGroup = L.layerGroup().addTo(map);
  initSpeedAwareness(map);
  document.getElementById("status").textContent = "Set a start and destination.";
}

function publishSpeedContext(snapToRoute) {
  const route = lastScoredRoutes.find((r) => r.route_index === selectedIndex) || null;
  const osrm = lastOsrmRoutes[selectedIndex];
  document.dispatchEvent(new CustomEvent("smartshield:context", {
    detail: {
      route,
      geometry: osrm ? osrm.geometry : null,
      weather: (document.getElementById("weather") || {}).value || "auto",
      snapToRoute: !!snapToRoute,
    },
  }));
}

function initBottomSheet() {
  const sheet = document.getElementById("bottom-sheet");
  const handle = document.getElementById("sheet-handle");
  let startY = 0;
  let startState = "peek";

  const states = ["peek", "half", "full"];

  handle.addEventListener("click", () => {
    const i = states.indexOf(sheet.dataset.state);
    const next = i >= states.length - 1 ? "peek" : states[i + 1];
    setSheetState(next);
    if (next === "peek") document.body.classList.remove("nav-tools-open");
  });

  handle.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    startState = sheet.dataset.state;
  }, { passive: true });

  handle.addEventListener("touchend", (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    const idx = states.indexOf(startState);
    if (dy < -40 && idx < states.length - 1) {
      setSheetState(states[idx + 1]);
    } else if (dy > 40 && idx > 0) {
      setSheetState(states[idx - 1]);
    }
  }, { passive: true });

  publishSheetOffset();
  window.addEventListener("resize", () => {
    publishSheetOffset();
    setTimeout(() => map && map.invalidateSize(), 200);
  });
}

function publishSheetOffset() {
  const sheet = document.getElementById("bottom-sheet");
  if (!sheet) return;
  const height = Math.round(sheet.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--sheet-offset", height + "px");
}

function setSheetState(state) {
  const sheet = document.getElementById("bottom-sheet");
  if (sheet) {
    sheet.dataset.state = state;
    requestAnimationFrame(publishSheetOffset);
    setTimeout(() => {
      publishSheetOffset();
      if (map) map.invalidateSize();
    }, 320);
  }
}

async function findRoutes() {
  const btn = document.getElementById("btn-route");
  const status = document.getElementById("status");
  const origin = document.getElementById("origin").value.trim();
  const destination = document.getElementById("destination").value.trim();
  const weather = document.getElementById("weather").value;
  const visionMode = (document.getElementById("vision-mode") || {}).value || "real";

  if (!origin || !destination) {
    status.textContent = "Enter origin and destination.";
    return;
  }

  btn.disabled = true;
  setSheetState("half");
  status.textContent = "Finding those places…";

  try {
    const [o, d] = await Promise.all([
      endpointPoint("origin"),
      endpointPoint("destination"),
    ]);

    const travel = window.TravelModes;
    const travelMode = travel ? travel.current() : "drive";
    status.textContent = travelMode === "transit" ? "Looking up transit…" : "Drawing the route…";
    const osrmData = travel
      ? await travel.fetchMode(o, d, travelMode, false)
      : await fetchRoutes(o, d);
    lastTravelPayload = osrmData;
    selectedItinerary = 0;
    if (!osrmData.routes || osrmData.routes.length === 0) {
      throw new Error(osrmData.error || "No route found.");
    }

    lastOsrmRoutes = osrmData.routes.slice(0, 3);
    const head = (osrmData.itineraries && osrmData.itineraries[0]) || lastOsrmRoutes[0] || {};
    if (travel) {
      travel.remember(o, d);
      travel.rememberSummary(
        travelMode,
        head.duration_s != null ? head.duration_s : head.duration,
        head.distance_m != null ? head.distance_m : head.distance,
      );
      travel.refreshSummaries(o, d);
    }

    document.getElementById("results-block").hidden = false;
    if (!travel || travel.isVehicle(travelMode)) {
      const routes = lastOsrmRoutes.map((route, i) => ({
        route_index: i,
        distance_m: route.distance,
        duration_s: route.duration,
        summary: route.summary || `Route ${i + 1}`,
        mid_lat: route.mid_lat,
        mid_lon: route.mid_lon,
      }));

      status.textContent = "Checking safety for this drive…";
      const resp = await fetch("/api/score-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes, weather, vision_mode: visionMode }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "API error");

      lastScoredRoutes = data.routes;
      selectedIndex = data.best_route_index ?? 0;

      renderHighRiskBanner(lastScoredRoutes);
      renderRouteCards(lastScoredRoutes);
      renderRoutePreview(lastScoredRoutes);
      drawRoutesOnMap(lastOsrmRoutes, selectedIndex, o, d);
      const safetyCard = document.getElementById("safety-card");
      if (safetyCard) safetyCard.hidden = false;
      publishSpeedContext(true);

      const worst = lastScoredRoutes.reduce(
        (a, b) => (a.safety_score >= b.safety_score ? a : b),
        lastScoredRoutes[0]
      );
      setSheetState(worst && worst.tier === "HIGH" ? "full" : "half");
      status.textContent = routes.length === 1 ? "1 route scored." : `${routes.length} routes scored.`;
    } else {
      lastScoredRoutes = [];
      selectedIndex = 0;
      const highRisk = document.getElementById("high-risk-banner");
      if (highRisk) {
        highRisk.hidden = true;
        highRisk.innerHTML = "";
      }
      const cards = document.getElementById("route-cards");
      if (cards) cards.innerHTML = "";
      const safetyCard = document.getElementById("safety-card");
      if (safetyCard) safetyCard.hidden = true;
      if (travel) travel.fillPreview(document.getElementById("route-preview"), osrmData);
      drawRoutesOnMap(shownRoutes(), 0, o, d);
      publishSpeedContext(false);
      setSheetState("half");
      status.textContent = osrmData.note || "Route ready. Road risk is for driving only.";
    }
  } catch (err) {
    status.textContent = err.message ? `Could not score the route. ${err.message}` : "Could not score the route.";
  }

  btn.disabled = false;
}

async function endpointPoint(inputId) {
  const el = document.getElementById(inputId);
  const lat = el ? parseFloat(el.dataset.lat) : NaN;
  const lon = el ? parseFloat(el.dataset.lon) : NaN;
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
    return { lat, lon, display_name: el.value.trim() };
  }
  return geocode((el && el.value.trim()) || "");
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

function scoreLabel(value) {
  if (value == null || value === "") return "—";
  return String(value);
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

function renderRoutePreview(scored) {
  const box = document.getElementById("route-preview");
  if (!box) return;
  box.innerHTML = "";
  if (!scored || !scored.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const sorted = [...scored].sort((a, b) => (a.safety_rank || 0) - (b.safety_rank || 0));
  sorted.forEach((route) => {
    const card = document.createElement("article");
    card.className = "route-preview-card" + (route.route_index === selectedIndex ? " is-selected" : "");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = route.duration_text || route.summary || "Route";
    const meta = document.createElement("span");
    meta.textContent = `${route.distance_km} km · ${route.summary || "Route"}`;
    const chip = document.createElement("em");
    chip.textContent = `Risk ${scoreLabel(route.safety_score)}`;
    copy.appendChild(title);
    copy.appendChild(meta);
    copy.appendChild(chip);
    const start = document.createElement("button");
    start.type = "button";
    start.className = "route-start";
    start.textContent = "Start";
    start.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedIndex = route.route_index;
      drawRoutesOnMap(lastOsrmRoutes, selectedIndex);
      document.dispatchEvent(new CustomEvent("smartshield:start-nav"));
    });
    card.addEventListener("click", () => {
      selectedIndex = route.route_index;
      document.querySelectorAll(".route-preview-card").forEach((el) => el.classList.remove("is-selected"));
      card.classList.add("is-selected");
      drawRoutesOnMap(lastOsrmRoutes, selectedIndex);
      if (typeof setSheetState === "function") setSheetState("half");
    });
    card.appendChild(copy);
    card.appendChild(start);
    box.appendChild(card);
  });
  const firstStart = box.querySelector(".route-start");
  if (firstStart && window.matchMedia("(max-width: 860px)").matches) {
    requestAnimationFrame(() => firstStart.scrollIntoView({ block: "center", inline: "nearest" }));
  }
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
        ? `<span class="speed-advisory">${escapeHtml(relText)}</span>`
        : `<span>Advisory ${r.recommended_speed_kmh} km/h</span>`;

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
        <div class="safety-pill" style="background:${r.tier_color}">S ${scoreLabel(r.safety_score)}</div>
      </div>
      ${highAlert}
      <div class="route-meta">
        <span>${r.duration_text}</span>
        <span>${r.distance_km} km</span>
        ${speedLine}
      </div>
      <details class="route-details">
        <summary>Model details</summary>
        <p class="route-brains">${r.tier} risk · text ${r.T_nlp} · vision ${r.V_vision} · environment ${r.E_index}${r.vision_source === "resnet18_live_cctv" ? " · live camera" : ""}</p>
        ${renderLiveDetails(r)}
      </details>
    `;

    card.addEventListener("click", () => {
      selectedIndex = idx;
      document.querySelectorAll(".route-card").forEach((el) => el.classList.remove("selected"));
      card.classList.add("selected");
      drawRoutesOnMap(lastOsrmRoutes, idx);
      updateMapBadge(r);
      publishSpeedContext(true);
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
  const pad = window.SmartShieldMapPadding
    ? window.SmartShieldMapPadding()
    : { paddingTopLeft: [24, 88], paddingBottomRight: [80, 220] };

  routes.forEach((route, i) => {
    const shapes = window.TravelModes && window.TravelModes.shapesFor(route, i === activeIndex);
    if (shapes && shapes.length) {
      shapes.forEach((shape) => {
        shape.latlngs.forEach((ll) => bounds.extend(ll));
        routeLayers.push(L.polyline(shape.latlngs, shape.options).addTo(map));
      });
      return;
    }
    const latlngs = (route.geometry || []).map(([lon, lat]) => [lat, lon]);
    latlngs.forEach((ll) => bounds.extend(ll));

    const isActive = i === activeIndex;
    if (isActive) {
      routeLayers.push(L.polyline(latlngs, { color: "#123a66", weight: 14, opacity: 0.95, smoothFactor: 0 }).addTo(map));
      routeLayers.push(L.polyline(latlngs, { color: "#4da3ff", weight: 8, opacity: 1, smoothFactor: 0 }).addTo(map));
    } else {
      routeLayers.push(L.polyline(latlngs, {
        color: ROUTE_COLORS[i % ROUTE_COLORS.length],
        weight: 5,
        opacity: 0.45,
      }).addTo(map));
    }
  });

  if (origin && dest) {
    L.marker([origin.lat, origin.lon]).addTo(markerGroup);
    L.marker([dest.lat, dest.lon]).addTo(markerGroup);
    bounds.extend([origin.lat, origin.lon]);
    bounds.extend([dest.lat, dest.lon]);
  }

  if (bounds.isValid()) {
    lastBounds = bounds;
    document.dispatchEvent(new CustomEvent("smartshield:clear-prep"));
    map.fitBounds(bounds, pad);
  }

  const scored = lastScoredRoutes.find((r) => r.route_index === activeIndex);
  if (scored) updateMapBadge(scored);
  showDirectionSteps(routes, activeIndex);
  const route = routes && routes[activeIndex];
  if (route) {
    const destInput = document.getElementById("destination");
    document.dispatchEvent(new CustomEvent("smartshield:nav-route", {
      detail: {
        geometry: route.geometry,
        distanceM: route.distance,
        durationS: route.duration,
        destination: (dest && dest.display_name) || (destInput && destInput.value) || "Destination",
        steps: route.steps || [],
        safetyScore: (lastScoredRoutes.find((item) => item.route_index === activeIndex) || {}).safety_score,
        travelMode: window.TravelModes ? window.TravelModes.current() : "drive",
        itinerary: lastTravelPayload && lastTravelPayload.itineraries
          ? lastTravelPayload.itineraries[selectedItinerary] || null
          : null,
      },
    }));
  }
}

function shownRoutes() {
  if (!lastTravelPayload || !lastTravelPayload.itineraries || !lastTravelPayload.itineraries.length) {
    return lastOsrmRoutes;
  }
  const item = lastTravelPayload.itineraries[selectedItinerary] || lastTravelPayload.itineraries[0];
  const route = (lastOsrmRoutes || [])[selectedItinerary] || lastOsrmRoutes[0];
  if (!route) return lastOsrmRoutes;
  return [{ ...route, legs: item.legs || route.legs || [] }];
}

document.addEventListener("smartshield:select-itinerary", (event) => {
  selectedItinerary = (event.detail && event.detail.index) || 0;
  if (lastOsrmRoutes.length) drawRoutesOnMap(shownRoutes(), 0);
});

function fitMapToRoute() {
  if (lastBounds && lastBounds.isValid()) {
    const pad = window.SmartShieldMapPadding
      ? window.SmartShieldMapPadding()
      : { paddingTopLeft: [24, 88], paddingBottomRight: [80, 220] };
    map.fitBounds(lastBounds, pad);
  }
}

function clearDirectionPreview() {
  if (window.RoadPreview && map) window.RoadPreview.clear(map, true);
  const list = document.getElementById("direction-steps");
  if (list) {
    list.innerHTML = "";
    list.hidden = true;
  }
  const label = document.getElementById("direction-steps-label");
  if (label) label.hidden = true;
}

function showDirectionSteps(routes, activeIndex) {
  if (!window.RoadPreview || !map) return;
  window.RoadPreview.clear(map, true);
  window.RoadPreview.attachHits(map, routes, routeLayers);
  const route = routes && routes[activeIndex];
  window.RoadPreview.fillList(map, document.getElementById("direction-steps"), (route && route.steps) || []);
}

function updateMapBadge(route) {
  const badge = document.getElementById("safety-card") || document.getElementById("map-badge");
  const scoreEl = document.getElementById("badge-score");
  if (!badge || !scoreEl || !route) return;

  badge.hidden = false;
  badge.removeAttribute("hidden");
  const section = document.getElementById("safety-section");
  if (section) section.open = true;
  badge.dataset.tier = (route.tier || "").toLowerCase();
  scoreEl.textContent = scoreLabel(route.safety_score);
  scoreEl.style.color = "";
  const tier = document.getElementById("safety-tier");
  if (tier) tier.textContent = route.tier || "";
  const line = document.getElementById("safety-line");
  if (line) line.textContent = primaryGuidance(route);
}


