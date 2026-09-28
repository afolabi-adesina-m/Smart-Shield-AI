import { stopLayout, stopSignSvg } from "./stopSign";

const regularStop = stopLayout(false);
const allWayStop = stopLayout(true);

/** Browser preview map. Phones use the native map in MapCanvas.tsx. Tiles are OpenStreetMap. No map API key. */
export const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { margin: 0; height: 100%; background: #d5dde6; }
    .leaflet-tile-pane.night { filter: invert(100%) hue-rotate(180deg) brightness(0.82) contrast(0.95) saturate(0.35); }
    .leaflet-control-attribution { font-size: 9px; background: rgba(0,0,0,0.45); color: #c5d0dc; }
    .leaflet-control-attribution a { color: #9ecbff; }
    .leaflet-div-icon.plain { background: transparent; border: none; }
    .puck { width: 36px; height: 36px; position: relative; }
    .puck .arrow {
      position: absolute; left: 10px; top: 0;
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 16px solid #1a73e8;
      filter: drop-shadow(0 0 1px #fff);
    }
    .puck .dot {
      position: absolute; left: 6px; top: 14px;
      width: 22px; height: 22px; border-radius: 50%;
      background: #1a73e8; border: 3px solid #fff;
      box-shadow: 0 0 0 7px rgba(26,115,232,0.28);
    }
    .signal {
      width: 12px; height: 26px; border-radius: 3px; background: #111;
      border: 1px solid #fff; display: flex; flex-direction: column;
      align-items: center; justify-content: space-around; padding: 2px 0;
    }
    .signal i { width: 6px; height: 6px; border-radius: 50%; background: #3a3a3a; display: block; }
    .signal i.on { background: #3ddc6a; }
    .report-pin {
      width: 0; height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 12px solid #f5c542;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate.js"></script>
  <script>
    var map;
    try {
      map = L.map("map", {
        zoomControl: false,
        attributionControl: true,
        rotate: true,
        bearing: 0,
        touchRotate: false,
        rotateControl: false
      });
    } catch (err) {
      map = L.map("map", { zoomControl: false, attributionControl: true });
    }
    map.setView([43.6532, -79.3832], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    var drawn = L.layerGroup().addTo(map);
    var STOP_SVG = ${JSON.stringify(stopSignSvg(false))};
    var STOP_ALL_SVG = ${JSON.stringify(stopSignSvg(true))};

    function icon(html, w, h, ax, ay) {
      return L.divIcon({
        className: "plain",
        html: html,
        iconSize: [w, h],
        iconAnchor: [ax == null ? w / 2 : ax, ay == null ? h / 2 : ay]
      });
    }

    function setBearing(deg) {
      if (typeof map.setBearing === "function") map.setBearing(deg || 0);
    }

    function applyScene(scene) {
      drawn.clearLayers();
      var bounds = [];
      (scene.heat || []).forEach(function (spot) {
        if (spot.lat == null || spot.lon == null) return;
        var order = spot.kind === "order";
        var alpha = order ? 0.55 + spot.weight * 0.35 : 0.42 + spot.weight * 0.4;
        L.circle([spot.lat, spot.lon], {
          radius: order ? 180 : 280,
          color: order ? "#1a56db" : "#e23b2f",
          weight: order ? 2 : 0,
          fillColor: order ? "#1a56db" : "#e23b2f",
          fillOpacity: alpha,
          interactive: false
        }).addTo(drawn);
      });
      (scene.routes || []).forEach(function (route) {
        if (!route.coords || route.coords.length < 2) return;
        if (route.active) {
          L.polyline(route.coords, { color: "#ffffff", weight: 12, opacity: 0.92 }).addTo(drawn);
          L.polyline(route.coords, { color: route.color || "#4da3ff", weight: 7, opacity: 1 }).addTo(drawn);
        } else {
          L.polyline(route.coords, { color: route.color || "#8aa0b8", weight: 5, opacity: 0.55 }).addTo(drawn);
        }
        route.coords.forEach(function (pair) { bounds.push(pair); });
      });
      (scene.markers || []).forEach(function (marker) {
        if (marker.lat == null || marker.lon == null) return;
        L.circleMarker([marker.lat, marker.lon], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: marker.color || "#e23b2f",
          fillOpacity: 1
        }).addTo(drawn);
        bounds.push([marker.lat, marker.lon]);
      });
      (scene.signs || []).forEach(function (sign) {
        if (sign.lat == null || sign.lon == null) return;
        var html = '<div class="signal"><i></i><i class="on"></i><i></i></div>';
        var w = 12, h = 26, ax = null, ay = null;
        if (sign.kind === "stop") {
          html = STOP_SVG; w = ${regularStop.width}; h = ${regularStop.height};
          ax = ${regularStop.cx}; ay = ${regularStop.cy};
        }
        if (sign.kind === "stop-all") {
          html = STOP_ALL_SVG; w = ${allWayStop.width}; h = ${allWayStop.height};
          ax = ${allWayStop.cx}; ay = ${allWayStop.cy};
        }
        if (sign.kind === "report") { html = '<div class="report-pin"></div>'; w = 16; h = 14; ax = null; ay = null; }
        L.marker([sign.lat, sign.lon], { icon: icon(html, w, h, ax, ay), interactive: false }).addTo(drawn);
      });
      if (scene.user && scene.user.lat != null) {
        var heading = scene.user.heading || 0;
        var relative = scene.headingUp ? 0 : heading;
        var puck = '<div class="puck"><div class="arrow" style="transform:rotate(' + relative + 'deg);transform-origin:50% 22px"></div><div class="dot"></div></div>';
        L.marker([scene.user.lat, scene.user.lon], {
          icon: icon(puck, 36, 36),
          interactive: false,
          zIndexOffset: 800
        }).addTo(drawn);
        bounds.push([scene.user.lat, scene.user.lon]);
      }
      var tiles = document.querySelector(".leaflet-tile-pane");
      if (tiles) tiles.classList.toggle("night", !!scene.night);
      document.body.style.background = scene.night ? "#0e1620" : "#d5dde6";
      if (scene.camera === "follow" && scene.user) {
        var zoom = map.getZoom();
        if (!zoom || zoom < 15) zoom = 16;
        map.setView([scene.user.lat, scene.user.lon], zoom, { animate: false });
        setBearing(scene.headingUp ? (scene.user.heading || 0) : 0);
      } else if (bounds.length) {
        setBearing(0);
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
      }
    }
    window.applyScene = applyScene;
  </script>
</body>
</html>`;
