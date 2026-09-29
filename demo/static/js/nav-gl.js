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

  function signImage(draw) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    draw(canvas.getContext("2d"));
    return canvas.getContext("2d").getImageData(0, 0, 32, 32);
  }

  function addSignImages() {
    if (!map || map.hasImage("sign-stop")) return;
    map.addImage("sign-stop", signImage((ctx) => {
      ctx.translate(16, 16);
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = -Math.PI / 2 - Math.PI / 8 + i * (Math.PI / 4);
        const x = Math.cos(angle) * 13;
        const y = Math.sin(angle) * 13;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "#d93025";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }), { pixelRatio: 2 });
    map.addImage("sign-signal", signImage((ctx) => {
      ctx.fillStyle = "#111111";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(11, 2, 10, 28, 3);
      ctx.fill();
      ctx.stroke();
      [[8, "#3a3a3a"], [16, "#3ddc6a"], [24, "#3a3a3a"]].forEach(([y, color]) => {
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(16, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }), { pixelRatio: 2 });
  }

  function ensureLayers() {
    if (map.getSource("route-ahead")) return;
    addSignImages();
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
      type: "symbol",
      source: "nav-signs",
      layout: {
        "icon-image": ["match", ["get", "kind"], "stop", "sign-stop", "stop-all", "sign-stop", "sign-signal"],
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    ensureBuildings();
  }

  function movePuck(lon, lat) {
    const travel = (pending && pending.travelMode) || "drive";
    const puckClass = travel === "walk" ? "nav-gl-puck is-walk" : travel === "cycle" ? "nav-gl-puck is-cycle" : "nav-gl-puck";
    if (!puck) {
      const el = document.createElement("div");
      el.className = puckClass;
      puck = new window.maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
      return;
    }
    puck.getElement().className = puckClass;
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
