/* Cameras and variable speed zones. Keep in sync with mobile/src/cameras.ts. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SmartShieldCameras = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DISCLAIMER = "Camera locations from OpenStreetMap and City of Toronto open data; may be incomplete.";
  const HIGHWAY_ROADS = { motorway: 1, trunk: 1, motorway_link: 1, trunk_link: 1 };
  const HIGHWAY_MODES = { HIGHWAY: 1, highway: 1, motorway: 1, trunk: 1 };
  const CITY_M = 250;
  const HIGHWAY_M = 400;
  const DEDUPE_M = 30;
  const ROUTE_CORRIDOR_M = 60;
  const AHEAD_DEG = 60;

  function haversineM(lat1, lon1, lat2, lon2) {
    const radius = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function headingDelta(heading, bearing) {
    return (bearing - heading + 540) % 360 - 180;
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function parseLimit() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value == null || value === "") continue;
      const text = String(value).trim().toLowerCase();
      if (!text || ["signals", "variable", "yes", "no", "none", "walk", "urban", "rural"].indexOf(text) >= 0) continue;
      const match = text.match(/(\d+(?:\.\d+)?)/);
      if (!match) continue;
      let number = Number(match[1]);
      if (text.indexOf("mph") >= 0) number *= 1.60934;
      if (number >= 5 && number <= 200) return Math.round(number);
    }
    return null;
  }

  function sample(points, limit) {
    if (points.length <= limit) return points;
    const step = points.length / limit;
    const out = [];
    for (let index = 0; index < limit; index += 1) out.push(points[Math.floor(index * step)]);
    return out;
  }

  function elementPoints(element, nodes) {
    if (element.lat != null && element.lon != null) return [[Number(element.lat), Number(element.lon)]];
    const center = element.center || {};
    if (center.lat != null && center.lon != null) return [[Number(center.lat), Number(center.lon)]];
    const geometry = [];
    (element.geometry || []).forEach((point) => {
      if (point && point.lat != null && point.lon != null) geometry.push([Number(point.lat), Number(point.lon)]);
    });
    if (geometry.length) return sample(geometry, 40);
    if (element.type === "relation") {
      const ranked = [];
      (element.members || []).forEach((member) => {
        const role = String(member.role || "").toLowerCase();
        if (role !== "device" && role !== "from") return;
        let lat = member.lat;
        let lon = member.lon;
        if (lat == null || lon == null) {
          const found = nodes[member.ref];
          if (!found) return;
          lat = found[0];
          lon = found[1];
        }
        ranked.push([role === "device" ? 0 : 1, [Number(lat), Number(lon)]]);
      });
      ranked.sort((a, b) => a[0] - b[0]);
      if (ranked.length) return [ranked[0][1]];
    }
    return [];
  }

  function kindFromTags(tags) {
    const highway = String(tags.highway || "").toLowerCase();
    const enforcement = String(tags.enforcement || "").toLowerCase();
    const signal = enforcement === "traffic_signals" || enforcement === "red_light" || enforcement === "traffic_signal"
      || enforcement.indexOf("signal") >= 0 || enforcement.indexOf("red_light") >= 0 || enforcement.indexOf("red") >= 0;
    if (highway === "speed_camera" || enforcement === "maxspeed" || enforcement === "average_speed" || enforcement === "speed" || enforcement.indexOf("speed") >= 0) {
      if (signal) return "red_light";
      if (highway === "speed_camera" || enforcement) return "speed_camera";
    }
    if (signal && enforcement) return "red_light";
    if (tags["maxspeed:variable"] != null && tags["maxspeed:variable"] !== "" || String(tags.maxspeed || "").toLowerCase() === "signals") {
      return "variable";
    }
    const sign = String(tags.traffic_sign || "").toLowerCase();
    if (sign.indexOf("variable") >= 0 && (sign.indexOf("speed") >= 0 || sign.indexOf("maxspeed") >= 0)) return "variable";
    if (enforcement) return "speed_camera";
    return null;
  }

  function roadClass(tags) {
    const highway = String(tags.highway || "").toLowerCase();
    return HIGHWAY_ROADS[highway] ? highway : null;
  }

  function parseOverpass(elements) {
    const nodes = {};
    (elements || []).forEach((element) => {
      if (element.type === "node" && element.id != null && element.lat != null) {
        nodes[element.id] = [Number(element.lat), Number(element.lon)];
      }
    });
    const found = [];
    (elements || []).forEach((element) => {
      const tags = element.tags || {};
      if (element.type === "relation" && String(tags.type || "").toLowerCase() !== "enforcement") return;
      if (element.type === "relation") {
        const enforcement = String(tags.enforcement || "").toLowerCase();
        if (enforcement !== "maxspeed" && enforcement !== "traffic_signals" && enforcement.indexOf("speed") < 0 && enforcement.indexOf("signal") < 0) return;
      }
      const kind = kindFromTags(tags);
      if (!kind) return;
      const points = elementPoints(element, nodes);
      if (!points.length) return;
      const midpoint = points[Math.floor(points.length / 2)];
      found.push({
        id: `osm:${element.type || "node"}:${element.id}`,
        kind,
        lat: midpoint[0],
        lon: midpoint[1],
        limit_kmh: parseLimit(tags["maxspeed:variable"], tags.maxspeed, tags["maxspeed:forward"]),
        source: "osm",
        road_class: roadClass(tags),
        name: tags.name || tags.description || "",
        points,
      });
    });
    return collapse(found, 20);
  }

  function collapse(features, metres) {
    const kept = [];
    features.forEach((item) => {
      const match = kept.find((other) => other.kind === item.kind && haversineM(item.lat, item.lon, other.lat, other.lon) <= metres);
      if (!match) {
        kept.push(item);
        return;
      }
      if (match.limit_kmh == null && item.limit_kmh != null) match.limit_kmh = item.limit_kmh;
    });
    return kept;
  }

  function dedupeCameras(osm, toronto, metres) {
    const limit = metres == null ? DEDUPE_M : metres;
    const kept = (osm || []).map((item) => Object.assign({}, item, {
      points: (item.points && item.points.length) ? item.points.slice() : [[item.lat, item.lon]],
    }));
    (toronto || []).forEach((item) => {
      const duplicate = kept.find((other) => other.kind === item.kind && haversineM(item.lat, item.lon, other.lat, other.lon) <= limit);
      if (duplicate) {
        if (duplicate.limit_kmh == null && item.limit_kmh != null) duplicate.limit_kmh = item.limit_kmh;
        return;
      }
      kept.push(item);
    });
    return kept;
  }

  function warnDistance(feature, roadMode) {
    if (feature.road_class && HIGHWAY_ROADS[feature.road_class]) return HIGHWAY_M;
    if (roadMode && HIGHWAY_MODES[roadMode]) return HIGHWAY_M;
    return CITY_M;
  }

  function featurePoints(feature) {
    if (feature.points && feature.points.length) return feature.points;
    return [[feature.lat, feature.lon]];
  }

  function distanceTo(feature, lat, lon) {
    return Math.min.apply(null, featurePoints(feature).map((point) => haversineM(lat, lon, point[0], point[1])));
  }

  function onRoute(feature, route) {
    if (!route || !route.length) return false;
    return featurePoints(feature).some((point) => route.some((stop) => haversineM(point[0], point[1], stop[0], stop[1]) <= ROUTE_CORRIDOR_M));
  }

  function aheadOfHeading(feature, lat, lon, heading) {
    if (heading == null || Number.isNaN(Number(heading))) return false;
    let nearest = featurePoints(feature)[0];
    let best = Infinity;
    featurePoints(feature).forEach((point) => {
      const distance = haversineM(lat, lon, point[0], point[1]);
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    });
    const bearing = bearingDeg(lat, lon, nearest[0], nearest[1]);
    return Math.abs(headingDelta(Number(heading), bearing)) <= AHEAD_DEG;
  }

  function alertPhrase(feature, postedKmh) {
    let limit = feature.limit_kmh;
    if (limit == null && postedKmh != null && postedKmh !== "") {
      const number = Math.round(Number(postedKmh));
      if (!Number.isNaN(number)) limit = number;
    }
    if (feature.kind === "red_light") return "Red light camera at the next intersection";
    if (feature.kind === "speed_camera") {
      return limit ? `Speed camera ahead, limit ${Number(limit)}` : "Speed camera ahead";
    }
    return limit ? `Variable speed limit zone, usually posted ${Number(limit)}` : "Variable speed limit zone";
  }

  function spokenHas(spoken, id) {
    if (!spoken) return false;
    if (typeof spoken.has === "function") return spoken.has(id);
    return !!spoken[id];
  }

  function alertsAhead(features, lat, lon, options) {
    const opts = options || {};
    const route = opts.route || [];
    const useRoute = route.length >= 2;
    const chosen = [];
    (features || []).forEach((feature) => {
      if (!feature.id || spokenHas(opts.spoken, feature.id)) return;
      const distance = distanceTo(feature, lat, lon);
      if (distance > warnDistance(feature, opts.roadMode) || distance < 15) return;
      if (useRoute) {
        if (!onRoute(feature, route)) return;
      } else if (!aheadOfHeading(feature, lat, lon, opts.heading)) return;
      chosen.push([distance, feature]);
    });
    chosen.sort((a, b) => a[0] - b[0]);
    return chosen.map((item) => ({
      id: item[1].id,
      kind: item[1].kind,
      phrase: alertPhrase(item[1], opts.postedKmh),
      distance_m: Math.round(item[0] * 10) / 10,
    }));
  }

  function overpassQuery(lat, lon) {
    const around = `(around:1400,${Number(lat)},${Number(lon)})`;
    return `[out:json][timeout:18];(node["highway"="speed_camera"]${around};node["enforcement"]${around};way["maxspeed:variable"]${around};way["maxspeed"="signals"]${around};node["traffic_sign"~"variable",i]${around};way["traffic_sign"~"variable",i]${around};);out tags center;rel["type"="enforcement"]["enforcement"~"maxspeed|traffic_signals"]${around};out geom;`;
  }

  function iconHtml(feature) {
    if (feature.kind === "variable") {
      const label = feature.limit_kmh ? String(feature.limit_kmh) : "VAR";
      return `<div class="cam-var" title="Variable speed limit">${label}</div>`;
    }
    if (feature.kind === "red_light") {
      return '<div class="cam cam-red" title="Red light camera"><i></i></div>';
    }
    const label = feature.limit_kmh ? `<b>${feature.limit_kmh}</b>` : "<i></i>";
    return `<div class="cam cam-speed" title="Speed camera">${label}</div>`;
  }

  return {
    DISCLAIMER,
    haversineM,
    parseOverpass,
    dedupeCameras,
    alertsAhead,
    alertPhrase,
    overpassQuery,
    iconHtml,
  };
});
