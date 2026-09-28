/* Upcoming maneuver and along-route alert window. No network. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NavProgress = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var WINDOW_M = 1500;
  var CORRIDOR_M = 80;
  var PASSED_M = 35;

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

  function maneuverKind(step) {
    var type = String((step && step.type) || "").replace(/[_-]/g, " ").trim().toLowerCase();
    var modifier = String((step && step.modifier) || "").trim().toLowerCase();
    if (type === "arrive") return "arrive";
    if (type.indexOf("roundabout") !== -1 || type === "rotary") return "roundabout";
    if (type === "merge") return "merge";
    if (type === "off ramp" || type === "fork" || type === "exit roundabout") return "exit";
    if (modifier === "uturn") return "uturn";
    if (modifier === "sharp left" || modifier === "left") return "left";
    if (modifier === "sharp right" || modifier === "right") return "right";
    if (modifier === "slight left") return "slight-left";
    if (modifier === "slight right") return "slight-right";
    return "straight";
  }

  function stepPoint(step) {
    var location = step && step.location;
    if (location && location.length >= 2) return { lat: location[1], lon: location[0] };
    var geometry = step && step.geometry;
    if (geometry && geometry[0] && geometry[0].length >= 2) return { lat: geometry[0][1], lon: geometry[0][0] };
    return null;
  }

  function segmentT(a, b, lat, lon) {
    var midLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    var lonScale = Math.cos(midLat) * 111320;
    var dx = (b[1] - a[1]) * lonScale;
    var dy = (b[0] - a[0]) * 111320;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1) return 0;
    var px = (lon - a[1]) * lonScale;
    var py = (lat - a[0]) * 111320;
    return Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
  }

  function projectAlong(line, lat, lon) {
    if (!line || !line.length) return { alongM: 0, offM: Infinity };
    if (line.length === 1) return { alongM: 0, offM: haversineM(lat, lon, line[0][0], line[0][1]) };
    var along = 0;
    var best = { alongM: 0, offM: Infinity };
    for (var index = 1; index < line.length; index += 1) {
      var start = line[index - 1];
      var end = line[index];
      var length = haversineM(start[0], start[1], end[0], end[1]);
      var t = segmentT(start, end, lat, lon);
      var latP = start[0] + (end[0] - start[0]) * t;
      var lonP = start[1] + (end[1] - start[1]) * t;
      var off = haversineM(lat, lon, latP, lonP);
      if (off < best.offM) best = { alongM: along + length * t, offM: off };
      along += length;
    }
    return best;
  }

  function toManeuver(item, userAlong) {
    var step = item.step;
    return {
      kind: maneuverKind(step),
      distanceM: Math.max(0, item.alongM - userAlong),
      street: step.name || "Unnamed road",
      atLat: item.point.lat,
      atLon: item.point.lon,
      type: step.type || "",
      modifier: step.modifier || "",
    };
  }

  function upcomingManeuvers(steps, line, lat, lon) {
    var user = projectAlong(line, lat, lon);
    var placed = [];
    (steps || []).forEach(function (step) {
      var point = stepPoint(step);
      if (!point) return;
      var alongM = line && line.length >= 2 ? projectAlong(line, point.lat, point.lon).alongM : 0;
      placed.push({ step: step, point: point, alongM: alongM });
    });
    placed.sort(function (a, b) { return a.alongM - b.alongM; });
    var upcoming = placed.filter(function (item) { return item.alongM - user.alongM >= -PASSED_M; });
    while (
      upcoming.length > 1
      && upcoming[0].alongM - user.alongM < 40
      && String(upcoming[0].step.type || "").toLowerCase() === "depart"
    ) {
      upcoming.shift();
    }
    if (!upcoming.length) return { current: null, then: null };
    return {
      current: toManeuver(upcoming[0], user.alongM),
      then: upcoming[1] ? toManeuver(upcoming[1], user.alongM) : null,
    };
  }

  function featuresAhead(features, line, lat, lon, windowM, corridorM) {
    var windowMeters = windowM == null ? WINDOW_M : windowM;
    var corridor = corridorM == null ? CORRIDOR_M : corridorM;
    if (!line || line.length < 2) return [];
    var user = projectAlong(line, lat, lon);
    return (features || []).filter(function (feature) {
      if (feature == null || feature.lat == null || feature.lon == null) return false;
      var projected = projectAlong(line, feature.lat, feature.lon);
      if (projected.offM > corridor) return false;
      var ahead = projected.alongM - user.alongM;
      return ahead >= -PASSED_M && ahead <= windowMeters;
    });
  }

  function featuresAlongRoute(features, line, corridorM) {
    var corridor = corridorM == null ? CORRIDOR_M : corridorM;
    if (!line || line.length < 2) return [];
    return (features || []).filter(function (feature) {
      if (feature == null || feature.lat == null || feature.lon == null) return false;
      return projectAlong(line, feature.lat, feature.lon).offM <= corridor;
    });
  }

  return {
    WINDOW_M: WINDOW_M,
    CORRIDOR_M: CORRIDOR_M,
    PASSED_M: PASSED_M,
    haversineM: haversineM,
    maneuverKind: maneuverKind,
    projectAlong: projectAlong,
    upcomingManeuvers: upcomingManeuvers,
    featuresAhead: featuresAhead,
    featuresAlongRoute: featuresAlongRoute,
  };
});
