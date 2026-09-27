/* Ontario G2/G practice loops. Scoring uses the existing road-context endpoint. */

(function () {
  const CAPS = { stop: 15, signal: 30, school: 40, crosswalk: 30, ramp: 50 };
  const FALLBACK = {
    over_posted: 8,
    above_safe: 3,
    school_speeding: 15,
    missed_signal: 10,
    missed_stop: 10,
    missed_crosswalk: 10,
  };
  const CHECKS = [
    ["licence", "Licence and road-test appointment"],
    ["papers", "Ownership, insurance, and plate stickers"],
    ["mirrors", "Mirrors set and a blind-spot head check"],
    ["stops", "Full stop behind the line at every stop sign"],
    ["belt", "Seatbelts on before moving"],
  ];

  let centres = [];
  let loop = null;
  let layer = null;
  let playing = false;
  let penalties = FALLBACK;
  let drawing = false;

  function host() {
    return document.getElementById("test-prep");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function savedChecks() {
    try {
      return JSON.parse(localStorage.getItem("smartshield-test-checklist") || "{}");
    } catch (err) {
      return {};
    }
  }

  function renderShell(disclaimer) {
    const root = host();
    if (!root || root.dataset.ready) return;
    root.dataset.ready = "1";
    const checks = savedChecks();
    root.innerHTML = `
      <div class="test-row">
        <select id="test-centre" aria-label="DriveTest centre"></select>
        <select id="test-level" aria-label="Test level">
          <option value="G2">G2</option>
          <option value="G">G</option>
        </select>
      </div>
      <p id="test-centre-note" class="approx-note" hidden></p>
      <div class="section-action">
        <button id="test-build" type="button" class="btn-primary">Build practice loop</button>
      </div>
      <button id="test-play" type="button" class="btn-primary" disabled>Start practice drive</button>
      <div class="test-score"><strong id="test-score">—</strong><span>Practice score</span></div>
      <p id="test-status" class="status-msg" role="status"></p>
      <ul id="test-points" class="test-points"></ul>
      <ul class="test-checks">
        ${CHECKS.map(([id, label]) => `
          <li><label><input type="checkbox" data-check="${id}" ${checks[id] ? "checked" : ""} /> ${escapeHtml(label)}</label></li>
        `).join("")}
      </ul>
      <p id="test-disclaimer" class="test-disclaimer">${escapeHtml(disclaimer || "")}</p>
    `;
    root.querySelectorAll("[data-check]").forEach((box) => {
      box.addEventListener("change", () => {
        const next = savedChecks();
        next[box.dataset.check] = box.checked;
        try { localStorage.setItem("smartshield-test-checklist", JSON.stringify(next)); } catch (err) { /* ignore */ }
      });
    });
    document.getElementById("test-centre").addEventListener("change", noteCentre);
    document.getElementById("test-build").addEventListener("click", () => {
      buildLoop().catch((err) => setStatus(err.message || "Could not build a loop."));
    });
    document.getElementById("test-play").addEventListener("click", () => {
      playLoop().catch((err) => setStatus(err.message || "Practice drive stopped."));
    });
  }

  function noteCentre() {
    const select = document.getElementById("test-centre");
    const note = document.getElementById("test-centre-note");
    const centre = centres.find((item) => item.id === (select && select.value));
    if (!note || !centre) return;
    note.hidden = !centre.coords_approximate;
    note.textContent = centre.coords_approximate
      ? "Map point is approximate for this plaza or unit."
      : "";
  }

  function setStatus(text) {
    const el = document.getElementById("test-status");
    if (el) el.textContent = text || "";
  }

  function fillCentres(list) {
    const select = document.getElementById("test-centre");
    if (!select) return;
    select.innerHTML = list.map((centre) => (
      `<option value="${escapeHtml(centre.id)}">${escapeHtml(centre.name)}</option>`
    )).join("");
    noteCentre();
  }

  async function loadCentres() {
    const root = host();
    if (!root) return;
    renderShell("Practice suggestions only. These are not official DriveTest routes.");
    try {
      const response = await fetch("/api/test-centres");
      const data = await response.json();
      centres = data.centres || [];
      fillCentres(centres);
      const disclaimer = document.getElementById("test-disclaimer");
      if (disclaimer && data.disclaimer) disclaimer.textContent = data.disclaimer;
    } catch (err) {
      setStatus("DriveTest centre list is unavailable.");
    }
    try {
      const rules = await fetch("/api/street-rules").then((response) => response.json());
      if (rules && rules.score && rules.score.penalties) penalties = rules.score.penalties;
    } catch (err) { /* locked engine: use the same public trip penalties */ }
  }

  function map() {
    return window.SmartShieldMap && window.SmartShieldMap();
  }

  function ensureLayer() {
    const leaflet = map();
    if (!leaflet || typeof L === "undefined") return null;
    if (!layer) layer = L.layerGroup().addTo(leaflet);
    return layer;
  }

  function clearPrep() {
    if (layer) layer.clearLayers();
    loop = null;
    const play = document.getElementById("test-play");
    if (play) play.disabled = true;
  }

  function drawLoop(data) {
    const group = ensureLayer();
    const leaflet = map();
    if (!group || !leaflet) return;
    group.clearLayers();
    const latlngs = (data.geometry || []).map(([lon, lat]) => [lat, lon]);
    const line = L.polyline(latlngs, { color: "#1a56db", weight: 6, opacity: 0.9 }).addTo(group);
    const bounds = line.getBounds();
    (data.points || []).forEach((point) => {
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: 7,
        color: "#1a56db",
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 1,
      }).addTo(group);
      marker.bindTooltip(point.label, { direction: "top" });
      bounds.extend([point.lat, point.lon]);
    });
    if (data.centre) bounds.extend([data.centre.lat, data.centre.lon]);
    const pad = window.SmartShieldMapPadding ? window.SmartShieldMapPadding() : { padding: [40, 40] };
    if (bounds.isValid()) leaflet.fitBounds(bounds, pad);
    const list = document.getElementById("test-points");
    if (list) {
      const items = data.points || [];
      list.innerHTML = items.length
        ? items.map((point) => `<li>${escapeHtml(point.label)}</li>`).join("")
        : "<li>No examiner points on this short loop. The drive still follows the streets.</li>";
    }
  }

  async function buildLoop() {
    const centre = document.getElementById("test-centre").value;
    const level = document.getElementById("test-level").value;
    setStatus("Building a practice loop…");
    const response = await fetch("/api/test-loop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centre_id: centre, level }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not build a loop.");
    loop = data;
    drawing = true;
    document.dispatchEvent(new CustomEvent("smartshield:clear-nav"));
    drawing = false;
    drawLoop(data);
    const play = document.getElementById("test-play");
    if (play) play.disabled = false;
    const km = (data.distance_m / 1000).toFixed(1);
    const extra = data.overpass_note ? " " + data.overpass_note : "";
    setStatus(`${data.centre.name} · ${data.level} · ${km} km loop.${extra}`);
    const score = document.getElementById("test-score");
    if (score) score.textContent = "—";
  }

  function nearest(lat, lon) {
    let best = null;
    let bestM = 80;
    (loop.points || []).forEach((point) => {
      if (!point.scored) return;
      const meters = distance(lat, lon, point.lat, point.lon);
      if (meters < bestM) {
        best = point;
        bestM = meters;
      }
    });
    return best;
  }

  function distance(lat1, lon1, lat2, lon2) {
    const radius = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function speedFor(lat, lon, posted) {
    const limit = posted || 50;
    const point = nearest(lat, lon);
    if (!point) return Math.max(20, Math.min(limit - 5, 50));
    const cap = CAPS[point.kind];
    if (cap) return Math.min(limit, cap);
    return Math.max(20, Math.min(limit - 5, 50));
  }

  async function roadAt(lat, lon) {
    const response = await fetch("/api/road-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon, demo: true, geometry: loop.geometry }),
    });
    if (!response.ok) return null;
    return response.json();
  }

  async function playLoop() {
    if (!loop || playing) return;
    playing = true;
    const button = document.getElementById("test-play");
    if (button) button.disabled = true;
    let score = 100;
    const seen = {};
    const coords = loop.geometry || [];
    const stride = Math.max(1, Math.floor(coords.length / 28));
    setStatus("Practice drive in progress.");
    for (let index = 0; index < coords.length; index += stride) {
      if (!playing) break;
      const [lon, lat] = coords[index];
      let posted = 50;
      let safe = 50;
      if (index % (stride * 6) === 0) {
        try {
          const road = await Promise.race([
            roadAt(lat, lon),
            new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (road) {
            posted = Number(road.posted_kmh) || posted;
            safe = Number(road.safe_kmh) || posted;
          }
        } catch (err) { /* keep the last limit */ }
      }
      const speed = speedFor(lat, lon, posted);
      if (window.SmartShieldSetLocation) window.SmartShieldSetLocation(lat, lon, "test-prep");
      if (window.SmartShieldSetSpeed) window.SmartShieldSetSpeed(speed, { silent: true });
      if (speed > posted && !seen.over) {
        seen.over = true;
        score -= penalties.over_posted || 8;
      } else if (speed > safe && speed <= posted && !seen.above) {
        seen.above = true;
        score -= penalties.above_safe || 3;
      }
      const point = nearest(lat, lon);
      if (point && !seen[point.kind + point.lat]) {
        const cap = CAPS[point.kind];
        if (cap && speed > cap) {
          seen[point.kind + point.lat] = true;
          const key = point.kind === "school" ? "school_speeding"
            : point.kind === "stop" ? "missed_stop"
            : point.kind === "crosswalk" ? "missed_crosswalk"
            : "missed_signal";
          score -= penalties[key] || 10;
        }
      }
      score = Math.max(0, Math.min(100, score));
      const scoreEl = document.getElementById("test-score");
      if (scoreEl) scoreEl.textContent = String(score);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    playing = false;
    if (button) button.disabled = false;
    setStatus("Practice drive finished. This score is a practice aid, not an examiner result.");
  }

  document.addEventListener("smartshield:clear-prep", () => {
    if (!drawing) clearPrep();
  });

  document.addEventListener("DOMContentLoaded", () => {
    loadCentres();
  });
})();
