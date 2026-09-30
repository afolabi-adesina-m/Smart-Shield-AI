/* Travel-mode chips. Routing stays on /api/directions. No scores are invented. */
(function () {
  const KEY = "smartshield.travelMode.v1";
  const MODES = [
    { id: "drive", label: "Drive", icon: carIcon() },
    { id: "motorcycle", label: "Motorcycle", icon: bikeIcon() },
    { id: "cycle", label: "Cycle", icon: cycleIcon() },
    { id: "walk", label: "Walk", icon: walkIcon() },
    { id: "transit", label: "Transit", icon: busIcon() },
  ];
  let mode = load();
  let summaries = {};
  let endpoints = null;

  function load() {
    try {
      const saved = localStorage.getItem(KEY);
      if (MODES.some((item) => item.id === saved)) return saved;
    } catch (err) { /* private mode */ }
    return "drive";
  }

  function save(next) {
    mode = next;
    try { localStorage.setItem(KEY, next); } catch (err) { /* ignore */ }
    document.body.dataset.travel = next;
    const button = document.getElementById("btn-route");
    if (button && !button.dataset.travelLock) {
      button.textContent = isVehicle(next) ? "Find safest route" : "Find route";
    }
    paint();
    const note = document.getElementById("travel-note");
    if (note) {
      note.hidden = next !== "motorcycle";
      note.textContent = next === "motorcycle"
        ? "Motorcycle uses the car route. Motorways are allowed in Ontario."
        : "";
    }
  }

  function isVehicle(value) {
    return value === "drive" || value === "motorcycle";
  }

  function current() {
    return mode;
  }

  function mount() {
    document.body.dataset.travel = mode;
    ensureNavHost();
    ["travel-modes", "nav-travel-modes"].forEach((id) => {
      const host = document.getElementById(id);
      if (!host || host.dataset.ready) return;
      host.dataset.ready = "1";
      host.classList.add("travel-modes");
      MODES.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "travel-mode";
        button.dataset.mode = item.id;
        button.setAttribute("aria-pressed", item.id === mode ? "true" : "false");
        button.innerHTML = `<span class="travel-mode-icon" aria-hidden="true">${item.icon}</span><span class="travel-mode-label"></span><span class="travel-mode-eta"></span><span class="travel-mode-dist"></span>`;
        button.querySelector(".travel-mode-label").textContent = item.label;
        button.addEventListener("click", () => choose(item.id));
        host.appendChild(button);
      });
    });
    save(mode);
  }

  function ensureNavHost() {
    if (document.getElementById("nav-travel-modes")) return;
    const card = document.getElementById("nav-card");
    const where = document.getElementById("nav-where");
    if (!card || !where) return;
    const host = document.createElement("div");
    host.id = "nav-travel-modes";
    host.setAttribute("aria-label", "Travel mode");
    card.insertBefore(host, where.nextSibling);
  }

  function choose(next) {
    if (!MODES.some((item) => item.id === next)) return;
    save(next);
    document.dispatchEvent(new CustomEvent("smartshield:travel-mode", { detail: { mode: next } }));
    if (endpoints) {
      const button = document.getElementById("btn-route");
      if (button) button.click();
    }
  }

  function paint() {
    document.querySelectorAll(".travel-mode").forEach((button) => {
      const id = button.dataset.mode;
      const on = id === mode;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      const eta = button.querySelector(".travel-mode-eta");
      const dist = button.querySelector(".travel-mode-dist");
      const item = summaries[id];
      if (!item || item.duration == null) {
        if (eta) eta.textContent = item && item.failed ? "Unavailable" : "";
        if (dist) dist.textContent = "";
        return;
      }
      if (eta) eta.textContent = durationText(item.duration);
      if (dist) dist.textContent = item.via === "car" ? "car route" : (item.distance == null ? "" : distanceText(item.distance));
    });
  }

  function remember(origin, dest) {
    endpoints = { origin, dest };
  }

  function rememberSummary(id, duration, distance) {
    summaries[id] = { duration, distance, failed: duration == null, via: id === "motorcycle" ? "car" : undefined };
    if (id === "drive" || id === "motorcycle") {
      summaries.drive = { duration, distance, failed: duration == null };
      summaries.motorcycle = { duration, distance, failed: duration == null, via: "car" };
    }
    paint();
  }

  async function refreshSummaries(origin, dest) {
    remember(origin, dest);
    const jobs = ["drive", "cycle", "walk", "transit"].filter((id) => id !== mode);
    await Promise.all(jobs.map(async (id) => {
      try {
        const data = await fetchMode(origin, dest, id, true);
        if (!modeEchoed(data, id)) {
          summaries[id] = { duration: null, distance: null, failed: true };
        } else if (id === "transit") {
          const item = (data.itineraries && data.itineraries[0]) || {};
          summaries[id] = {
            duration: item.duration_s == null ? null : item.duration_s,
            distance: item.distance_m == null ? null : item.distance_m,
            failed: item.duration_s == null,
          };
        } else {
          const head = (data.routes && data.routes[0]) || {};
          summaries[id] = {
            duration: head.duration == null ? null : head.duration,
            distance: head.distance == null ? null : head.distance,
            failed: head.duration == null,
          };
        }
        if (id === "drive") {
          summaries.motorcycle = summaries.drive && summaries.drive.duration != null
            ? { duration: summaries.drive.duration, distance: summaries.drive.distance, via: "car" }
            : { duration: null, distance: null, failed: true };
        }
      } catch (err) {
        summaries[id] = { duration: null, distance: null, failed: true };
        if (id === "drive") summaries.motorcycle = { duration: null, distance: null, failed: true };
      }
    }));
    paint();
  }

  function modeEchoed(data, id) {
    if (id === "drive") return !data.mode || data.mode === "drive";
    if (id === "transit") return data.mode === "transit" && data.itineraries && data.itineraries[0] && data.itineraries[0].duration_s != null;
    return data.mode === id;
  }

  async function fetchMode(origin, dest, id, summary) {
    const params = new URLSearchParams({
      from_lat: String(origin.lat),
      from_lon: String(origin.lon),
      to_lat: String(dest.lat),
      to_lon: String(dest.lon),
      mode: id || mode,
    });
    if (summary) params.set("summary", "1");
    const response = await fetch(`/api/directions?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Routing failed");
    return data;
  }

  function durationText(seconds) {
    const minutes = Math.max(1, Math.round(Number(seconds) / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  }

  function distanceText(metres) {
    if (metres == null || metres === "") return "";
    if (metres < 950) return `${Math.max(1, Math.round(metres))} m`;
    return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
  }

  function clock(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" });
  }

  function walkNotes(legs) {
    const notes = [];
    if (!legs.length) return notes;
    if (legs[0].mode !== "WALK") notes.push("Transitous did not include the walk to the first stop.");
    legs.forEach((leg, index) => {
      const next = legs[index + 1];
      if (next && leg.mode !== "WALK" && next.mode !== "WALK") {
        notes.push(`Transitous did not include the walk between ${leg.to_name || "the vehicle"} and ${next.from_name || "the next vehicle"}.`);
      }
    });
    if (legs[legs.length - 1].mode !== "WALK") notes.push("Transitous did not include the walk from the last stop to the destination.");
    legs.forEach((leg) => {
      if (leg.mode === "WALK" && (leg.geometry || []).length < 2) {
        notes.push(`Transitous did not include a path for the walk to ${leg.to_name || "the stop"}.`);
      }
    });
    return notes;
  }

  function walkCaption(leg) {
    const stop = leg.to_name || "the stop";
    const minutes = leg.walk_min != null ? `${leg.walk_min} min` : "time not provided";
    const distance = leg.distance_m != null ? distanceText(leg.distance_m) : "distance not provided";
    return `Walk to the stop · ${stop} · ${minutes} · ${distance}`;
  }

  function legTitle(leg) {
    if (!leg) return "";
    if (leg.mode === "WALK") {
      return leg.walk_min != null ? `Walk ${leg.walk_min} min` : "Walk";
    }
    const kind = {
      BUS: "Bus",
      TRAM: "Streetcar",
      SUBWAY: "Subway",
      RAIL: "Train",
      REGIONAL_RAIL: "Train",
      FERRY: "Ferry",
    }[leg.mode] || String(leg.mode || "Ride").replace(/_/g, " ");
    return leg.line ? `${kind} ${leg.line}` : kind;
  }

  function fillPreview(box, payload) {
    if (!box) return;
    box.innerHTML = "";
    box.hidden = false;
    const note = document.createElement("p");
    note.className = "travel-note";
    if (payload.mode === "transit") {
      note.textContent = payload.note || "Scheduled times from Transitous. Not live departures.";
    } else {
      note.textContent = payload.note || "Road risk is for driving only.";
    }
    box.appendChild(note);
    const itineraries = payload.itineraries || [];
    if (itineraries.length) {
      itineraries.forEach((item, index) => {
        box.appendChild(itineraryCard(item, index));
      });
      return;
    }
    (payload.routes || []).forEach((route, index) => {
      const card = document.createElement("article");
      card.className = "route-preview-card" + (index === 0 ? " is-selected" : "");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = route.duration == null ? "Route" : durationText(route.duration);
      const meta = document.createElement("span");
      meta.textContent = `${distanceText(route.distance) || "—"}${route.summary ? ` · ${route.summary}` : ""}`;
      const chip = document.createElement("em");
      chip.textContent = "Driving only";
      copy.append(title, meta, chip);
      card.appendChild(copy);
      const start = document.createElement("button");
      start.type = "button";
      start.className = "route-start";
      start.textContent = "Start";
      start.addEventListener("click", (event) => {
        event.stopPropagation();
        document.dispatchEvent(new CustomEvent("smartshield:start-nav"));
      });
      card.appendChild(start);
      box.appendChild(card);
    });
  }

  function itineraryCard(item, index) {
    const card = document.createElement("article");
    card.className = "route-preview-card transit-card" + (index === 0 ? " is-selected" : "");
    const head = document.createElement("div");
    const title = document.createElement("strong");
    const start = clock(item.start);
    const end = clock(item.end);
    title.textContent = item.duration_s == null ? "Transit" : durationText(item.duration_s);
    const meta = document.createElement("span");
    const bits = [];
    if (start && end) bits.push(`${start}–${end}`);
    if (item.walk_min != null) bits.push(`${item.walk_min} min walk`);
    if (item.transfers != null) bits.push(item.transfers === 1 ? "1 transfer" : `${item.transfers} transfers`);
    meta.textContent = bits.join(" · ");
    const when = document.createElement("em");
    when.textContent = item.scheduled === false ? "Live times" : "Scheduled";
    head.append(title, meta, when);
    card.appendChild(head);
    (item.legs || []).forEach((leg) => {
      const row = document.createElement("p");
      row.className = "transit-leg" + (leg.mode === "WALK" ? " is-walk" : "");
      const swatch = document.createElement("i");
      if (leg.mode === "WALK") swatch.className = "is-dotted";
      else swatch.style.background = leg.draw_color || leg.color || "#5f6368";
      const text = document.createElement("span");
      if (leg.mode === "WALK") {
        text.textContent = walkCaption(leg);
      } else {
        const pieces = [legTitle(leg)];
        if (leg.stop_count) pieces.push(`${leg.stop_count} stops`);
        if (leg.from_name && leg.to_name) pieces.push(`${leg.from_name} → ${leg.to_name}`);
        const depart = clock(leg.departure);
        const arrive = clock(leg.arrival);
        if (depart && arrive) pieces.push(`${depart}–${arrive}`);
        text.textContent = pieces.join(" · ");
      }
      row.append(swatch, text);
      card.appendChild(row);
    });
    (item.walk_notes || walkNotes(item.legs || [])).forEach((note) => {
      const missing = document.createElement("p");
      missing.className = "transit-colour-note";
      missing.textContent = note;
      card.appendChild(missing);
    });
    (item.legs || []).forEach((leg) => {
      if (leg.color_missing) {
        const missing = document.createElement("p");
        missing.className = "transit-colour-note";
        missing.textContent = "Line colour was not provided by the agency.";
        card.appendChild(missing);
      }
    });
    const go = document.createElement("button");
    go.type = "button";
    go.className = "route-start";
    go.textContent = "Start";
    go.addEventListener("click", (event) => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent("smartshield:select-itinerary", { detail: { index } }));
      document.dispatchEvent(new CustomEvent("smartshield:start-nav"));
    });
    card.appendChild(go);
    card.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("smartshield:select-itinerary", { detail: { index } }));
    });
    return card;
  }

  function legAt(itinerary, alongM) {
    const legs = (itinerary && itinerary.legs) || [];
    if (!legs.length || !window.NavProgress) return null;
    let cursor = 0;
    let current = legs[0];
    let start = 0;
    legs.forEach((leg) => {
      const length = lineMetres(leg.geometry);
      if (alongM + 8 >= cursor) {
        current = leg;
        start = cursor;
      }
      cursor += length;
    });
    const into = Math.max(0, alongM - start);
    const length = lineMetres(current.geometry);
    const remain = Math.max(0, length - into);
    let remainingStops = null;
    if (current.mode !== "WALK" && current.stops && current.stops.length && current.geometry && current.geometry.length >= 2) {
      const line = current.geometry.map(([lon, lat]) => [lat, lon]);
      const ahead = current.stops.filter((stop) => {
        if (stop.lat == null || stop.lon == null) return false;
        const at = window.NavProgress.projectAlong(line, stop.lat, stop.lon).alongM;
        return at >= into - 20;
      }).length;
      remainingStops = ahead + 1;
    }
    const last = legs[legs.length - 1] === current;
    if (current.mode === "WALK") {
      return {
        kind: last && remain < 40 ? "arrive" : "walk",
        distanceM: remain,
        street: current.to_name || "the stop",
        shield: null,
        atLat: 0,
        atLon: 0,
      };
    }
    const title = legTitle(current);
    let street = title;
    if (remainingStops != null) street = `${title} · get off in ${remainingStops} stops`;
    else if (current.stop_count) street = `${title} · ${current.stop_count} stops`;
    const nextStop = nextStopName(current, into);
    return {
      kind: last && remain < 40 ? "arrive" : "bus",
      distanceM: remain,
      street: nextStop ? `${street} · next ${nextStop}` : street,
      shield: null,
      atLat: 0,
      atLon: 0,
    };
  }

  function nextStopName(leg, into) {
    if (!leg || !window.NavProgress || !leg.geometry || leg.geometry.length < 2) return leg && leg.to_name || "";
    const line = leg.geometry.map(([lon, lat]) => [lat, lon]);
    const upcoming = (leg.stops || []).filter((stop) => stop && stop.name && stop.lat != null && stop.lon != null && window.NavProgress.projectAlong(line, stop.lat, stop.lon).alongM >= into - 20);
    if (upcoming.length) return upcoming[0].name;
    return leg.to_name || "";
  }

  function lineMetres(geometry) {
    const line = (geometry || []).map(([lon, lat]) => [lat, lon]);
    let total = 0;
    for (let i = 1; i < line.length; i += 1) {
      total += window.NavProgress.haversineM(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    }
    return total;
  }

  function shapesFor(route, active) {
    const legs = active && route && route.legs && route.legs.some((leg) => (leg.geometry || []).length >= 2)
      ? route.legs
      : null;
    if (!legs) return null;
    return legs.map((leg) => ({
      latlngs: (leg.geometry || []).map(([lon, lat]) => [lat, lon]).filter((pair) => pair[0] != null),
      options: {
        color: leg.draw_color || leg.color || "#5f6368",
        weight: leg.mode === "WALK" ? 5 : 8,
        opacity: 0.95,
        dashArray: leg.mode === "WALK" ? "1 9" : null,
        lineCap: leg.mode === "WALK" ? "round" : "butt",
        smoothFactor: 0,
      },
    })).filter((shape) => shape.latlngs.length >= 2);
  }

  function carIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M5 16v2M19 16v2M4 16h16l-1.2-4.2A2 2 0 0 0 16.9 10H7.1a2 2 0 0 0-1.9 1.8L4 16zM7 10l1.2-3.2A2 2 0 0 1 10.1 5h3.8a2 2 0 0 1 1.9 1.8L17 10"/></svg>';
  }
  function bikeIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M6 17a3 3 0 1 0 0.01 0M18 17a3 3 0 1 0 0.01 0M6 17h6l3-6h3M9 8h4l2 3M11 8V5h3"/></svg>';
  }
  function cycleIcon() {
    return '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="16.5" r="3"/><circle cx="17.5" cy="16.5" r="3"/><path d="M6.5 16.5 11 8h4l2.5 8.5M11 8 9 5H7M15 8l2-3h2"/></svg>';
  }
  function walkIcon() {
    return '<svg viewBox="0 0 24 24"><circle cx="13" cy="5" r="1.6"/><path d="M10 21l2.2-6.2L9 12l2-3 3 2 1.2 3.2M13 10l3 2.2"/></svg>';
  }
  function busIcon() {
    return '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="14" rx="2"/><path d="M5 10h14M8 18v2M16 18v2M8 14h.01M16 14h.01"/></svg>';
  }

  document.addEventListener("DOMContentLoaded", mount);
  window.TravelModes = {
    MODES,
    current,
    isVehicle,
    mount,
    remember,
    rememberSummary,
    refreshSummaries,
    fetchMode,
    modeEchoed,
    durationText,
    distanceText,
    fillPreview,
    legAt,
    shapesFor,
  };
})();
