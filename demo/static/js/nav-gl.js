/* Keyless vector map for website navigation. Leaflet stays underneath if this fails. */

(function () {
  const LIBERTY = "https://tiles.openfreemap.org/styles/liberty";
  const DARK = "https://tiles.openfreemap.org/styles/dark";
  let map = null;
  let puck = null;
  let ready = false;
  let failed = false;
  let pending = null;
  let styleUrl = "";

  function emptyCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function lineFeature(latlons) {
    const coords = (latlons || []).filter((pair) => pair && pair.length >= 2).map((pair) => [pair[1], pair[0]]);
    if (coords.length < 2) return emptyCollection();
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    };
  }

  function host() {
    return document.getElementById("nav-gl");
  }

  function fail() {
    failed = true;
    ready = false;
    document.body.classList.remove("nav-gl-live");
    const box = host();
    if (box) box.hidden = true;
    if (map) {
      try { map.remove(); } catch (err) { /* already gone */ }
      map = null;
    }
  }

  function ensureBuildings() {
    if (!map.getSource("openmaptiles") || map.getLayer("building-3d")) return;
    map.addLayer({
      id: "building-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 15,
      paint: {
        "fill-extrusion-color": styleUrl === DARK ? "#2a3340" : "#d9dee6",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.9,
      },
    });
  }

  function ensureLayers() {
    if (map.getSource("route-ahead")) return;
    map.addSource("route-ahead", { type: "geojson", data: emptyCollection() });
    map.addSource("route-travel", { type: "geojson", data: emptyCollection() });
    map.addSource("nav-signs", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "route-ahead-case",
      type: "line",
      source: "route-ahead",
      paint: { "line-color": "#123a66", "line-width": 12, "line-opacity": 0.95 },
    });
    map.addLayer({
      id: "route-ahead-core",
      type: "line",
      source: "route-ahead",
      paint: { "line-color": "#4da3ff", "line-width": 7 },
    });
    map.addLayer({
      id: "route-travel",
      type: "line",
      source: "route-travel",
      paint: { "line-color": "#8b97a6", "line-width": 7 },
    });
    map.addLayer({
      id: "nav-signs",
      type: "circle",
      source: "nav-signs",
      paint: {
        "circle-radius": 5,
        "circle-color": ["match", ["get", "kind"], "stop", "#d93025", "stop-all", "#d93025", "#f5c542"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    ensureBuildings();
  }

  function movePuck(lon, lat) {
    if (!puck) {
      const el = document.createElement("div");
      el.className = "nav-gl-puck";
      puck = new window.maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
      return;
    }
    puck.setLngLat([lon, lat]);
  }

  function ensure() {
    if (failed || map || !window.maplibregl) {
      if (!window.maplibregl) fail();
      return;
    }
    const box = host();
    if (!box) return;
    box.hidden = false;
    try {
      map = new window.maplibregl.Map({
        container: box,
        style: document.documentElement.getAttribute("data-theme") === "dark" ? DARK : LIBERTY,
        center: [-79.3832, 43.6532],
        zoom: 17,
        pitch: 52,
        bearing: 0,
        attributionControl: true,
        fadeDuration: 0,
      });
      styleUrl = map.getStyle() && map.getStyle().name ? "" : (document.documentElement.getAttribute("data-theme") === "dark" ? DARK : LIBERTY);
      map.on("error", (event) => {
        const message = String((event && event.error && event.error.message) || "");
        if (!ready && /style|sprite|glyph|fetch|ajax/i.test(message)) fail();
      });
      map.on("load", () => {
        ready = true;
        styleUrl = document.documentElement.getAttribute("data-theme") === "dark" ? DARK : LIBERTY;
        ensureLayers();
        if (pending) apply(pending);
      });
      map.on("dragstart", () => {
        document.dispatchEvent(new CustomEvent("smartshield:usermove", { detail: { reason: "pan" } }));
      });
    } catch (err) {
      fail();
    }
  }

  function apply(frame) {
    pending = frame || { navigating: false };
    if (!pending.navigating) {
      document.body.classList.remove("nav-gl-live");
      return;
    }
    if (failed) return;
    ensure();
    if (!map || !ready) return;
    const nextStyle = pending.night ? DARK : LIBERTY;
    if (styleUrl && styleUrl !== nextStyle) {
      styleUrl = nextStyle;
      ready = false;
      map.setStyle(nextStyle);
      map.once("style.load", () => {
        ready = true;
        ensureLayers();
        apply(pending);
      });
      return;
    }
    styleUrl = nextStyle;
    document.body.classList.add("nav-gl-live");
    const box = host();
    if (box) box.hidden = false;
    ensureLayers();
    const ahead = map.getSource("route-ahead");
    const travel = map.getSource("route-travel");
    const signs = map.getSource("nav-signs");
    if (ahead) ahead.setData(lineFeature(pending.ahead));
    if (travel) travel.setData(lineFeature(pending.traveled));
    if (signs) {
      signs.setData({
        type: "FeatureCollection",
        features: (pending.signs || []).filter((sign) => sign.lat != null).map((sign) => ({
          type: "Feature",
          properties: { kind: sign.kind || "signal" },
          geometry: { type: "Point", coordinates: [sign.lon, sign.lat] },
        })),
      });
    }
    if (pending.lon != null && pending.lat != null) {
      movePuck(pending.lon, pending.lat);
      map.easeTo({
        center: [pending.lon, pending.lat],
        bearing: pending.bearing || 0,
        pitch: pending.pitch == null ? 52 : pending.pitch,
        zoom: pending.zoom || 17,
        duration: pending.jump ? 0 : 650,
        essential: true,
      });
    }
  }

  document.addEventListener("smartshield:nav-frame", (event) => apply(event.detail || { navigating: false }));
  window.SmartShieldNavGl = { failed: () => failed };
})();
