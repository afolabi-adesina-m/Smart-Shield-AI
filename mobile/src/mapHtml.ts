/** Leaflet map. Tiles are the public OpenStreetMap server. No map API key. */
export const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { margin: 0; height: 100%; background: #d5dde6; }
    .leaflet-control-attribution { font-size: 10px; max-width: 70%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map("map", { zoomControl: false, attributionControl: true }).setView([43.6532, -79.3832], 9);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    var drawn = L.layerGroup().addTo(map);

    function applyScene(scene) {
      drawn.clearLayers();
      var bounds = [];
      (scene.routes || []).forEach(function (route) {
        if (!route.coords || route.coords.length < 2) return;
        L.polyline(route.coords, {
          color: route.color || "#1a56db",
          weight: route.active ? 7 : 4,
          opacity: route.active ? 0.95 : 0.4
        }).addTo(drawn);
        route.coords.forEach(function (pair) { bounds.push(pair); });
      });
      (scene.markers || []).forEach(function (marker) {
        if (marker.lat == null || marker.lon == null) return;
        var pin = L.circleMarker([marker.lat, marker.lon], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: marker.color || "#1a56db",
          fillOpacity: 1
        }).addTo(drawn);
        if (marker.label) pin.bindTooltip(marker.label, { permanent: false, direction: "top" });
        bounds.push([marker.lat, marker.lon]);
      });
      if (bounds.length) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
      }
    }
    window.applyScene = applyScene;
  </script>
</body>
</html>`;
