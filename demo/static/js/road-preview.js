/* Street-name previews for a drawn route. Shared by the website and the phone web view. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RoadPreview = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var UNNAMED_ROAD = "Unnamed road";
  var HIGHWAY_REF = /^\d{1,4}[A-Z]?$/;
  var sessions = typeof WeakMap === "function" ? new WeakMap() : null;

  function roadLabel(name, ref) {
    var cleaned = String(name || "").trim();
    if (cleaned) return cleaned;
    var roadRef = String(ref || "").trim();
    if (HIGHWAY_REF.test(roadRef)) return "Hwy " + roadRef;
    if (roadRef) return roadRef;
    return UNNAMED_ROAD;
  }

  function stepInstruction(kind, modifier, label) {
    var maneuver = String(kind || "").replace(/[_-]/g, " ").trim().toLowerCase();
    var turn = String(modifier || "").trim().toLowerCase();
    if (maneuver === "depart") return "Head onto " + label;
    if (maneuver === "arrive") return "Arrive · " + label;
    var leads = {
      left: "Turn left onto",
      right: "Turn right onto",
      "slight left": "Bear left onto",
      "slight right": "Bear right onto",
      straight: "Continue on",
      uturn: "Make a U-turn onto",
    };
    if (leads[turn]) return leads[turn] + " " + label;
    return "Continue on " + label;
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    var radius = 6371000;
    var p1 = lat1 * Math.PI / 180;
    var p2 = lat2 * Math.PI / 180;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function nearestStep(steps, lat, lon) {
    var best = null;
    var bestDistance = Infinity;
    (steps || []).forEach(function (step) {
      (step.geometry || []).forEach(function (pair) {
        if (!pair || pair.length < 2) return;
        var distance = haversineM(lat, lon, pair[1], pair[0]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = step;
        }
      });
    });
    return best;
  }

  function session(map) {
    if (!sessions) return { highlight: null, marker: null, pinned: null, lineTip: null };
    var current = sessions.get(map);
    if (!current) {
      current = { highlight: null, marker: null, pinned: null, lineTip: null };
      sessions.set(map, current);
    }
    return current;
  }

  function dropLayers(map, state) {
    if (state.highlight) {
      map.removeLayer(state.highlight);
      state.highlight = null;
    }
    if (state.marker) {
      map.removeLayer(state.marker);
      state.marker = null;
    }
  }

  function clearPreviewMarks() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".direction-step.is-preview").forEach(function (el) {
      el.classList.remove("is-preview");
    });
  }

  function clear(map, force) {
    if (typeof L === "undefined" || !map) return;
    var state = session(map);
    if (state.pinned && !force) return;
    dropLayers(map, state);
    if (state.lineTip && map.hasLayer(state.lineTip)) map.removeLayer(state.lineTip);
    state.pinned = null;
    clearPreviewMarks();
  }

  function pointOf(step) {
    if (step.location && step.location.length >= 2) return [step.location[1], step.location[0]];
    var geometry = step.geometry || [];
    if (geometry[0] && geometry[0].length >= 2) return [geometry[0][1], geometry[0][0]];
    return null;
  }

  function show(map, step, pin, row) {
    if (typeof L === "undefined" || !map || !step) return;
    var state = session(map);
    dropLayers(map, state);
    if (state.lineTip && map.hasLayer(state.lineTip)) map.removeLayer(state.lineTip);
    state.pinned = pin ? step : null;
    var latlngs = (step.geometry || []).filter(function (pair) {
      return pair && pair.length >= 2;
    }).map(function (pair) {
      return [pair[1], pair[0]];
    });
    if (latlngs.length >= 2) {
      state.highlight = L.polyline(latlngs, {
        color: "#f5c542",
        weight: 10,
        opacity: 0.95,
        interactive: false,
        className: "road-preview-highlight",
      }).addTo(map);
    }
    var point = pointOf(step);
    if (point) {
      state.marker = L.circleMarker(point, {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#14685c",
        fillOpacity: 1,
        interactive: false,
        className: "road-preview-marker",
      }).addTo(map);
      state.marker.bindTooltip(step.name || UNNAMED_ROAD, {
        permanent: true,
        direction: "top",
        className: "road-preview-tip",
        offset: [0, -6],
      }).openTooltip();
    }
    clearPreviewMarks();
    if (pin && row) row.classList.add("is-preview");
  }

  function bindRouteHover(map, line, steps) {
    var state = session(map);
    line.on("mousemove", function (event) {
      if (state.pinned) return;
      var step = nearestStep(steps, event.latlng.lat, event.latlng.lng);
      if (!step) return;
      if (!state.lineTip) {
        state.lineTip = L.tooltip({
          sticky: true,
          className: "road-preview-tip",
          direction: "top",
          opacity: 1,
        });
      }
      state.lineTip.setContent(step.name || UNNAMED_ROAD);
      state.lineTip.setLatLng(event.latlng);
      if (!map.hasLayer(state.lineTip)) state.lineTip.addTo(map);
    });
    line.on("mouseout", function () {
      if (state.pinned) return;
      if (state.lineTip && map.hasLayer(state.lineTip)) map.removeLayer(state.lineTip);
    });
    line.on("click", function (event) {
      var step = nearestStep(steps, event.latlng.lat, event.latlng.lng);
      if (!step) return;
      show(map, step, true, null);
    });
  }

  function attachHits(map, routes, routeLayers) {
    (routes || []).forEach(function (route) {
      if (!route.steps || !route.steps.length || !route.geometry) return;
      var latlngs = route.geometry.map(function (pair) { return [pair[1], pair[0]]; });
      var hit = L.polyline(latlngs, {
        weight: 22,
        opacity: 0,
        className: "road-preview-hit",
      }).addTo(map);
      if (routeLayers) routeLayers.push(hit);
      bindRouteHover(map, hit, route.steps);
    });
  }

  function setListVisible(list, visible) {
    list.hidden = !visible;
    var label = document.getElementById("direction-steps-label");
    if (label) label.hidden = !visible;
  }

  function fillList(map, list, steps) {
    if (!list) return;
    list.innerHTML = "";
    if (!steps || !steps.length) {
      setListVisible(list, false);
      return;
    }
    setListVisible(list, true);
    steps.forEach(function (step) {
      var item = document.createElement("li");
      item.className = "direction-step";
      item.tabIndex = 0;
      item.dataset.road = step.name || UNNAMED_ROAD;
      var instruction = document.createElement("span");
      instruction.className = "direction-instruction";
      instruction.textContent = step.instruction || step.name || UNNAMED_ROAD;
      var tip = document.createElement("span");
      tip.className = "road-name-tip";
      tip.textContent = step.name || UNNAMED_ROAD;
      item.appendChild(instruction);
      item.appendChild(tip);
      item.addEventListener("mouseenter", function () { show(map, step, false, item); });
      item.addEventListener("mouseleave", function () { clear(map, false); });
      item.addEventListener("focus", function () { show(map, step, false, item); });
      item.addEventListener("blur", function () { clear(map, false); });
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        if (session(map).pinned === step) clear(map, true);
        else show(map, step, true, item);
      });
      list.appendChild(item);
    });
  }

  return {
    UNNAMED_ROAD: UNNAMED_ROAD,
    roadLabel: roadLabel,
    stepInstruction: stepInstruction,
    nearestStep: nearestStep,
    clear: clear,
    show: show,
    attachHits: attachHits,
    fillList: fillList,
  };
});
